import assert from "node:assert/strict";
import { test } from "node:test";
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

test("restored ride automation preserves its durable identity and reports state changes", async () => {
	const states: string[] = [];
	const store = new RideAutomationStore(task => states.push(task.state));
	const task = store.schedule({ id: "restored-job", createdAt: Date.now() - 5000, userId: 8, rideId: 9, scooterId: 10, action: "notify", triggerAt: Date.now() + 5 }, async () => undefined);
	await wait(30);
	assert.equal(task.id, "restored-job");
	assert.deepEqual(states, ["scheduled", "running", "due"]);
	store.close();
});

test("only the instance that claims a due job executes it", async () => {
	const claimed = new Set<string>();
	const claim = async (task: { id: string }) => {
		if (claimed.has(task.id)) return false;
		claimed.add(task.id);
		return true;
	};
	const instanceA = new RideAutomationStore(undefined, claim);
	const instanceB = new RideAutomationStore(undefined, claim);
	let executions = 0;
	const input = { id: "shared-job", userId: 5, rideId: 6, scooterId: 7, action: "return" as const, triggerAt: Date.now() + 10 };
	const execute = async () => {
		executions += 1;
	};
	instanceA.schedule(input, execute);
	instanceB.schedule(input, execute);
	await wait(40);
	assert.equal(executions, 1, "a restored job on a second instance does not return the scooter twice");
	instanceA.close();
	instanceB.close();
});
