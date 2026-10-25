import { randomUUID } from "node:crypto";
import { z } from "zod";

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
	expiresAt: number;
}

export class SessionStore {
	readonly #sessions = new Map<string, ProviderSession>();

	create(login: z.infer<typeof loginResponseSchema>) {
		const id = randomUUID();
		const payload = JSON.parse(Buffer.from(login.accessToken.id.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
		const session: ProviderSession = {
			id,
			email: login.user.email,
			userId: login.user.userId,
			roles: login.user.roles,
			accessToken: login.accessToken.id,
			expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : Date.now() + login.accessToken.ttl * 1000
		};
		this.#sessions.set(id, session);
		return session;
	}

	get(id?: string) {
		if (!id) return null;
		const session = this.#sessions.get(id);
		if (!session) return null;
		if (session.expiresAt <= Date.now()) {
			this.#sessions.delete(id);
			return null;
		}
		return session;
	}

	delete(id?: string) {
		if (id) this.#sessions.delete(id);
	}
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

export function publicSession(session: ProviderSession) {
	return { authenticated: true as const, email: session.email, userId: session.userId, roles: session.roles, expiresAt: new Date(session.expiresAt).toISOString() };
}
