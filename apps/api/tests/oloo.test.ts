import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchOlooFleet } from "../src/oloo-fleet.js";
import { olooRequest } from "../src/oloo.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("provider request keeps the credential server-side while satisfying staging auth", async () => {
	let observed: { url: string; authorization: string | null } | undefined;
	globalThis.fetch = async (input, init) => {
		const url = new URL(input.toString());
		observed = { url: url.toString(), authorization: new Headers(init?.headers).get("authorization") };
		return Response.json({ ok: true });
	};
	await olooRequest("https://provider.test/api", "/resource", "secret-token-value");
	assert.equal(observed?.authorization, "secret-token-value");
	assert.equal(new URL(observed!.url).searchParams.get("access_token"), "secret-token-value");
});

test("fleet joins telemetry and classifies explainable availability", async () => {
	const now = new Date().toISOString();
	const stale = new Date(Date.now() - 10 * 60_000).toISOString();
	const infos = [
		{ id: 1, imei: "a", EngineLicenseNumber: "A-001", isActive: true, accountId: null },
		{ id: 2, imei: "b", EngineLicenseNumber: "B-002", isActive: true, accountId: null },
		{ id: 3, imei: "c", EngineLicenseNumber: "C-003", isActive: true, accountId: null },
		{ id: 4, imei: "d", EngineLicenseNumber: "D-004", isActive: true, accountId: 99 },
		{ id: 5, imei: "e", EngineLicenseNumber: "E-005", isActive: true, accountId: null }
	];
	const statuses = [
		{ imei: "a", latitude: 24.7938, longitude: 120.9937, power: 80, errorMsg: "illegalMovement", updatedAt: now },
		{ imei: "b", latitude: 24.7939, longitude: 120.9937, power: 20, errorMsg: null, updatedAt: now },
		{ imei: "c", latitude: 24.794, longitude: 120.9937, power: 90, errorMsg: "throttleAbnormal", updatedAt: now },
		{ imei: "d", latitude: 24.7941, longitude: 120.9937, power: 90, errorMsg: null, updatedAt: now },
		{ imei: "e", latitude: 24.7942, longitude: 120.9937, power: 90, errorMsg: "Connection: close", updatedAt: stale }
	];
	globalThis.fetch = async input => {
		const url = input.toString();
		if (url.includes("scooter-statuses")) return Response.json(statuses);
		if (url.includes("reservation/overall-current")) return Response.json([{ scootersInfoId: 1 }, { scootersInfoId: 5 }]);
		if (url.includes("reservation/current")) return Response.json({ scootersInfoId: 1 });
		return Response.json(infos);
	};
	const result = await fetchOlooFleet("https://provider.test/api", "token-value");
	assert.equal(result.availableCount, 1);
	assert.equal(result.unavailableCount, 4);
	assert.deepEqual(result.reasons, { lowBattery: 1, hardware: 1, location: 1, reserved: 1 });
	assert.equal(result.scooters.find(item => item.id === "A-001")?.availability, "available");
	assert.equal(result.scooters.find(item => item.id === "B-002")?.availability, "low_battery");
	assert.equal(result.scooters.find(item => item.id === "C-003")?.availability, "unavailable");
	assert.equal(result.scooters.find(item => item.id === "D-004")?.availability, "unavailable");
	assert.equal(result.scooters.find(item => item.id === "E-005")?.availability, "unavailable");
});
