import type pg from "pg";
import { OlooUpstreamError } from "./oloo.js";

const memoryTtlMs = 5 * 60_000;

/**
 * Runs a mutation at most once per (user, scope, key). In-process callers share one promise; with
 * PostgreSQL the key is claimed by an insert, so retries that land on another API instance replay
 * the stored outcome instead of calling oloo again.
 */
export class IdempotencyStore {
	readonly #inflight = new Map<string, Promise<unknown>>();

	constructor(readonly database: pg.Pool | null) {}

	run<T>(userId: number, scope: string, key: string, action: () => Promise<T>): Promise<T> {
		const memoryKey = `${userId}:${scope}:${key}`;
		const existing = this.#inflight.get(memoryKey);
		if (existing) return existing as Promise<T>;
		const result = this.database ? this.#runDurable(userId, scope, key, action) : action();
		this.#inflight.set(memoryKey, result);
		setTimeout(() => this.#inflight.delete(memoryKey), memoryTtlMs).unref();
		return result;
	}

	async #runDurable<T>(userId: number, scope: string, key: string, action: () => Promise<T>): Promise<T> {
		const database = this.database!;
		const claimed = await database.query(
			`INSERT INTO idempotency_keys (provider_user_id, scope, key, state) VALUES ($1, $2, $3, 'pending')
			 ON CONFLICT DO NOTHING RETURNING key`,
			[userId, scope, key]
		);
		if (claimed.rowCount === 0) {
			const row = (
				await database.query<{ state: string; response: T | null; error_status: number | null; error_message: string | null }>(
					"SELECT state, response, error_status, error_message FROM idempotency_keys WHERE provider_user_id = $1 AND scope = $2 AND key = $3",
					[userId, scope, key]
				)
			).rows[0];
			if (row?.state === "completed") return row.response as T;
			if (row?.state === "failed") throw new OlooUpstreamError(row.error_status ?? 502, row.error_message ?? "Previous attempt failed");
			throw new OlooUpstreamError(409, "The same request is still in progress");
		}
		try {
			const response = await action();
			await database.query("UPDATE idempotency_keys SET state = 'completed', response = $4::jsonb, updated_at = now() WHERE provider_user_id = $1 AND scope = $2 AND key = $3", [
				userId,
				scope,
				key,
				JSON.stringify(response ?? null)
			]);
			return response;
		} catch (error) {
			const status = error instanceof OlooUpstreamError ? error.status : 500;
			const message = error instanceof Error ? error.message : "Request failed";
			await database.query("UPDATE idempotency_keys SET state = 'failed', error_status = $4, error_message = $5, updated_at = now() WHERE provider_user_id = $1 AND scope = $2 AND key = $3", [
				userId,
				scope,
				key,
				status,
				message
			]);
			throw error;
		}
	}

	/** Keys only need to outlive client retries. */
	async prune(maxAgeHours = 24) {
		if (this.database) await this.database.query("DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(hours => $1)", [maxAgeHours]);
	}
}
