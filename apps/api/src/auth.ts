import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { olooRequest } from "./oloo.js";

const roleSchema = z.union([z.string(), z.object({ name: z.string() })]).transform(role => (typeof role === "string" ? role : role.name));

const loginResponseSchema = z.object({
	success: z.boolean(),
	user: z.object({ email: z.string().email(), userId: z.number(), roles: z.array(roleSchema) }),
	accessToken: z.object({ id: z.string().min(20), ttl: z.number(), created: z.string(), userId: z.number(), roles: z.array(roleSchema) })
});

export interface ProviderSession {
	id: string;
	email: string;
	userId: number;
	roles: string[];
	accessToken: string;
	issuedAt: number;
	expiresAt: number;
}

/** Issue and expiry times from the provider JWT; falls back to `ttlSeconds` when the token carries no `exp`. */
export function tokenLifetime(token: string, ttlSeconds?: number) {
	let payload: { iat?: unknown; exp?: unknown } = {};
	try {
		payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as typeof payload;
	} catch {
		// Opaque token: rely on the provider ttl.
	}
	const issuedAt = typeof payload.iat === "number" ? payload.iat * 1000 : Date.now();
	const expiresAt = typeof payload.exp === "number" ? payload.exp * 1000 : issuedAt + (ttlSeconds ?? 0) * 1000;
	return { issuedAt, expiresAt };
}

/** Refresh once half of the provider token lifetime has passed. */
export function needsRefresh(session: ProviderSession, now = Date.now()) {
	return now >= session.issuedAt + (session.expiresAt - session.issuedAt) / 2 && now < session.expiresAt;
}

export class SessionStore {
	readonly #sessions = new Map<string, ProviderSession>();
	readonly #database: pg.Pool | null;
	readonly #encryptionKey: Buffer | null;

