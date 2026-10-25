import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionStore } from "../src/auth.js";

function providerLogin() {
	const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
	return {
		success: true as const,
		user: { email: "rider@example.test", userId: 42, roles: ["customer"] },
		accessToken: { id: `header.${payload}.signature-value`, ttl: 3600, created: new Date().toISOString(), userId: 42, roles: ["customer"] }
	};
}

test("session cookie is opaque and public session excludes provider token", async () => {
	const store = new SessionStore();
	const provider = providerLogin();
	const session = await store.create(provider);
	assert.notEqual(session.id, provider.accessToken.id);
	assert.equal(session.id.includes("."), false);
	assert.equal((await store.get(session.id))?.accessToken, provider.accessToken.id);
	await store.delete(session.id);
	assert.equal(await store.get(session.id), null);
});

test("database mode requires a 256-bit encryption key", () => {
	assert.throws(() => new SessionStore({} as never, "short"), /64 hexadecimal/);
});

test("database session stores an encrypted provider credential and restores it", async () => {
	let ciphertext: Buffer | undefined;
	let expiresAt = new Date(Date.now() + 3600_000);
	const client = {
		query: async (sql: string, parameters?: unknown[]) => {
			if (sql.includes("RETURNING id")) return { rows: [{ id: "local-user" }] };
			if (sql.includes("provider_credentials")) ciphertext = parameters?.[1] as Buffer;
			if (sql.includes("INSERT INTO sessions")) expiresAt = parameters?.[2] as Date;
			return { rows: [] };
		},
		release: () => undefined
	};
	const database = {
		connect: async () => client,
		query: async (sql: string) => {
			if (sql.includes("WHERE u.provider_user_id")) {
				return { rows: [{ email: "rider@example.test", provider_user_id: "42", roles: ["customer"], expires_at: expiresAt, ciphertext }] };
			}
			return { rows: [] };
		}
	} as never;
	const encryptionKey = "11".repeat(32);
	const firstProcess = new SessionStore(database, encryptionKey);
	const login = providerLogin();
	await firstProcess.create(login);
	assert.ok(ciphertext);
	assert.equal(ciphertext!.includes(Buffer.from(login.accessToken.id)), false);

	const restartedProcess = new SessionStore(database, encryptionKey);
	const restored = await restartedProcess.getForProviderUser(42);
	assert.equal(restored?.accessToken, login.accessToken.id);
	assert.deepEqual(restored?.roles, ["customer"]);
});
