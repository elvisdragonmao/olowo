import assert from "node:assert/strict";
import { test } from "node:test";
import { ScheduledActionRepository } from "../src/scheduled-action-repository.js";

test("scheduled action repository normalizes pending ride and reservation rows", async () => {
	const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
	const now = new Date();
	const database = {
		query: async (sql: string, parameters?: unknown[]) => {
			queries.push({ sql, parameters });
			if (sql.startsWith("SELECT")) {
				return {
					rows: [
						{ id: "ride-id", provider_user_id: "7", kind: "ride", ride_id: "8", scooter_id: "9", engine_license_number: null, action: "return", trigger_at: now, created_at: now },
						{ id: "reservation-id", provider_user_id: "7", kind: "reservation", ride_id: null, scooter_id: "10", engine_license_number: "AA-010", action: null, trigger_at: now, created_at: now }
					]
				};
			}
			return { rows: [] };
		}
	} as never;
	const repository = new ScheduledActionRepository(database);
	assert.deepEqual(await repository.loadPending(), [
		{ id: "ride-id", kind: "ride", userId: 7, rideId: 8, scooterId: 9, action: "return", triggerAt: now.getTime(), createdAt: now.getTime() },
		{ id: "reservation-id", kind: "reservation", userId: 7, scooterId: 10, engineLicenseNumber: "AA-010", triggerAt: now.getTime(), createdAt: now.getTime() }
	]);
	assert.equal(queries.length, 1);
});
