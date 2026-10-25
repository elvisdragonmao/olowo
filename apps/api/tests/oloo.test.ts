import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildFleetSnapshot, codeCandidates, FleetCache } from "../src/oloo-fleet.js";
import { toEfenceCollection } from "../src/efences.js";
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

test("fleet groups scooters by station and classifies explainable availability", async () => {
	const now = new Date().toISOString();
	const stale = new Date(Date.now() - 10 * 60_000).toISOString();
	const infos = [
		{ id: 1, imei: "a", EngineLicenseNumber: "A-001", VehicleModel: "c5", isActive: true, accountId: null, scooterRentalStationId: 7 },
		{ id: 2, imei: "b", EngineLicenseNumber: "B-002", isActive: true, accountId: null, scooterRentalStationId: 7 },
		{ id: 3, imei: "c", EngineLicenseNumber: "C-003", isActive: true, accountId: null, scooterRentalStationId: 7 },
		{ id: 4, imei: "d", EngineLicenseNumber: "D-004", isActive: true, accountId: 99, scooterRentalStationId: 7 },
		{ id: 5, imei: "e", EngineLicenseNumber: "E-005", isActive: true, accountId: null, scooterRentalStationId: 8 },
		{ id: 6, imei: "f", EngineLicenseNumber: "F-006", isActive: false, accountId: null, scooterRentalStationId: 8 },
		{ id: 7, imei: "g", EngineLicenseNumber: "G-007", isActive: true, accountId: null, scooterRentalStationId: 404 },
		{ id: 8, imei: "h", EngineLicenseNumber: "H-008", isActive: false, accountId: null, scooterRentalStationId: 404 }
	];
	const statuses = [
		{ imei: "a", latitude: 24.7938, longitude: 120.9937, power: 80, errorMsg: "illegalMovement", updatedAt: now },
		{ imei: "b", latitude: 24.7939, longitude: 120.9937, power: 20, errorMsg: null, updatedAt: now },
		{ imei: "c", latitude: 24.794, longitude: 120.9937, power: 90, errorMsg: "throttleAbnormal", updatedAt: now },
		{ imei: "d", latitude: 24.7941, longitude: 120.9937, power: 90, errorMsg: null, updatedAt: now },
		{ imei: "e", latitude: 24.7952, longitude: 120.9951, power: 90, errorMsg: "Connection: close", updatedAt: stale },
		{ imei: "f", latitude: 24.7952, longitude: 120.9951, power: 90, errorMsg: null, updatedAt: now },
		{ imei: "g", latitude: 24.79521, longitude: 120.99511, power: 70, errorMsg: null, updatedAt: now },
		{ imei: "h", latitude: 24.79521, longitude: 120.99511, power: 70, errorMsg: null, updatedAt: now }
	];
	const stations = [
		{ id: 7, name: "浩然圖書館", latitude: 24.7939, longitude: 120.9937, totalParkingSpace: 16, stationType: "normal", isActive: true },
		{ id: 8, name: "第二餐廳", latitude: 24.7952, longitude: 120.9951, totalParkingSpace: 8, stationType: "rfid", isActive: true }
	];
	const requested: string[] = [];
	globalThis.fetch = async input => {
		const url = new URL(input.toString());
		requested.push(url.pathname);
		if (url.pathname.endsWith("/scooter-statuses")) return Response.json(statuses);
		if (url.pathname.endsWith("/active-stations")) return Response.json(stations);
		if (url.pathname.endsWith("/reservation/overall-current")) return Response.json([{ scootersInfoId: 1 }, { scootersInfoId: 7 }]);
		if (url.pathname.endsWith("/efence-display-ranges")) return Response.json([]);
		if (url.pathname.endsWith("/oloo-options")) return Response.json([]);
		return Response.json(infos);
	};
	const cache = new FleetCache("https://provider.test/api");
	const [raw, concurrent] = await Promise.all([cache.get("token-value"), cache.get("token-value")]);
	assert.equal(raw, concurrent);
	assert.equal(requested.length, 6, "concurrent misses share one upstream refresh (fleet plus region config)");
	assert.equal(cache.identity(3)?.imei, "c");
	assert.equal(cache.lookupCode("c-003"), 3, "a typed plate matches regardless of case and dash");
	assert.equal(cache.lookupCode("https://oloo.example/appLink?path=rent&param=B-002"), 2, "a URL carrying the plate matches");
	assert.equal(cache.lookupCode("ZZ-999"), null);

	const ownView = buildFleetSnapshot(raw, new Set([1]));
	assert.equal(ownView.stationCount, 2);
	assert.equal(ownView.inUseCount, 1);
	assert.equal(ownView.totalCount, 6, "in-use scooters are not station inventory; switched-off ones at a real station still are, depot ones are not");
	assert.equal(ownView.outOfServiceCount, 1);
	const library = ownView.stations.find(item => item.id === 7)!;
	assert.deepEqual(
		library.scooters.map(item => [item.id, item.availability, item.reasons, item.warnings, item.fault]),
		[
			["C-003", "available", [], ["hardware"], "throttleAbnormal"],
			["A-001", "available", [], [], null],
			["B-002", "low_battery", ["low_battery"], [], null]
		],
		"a reported controller fault is a warning, not a block: oloo decides at rent time, as in the official app"
	);
	assert.equal(library.availableCount, 2);
	assert.equal(library.lowBatteryCount, 1);
	assert.equal("imei" in library.scooters[0]!, false);

	const cafeteria = ownView.stations.find(item => item.id === 8)!;
	assert.deepEqual(
		cafeteria.scooters.map(item => [item.id, item.availability, item.reasons, item.warnings]),
		[
			["E-005", "available", [], ["communication"]],
			["F-006", "unavailable", ["inactive"], []],
			["G-007", "unavailable", ["reserved"], []]
		],
		"an unknown station id falls back to the nearest station"
	);
	assert.deepEqual(ownView.reasons, { inactive: 1, lowBattery: 1, hardware: 1, communication: 1, location: 0, reserved: 1 });
	assert.equal(cafeteria.outOfServiceCount, 1);

	const sharedView = buildFleetSnapshot(raw);
	const reservedForOthers = sharedView.stations.find(item => item.id === 7)!.scooters.find(item => item.id === "A-001");
	assert.equal(reservedForOthers?.availability, "unavailable", "another rider's reservation blocks the scooter");
	assert.deepEqual(reservedForOthers?.reasons, ["reserved"]);
});

