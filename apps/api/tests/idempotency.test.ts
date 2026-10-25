import assert from "node:assert/strict";
import { test } from "node:test";
import { IdempotencyStore } from "../src/idempotency.js";
import { OlooUpstreamError } from "../src/oloo.js";

/** Minimal stand-in for the idempotency_keys table shared by two API instances. */
function sharedTable() {
	const rows = new Map<string, { state: string; response: unknown; error_status: number | null; error_message: string | null }>();
	return {
		rows,
		query: async (sql: string, parameters: unknown[] = []) => {
			const id = parameters.slice(0, 3).join(":");
			if (sql.startsWith("INSERT")) {
				if (rows.has(id)) return { rowCount: 0, rows: [] };
				rows.set(id, { state: "pending", response: null, error_status: null, error_message: null });
				return { rowCount: 1, rows: [{ key: parameters[2] }] };
			}
			if (sql.startsWith("SELECT")) return { rowCount: 1, rows: rows.has(id) ? [rows.get(id)] : [] };
			if (sql.includes("'completed'")) rows.set(id, { ...rows.get(id)!, state: "completed", response: JSON.parse(String(parameters[3])) });
			if (sql.includes("'failed'")) rows.set(id, { ...rows.get(id)!, state: "failed", error_status: parameters[3] as number, error_message: parameters[4] as string });
			return { rowCount: 1, rows: [] };
		}
	};
}

test("a retry on another instance replays the stored outcome instead of calling oloo again", async () => {
	const table = sharedTable();
	const first = new IdempotencyStore(table as never);
	const second = new IdempotencyStore(table as never);
	let calls = 0;
	const rent = async () => ({ rideId: ++calls });
	assert.deepEqual(await first.run(7, "rent", "key-1", rent), { rideId: 1 });
	assert.deepEqual(await second.run(7, "rent", "key-1", rent), { rideId: 1 });
	assert.equal(calls, 1);
	assert.deepEqual(await second.run(7, "rent", "key-2", rent), { rideId: 2 }, "a new key is a new mutation");
});

test("failures are replayed and in-flight duplicates are rejected", async () => {
	const table = sharedTable();
	const store = new IdempotencyStore(table as never);
	await assert.rejects(
		store.run(7, "return:9", "key", async () => {
			throw new OlooUpstreamError(409, "Active ride changed");
		}),
		/Active ride changed/
	);
	await assert.rejects(
		new IdempotencyStore(table as never).run(7, "return:9", "key", async () => "should not run"),
		(error: unknown) => error instanceof OlooUpstreamError && error.status === 409
	);

	table.rows.set("7:reserve:busy", { state: "pending", response: null, error_status: null, error_message: null });
	await assert.rejects(
		new IdempotencyStore(table as never).run(7, "reserve", "busy", async () => "should not run"),
		/still in progress/
	);
});

test("without a database, concurrent callers in one process share a single call", async () => {
	const store = new IdempotencyStore(null);
	let calls = 0;
	const action = async () => ++calls;
	assert.deepEqual(await Promise.all([store.run(1, "rent", "k", action), store.run(1, "rent", "k", action)]), [1, 1]);
});
