import assert from "node:assert/strict";
import { test } from "node:test";
import { ScheduledActionRepository } from "../src/scheduled-action-repository.js";

test("scheduled action repository normalizes pending ride rows", async () => {
	const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
	const now = new Date();
	const database = {
		query: async (sql: string, parameters?: unknown[]) => {
			queries.push({ sql, parameters });
			if (sql.startsWith("SELECT")) {
				return {
					rows: [{ id: "ride-id", provider_user_id: "7", ride_id: "8", scooter_id: "9", action: "return", trigger_at: now, created_at: now }]
				};
			}
			return { rows: [] };
		}
	} as never;
	const repository = new ScheduledActionRepository(database);
	assert.deepEqual(await repository.loadPending(), [{ id: "ride-id", userId: 7, rideId: 8, scooterId: 9, action: "return", triggerAt: now.getTime(), createdAt: now.getTime() }]);
	assert.equal(queries.length, 1);
});
