import type { Page } from "@playwright/test";

const now = () => new Date().toISOString();

function scooter(providerId: number, id: string, batteryPercent: number, availability: string, reasons: string[] = [], model = "c5", fault: string | null = null) {
	// A few metres apart, like real fixes around a station.
	const position = { latitude: 24.7869 + (providerId % 10) * 0.00006, longitude: 120.9975 + (providerId % 7) * 0.00006 };
	return { providerId, id, model, batteryPercent, rangeKm: Math.round(batteryPercent * 0.35), ...position, availability, reasons, warnings: fault ? ["hardware"] : [], fault, updatedAt: now() };
}

export function testFleet() {
	const library = [
		scooter(1512, "JZ-333", 84, "available"),
		scooter(1513, "JZ-551", 62, "available"),
		scooter(1514, "JZ-772", 31, "low_battery", ["low_battery"]),
		scooter(1515, "KA-104", 90, "available", [], "c5", "throttleAbnormal")
	];
	const engineering = [scooter(1601, "MB-220", 18, "low_battery", ["low_battery"], "wgt"), scooter(1602, "MB-221", 70, "unavailable", ["inactive"], "wgt")];
	return {
		updatedAt: now(),
		stationCount: 3,
		totalCount: 5,
		availableCount: 3,
		lowBatteryCount: 2,
		outOfServiceCount: 1,
		unavailableCount: 3,
		inUseCount: 1,
		reasons: { lowBattery: 2, hardware: 1, communication: 0, location: 0, reserved: 0 },
		stations: [
			{
				id: 101,
				name: "交大-浩然圖書館站",
				latitude: 24.78694,
				longitude: 120.99749,
				capacity: 16,
				type: "normal",
				region: "NCTU-NTHU",
				lowBatteryPercent: 35,
				availableCount: 3,
				lowBatteryCount: 1,
				outOfServiceCount: 0,
				unavailableCount: 1,
				scooters: library
			},
			{
				id: 102,
				name: "交大-工程四館站",
				latitude: 24.78716,
				longitude: 120.99558,
				capacity: 8,
				type: "rfid",
				region: "NCTU-NTHU",
				lowBatteryPercent: 35,
				availableCount: 0,
				lowBatteryCount: 1,
				outOfServiceCount: 1,
				unavailableCount: 2,
				scooters: engineering
			},
			{
				id: 103,
				name: "清大-第二餐廳站",
				latitude: 24.78938,
				longitude: 120.99938,
				capacity: 24,
				type: "normal",
				region: "NCTU-NTHU",
				lowBatteryPercent: 35,
				availableCount: 0,
				lowBatteryCount: 0,
				outOfServiceCount: 0,
				unavailableCount: 0,
				scooters: []
			}
		]
	};
}

const blankPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

/** Serves a stand-in for the Mapbox Standard style so tests never call Mapbox. `realTiles` uses OSM imagery for visual review. */
export async function mockMapbox(page: Page, options: { realTiles?: boolean } = {}) {
	await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, async route => {
		const url = new URL(route.request().url());
		if (url.pathname.startsWith("/styles/v1/mapbox/standard")) {
			return route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({
					version: 8,
					name: "e2e",
					schema: Object.fromEntries(["lightPreset", "theme", "showPointOfInterestLabels", "showTransitLabels", "show3dObjects"].map(key => [key, { default: null }])),
					sources: { tiles: { type: "raster", tiles: [options.realTiles ? "https://tile.openstreetmap.org/{z}/{x}/{y}.png" : "https://tiles.e2e.test/{z}/{x}/{y}.png"], tileSize: 256 } },
					layers: [
						{ id: "bg", type: "background", paint: { "background-color": "#e9ebe6" } },
						{ id: "tiles", type: "raster", source: "tiles", paint: { "raster-saturation": -0.85, "raster-opacity": 0.85 } }
					]
				})
			});
		}
		return route.fulfill({ status: 204, body: "" });
	});
	await page.route("https://tiles.e2e.test/**", route => route.fulfill({ contentType: "image/png", body: blankPng }));
}

type Ride = { id: number; scooterId: number; label: string; startedAt: string; cost: number };

