import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const apiDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
let providerPort = 0;
let apiPort = 0;
let providerServer: ReturnType<typeof createServer>;
let apiProcess: ChildProcess;
let cookie = "";
let providerAuthChecks = 0;
let keepLoginCalls = 0;
let revokeRides = false;
const seenTokens = new Set<string>();
type RentalLog = { id: number; scootersInfoId: number; engineLicenseNumber: string; lastRentalStartedAt: string; lastRentalEndedAt: string | null; cost: number; isPaid: boolean | null };
let activeRide: RentalLog | null = null;
let lastRide: RentalLog | null = null;
let checkoutBody: Record<string, unknown> | null = null;
let uploadedPhoto = "";
let nextRideId = 9001;
let rideStartOffsetMs = 0;
const closingAt = new Date(Date.now() - 1000).toISOString();
const providerLog: string[] = [];
let billLocation: string | null = null;
let estimateEndedAt: string | null = null;
let reservation: Record<string, unknown> | null = null;

function json(response: ServerResponse, value: unknown, status = 200) {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(value));
}

async function unusedPort() {
	const server = createNetServer();
	await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	await new Promise<void>(resolve => server.close(() => resolve()));
	return port;
}

async function readBody(request: IncomingMessage) {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("latin1");
}

async function providerHandler(request: IncomingMessage, response: ServerResponse) {
	const url = new URL(request.url ?? "/", `http://127.0.0.1:${providerPort}`);
	const path = url.pathname;
	if (path !== "/accounts/require-email-verification-for-login-with-numeric-captcha" && path !== "/accounts/login-by-email-verification-with-numeric-captcha") {
		const authorization = request.headers.authorization;
		if (!authorization || authorization.startsWith("Bearer ") || url.searchParams.get("access_token") !== authorization) return json(response, { message: "bad auth forwarding" }, 401);
		providerAuthChecks += 1;
		seenTokens.add(authorization);
	}
	if (path === "/accounts/require-email-verification-for-login-with-numeric-captcha") return json(response, { success: true });
	if (path === "/accounts/login-by-email-verification-with-numeric-captcha") {
		// Issued 50 minutes ago with 10 minutes left: past half its lifetime, so the API should refresh it.
		const now = Math.floor(Date.now() / 1000);
		const payload = Buffer.from(JSON.stringify({ iat: now - 3000, exp: now + 600 })).toString("base64url");
		return json(response, {
			success: true,
			user: { email: "info@elvismao.com", userId: 115827, roles: [{ name: "customer" }] },
			accessToken: { id: `header.${payload}.signature`, ttl: 3600, created: new Date().toISOString(), userId: 115827, roles: [{ name: "customer" }] }
		});
	}
	if (path === "/accounts/keep-login") {
		keepLoginCalls += 1;
		const now = Math.floor(Date.now() / 1000);
		const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 7 * 86400 })).toString("base64url");
		return json(response, { token: { id: `header.${payload}.refreshed-signature`, ttl: 604800, created: new Date().toISOString(), userId: 115827, roles: ["customer"] } }, 201);
	}
	if (path === "/rental-logs/get-last-rental-log-by-account" && revokeRides) return json(response, { message: "Unauthorized" }, 401);
	if (path === "/scooters-infos")
		return json(response, [{ id: 12, imei: "private-imei", EngineLicenseNumber: "JZ-333", isActive: true, AvailableDistance: 18, accountId: activeRide ? 115827 : null, scooterRentalStationId: 3 }]);
	if (path === "/location-meta/multi-feature-efences")
		return json(response, [
			{
				id: 25,
				type: "noThrottleArea",
				properties: {
					name: "空檔區",
					color: "#FF7C6A",
					priority: 2500,
					polygon: [
						[24.79, 120.99],
						[24.8, 120.99],
						[24.8, 121.0]
					]
				}
			}
		]);
	if (path === "/scooter-rental-stations/active-stations")
		return json(response, [{ id: 3, name: "浩然圖書館", latitude: 24.79315, longitude: 120.99327, totalParkingSpace: 16, stationType: "normal" }]);
	if (path === "/scooter-statuses") return json(response, [{ imei: "private-imei", latitude: 24.79315, longitude: 120.99327, power: 84, errorMsg: null, updatedAt: new Date().toISOString() }]);
	if (path === "/scooters-infos/get-possible-ride-plan/12") return json(response, { basicOrStationRidePlan: { id: 73, name: "普通費率", minMinute: 30, minPrice: 60, normalRate: 2 } });
	if (path === "/rental-logs/get-last-rental-log-by-account") return json(response, lastRide ? [lastRide] : []);
	if (
		[
			"/scooters-infos/bill",
			"/scooters-infos/return",
			"/scooters-infos/estimate-bill",
			"/account-rental-images/upload/",
			"/scooters-infos/checkout-with-creditcard",
			"/scooters-infos/new-rent"
		].includes(path)
	)
		providerLog.push(path.split("/").filter(Boolean).pop()!);
	if (path === "/scooters-infos/estimate-bill") estimateEndedAt = url.searchParams.get("lastRentalEndedAtForCalculationMillis");
	if (path === "/scooters-infos/bill") billLocation = `${url.searchParams.get("latitude")},${url.searchParams.get("longitude")}`;
	if (path === "/scooters-infos/bill" || path === "/scooters-infos/estimate-bill")
		return json(response, {
			rentalEndedAt: closingAt,
			returnStation: { name: "交大-工程三館站" },
			returnType: "GPS",
			rentalCost: 9,
			minPrice: 0,
			scooterRentalLogId: lastRide?.id,
			engineLicenseNumber: "JZ-333",
			costPerMinDurationsAndCosts: { normalMinutes: { costPerMin: 2.4, duration: 240000, cost: 9 }, stopMinutes: { costPerMin: 2.4, duration: 60000, cost: 0 } },
			ridePlan: { name: "月用量 Starter", normalRate: 2.4 },
			imei: "private-imei"
		});
	if (path === "/transaction-logs/get-card") return json(response, [{ id: 154060, issuer: "VISA", lastFour: "4242", isValid: true, accountId: 115827 }]);
	if (path === "/account-rental-images/upload/") {
		uploadedPhoto = await readBody(request);
		assert.equal(url.searchParams.get("type"), "SCOOTER");
		assert.equal(url.searchParams.get("when"), "RETURN");
		return json(response, { success: true, raw: { id: 777, fileId: 1, rentalId: lastRide?.id, type: "SCOOTER", when: "RETURN" } }, 201);
	}
	if (path === "/scooters-infos/checkout-with-creditcard") {
		checkoutBody = JSON.parse(await readBody(request)) as Record<string, unknown>;
		if (lastRide) lastRide.isPaid = true;
		return json(response, { success: true, result: { pointsToDeduct: 0, amount: 9 } }, 201);
	}
	if (path === "/reservation/overall-current") return json(response, []);
	if (path === "/reservation/current") return json(response, reservation ?? {});
	if (path === "/reservation/scooters-info") {
		reservation = { id: 4401, type: "SCOOTER", scootersInfoId: 12, createdAt: new Date().toISOString(), expired: Date.now() + 300_000 };
		return json(response, reservation, 201);
	}
	if (path === "/reservation/self-anhour")
		return json(response, [
			{ id: 4400, type: "SCOOTER", isCancel: true, isPickUp: false, scootersInfoId: 12, createdAt: new Date(Date.now() - 20 * 60_000).toISOString() },
			{ id: 4399, type: "SCOOTER", isCancel: false, isPickUp: true, scootersInfoId: 12, createdAt: new Date(Date.now() - 2 * 3600_000).toISOString() }
		]);
	if (path === "/rental-logs/get-rental-logs-by-account")
		return json(response, [
			{
				id: 3172502,
				engineLicenseNumber: "JZ-401",
				lastRentalStartedAt: "2026-09-22T11:56:00.000Z",
				lastRentalEndedAt: "2026-09-22T11:56:55.000Z",
				cost: 3,
				normalMinutes: 1,
				discountNormalMinutes: 0,
				stopMinutes: 1,
				discountStopMinutes: 0,
				isPaid: true,
				startStationId: 3,
				endStationId: 99,
				imei: "private-imei",
				accountId: 115827,
				ridePlan: JSON.stringify({ id: 53, name: "月用量 Starter" }),
				onOffActionsRecord: JSON.stringify([
					{ type: "off", totalTime: 0, createdAt: 1 },
					{ type: "on", totalTime: 2100, createdAt: 2 },
					{ type: "off", totalTime: 52700, createdAt: 3 }
				])
			}
		]);
	if (path === "/contracts")
		return json(response, [
			{ id: 49, name: "月用量 Starter", paymentType: "Monthly", itemId: 53, details: JSON.stringify({ topUp: [{ id: 1, minutes: 15, price: 33 }] }) },
			{ id: 60, name: "遊客 1.5 小時悠遊券", paymentType: "PayOff", itemId: 70, details: JSON.stringify({ actualPayPrice: 150 }) },
			{ id: 1, name: "beta_Starter 1", paymentType: "Monthly", itemId: 16, details: JSON.stringify({ disabled: true }) }
		]);
	if (path === "/ride-plans")
		return json(response, [
			{
				id: 53,
				name: "月用量 Starter",
				isActive: true,
				normalRate: 2.4,
				actualPayPrice: 120,
				planMinutes: 60,
				period: 30,
				description: JSON.stringify([{ text: "每個月", suffixTag: "60 分鐘免費" }]),
				details: JSON.stringify({ cardBanner: { title: "新·初心者" } })
			},
			{
				id: 70,
				name: "遊客 1.5 小時悠遊券",
				isActive: true,
				normalRate: 1,
				actualPayPrice: 150,
				planMinutes: 90,
				period: 0.0625,
				description: JSON.stringify([{ prefixTag: "1.5 小時內", text: "讓你自由借還" }])
			},
			{ id: 16, name: "beta_Starter", isActive: false }
		]);
	if (path === "/oloo-options") return json(response, [{ id: 24, name: "area_contract_mapping", value: JSON.stringify({ "NCTU-NTHU": [60, 49, 1], default: [60] }) }]);
	if (path === "/user-contracts/take-self-effect")
		return json(response, {
			activeUserContract: [{ id: 53393, contractId: 49, details: JSON.stringify({ autoRenewCanceled: null, opts: { autoRenewCanceled: false } }) }],
			activatedUserRidePlan: {
				startDate: "2026-10-01T18:37:34.000Z",
				endDate: "2026-11-01T15:59:59.000Z",
				remainingMinutes: 12,
				ridePlanId: 53,
				ridePlan: { name: "月用量 Starter", planMinutes: 60, normalRate: 2.4 }
			},
			nextActivateRidePlan: { id: 53, name: "月用量 Starter" }
		});
	if (path.startsWith("/contracts/can-purchase/")) return json(response, path.endsWith("/60") ? { canPurchase: false, reasons: ["ACTIVE_CONTRACT"] } : { canPurchase: true, reasons: [] });
	if (path === "/scooters-infos/new-rent") {
		activeRide = {
			id: nextRideId++,
			scootersInfoId: 12,
			engineLicenseNumber: "JZ-333",
			lastRentalStartedAt: new Date(Date.now() - rideStartOffsetMs).toISOString(),
			lastRentalEndedAt: null,
			cost: 0,
			isPaid: null
		};
		lastRide = activeRide;
		return json(response, { success: true });
	}
	if (path === "/scooters-infos/return") {
		if (lastRide) Object.assign(lastRide, { lastRentalEndedAt: new Date().toISOString(), isPaid: false });
		activeRide = null;
		return json(response, { success: true });
	}
	return json(response, { message: `unhandled ${path}` }, 404);
}

