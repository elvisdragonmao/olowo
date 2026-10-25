import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadEnvFile } from "node:process";
import { z } from "zod";
import { publicSession, type ProviderSession, SessionStore, startEmailLogin, verifyEmailLogin } from "./auth.js";
import { createDatabase } from "./database.js";
import { demoFleet } from "./fleet.js";
import { olooRequest, OlooUpstreamError, resolveProviderScooter } from "./oloo.js";
import { fetchOlooFleet } from "./oloo-fleet.js";
import { publicReservationAutomation, ReservationAutomationStore } from "./reservation-automation.js";
import { publicAutomation, RideAutomationStore } from "./ride-automation.js";
import { ScheduledActionRepository, type StoredScheduledAction } from "./scheduled-action-repository.js";

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
		SESSION_ENCRYPTION_KEY: z
			.string()
			.regex(/^[0-9a-fA-F]{64}$/)
			.optional(),
		NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
		OLOO_ACCESS_TOKEN: z.string().min(20).optional(),
		OLOO_API_BASE_URL: z.string().url().default("https://looplus-api-staging.loopluscooter.com/nest/api")
	})
	.parse(process.env);

const app = Fastify({ logger: true, trustProxy: true });
const database = createDatabase(environment.DATABASE_URL);
const sessions = new SessionStore(database, environment.SESSION_ENCRYPTION_KEY);
const sessionCookie = "oluwu_session";
let fleetCache: { expiresAt: number; token: string; value: typeof demoFleet } | null = null;
const actions = new Map<string, Promise<unknown>>();
const scheduledActions = new ScheduledActionRepository(database);
const persistFailure = (kind: string, id: string, error: unknown) => app.log.error({ err: error, kind, scheduledActionId: id }, "failed to persist scheduled action");
const rideAutomations = new RideAutomationStore(task => void scheduledActions.saveRide(task).catch(error => persistFailure("ride", task.id, error)));
const reservationAutomations = new ReservationAutomationStore(task => void scheduledActions.saveReservation(task).catch(error => persistFailure("reservation", task.id, error)));

interface ActiveRide {
	id: number;
	scooterId: number;
	label: string;
	startedAt: string;
	cost: number;
}

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

async function getActiveRide(session: ProviderSession): Promise<ActiveRide | null> {
	const logs = await olooRequest<Array<Record<string, unknown>>>(environment.OLOO_API_BASE_URL, "/rental-logs/get-last-rental-log-by-account", session.accessToken);
	const ride = logs[0];
	if (!ride || ride.lastRentalEndedAt) return null;
	const parsed = z
		.object({
			id: z.coerce.number().int().positive(),
			scootersInfoId: z.coerce.number().int().positive(),
			engineLicenseNumber: z.string().min(1),
			lastRentalStartedAt: z.string().datetime(),
			cost: z.coerce.number().default(0)
		})
		.safeParse(ride);
	if (!parsed.success) throw new OlooUpstreamError(502, "Upstream returned an invalid active ride");
	return {
		id: parsed.data.id,
		scooterId: parsed.data.scootersInfoId,
		label: parsed.data.engineLicenseNumber,
		startedAt: parsed.data.lastRentalStartedAt,
		cost: parsed.data.cost
	};
}

async function getCurrentReservations(session: ProviderSession) {
	const value = await olooRequest<Record<string, unknown> | Array<Record<string, unknown>>>(environment.OLOO_API_BASE_URL, "/reservation/current", session.accessToken);
	if (Array.isArray(value)) return value;
	return value && typeof value === "object" && Object.keys(value).length > 0 ? [value] : [];
}

async function waitForActiveRide(session: ProviderSession, scooterId: number) {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const ride = await getActiveRide(session);
		if (ride?.scooterId === scooterId) return ride;
		await new Promise(resolve => setTimeout(resolve, 350));
	}
	throw new OlooUpstreamError(409, "Rental started but the active ride is not visible yet");
}

async function returnCurrentRide(session: ProviderSession, rideId: number, scooterId: number) {
	const active = await getActiveRide(session);
	if (!active || active.id !== rideId || active.scooterId !== scooterId) {
		throw new OlooUpstreamError(409, "Active ride changed; no return command was sent");
	}
	const scooter = await resolveProviderScooter(environment.OLOO_API_BASE_URL, session.accessToken, scooterId);
	const upstream = await olooRequest<{ success?: boolean }>(environment.OLOO_API_BASE_URL, "/scooters-infos/return", session.accessToken, {
		method: "POST",
		body: JSON.stringify({ imei: scooter.imei })
	});
	return { success: upstream.success !== false, rideId, scooter };
}