	constructor(database: pg.Pool | null = null, encryptionKey?: string) {
		this.#database = database;
		this.#encryptionKey = encryptionKey ? Buffer.from(encryptionKey, "hex") : null;
		if (database && this.#encryptionKey?.length !== 32) throw new Error("SESSION_ENCRYPTION_KEY must be 64 hexadecimal characters when DATABASE_URL is configured");
	}

	async create(login: z.infer<typeof loginResponseSchema>) {
		const id = randomUUID();
		const session: ProviderSession = {
			id,
			email: login.user.email,
			userId: login.user.userId,
			roles: login.user.roles,
			accessToken: login.accessToken.id,
			...tokenLifetime(login.accessToken.id, login.accessToken.ttl)
		};
		this.#sessions.set(id, session);
		if (this.#database && this.#encryptionKey) {
			const client = await this.#database.connect();
			try {
				await client.query("BEGIN");
				const user = await client.query<{ id: string }>(
					`INSERT INTO users (email, provider_user_id, roles)
					 VALUES ($1, $2, $3::jsonb)
					 ON CONFLICT (email) DO UPDATE SET provider_user_id = EXCLUDED.provider_user_id, roles = EXCLUDED.roles
					 RETURNING id`,
					[session.email, session.userId, JSON.stringify(session.roles)]
				);
				const localUserId = user.rows[0]?.id;
				if (!localUserId) throw new Error("Failed to persist session user");
				await client.query(
					`INSERT INTO provider_credentials (user_id, ciphertext, key_version)
					 VALUES ($1, $2, 1)
					 ON CONFLICT (user_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, key_version = EXCLUDED.key_version, updated_at = now()`,
					[localUserId, encryptToken(session.accessToken, this.#encryptionKey)]
				);
				await client.query(
					`INSERT INTO sessions (user_id, token_hash, expires_at)
					 VALUES ($1, $2, $3)
					 ON CONFLICT (token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
					[localUserId, sessionHash(id), new Date(session.expiresAt)]
				);
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK");
				this.#sessions.delete(id);
				throw error;
			} finally {
				client.release();
			}
		}
		return session;
	}

	async get(id?: string) {
		if (!id) return null;
		const session = this.#sessions.get(id);
		if (session?.expiresAt && session.expiresAt <= Date.now()) {
			this.#sessions.delete(id);
			return null;
		}
		if (session) return session;
		if (!this.#database || !this.#encryptionKey) return null;
		const result = await this.#database.query<{
			email: string;
			provider_user_id: string;
			roles: unknown;
			expires_at: Date;
			ciphertext: Buffer;
		}>(
			`SELECT u.email, u.provider_user_id, u.roles, s.expires_at, p.ciphertext
			 FROM sessions s
			 JOIN users u ON u.id = s.user_id
			 JOIN provider_credentials p ON p.user_id = u.id
			 WHERE s.token_hash = $1 AND s.expires_at > now()`,
			[sessionHash(id)]
		);
		const row = result.rows[0];
		if (!row) return null;
		const accessToken = decryptToken(row.ciphertext, this.#encryptionKey);
		const restored: ProviderSession = {
			id,
			email: row.email,
			userId: Number(row.provider_user_id),
			roles: z.array(z.string()).parse(row.roles),
			accessToken,
			issuedAt: tokenLifetime(accessToken).issuedAt,
			expiresAt: row.expires_at.getTime()
		};
		this.#sessions.set(id, restored);
		return restored;
	}

	async getForProviderUser(userId: number) {
		for (const session of this.#sessions.values()) if (session.userId === userId && session.expiresAt > Date.now()) return session;
		if (!this.#database || !this.#encryptionKey) return null;
		const result = await this.#database.query<{
			email: string;
			provider_user_id: string;
			roles: unknown;
			expires_at: Date;
			ciphertext: Buffer;
		}>(
			`SELECT u.email, u.provider_user_id, u.roles, s.expires_at, p.ciphertext
			 FROM users u
			 JOIN provider_credentials p ON p.user_id = u.id
			 JOIN sessions s ON s.user_id = u.id
			 WHERE u.provider_user_id = $1 AND s.expires_at > now()
			 ORDER BY s.expires_at DESC LIMIT 1`,
			[userId]
		);
		const row = result.rows[0];
		if (!row) return null;
		const accessToken = decryptToken(row.ciphertext, this.#encryptionKey);
		return {
			id: `restored:${userId}`,
			email: row.email,
			userId: Number(row.provider_user_id),
			roles: z.array(z.string()).parse(row.roles),
			accessToken,
			issuedAt: tokenLifetime(accessToken).issuedAt,
			expiresAt: row.expires_at.getTime()
		} satisfies ProviderSession;
	}

	/** Swap in a refreshed provider token for this session and the user's stored credential. */
	async replaceToken(session: ProviderSession, token: { id: string; ttl?: number }) {
		const lifetime = tokenLifetime(token.id, token.ttl);
		session.accessToken = token.id;
		session.issuedAt = lifetime.issuedAt;
		session.expiresAt = lifetime.expiresAt;
		for (const other of this.#sessions.values()) {
			if (other.userId !== session.userId || other === session) continue;
			Object.assign(other, { accessToken: token.id, ...lifetime });
		}
		if (!this.#database || !this.#encryptionKey) return;
		await this.#database.query(
			`UPDATE provider_credentials p SET ciphertext = $2, updated_at = now()
			 FROM users u WHERE u.id = p.user_id AND u.provider_user_id = $1`,
			[session.userId, encryptToken(token.id, this.#encryptionKey)]
		);
		await this.#database.query(
			`UPDATE sessions s SET expires_at = $2
			 FROM users u WHERE u.id = s.user_id AND u.provider_user_id = $1 AND s.expires_at > now()`,
			[session.userId, new Date(lifetime.expiresAt)]
		);
	}

	async delete(id?: string) {
		if (id) this.#sessions.delete(id);
		if (id && this.#database) await this.#database.query("DELETE FROM sessions WHERE token_hash = $1", [sessionHash(id)]);
	}
}

function sessionHash(id: string) {
	return createHash("sha256").update(id).digest();
}

function encryptToken(token: string, key: Buffer) {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
	return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
}

function decryptToken(envelope: Buffer, key: Buffer) {
	if (envelope[0] !== 1 || envelope.length < 30) throw new Error("Unsupported credential envelope");
	const iv = envelope.subarray(1, 13);
	const tag = envelope.subarray(13, 29);
	const encrypted = envelope.subarray(29);
	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

async function postJson(baseUrl: string, path: string, body: unknown) {
	const response = await fetch(`${baseUrl}/${path}`, {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(20_000)
	});
	const result = (await response.json().catch(() => null)) as unknown;
	if (!response.ok) throw new Error(`Upstream auth failed with ${response.status}`);
	return result;
}

export async function startEmailLogin(baseUrl: string, email: string) {
	return z
		.object({ success: z.literal(true) })
		.passthrough()
		.parse(await postJson(baseUrl, "accounts/require-email-verification-for-login-with-numeric-captcha", { email }));
}

export async function verifyEmailLogin(baseUrl: string, email: string, captcha: string) {
	return loginResponseSchema.parse(await postJson(baseUrl, "accounts/login-by-email-verification-with-numeric-captcha", { email, captcha }));
}

const keepLoginSchema = z.object({ token: z.object({ id: z.string().min(20), ttl: z.number().optional() }) });

/** Provider token refresh observed in the August capture: POST with the current token, no body. */
export async function keepLogin(baseUrl: string, accessToken: string) {
	return keepLoginSchema.parse(await olooRequest<unknown>(baseUrl, "/accounts/keep-login", accessToken, { method: "POST" })).token;
}

export function publicSession(session: ProviderSession) {
	return { authenticated: true as const, email: session.email, userId: session.userId, roles: session.roles, expiresAt: new Date(session.expiresAt).toISOString() };
}