async function api(path: string, init?: RequestInit) {
	return fetch(`http://127.0.0.1:${apiPort}${path}`, {
		...init,
		headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...init?.headers }
	});
}

before(async () => {
	providerServer = createServer(providerHandler);
	await new Promise<void>((resolve, reject) => providerServer.listen(0, "127.0.0.1", resolve).once("error", reject));
	const providerAddress = providerServer.address();
	providerPort = typeof providerAddress === "object" && providerAddress ? providerAddress.port : 0;
	apiPort = await unusedPort();
	apiProcess = spawn(process.execPath, ["dist/server.js"], {
		cwd: apiDirectory,
		env: {
			...process.env,
			PORT: String(apiPort),
			NODE_ENV: "test",
			// Never touch a developer's database: empty values override apps/api/.env and mean "unset".
			DATABASE_URL: "",
			SESSION_ENCRYPTION_KEY: "",
			OLOO_ACCESS_TOKEN: "",
			OLOO_API_BASE_URL: `http://127.0.0.1:${providerPort}`,
			WEB_ORIGINS: "http://127.0.0.1:4174"
		},
		stdio: ["ignore", "pipe", "pipe"]
	});
	let stderr = "";
	apiProcess.stderr?.on("data", chunk => {
		stderr += chunk.toString();
	});
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (apiProcess.exitCode != null) throw new Error(`API exited during setup: ${stderr}`);
		try {
			if ((await api("/v1/health")).ok) return;
		} catch {
			await new Promise(resolve => setTimeout(resolve, 50));
		}
	}
	throw new Error(`API did not start: ${stderr}`);
});