function startRideAutomation(
	session: ProviderSession,
	input: { id?: string; createdAt?: number; rideId: number; scooterId: number; action: "notify" | "return" | "return_and_reborrow"; triggerAt: number }
) {
	return rideAutomations.schedule({ userId: session.userId, ...input }, async task => {
		if (task.action === "notify") return;
		const returned = await returnCurrentRide(session, task.rideId, task.scooterId);
		if (task.action === "return_and_reborrow") {
			await new Promise(resolve => setTimeout(resolve, 1_500));
			await olooRequest(environment.OLOO_API_BASE_URL, "/scooters-infos/new-rent", session.accessToken, {
				method: "POST",
				body: JSON.stringify({ imei: returned.scooter.imei, reservationId: null })
			});
		}
	});
}

function scheduleRideAutomation(session: ProviderSession, ride: ActiveRide, action: "notify" | "return" | "return_and_reborrow", afterRideSeconds: number) {
	const triggerAt = Date.parse(ride.startedAt) + afterRideSeconds * 1000;
	if (!Number.isFinite(triggerAt) || triggerAt < Date.now() + 10_000) {
		throw new OlooUpstreamError(409, "The selected ride timer has already passed or is too close to execute safely");
	}
	return startRideAutomation(session, { rideId: ride.id, scooterId: ride.scooterId, action, triggerAt });
}

function startReservationAutomation(session: ProviderSession, input: { id?: string; createdAt?: number; scooterId: number; engineLicenseNumber: string; triggerAt: number }) {
	return reservationAutomations.schedule({ userId: session.userId, ...input }, async task => {
		const activeReservations = await getCurrentReservations(session);
		if (activeReservations.length > 0) throw new OlooUpstreamError(409, "An active reservation already exists");
		const scooter = await resolveProviderScooter(environment.OLOO_API_BASE_URL, session.accessToken, task.scooterId);
		if (scooter.EngineLicenseNumber !== task.engineLicenseNumber) throw new OlooUpstreamError(409, "Scooter identity changed");
		const result = await olooRequest<Record<string, unknown>>(environment.OLOO_API_BASE_URL, "/reservation/scooters-info", session.accessToken, {
			method: "POST",
			body: JSON.stringify({ engineLicenseNumber: task.engineLicenseNumber })
		});
		return { reservationId: typeof result.id === "number" ? result.id : undefined, expiresAt: typeof result.expired === "string" ? result.expired : undefined };
	});
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
	return getFleet((await sessions.get(request.cookies[sessionCookie]))?.accessToken);
});

app.get("/v1/map/availability-summary", async request => {
	const fleet = await getFleet((await sessions.get(request.cookies[sessionCookie]))?.accessToken);
	return {
		totalCount: fleet.totalCount,
		availableCount: fleet.availableCount,
		unavailableCount: fleet.unavailableCount,
		reasons: fleet.reasons
	};
});

app.get("/v1/scooters/:scooterId/ride-plan", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { scooterId } = z.object({ scooterId: z.coerce.number().int().positive() }).parse(request.params);
	const result = await olooRequest<Record<string, unknown>>(environment.OLOO_API_BASE_URL, `/scooters-infos/get-possible-ride-plan/${scooterId}`, session.accessToken);
	return reply.send(result);
});

app.get("/v1/rides/current", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	return reply.send({ activeRide: await getActiveRide(session) });
});

app.post("/v1/rides", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const key = z.string().min(8).parse(request.headers["idempotency-key"]);
	const body = z
		.object({
			scooterId: z.number().int().positive(),
			reservationId: z.number().int().positive().nullable().default(null),
			automation: z
				.object({
					action: z.enum(["notify", "return", "return_and_reborrow"]),
					afterRideSeconds: z
						.number()
						.int()
						.min(30)
						.max(6 * 60 * 60)
				})
				.optional()
		})
		.parse(request.body);
	const result = await runIdempotent(`${session.userId}:rent:${key}`, async () => {
		const scooter = await resolveProviderScooter(environment.OLOO_API_BASE_URL, session.accessToken, body.scooterId);
		const upstream = await olooRequest<{ success?: boolean }>(environment.OLOO_API_BASE_URL, "/scooters-infos/new-rent", session.accessToken, {
			method: "POST",
			body: JSON.stringify({ imei: scooter.imei, reservationId: body.reservationId })
		});
		const ride = await waitForActiveRide(session, scooter.id);
		const automation = body.automation ? scheduleRideAutomation(session, ride, body.automation.action, body.automation.afterRideSeconds) : null;
		if (automation) await scheduledActions.saveRide(automation);
		return { success: upstream.success !== false, scooterId: scooter.id, label: scooter.EngineLicenseNumber, activeRide: ride, automation: publicAutomation(automation) };
	});
	return reply.send(result);
});

app.post("/v1/rides/:rideId/return", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const key = z.string().min(8).parse(request.headers["idempotency-key"]);
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	const { scooterId } = z.object({ scooterId: z.number().int().positive() }).parse(request.body);
	const result = await runIdempotent(`${session.userId}:return:${rideId}:${key}`, async () => {
		const returned = await returnCurrentRide(session, rideId, scooterId);
		rideAutomations.cancel(session.userId, rideId);
		return { success: returned.success, rideId };
	});
	return reply.send(result);
});

