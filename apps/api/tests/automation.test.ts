import assert from "node:assert/strict";
import { test } from "node:test";
import { publicReservationAutomation, ReservationAutomationStore } from "../src/reservation-automation.js";
import { publicAutomation, RideAutomationStore } from "../src/ride-automation.js";

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

test("ride automation replaces an older task and exposes no user credential", async () => {
	const store = new RideAutomationStore();
	let calls = 0;
	const old = store.schedule({ userId: 7, rideId: 10, scooterId: 20, action: "return", triggerAt: Date.now() + 15 }, async () => {
		calls += 100;
	});
	const current = store.schedule({ userId: 7, rideId: 10, scooterId: 20, action: "notify", triggerAt: Date.now() + 20 }, async () => {
		calls += 1;
	});
	assert.equal(old.state, "cancelled");
	await wait(45);
	assert.equal(calls, 1);
	assert.equal(current.state, "due");
	assert.deepEqual(Object.keys(publicAutomation(current)!).sort(), ["action", "createdAt", "error", "id", "rideId", "scooterId", "state", "triggerAt", "updatedAt"]);
	store.close();
});

test("ride automation records a failed destructive action without retrying", async () => {
	const store = new RideAutomationStore();
	let calls = 0;
	const task = store.schedule({ userId: 2, rideId: 3, scooterId: 4, action: "return_and_reborrow", triggerAt: Date.now() + 5 }, async () => {
		calls += 1;
		throw new Error("ride changed");
	});
	await wait(30);
	assert.equal(calls, 1);
	assert.equal(task.state, "failed");
	assert.equal(task.error, "ride changed");
	store.close();
});

test("scheduled reservation stores only the public result", async () => {
	const store = new ReservationAutomationStore();
	const task = store.schedule({ userId: 4, scooterId: 12, engineLicenseNumber: "AA-012", triggerAt: Date.now() + 5 }, async () => ({ reservationId: 99, expiresAt: "2026-10-25T12:00:00.000Z" }));
	await wait(30);
	assert.equal(task.state, "completed");
	assert.equal(task.reservationId, 99);
	const output = publicReservationAutomation(task)!;
	assert.equal("userId" in output, false);
	assert.equal(output.engineLicenseNumber, "AA-012");
	store.close();
});
