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
let activeRide: null | { id: number; scootersInfoId: number; engineLicenseNumber: string; lastRentalStartedAt: string; lastRentalEndedAt: null; cost: number } = null;

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

function providerHandler(request: IncomingMessage, response: ServerResponse) {
	const url = new URL(request.url ?? "/", `http://127.0.0.1:${providerPort}`);
	const path = url.pathname;
	if (path !== "/accounts/require-email-verification-for-login-with-numeric-captcha" && path !== "/accounts/login-by-email-verification-with-numeric-captcha") {
		const authorization = request.headers.authorization;
		if (!authorization || authorization.startsWith("Bearer ") || url.searchParams.get("access_token") !== authorization) return json(response, { message: "bad auth forwarding" }, 401);
		providerAuthChecks += 1;
	}
	if (path === "/accounts/require-email-verification-for-login-with-numeric-captcha") return json(response, { success: true });
	if (path === "/accounts/login-by-email-verification-with-numeric-captcha") {
		const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
		return json(response, {
			success: true,
			user: { email: "info@elvismao.com", userId: 115827, roles: [{ name: "customer" }] },
			accessToken: { id: `header.${payload}.signature`, ttl: 3600, created: new Date().toISOString(), userId: 115827, roles: [{ name: "customer" }] }
		});
	}
	if (path === "/scooters-infos")
		return json(response, [{ id: 12, imei: "private-imei", EngineLicenseNumber: "JZ-333", isActive: true, AvailableDistance: 18, accountId: activeRide ? 115827 : null }]);
	if (path === "/scooter-statuses") return json(response, [{ imei: "private-imei", latitude: 24.79315, longitude: 120.99327, power: 84, errorMsg: null, updatedAt: new Date().toISOString() }]);
	if (path === "/scooters-infos/get-possible-ride-plan/12") return json(response, { basicOrStationRidePlan: { id: 73, name: "普通費率", minMinute: 30, minPrice: 60, normalRate: 2 } });
	if (path === "/rental-logs/get-last-rental-log-by-account") return json(response, activeRide ? [activeRide] : []);
	if (path === "/reservation/overall-current") return json(response, []);
	if (path === "/reservation/current") return json(response, {});
	if (path === "/scooters-infos/new-rent") {
		activeRide = { id: 9001, scootersInfoId: 12, engineLicenseNumber: "JZ-333", lastRentalStartedAt: new Date().toISOString(), lastRentalEndedAt: null, cost: 0 };
		return json(response, { success: true });
	}
	if (path === "/scooters-infos/return") {
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
	let response = await api("/v1/auth/email/start", { method: "POST", body: JSON.stringify({ email: "info@elvismao.com" }) });
	assert.equal(response.status, 200);
	response = await api("/v1/auth/email/verify", { method: "POST", body: JSON.stringify({ email: "info@elvismao.com", captcha: "123456" }) });
	assert.equal(response.status, 200);
	cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
	assert.match(cookie, /^oluwu_session=[0-9a-f-]+$/);
	assert.equal(cookie.includes("provider-jwt-value"), false);

	const session = (await (await api("/v1/auth/session")).json()) as Record<string, unknown>;
	assert.equal(session.authenticated, true);
	assert.equal("accessToken" in session, false);
	const fleet = (await (await api("/v1/map/scooters")).json()) as { availableCount: number; scooters: Array<Record<string, unknown>> };
	assert.equal(fleet.availableCount, 1);
	assert.equal("imei" in fleet.scooters[0]!, false);
	assert.ok(providerAuthChecks >= 2);

	response = await api("/v1/reservations/scheduled", { method: "PUT", body: JSON.stringify({ scooterId: 12, engineLicenseNumber: "JZ-333", secondsFromNow: 300 }) });
	assert.equal(response.status, 200);
	assert.equal(((await response.json()) as { schedule: { state: string } }).schedule.state, "scheduled");

	response = await api("/v1/rides", {
		method: "POST",
		headers: { "idempotency-key": "integration-rent" },
		body: JSON.stringify({ scooterId: 12, reservationId: null, automation: { action: "notify", afterRideSeconds: 89 } })
	});
	assert.equal(response.status, 200);
	const rent = (await response.json()) as { activeRide: { id: number }; automation: { state: string } };
	assert.equal(rent.activeRide.id, 9001);
	assert.equal(rent.automation.state, "scheduled");

	response = await api("/v1/rides/9999/return", { method: "POST", headers: { "idempotency-key": "wrong-ride-key" }, body: JSON.stringify({ scooterId: 12 }) });
	assert.equal(response.status, 409);
	assert.notEqual(activeRide, null);

	response = await api("/v1/rides/9001/return", { method: "POST", headers: { "idempotency-key": "correct-ride-key" }, body: JSON.stringify({ scooterId: 12 }) });
	assert.equal(response.status, 200);
	assert.equal(activeRide, null);

	response = await api("/v1/auth/logout", { method: "POST" });
	assert.equal(response.status, 200);
	assert.deepEqual(await (await api("/v1/auth/session")).json(), { authenticated: false });
});