app.get("/v1/rides/:rideId/automation", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	return reply.send({ automation: publicAutomation(rideAutomations.get(session.userId, rideId)) });
});

app.put("/v1/rides/:rideId/automation", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	const body = z
		.object({
			action: z.enum(["notify", "return", "return_and_reborrow"]),
			afterRideSeconds: z
				.number()
				.int()
				.min(30)
				.max(6 * 60 * 60)
		})
		.parse(request.body);
	const active = await getActiveRide(session);
	if (!active || active.id !== rideId) return reply.code(409).send({ code: "RIDE_CHANGED", message: "Active ride changed" });
	const automation = scheduleRideAutomation(session, active, body.action, body.afterRideSeconds);
	await scheduledActions.saveRide(automation);
	return reply.send({ automation: publicAutomation(automation) });
});

app.delete("/v1/rides/:rideId/automation", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	rideAutomations.cancel(session.userId, rideId);
	return reply.send({ success: true });
});

app.get("/v1/reservations/current", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const reservations = await getCurrentReservations(session);
	return reply.send(
		reservations.map(item => ({
			id: item.id ?? item.reservationId,
			type: item.type,
			scooterId: item.scootersInfoId,
			vehicleId: item.vehiclesInfoId,
			label: item.EngineLicenseNumber ?? (item.scootersInfo && typeof item.scootersInfo === "object" ? (item.scootersInfo as Record<string, unknown>).EngineLicenseNumber : undefined),
			createdAt: item.createdAt,
			expiresAt: item.expired
		}))
	);
});

app.post("/v1/reservations", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
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

app.get("/v1/reservations/scheduled", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	return reply.send({ schedule: publicReservationAutomation(reservationAutomations.get(session.userId)) });
});

app.put("/v1/reservations/scheduled", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const body = z
		.object({
			scooterId: z.number().int().positive(),
			engineLicenseNumber: z.string().min(2).max(32),
			secondsFromNow: z
				.number()
				.int()
				.min(30)
				.max(24 * 60 * 60)
		})
		.parse(request.body);
	const automation = startReservationAutomation(session, {
		scooterId: body.scooterId,
		engineLicenseNumber: body.engineLicenseNumber,
		triggerAt: Date.now() + body.secondsFromNow * 1000
	});
	await scheduledActions.saveReservation(automation);
	return reply.send({ schedule: publicReservationAutomation(automation) });
});

app.delete("/v1/reservations/scheduled", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	reservationAutomations.cancel(session.userId);
	return reply.send({ success: true });
});

app.delete("/v1/reservations/:reservationId", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const key = z.string().min(8).parse(request.headers["idempotency-key"]);
	const { reservationId } = z.object({ reservationId: z.coerce.number().int().positive() }).parse(request.params);
	await runIdempotent(`${session.userId}:cancel-reservation:${reservationId}:${key}`, () =>
		olooRequest(environment.OLOO_API_BASE_URL, "/reservation/cancel", session.accessToken, { method: "POST", body: JSON.stringify({ reservationId }) })
	);
	return reply.send({ success: true });
});

app.get("/v1/auth/session", async request => {
	const session = await sessions.get(request.cookies[sessionCookie]);
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
	const session = await sessions.create(login);
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
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (session) {
		rideAutomations.cancelForUser(session.userId);
		reservationAutomations.cancel(session.userId);
	}
	await sessions.delete(request.cookies[sessionCookie]);
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
	rideAutomations.close();
	reservationAutomations.close();
	await database?.end();
});

async function restoreScheduledAction(stored: StoredScheduledAction) {
	const session = await sessions.getForProviderUser(stored.userId);
	if (!session) {
		await scheduledActions.fail(stored.id, "No unexpired provider session is available");
		return;
	}
	if (stored.kind === "ride") {
		startRideAutomation(session, {
			id: stored.id,
			createdAt: stored.createdAt,
			rideId: stored.rideId,
			scooterId: stored.scooterId,
			action: stored.action,
			triggerAt: stored.triggerAt
		});
		return;
	}
	startReservationAutomation(session, {
		id: stored.id,
		createdAt: stored.createdAt,
		scooterId: stored.scooterId,
		engineLicenseNumber: stored.engineLicenseNumber,
		triggerAt: stored.triggerAt
	});
}

for (const stored of await scheduledActions.loadPending()) {
	try {
		await restoreScheduledAction(stored);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to restore scheduled action";
		await scheduledActions.fail(stored.id, message);
		app.log.error({ err: error, scheduledActionId: stored.id }, "failed to restore scheduled action");
	}
}

await app.listen({ host: "127.0.0.1", port: environment.PORT });