export async function mockOlowoApi(page: Page, options: { authenticated?: boolean } = {}) {
	const state = {
		authenticated: options.authenticated ?? true,
		activeRide: null as Ride | null,
		unpaidRide: null as (Ride & { endedAt: string }) | null,
		reservation: null as null | { id: number; scooterId: number; label: string; createdAt: string; expiresAt: string },
		rideAutomation: null as null | Record<string, unknown>,
		photoUploads: 0,
		checkout: null as null | Record<string, unknown>,
		requests: [] as Array<{ method: string; path: string; body: unknown }>
	};

	await page.route(
		url => url.hostname === "127.0.0.1" && url.pathname.startsWith("/v1/"),
		async route => {
			const request = route.request();
			const url = new URL(request.url());
			const method = request.method();
			const isJson = request.headers()["content-type"]?.includes("json");
			const body = isJson ? (request.postDataJSON() as unknown) : null;
			state.requests.push({ method, path: url.pathname, body });
			const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
			const session = { authenticated: true, email: "rider@example.com", userId: 115827, roles: ["customer"], expiresAt: "2026-11-24T00:00:00.000Z" };
			const route_ = `${method} ${url.pathname}${url.search === "?placeholder=1" ? url.search : ""}`;

			if (url.pathname === "/v1/auth/session") return json(state.authenticated ? session : { authenticated: false });
			if (url.pathname === "/v1/auth/email/start") return json({ success: true });
			if (url.pathname === "/v1/auth/email/verify") {
				state.authenticated = true;
				return json(session);
			}
			if (url.pathname === "/v1/auth/logout") {
				state.authenticated = false;
				return json({ success: true });
			}
			if (!state.authenticated) return json({ code: "AUTH_REQUIRED", message: "Sign in" }, 401);

			switch (route_) {
				case "GET /v1/map/stations":
					return json(testFleet());
				case "GET /v1/map/efences":
					return json({
						type: "FeatureCollection",
						features: [
							{
								type: "Feature",
								id: 11,
								properties: { zone: "normalSpeedArea", name: "正常騎乘區", description: null, color: "#FFD700", priority: 10000 },
								geometry: {
									type: "Polygon",
									coordinates: [
										[
											[120.99, 24.78],
											[121.005, 24.78],
											[121.005, 24.795],
											[120.99, 24.795],
											[120.99, 24.78]
										]
									]
								}
							},
							{
								type: "Feature",
								id: 25,
								properties: { zone: "noThrottleArea", name: "空檔區", description: "車子會被切換為空檔", color: "#FF7C6A", priority: 2500 },
								geometry: {
									type: "Polygon",
									coordinates: [
										[
											[120.996, 24.786],
											[120.998, 24.786],
											[120.998, 24.788],
											[120.996, 24.786]
										]
									]
								}
							}
						]
					});
				case "GET /v1/scooters/lookup": {
					const code = (url.searchParams.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
					return code === "JZ333" ? json({ scooterId: 1512, stationId: 101, label: "JZ-333" }) : json({ code: "SCOOTER_NOT_FOUND", message: "這不是 oloo 車輛的 QR Code 或車號" }, 404);
				}
				case "GET /v1/rides/current":
					return json({ activeRide: state.activeRide });
				case "GET /v1/rides/unpaid":
					return json({ ride: state.unpaidRide });
				case "GET /v1/reservations/current":
					return json(state.reservation ? [state.reservation] : []);
				case "GET /v1/reservations/usage":
					return json({ limitPerHour: 2, reservedLastHour: state.reservation ? 1 : 0, cancelledLastHour: 0, remaining: state.reservation ? 1 : 2, nextSlotAt: null });
				case "POST /v1/reservations":
					state.reservation = { id: 55, scooterId: 1512, label: "JZ-333", createdAt: now(), expiresAt: new Date(Date.now() + 300_000).toISOString() };
					return json({ success: true, reservationId: 55, expiresAt: state.reservation.expiresAt });
				case "DELETE /v1/reservations/55":
					state.reservation = null;
					return json({ success: true });
				case "POST /v1/rides": {
					state.reservation = null;
					state.activeRide = { id: 9123, scooterId: 1512, label: "JZ-333", startedAt: now(), cost: 0 };
					const automation = (body as { automation?: { action: string; afterRideSeconds: number } }).automation;
					state.rideAutomation = automation
						? { id: "ride-task", rideId: 9123, scooterId: 1512, action: automation.action, triggerAt: new Date(Date.now() + automation.afterRideSeconds * 1000).toISOString(), state: "scheduled" }
						: null;
					return json({ success: true, activeRide: state.activeRide, automation: state.rideAutomation });
				}
				case "GET /v1/rides/history":
					return json({
						rides: [
							{
								id: 3172502,
								label: "JZ-401",
								startedAt: "2026-09-22T11:56:00.000Z",
								endedAt: "2026-09-22T11:56:55.000Z",
								durationSeconds: 55,
								cost: 3,
								ridingMinutes: 1,
								parkedMinutes: 1,
								engineOnSeconds: 52.7,
								engineOffSeconds: 2.1,
								paid: true,
								planName: "月用量 Starter",
								startStation: "交大-浩然圖書館站",
								endStation: "交大-工程三館站"
							}
						]
					});
				case "GET /v1/plans":
					return json({
						region: url.searchParams.get("region"),
						current: {
							name: "月用量 Starter",
							startsAt: "2026-10-01T18:37:34.000Z",
							endsAt: "2026-11-01T15:59:59.000Z",
							includedMinutes: 60,
							remainingMinutes: 0,
							ratePerMinute: 2.4,
							autoRenew: true,
							nextPlanName: "月用量 Starter",
							topUps: [{ minutes: 15, price: 33, tag: null }]
						},
						plans: [
							{
								contractId: 49,
								name: "月用量 Starter",
								tagline: "新·初心者",
								kind: "monthly",
								price: 120,
								includedMinutes: 60,
								periodDays: 30,
								ratePerMinute: 2.4,
								lines: ["每個月 60 分鐘免費"],
								current: true,
								next: true,
								canPurchase: true,
								reasons: []
							},
							{
								contractId: 51,
								name: "月用量 Plus",
								tagline: null,
								kind: "monthly",
								price: 599,
								includedMinutes: 500,
								periodDays: 30,
								ratePerMinute: 2.4,
								lines: ["每個月 500 分鐘免費"],
								current: false,
								next: false,
								canPurchase: true,
								reasons: []
							},
							{
								contractId: 61,
								name: "遊客 3 小時悠遊券",
								tagline: null,
								kind: "pass",
								price: 289,
								includedMinutes: 180,
								periodDays: 0.125,
								ratePerMinute: 1,
								lines: ["3 小時內 讓你自由借還"],
								current: false,
								next: false,
								canPurchase: false,
								reasons: ["已停售"]
							}
						]
					});
				case "GET /v1/rides/9123/estimate":
					return json({ estimate: { cost: 4, ridingMinutes: 1, parkedMinutes: 0, ratePerMinute: 2.4 } });
				case "GET /v1/rides/9123/automation":
					return json({ automation: state.rideAutomation });
				case "PUT /v1/rides/9123/automation": {
					const requestBody = body as { action: string; afterRideSeconds: number };
					state.rideAutomation = {
						id: "ride-task",
						rideId: 9123,
						scooterId: 1512,
						action: requestBody.action,
						triggerAt: new Date(Date.parse(state.activeRide?.startedAt ?? now()) + requestBody.afterRideSeconds * 1000).toISOString(),
						state: "scheduled"
					};
					return json({ automation: state.rideAutomation });
				}
				case "DELETE /v1/rides/9123/automation":
					state.rideAutomation = null;
					return json({ success: true });
				case "POST /v1/rides/9123/return":
					if (state.activeRide) state.unpaidRide = { ...state.activeRide, endedAt: now(), cost: 9 };
					state.activeRide = null;
					return json({ success: true });
				case "GET /v1/rides/9123/bill":
					return json({ bill: { cost: 9, minimumPrice: 0, ridingMinutes: 4, parkedMinutes: 1, ratePerMinute: 2.4, planName: "月用量 Starter", endedAt: now(), returnStation: "交大-工程三館站" } });
				case "GET /v1/payment/cards":
					return json({ cards: [{ id: 154060, issuer: "VISA", lastFour: "4242", valid: true }] });
				case "POST /v1/rides/9123/photo?placeholder=1":
				case "POST /v1/rides/9123/photo":
					state.photoUploads += 1;
					return json({ imageId: 777 });
				case "POST /v1/rides/9123/checkout":
					state.checkout = body as Record<string, unknown>;
					state.unpaidRide = null;
					return json({ success: true, rideId: 9123, amount: 9, pointsDeducted: 0 });
			}
			if (url.pathname.endsWith("/ride-plan")) return json({ basicOrStationRidePlan: { id: 73, name: "普通費率", minMinute: 30, minPrice: 60, normalRate: 2, stopRate: 2 } });
			return json({ code: "NOT_MOCKED", message: route_ }, 404);
		}
	);

	return state;
}

/** A real (tiny) PNG so the browser can decode and re-encode it like a camera photo. */
export const samplePhoto = { name: "return.png", mimeType: "image/png", buffer: blankPng };
