import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadEnvFile } from "node:process";
import { z } from "zod";
import { publicSession, SessionStore, startEmailLogin, verifyEmailLogin } from "./auth.js";
import { createDatabase } from "./database.js";
import { demoFleet } from "./fleet.js";
import { olooRequest, OlooUpstreamError, resolveProviderScooter } from "./oloo.js";
import { fetchOlooFleet } from "./oloo-fleet.js";

try {
	loadEnvFile();
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const environment = z
	.object({
		PORT: z.coerce.number().int().min(1).max(65535).default(8787),
		WEB_ORIGINS: z
			.string()
			.default("http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173")
			.transform(value => value.split(",").map(origin => z.string().url().parse(origin.trim()))),
		DATABASE_URL: z.string().url().optional(),
		NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
		OLOO_ACCESS_TOKEN: z.string().min(20).optional(),
		OLOO_API_BASE_URL: z.string().url().default("https://looplus-api-staging.loopluscooter.com/nest/api")
	})
	.parse(process.env);

const app = Fastify({ logger: true, trustProxy: true });
const database = createDatabase(environment.DATABASE_URL);
const sessions = new SessionStore();
const sessionCookie = "oluwu_session";
let fleetCache: { expiresAt: number; token: string; value: typeof demoFleet } | null = null;
const actions = new Map<string, Promise<unknown>>();

function runIdempotent<T>(key: string, action: () => Promise<T>) {
	const existing = actions.get(key);
	if (existing) return existing as Promise<T>;
	const result = action();
	actions.set(key, result);
	setTimeout(() => actions.delete(key), 5 * 60_000).unref();
	return result;
}

async function getFleet(token?: string) {
	const providerToken = token ?? environment.OLOO_ACCESS_TOKEN;
	if (!providerToken) return demoFleet;
	if (fleetCache && fleetCache.token === providerToken && fleetCache.expiresAt > Date.now()) return fleetCache.value;
	const value = await fetchOlooFleet(environment.OLOO_API_BASE_URL, providerToken);
	fleetCache = { expiresAt: Date.now() + 25_000, token: providerToken, value };
	return value;
}

await app.register(cors, {
	origin: environment.WEB_ORIGINS,
	credentials: true
});
await app.register(cookie);

app.get("/v1/health", async () => {
	if (!database) return { ok: true, service: "oluwu-api", database: "not_configured" };
	await database.query("SELECT 1");
	return { ok: true, service: "oluwu-api", database: "ready" };
});

app.get("/v1/map/scooters", async (request, reply) => {
	reply.header("cache-control", "private, max-age=15, stale-while-revalidate=30");
	return getFleet(sessions.get(request.cookies[sessionCookie])?.accessToken);
});

app.get("/v1/map/availability-summary", async request => {
	const fleet = await getFleet(sessions.get(request.cookies[sessionCookie])?.accessToken);
	return {
		totalCount: fleet.totalCount,
		availableCount: fleet.availableCount,
		unavailableCount: fleet.unavailableCount,
		reasons: fleet.reasons
	};
});

app.get("/v1/scooters/:scooterId/ride-plan", async (request, reply) => {
	const session = sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { scooterId } = z.object({ scooterId: z.coerce.number().int().positive() }).parse(request.params);
	const result = await olooRequest<Record<string, unknown>>(environment.OLOO_API_BASE_URL, `/scooters-infos/get-possible-ride-plan/${scooterId}`, session.accessToken);
	return reply.send(result);
});

app.get("/v1/rides/current", async (request, reply) => {
	const session = sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const logs = await olooRequest<Array<Record<string, unknown>>>(environment.OLOO_API_BASE_URL, "/rental-logs/get-last-rental-log-by-account", session.accessToken);
	const ride = logs[0];
	if (!ride || ride.lastRentalEndedAt) return reply.send({ activeRide: null });
	return reply.send({
		activeRide: {
			id: ride.id,
			scooterId: ride.scootersInfoId,
			label: ride.engineLicenseNumber,
			startedAt: ride.lastRentalStartedAt,
			cost: ride.cost
		}
	});
});

app.post("/v1/rides", async (request, reply) => {
	const session = sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const key = z.string().min(8).parse(request.headers["idempotency-key"]);
	const body = z.object({ scooterId: z.number().int().positive(), reservationId: z.number().int().positive().nullable().default(null) }).parse(request.body);
	const result = await runIdempotent(`${session.userId}:rent:${key}`, async () => {
		const scooter = await resolveProviderScooter(environment.OLOO_API_BASE_URL, session.accessToken, body.scooterId);
		const upstream = await olooRequest<{ success?: boolean }>(environment.OLOO_API_BASE_URL, "/scooters-infos/new-rent", session.accessToken, {
			method: "POST",
			body: JSON.stringify({ imei: scooter.imei, reservationId: body.reservationId })
		});
		return { success: upstream.success !== false, scooterId: scooter.id, label: scooter.EngineLicenseNumber };
	});
	return reply.send(result);
});

app.post("/v1/rides/:rideId/return", async (request, reply) => {
	const session = sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const key = z.string().min(8).parse(request.headers["idempotency-key"]);
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	const { scooterId } = z.object({ scooterId: z.number().int().positive() }).parse(request.body);
	const result = await runIdempotent(`${session.userId}:return:${rideId}:${key}`, async () => {
		const scooter = await resolveProviderScooter(environment.OLOO_API_BASE_URL, session.accessToken, scooterId);
		const upstream = await olooRequest<{ success?: boolean }>(environment.OLOO_API_BASE_URL, "/scooters-infos/return", session.accessToken, {
			method: "POST",
			body: JSON.stringify({ imei: scooter.imei })
		});
		return { success: upstream.success !== false, rideId };
	});
	return reply.send(result);
});

app.get("/v1/reservations/current", async (request, reply) => {
	const session = sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const reservations = await olooRequest<Array<Record<string, unknown>>>(environment.OLOO_API_BASE_URL, "/reservation/overall-current", session.accessToken);
	return reply.send(
		reservations.map(item => ({
			id: item.id,
			type: item.type,
			scooterId: item.scootersInfoId,
			vehicleId: item.vehiclesInfoId,
			label: item.EngineLicenseNumber,
			createdAt: item.createdAt,
			expiresAt: item.expired
		}))
	);
});

app.post("/v1/reservations", async (request, reply) => {
	const session = sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const key = z.string().min(8).parse(request.headers["idempotency-key"]);
	const { engineLicenseNumber } = z.object({ engineLicenseNumber: z.string().min(2).max(32) }).parse(request.body);
	const result = await runIdempotent(`${session.userId}:reserve:${key}`, () =>
		olooRequest<Record<string, unknown>>(environment.OLOO_API_BASE_URL, "/reservation/scooters-info", session.accessToken, {
			method: "POST",
			body: JSON.stringify({ engineLicenseNumber })
		})
	);
	return reply.send({ success: true, reservationId: result.id, expiresAt: result.expired });
});

app.delete("/v1/reservations/:reservationId", async (request, reply) => {
	const session = sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const key = z.string().min(8).parse(request.headers["idempotency-key"]);
	const { reservationId } = z.object({ reservationId: z.coerce.number().int().positive() }).parse(request.params);
	await runIdempotent(`${session.userId}:cancel-reservation:${reservationId}:${key}`, () =>
		olooRequest(environment.OLOO_API_BASE_URL, "/reservation/cancel", session.accessToken, { method: "POST", body: JSON.stringify({ reservationId }) })
	);
	return reply.send({ success: true });
});

app.get("/v1/auth/session", async request => {
	const session = sessions.get(request.cookies[sessionCookie]);
	return session ? publicSession(session) : { authenticated: false as const };
});

app.post("/v1/auth/email/start", async (request, reply) => {
	const { email } = z.object({ email: z.string().email() }).parse(request.body);
	await startEmailLogin(environment.OLOO_API_BASE_URL, email);
	return reply.send({ success: true, email });
});

app.post("/v1/auth/email/verify", async (request, reply) => {
	const body = z.object({ email: z.string().email(), captcha: z.string().regex(/^\d{6}$/) }).parse(request.body);
	const login = await verifyEmailLogin(environment.OLOO_API_BASE_URL, body.email, body.captcha);
	const session = sessions.create(login);
	reply.setCookie(sessionCookie, session.id, {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: environment.NODE_ENV === "production",
		maxAge: Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000))
	});
	return reply.send(publicSession(session));
});

app.post("/v1/auth/logout", async (request, reply) => {
	sessions.delete(request.cookies[sessionCookie]);
	reply.clearCookie(sessionCookie, { path: "/" });
	return reply.send({ success: true });
});

app.setErrorHandler((error, _request, reply) => {
	app.log.error({ err: error }, "request failed");
	if (error instanceof OlooUpstreamError) {
		void reply.code(error.status >= 400 && error.status < 500 ? error.status : 502).send({ code: "UPSTREAM_ERROR", message: error.message });
		return;
	}
	if (error instanceof z.ZodError) {
		void reply.code(400).send({ code: "INVALID_REQUEST", message: "Invalid request" });
		return;
	}
	void reply.code(500).send({ code: "INTERNAL_ERROR", message: "Request failed" });
});

app.addHook("onClose", async () => {
	await database?.end();
});

await app.listen({ host: "127.0.0.1", port: environment.PORT });