test("e-fences become closed GeoJSON rings with stricter zones drawn last", () => {
	const collection = toEfenceCollection([
		{
			id: 11,
			type: "normalSpeedArea",
			properties: {
				name: "正常騎乘區",
				color: "#FFD700",
				priority: 10000,
				polygon: [
					[24.79, 120.99],
					[24.8, 120.99],
					[24.8, 121.0]
				]
			}
		},
		{
			id: 25,
			type: "noThrottleArea",
			properties: {
				name: "空檔區",
				color: "#FF7C6A",
				priority: 2500,
				polygon: [
					[24.791, 120.991],
					[24.792, 120.991],
					[24.792, 120.992],
					[24.791, 120.991]
				]
			}
		},
		{ id: 99, type: "broken", properties: { polygon: [[1, 2]] } }
	]);
	assert.deepEqual(
		collection.features.map(feature => feature.id),
		[11, 25]
	);
	const ring = collection.features[0]!.geometry.coordinates[0]!;
	assert.deepEqual(ring[0], [120.99, 24.79], "coordinates are flipped to longitude, latitude");
	assert.deepEqual(ring[ring.length - 1], ring[0], "rings are closed");
	assert.equal(collection.features[1]!.geometry.coordinates[0]!.length, 4, "an already-closed ring is not closed twice");
});

test("each region uses oloo's own rental battery floor", () => {
	const now = new Date().toISOString();
	const square = (lat: number, lon: number): Array<[number, number]> => [
		[lat - 0.01, lon - 0.01],
		[lat - 0.01, lon + 0.01],
		[lat + 0.01, lon + 0.01],
		[lat + 0.01, lon - 0.01]
	];
	const raw = {
		fetchedAt: Date.now(),
		regionConfig: { regions: [{ code: "NCTU-NTHU", rings: [square(24.79, 120.99)] }], lowBatteryPercent: { "NCTU-NTHU": 20 } },
		infos: [
			{ id: 1, imei: "a", EngineLicenseNumber: "A-001", isActive: true, accountId: null, scooterRentalStationId: 7 },
			{ id: 2, imei: "b", EngineLicenseNumber: "B-002", isActive: true, accountId: null, scooterRentalStationId: 8 }
		],
		statuses: new Map([
			["a", { imei: "a", latitude: 24.79, longitude: 120.99, power: 25, updatedAt: now }],
			["b", { imei: "b", latitude: 24.12, longitude: 120.6, power: 25, updatedAt: now }]
		]),
		stations: [
			{ id: 7, name: "交大-浩然圖書館站", latitude: 24.79, longitude: 120.99 },
			{ id: 8, name: "東海-校門站", latitude: 24.12, longitude: 120.6 }
		],
		reservedIds: new Set<number>()
	};
	const snapshot = buildFleetSnapshot(raw);
	const campus = snapshot.stations.find(station => station.id === 7)!;
	const outside = snapshot.stations.find(station => station.id === 8)!;
	assert.deepEqual([campus.region, campus.lowBatteryPercent, campus.scooters[0]?.availability], ["NCTU-NTHU", 20, "available"], "25% is enough where the floor is 20%");
	assert.deepEqual([outside.region, outside.lowBatteryPercent, outside.scooters[0]?.availability], [null, 35, "low_battery"]);
});

test("QR payloads yield plate and IMEI candidates", () => {
	assert.deepEqual([...codeCandidates("JZ-333")], ["JZ333"]);
	assert.deepEqual([...codeCandidates("https://staging.loopluscooter.com/scooter/862079070014049?ref=qr")].sort(), ["862079070014049"]);
	assert.ok(codeCandidates("https://x.test/rent?plate=jz-333").has("JZ333"));
});