after(async () => {
	apiProcess?.kill("SIGTERM");
	await new Promise<void>(resolve => providerServer.close(() => resolve()));
});

test("Fastify completes the authenticated ride and reservation workflow", async () => {
	let response = await api("/v1/map/stations");
	assert.equal(response.status, 401, "stations require an oloo credential");
	assert.equal(((await response.json()) as { code: string }).code, "AUTH_REQUIRED");

	response = await api("/v1/auth/email/start", { method: "POST", body: JSON.stringify({ email: "info@elvismao.com" }) });
	assert.equal(response.status, 200);
	response = await api("/v1/auth/email/verify", { method: "POST", body: JSON.stringify({ email: "info@elvismao.com", captcha: "123456" }) });
	assert.equal(response.status, 200);
	cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
	assert.match(cookie, /^olowo_session=[0-9a-f-]+$/);
	assert.equal(cookie.includes("provider-jwt-value"), false);

	const sessionResponse = await api("/v1/auth/session");
	const session = (await sessionResponse.json()) as Record<string, unknown>;
	assert.equal(session.authenticated, true);
	assert.equal(keepLoginCalls, 1, "a token past half its lifetime is refreshed once");
	assert.match(sessionResponse.headers.get("set-cookie") ?? "", /olowo_session=/, "the refreshed session cookie gets a new lifetime");
	assert.ok(Date.parse(String(session.expiresAt)) > Date.now() + 6 * 86400_000);
	seenTokens.clear();
	assert.equal("accessToken" in session, false);
	const fleet = (await (await api("/v1/map/stations")).json()) as { stationCount: number; availableCount: number; stations: Array<{ scooters: Array<Record<string, unknown>> }> };
	assert.equal(fleet.stationCount, 1);
	const efences = (await (await api("/v1/map/efences")).json()) as { features: Array<{ properties: { zone: string } }> };
	assert.equal(efences.features[0]?.properties.zone, "noThrottleArea");
	assert.equal(fleet.availableCount, 1);
	assert.equal("imei" in fleet.stations[0]!.scooters[0]!, false);
	assert.ok(providerAuthChecks >= 2);
	assert.ok(
		[...seenTokens].every(token => token.endsWith("refreshed-signature")),
		"upstream calls use the refreshed token"
	);
	await api("/v1/auth/session");
	assert.equal(keepLoginCalls, 1, "a fresh token is not refreshed again");

	response = await api("/v1/rides", {
		method: "POST",
		headers: { "idempotency-key": "integration-rent" },
		body: JSON.stringify({ scooterId: 12, reservationId: null, automation: { action: "return", afterRideSeconds: 28 } })
	});
	assert.equal(response.status, 200);
	const rent = (await response.json()) as { activeRide: { id: number }; automation: { state: string } };
	assert.equal(rent.activeRide.id, 9001);
	assert.equal(rent.automation.state, "scheduled");

	response = await api("/v1/rides/9999/return", { method: "POST", headers: { "idempotency-key": "wrong-ride-key" }, body: JSON.stringify({ scooterId: 12 }) });
	assert.equal(response.status, 409);
	assert.notEqual(activeRide, null);

	providerLog.length = 0;
	response = await api("/v1/rides/9001/return", {
		method: "POST",
		headers: { "idempotency-key": "correct-ride-key" },
		body: JSON.stringify({ scooterId: 12, latitude: 24.7876, longitude: 120.9972 })
	});
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { success: true, rideId: 9001, endedAt: closingAt, returnStation: "交大-工程三館站", locationSource: "rider" });
	assert.equal(activeRide, null);
	assert.deepEqual(providerLog, ["bill", "return"], "like the official app, the ride is priced at the return location before the return command");
	assert.equal(billLocation, "24.7876,120.9972", "the rider's location is used when the PWA sends it");

	const unpaid = (await (await api("/v1/rides/unpaid")).json()) as { ride: { id: number } | null };
	assert.equal(unpaid.ride?.id, 9001, "a returned but unpaid ride waits for checkout");
	response = await api("/v1/rides/9001/bill");
	const { bill } = (await response.json()) as { bill: Record<string, unknown> };
	assert.deepEqual([bill.cost, bill.ridingMinutes, bill.parkedMinutes, bill.planName, bill.returnStation, "imei" in bill], [9, 4, 1, "月用量 Starter", "交大-工程三館站", false]);
	assert.equal(estimateEndedAt, String(Date.parse(closingAt)), "the bill is priced at the moment of return, so it stops growing");
	const { cards } = (await (await api("/v1/payment/cards")).json()) as { cards: Array<Record<string, unknown>> };
	assert.deepEqual(cards, [{ id: 154060, issuer: "VISA", lastFour: "4242", valid: true }], "cards drop the provider account id");

	response = await api("/v1/rides/9001/photo", { method: "POST", headers: { "content-type": "image/jpeg" }, body: Buffer.alloc(4096, 0xff) });
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { imageId: 777 });
	assert.match(uploadedPhoto, /name="file"; filename="9001-[^"]+\.jpg"/, "the photo is forwarded as multipart without the IMEI in its name");

	response = await api("/v1/rides/9001/checkout", { method: "POST", headers: { "idempotency-key": "checkout-key" }, body: JSON.stringify({ imageId: 777, cardId: 154060, useOlooCoin: true }) });
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { success: true, rideId: 9001, amount: 9, pointsDeducted: 0 });
	assert.deepEqual(checkoutBody, { extraFee: 0, firstImgId: 777, selectedCard: 154060, useOlooCoin: true, rentalLogId: 9001, imei: "private-imei" });
	assert.deepEqual(await (await api("/v1/rides/unpaid")).json(), { ride: null });
	response = await api("/v1/rides/9001/photo", { method: "POST", headers: { "content-type": "image/jpeg" }, body: Buffer.alloc(4096, 0xff) });
	assert.equal(response.status, 409, "a paid ride cannot receive another photo");

	// Return and reborrow: after N seconds of riding the server returns, pays with the placeholder photo, then rents again.
	rideStartOffsetMs = 12_000;
	response = await api("/v1/rides", { method: "POST", headers: { "idempotency-key": "integration-rent-2" }, body: JSON.stringify({ scooterId: 12, reservationId: null }) });
	assert.equal(((await response.json()) as { activeRide: { id: number } }).activeRide.id, 9002);
	response = await api("/v1/rides/9002/automation", { method: "PUT", body: JSON.stringify({ action: "return_and_reborrow", afterRideSeconds: 23 }) });
	assert.equal(response.status, 200);
	providerLog.length = 0;
	uploadedPhoto = "";
	for (let waited = 0; waited < 20_000 && activeRide?.id !== 9003; waited += 250) await new Promise(resolve => setTimeout(resolve, 250));
	assert.deepEqual(providerLog, ["bill", "return", "upload", "checkout-with-creditcard", "new-rent"]);
	assert.ok(uploadedPhoto.includes("\x89PNG") && /filename="9002-[^"]+\.png"/.test(uploadedPhoto), "the placeholder PNG is uploaded for the returned ride");
	assert.equal(checkoutBody?.rentalLogId, 9002);
	assert.equal(checkoutBody?.selectedCard, 154060);
	assert.equal(activeRide?.id, 9003, "the same scooter is borrowed again");
	const automation = (await (await api("/v1/rides/9002/automation")).json()) as { automation: { state: string } };
	assert.equal(automation.automation.state, "completed");
	rideStartOffsetMs = 0;

	// Reservations: the countdown comes from oloo's epoch-millisecond deadline, usage from oloo's own hourly list.
	response = await api("/v1/reservations", { method: "POST", headers: { "idempotency-key": "reserve-key" }, body: JSON.stringify({ engineLicenseNumber: "JZ-333" }) });
	const reserved = (await response.json()) as { reservationId: number; expiresAt: string };
	assert.equal(reserved.reservationId, 4401);
	assert.ok(Math.abs(Date.parse(reserved.expiresAt) - (Date.now() + 300_000)) < 5_000, "expiresAt is an ISO time five minutes out");
	const [current] = (await (await api("/v1/reservations/current")).json()) as Array<{ id: number; scooterId: number; expiresAt: string }>;
	assert.deepEqual([current?.id, current?.scooterId, current?.expiresAt], [4401, 12, reserved.expiresAt]);
	const usage = (await (await api("/v1/reservations/usage")).json()) as Record<string, unknown>;
	assert.deepEqual([usage.limitPerHour, usage.reservedLastHour, usage.cancelledLastHour, usage.remaining], [2, 1, 1, 1], "only the last hour counts, as oloo does");
	reservation = null;

	const { rides } = (await (await api("/v1/rides/history")).json()) as { rides: Array<Record<string, unknown>> };
	assert.deepEqual(rides[0], {
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
		startStation: "浩然圖書館",
		endStation: null
	});

	const catalog = (await (await api("/v1/plans?region=NCTU-NTHU")).json()) as { current: Record<string, unknown>; plans: Array<Record<string, unknown>> };
	assert.deepEqual(
		catalog.plans.map(plan => [plan.contractId, plan.kind, plan.current, plan.canPurchase, plan.reasons]),
		[
			[60, "pass", false, false, ["ACTIVE_CONTRACT"]],
			[49, "monthly", true, true, []]
		],
		"disabled contracts are hidden and each plan carries oloo's own purchase check"
	);
	assert.deepEqual([catalog.current.name, catalog.current.remainingMinutes, catalog.current.autoRenew, catalog.current.topUps], ["月用量 Starter", 12, true, [{ minutes: 15, price: 33, tag: null }]]);

	revokeRides = true;
	response = await api("/v1/rides/current");
	assert.equal(response.status, 401, "an upstream 401 surfaces as AUTH_REQUIRED");
	assert.deepEqual(await (await api("/v1/auth/session")).json(), { authenticated: false }, "the revoked session is dropped");
	revokeRides = false;

	response = await api("/v1/auth/logout", { method: "POST" });
	assert.equal(response.status, 200);
	assert.deepEqual(await (await api("/v1/auth/session")).json(), { authenticated: false });
});
