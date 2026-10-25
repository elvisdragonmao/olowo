import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { loadEnvFile } from "node:process";
import { z } from "zod";
import { keepLogin, needsRefresh, publicSession, type ProviderSession, SessionStore, startEmailLogin, verifyEmailLogin } from "./auth.js";
import { fetchCards, toPublicBill, uploadReturnPhoto } from "./billing.js";
import { applySchema, createDatabase } from "./database.js";
import { EfenceCache } from "./efences.js";
import type { FleetSnapshot } from "./fleet.js";
import { IdempotencyStore } from "./idempotency.js";
import { olooRequest, OlooUpstreamError, resolveProviderScooter } from "./oloo.js";
import { buildFleetSnapshot, FleetCache, reservedScooterIds, type RawFleet } from "./oloo-fleet.js";
import { ReservationLog } from "./reservation-log.js";
import { publicAutomation, RideAutomationStore } from "./ride-automation.js";
import { ScheduledActionRepository, type StoredScheduledAction } from "./scheduled-action-repository.js";

try {
	loadEnvFile();
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const environment = z
	.object({
		HOST: z.string().min(1).default("127.0.0.1"),
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
	// Compose and many hosts pass unset optional variables as empty strings.
	.parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== "")));

const app = Fastify({ logger: true, trustProxy: true });
const database = createDatabase(environment.DATABASE_URL);
if (database) await applySchema(database);
const sessions = new SessionStore(database, environment.SESSION_ENCRYPTION_KEY);
const sessionCookie = "olowo_session";
const fleetCache = new FleetCache(environment.OLOO_API_BASE_URL);
const efenceCache = new EfenceCache(environment.OLOO_API_BASE_URL);
const ownReservationCache = new Map<number, { expiresAt: number; ids: Set<number> }>();
let sharedSnapshot: { raw: RawFleet; value: FleetSnapshot } | null = null;
const idempotency = new IdempotencyStore(database);
const scheduledActions = new ScheduledActionRepository(database);
const persistFailure = (kind: string, id: string, error: unknown) => app.log.error({ err: error, kind, scheduledActionId: id }, "failed to persist scheduled action");
const claimJob = (task: { id: string }) => scheduledActions.claim(task.id);
const rideAutomations = new RideAutomationStore(task => void scheduledActions.saveRide(task).catch(error => persistFailure("ride", task.id, error)), claimJob);
const reservationLog = new ReservationLog(database);
const refreshes = new Map<number, Promise<void>>();
const lastRefreshAttempt = new Map<number, number>();

interface ActiveRide {
	id: number;
	scooterId: number;
	label: string;
	startedAt: string;
	cost: number;
}

function setSessionCookie(reply: FastifyReply, session: ProviderSession) {
	reply.setCookie(sessionCookie, session.id, {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: environment.NODE_ENV === "production",
		maxAge: Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000))
	});
}

/** Extends the provider token with keep-login once half its lifetime has passed, at most every ten minutes per user. */
async function refreshProviderToken(session: ProviderSession) {
	if (!needsRefresh(session) || Date.now() - (lastRefreshAttempt.get(session.userId) ?? 0) < 10 * 60_000) return false;
	let pending = refreshes.get(session.userId);
	if (!pending) {
		lastRefreshAttempt.set(session.userId, Date.now());
		pending = keepLogin(environment.OLOO_API_BASE_URL, session.accessToken)
			.then(token => sessions.replaceToken(session, token))
			.catch(error => app.log.warn({ err: error, userId: session.userId }, "provider keep-login failed; the current token stays in use"))
			.finally(() => refreshes.delete(session.userId));
		refreshes.set(session.userId, pending);
	}
	await pending;
	return true;
}

async function getSession(request: FastifyRequest, reply: FastifyReply) {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (session && (await refreshProviderToken(session))) setSessionCookie(reply, session);
	return session;
}

async function getOwnReservedIds(session: ProviderSession) {
	const cached = ownReservationCache.get(session.userId);
	if (cached && cached.expiresAt > Date.now()) return cached.ids;
	const ids = reservedScooterIds(await olooRequest<unknown>(environment.OLOO_API_BASE_URL, "/reservation/current", session.accessToken));
	ownReservationCache.set(session.userId, { expiresAt: Date.now() + 20_000, ids });
	return ids;
}

async function getFleet(session: ProviderSession | null): Promise<FleetSnapshot | null> {
	const providerToken = session?.accessToken ?? environment.OLOO_ACCESS_TOKEN;
	if (!providerToken) return null;
	const [raw, ownReservedIds] = await Promise.all([fleetCache.get(providerToken), session ? getOwnReservedIds(session) : new Set<number>()]);
	if (ownReservedIds.size > 0) return buildFleetSnapshot(raw, ownReservedIds);
	if (sharedSnapshot?.raw !== raw) sharedSnapshot = { raw, value: buildFleetSnapshot(raw) };
	return sharedSnapshot.value;
}

async function resolveScooter(session: ProviderSession, scooterId: number) {
	return fleetCache.identity(scooterId) ?? resolveProviderScooter(environment.OLOO_API_BASE_URL, session.accessToken, scooterId);
}

function requireSuccess(result: { success?: boolean }, message: string) {
	if (result.success === false) throw new OlooUpstreamError(409, message);
	return result;
}

const rentalLogSchema = z.object({
	id: z.coerce.number().int().positive(),
	scootersInfoId: z.coerce.number().int().positive(),
	engineLicenseNumber: z.string().min(1),
	lastRentalStartedAt: z.string().datetime(),
	lastRentalEndedAt: z.string().datetime().nullish(),
	cost: z.coerce.number().nullish(),
	isPaid: z.boolean().nullish()
});

/** The latest ride when it has ended but oloo has not been paid yet: it still needs a return photo and checkout. */
async function getUnpaidRide(session: ProviderSession) {
	const logs = await olooRequest<unknown[]>(environment.OLOO_API_BASE_URL, "/rental-logs/get-last-rental-log-by-account", session.accessToken);
	const parsed = rentalLogSchema.safeParse(logs[0]);
	if (!parsed.success || !parsed.data.lastRentalEndedAt || parsed.data.isPaid === true) return null;
	return {
		id: parsed.data.id,
		scooterId: parsed.data.scootersInfoId,
		label: parsed.data.engineLicenseNumber,
		startedAt: parsed.data.lastRentalStartedAt,
		endedAt: parsed.data.lastRentalEndedAt,
		cost: parsed.data.cost ?? null
	};
}

async function requireUnpaidRide(session: ProviderSession, rideId: number) {
	const ride = await getUnpaidRide(session);
	if (!ride || ride.id !== rideId) throw new OlooUpstreamError(409, "This ride is not waiting for checkout");
	return ride;
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
	const scooter = await resolveScooter(session, scooterId);
	const upstream = await olooRequest<{ success?: boolean }>(environment.OLOO_API_BASE_URL, "/scooters-infos/return", session.accessToken, {
		method: "POST",
		body: JSON.stringify({ imei: scooter.imei })
	});
	requireSuccess(upstream, "oloo rejected the return");
	return { success: true, rideId, scooter };
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
			const reborrowed = await olooRequest<{ success?: boolean }>(environment.OLOO_API_BASE_URL, "/scooters-infos/new-rent", session.accessToken, {
				method: "POST",
				body: JSON.stringify({ imei: returned.scooter.imei, reservationId: null })
			});
			requireSuccess(reborrowed, "Returned, but oloo rejected the reborrow");
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

await app.register(cors, {
	origin: environment.WEB_ORIGINS,
	credentials: true
});
await app.register(cookie);

app.get("/v1/health", async () => {
	if (!database) return { ok: true, service: "olowo-api", database: "not_configured" };
	await database.query("SELECT 1");
	return { ok: true, service: "olowo-api", database: "ready" };
});

// Station data comes from the provider and requires an oloo credential: the rider's session, or an operator token.
app.get("/v1/map/stations", async (request, reply) => {
	const fleet = await getFleet(await getSession(request, reply));
	if (!fleet) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Sign in to load stations" });
	reply.header("cache-control", "private, max-age=15, stale-while-revalidate=30");
	return fleet;
});

app.get("/v1/map/efences", async (request, reply) => {
	const token = (await getSession(request, reply))?.accessToken ?? environment.OLOO_ACCESS_TOKEN;
	if (!token) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Sign in to load e-fences" });
	reply.header("cache-control", "private, max-age=300");
	return efenceCache.get(token);
});

app.get("/v1/map/availability-summary", async (request, reply) => {
	const fleet = await getFleet(await getSession(request, reply));
	if (!fleet) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Sign in to load stations" });
	const { stations: _stations, ...summary } = fleet;
	return summary;
});

// QR scan / typed plate → the scooter and its station, so the PWA can open the borrow view.
app.get("/v1/scooters/lookup", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { code } = z.object({ code: z.string().trim().min(2).max(512) }).parse(request.query);
	const fleet = await getFleet(session);
	const scooterId = fleetCache.lookupCode(code);
	if (scooterId == null) return reply.code(404).send({ code: "SCOOTER_NOT_FOUND", message: "這不是 oloo 車輛的 QR Code 或車號" });
	const station = fleet?.stations.find(item => item.scooters.some(scooter => scooter.providerId === scooterId));
	if (!station) return reply.code(409).send({ code: "SCOOTER_NOT_DOCKED", message: "這台車目前不在站點，可能正在使用中" });
	return reply.send({ scooterId, stationId: station.id, label: station.scooters.find(scooter => scooter.providerId === scooterId)?.id ?? null });
});

app.get("/v1/scooters/:scooterId/ride-plan", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { scooterId } = z.object({ scooterId: z.coerce.number().int().positive() }).parse(request.params);
	const result = await olooRequest<Record<string, unknown>>(environment.OLOO_API_BASE_URL, `/scooters-infos/get-possible-ride-plan/${scooterId}`, session.accessToken);
	return reply.send(result);
});

app.get("/v1/rides/current", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	return reply.send({ activeRide: await getActiveRide(session) });
});

app.post("/v1/rides", async (request, reply) => {
	const session = await getSession(request, reply);
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
						.min(20)
						.max(6 * 60 * 60)
				})
				.optional()
		})
		.parse(request.body);
	const result = await idempotency.run(session.userId, "rent", key, async () => {
		const scooter = await resolveScooter(session, body.scooterId);
		requireSuccess(
			await olooRequest<{ success?: boolean }>(environment.OLOO_API_BASE_URL, "/scooters-infos/new-rent", session.accessToken, {
				method: "POST",
				body: JSON.stringify({ imei: scooter.imei, reservationId: body.reservationId })
			}),
			"oloo rejected the rental"
		);
		const ride = await waitForActiveRide(session, scooter.id);
		const automation = body.automation ? scheduleRideAutomation(session, ride, body.automation.action, body.automation.afterRideSeconds) : null;
		if (automation) await scheduledActions.saveRide(automation);
		return { success: true, scooterId: scooter.id, label: scooter.EngineLicenseNumber, activeRide: ride, automation: publicAutomation(automation) };
	});
	return reply.send(result);
});

app.post("/v1/rides/:rideId/return", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const key = z.string().min(8).parse(request.headers["idempotency-key"]);
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	const { scooterId } = z.object({ scooterId: z.number().int().positive() }).parse(request.body);
	const result = await idempotency.run(session.userId, `return:${rideId}`, key, async () => {
		const returned = await returnCurrentRide(session, rideId, scooterId);
		rideAutomations.cancel(session.userId, rideId);
		return { success: returned.success, rideId };
	});
	return reply.send(result);
});

app.get("/v1/rides/:rideId/automation", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	return reply.send({ automation: publicAutomation(rideAutomations.get(session.userId, rideId)) });
});

app.put("/v1/rides/:rideId/automation", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	const body = z
		.object({
			action: z.enum(["notify", "return", "return_and_reborrow"]),
			afterRideSeconds: z
				.number()
				.int()
				.min(20)
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
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	rideAutomations.cancel(session.userId, rideId);
	return reply.send({ success: true });
});

app.get("/v1/rides/:rideId/estimate", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	const active = await getActiveRide(session);
	if (!active || active.id !== rideId) return reply.code(409).send({ code: "RIDE_CHANGED", message: "Active ride changed" });
	const estimate = await olooRequest<unknown>(environment.OLOO_API_BASE_URL, `/scooters-infos/estimate-bill?lastRentalEndedAtForCalculationMillis=${Date.now()}`, session.accessToken);
	return reply.send({ estimate: toPublicBill(estimate) });
});

app.get("/v1/rides/unpaid", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	return reply.send({ ride: await getUnpaidRide(session) });
});

// oloo prices the final bill at the return location; prefer the rider's position, else the scooter's last fix.
app.get("/v1/rides/:rideId/bill", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	const query = z.object({ latitude: z.coerce.number().min(-90).max(90).optional(), longitude: z.coerce.number().min(-180).max(180).optional() }).parse(request.query);
	const ride = await requireUnpaidRide(session, rideId);
	const location = query.latitude != null && query.longitude != null ? { latitude: query.latitude, longitude: query.longitude } : fleetCache.position(ride.scooterId);
	if (!location) return reply.code(409).send({ code: "LOCATION_REQUIRED", message: "A return location is needed to price the ride" });
	const bill = toPublicBill(await olooRequest<unknown>(environment.OLOO_API_BASE_URL, `/scooters-infos/bill?latitude=${location.latitude}&longitude=${location.longitude}`, session.accessToken));
	if (bill.rideId != null && bill.rideId !== rideId) return reply.code(409).send({ code: "RIDE_CHANGED", message: "oloo returned a bill for a different ride" });
	return reply.send({ bill });
});

app.get("/v1/payment/cards", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	return reply.send({ cards: await fetchCards(environment.OLOO_API_BASE_URL, session.accessToken) });
});

app.addContentTypeParser(/^image\/(jpeg|png|webp)$/, { parseAs: "buffer", bodyLimit: 8 * 1024 * 1024 }, (_request, body, done) => done(null, body));

app.post("/v1/rides/:rideId/photo", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	const contentType = z.enum(["image/jpeg", "image/png", "image/webp"]).parse(String(request.headers["content-type"]).split(";")[0]);
	const image = z
		.instanceof(Buffer)
		.refine(buffer => buffer.length > 1024, "Photo is empty")
		.parse(request.body);
	await requireUnpaidRide(session, rideId);
	return reply.send(await uploadReturnPhoto(environment.OLOO_API_BASE_URL, session.accessToken, rideId, image, contentType));
});

app.post("/v1/rides/:rideId/checkout", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const key = z.string().min(8).parse(request.headers["idempotency-key"]);
	const { rideId } = z.object({ rideId: z.coerce.number().int().positive() }).parse(request.params);
	const body = z.object({ imageId: z.number().int().positive(), cardId: z.number().int().positive(), useOlooCoin: z.boolean().default(true) }).parse(request.body);
	const result = await idempotency.run(session.userId, `checkout:${rideId}`, key, async () => {
		const ride = await requireUnpaidRide(session, rideId);
		const scooter = await resolveScooter(session, ride.scooterId);
		const upstream = z
			.object({ success: z.boolean().optional(), result: z.object({ amount: z.coerce.number().nullish(), pointsToDeduct: z.coerce.number().nullish() }).partial().nullish() })
			.passthrough()
			.parse(
				await olooRequest<unknown>(environment.OLOO_API_BASE_URL, "/scooters-infos/checkout-with-creditcard", session.accessToken, {
					method: "POST",
					// Field set matches the captured client; extraFee was 0 there.
					body: JSON.stringify({ extraFee: 0, firstImgId: body.imageId, selectedCard: body.cardId, useOlooCoin: body.useOlooCoin, rentalLogId: rideId, imei: scooter.imei })
				})
			);
		requireSuccess(upstream, "oloo rejected the payment");
		return { success: true, rideId, amount: upstream.result?.amount ?? null, pointsDeducted: upstream.result?.pointsToDeduct ?? null };
	});
	return reply.send(result);
});

app.get("/v1/reservations/usage", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	return reply.send(await reservationLog.usage(session.userId));
});

app.get("/v1/reservations/current", async (request, reply) => {
	const session = await getSession(request, reply);
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
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const key = z.string().min(8).parse(request.headers["idempotency-key"]);
	const { engineLicenseNumber } = z.object({ engineLicenseNumber: z.string().min(2).max(32) }).parse(request.body);
	const result = await idempotency.run(session.userId, "reserve", key, () =>
		olooRequest<Record<string, unknown>>(environment.OLOO_API_BASE_URL, "/reservation/scooters-info", session.accessToken, {
			method: "POST",
			body: JSON.stringify({ engineLicenseNumber })
		})
	);
	ownReservationCache.delete(session.userId);
	await reservationLog.record(session.userId, "reserve").catch(error => app.log.warn({ err: error }, "failed to record reservation"));
	return reply.send({ success: true, reservationId: result.id, expiresAt: result.expired });
});

app.delete("/v1/reservations/:reservationId", async (request, reply) => {
	const session = await getSession(request, reply);
	if (!session) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Please sign in" });
	const key = z.string().min(8).parse(request.headers["idempotency-key"]);
	const { reservationId } = z.object({ reservationId: z.coerce.number().int().positive() }).parse(request.params);
	await idempotency.run(session.userId, `cancel-reservation:${reservationId}`, key, () =>
		olooRequest(environment.OLOO_API_BASE_URL, "/reservation/cancel", session.accessToken, { method: "POST", body: JSON.stringify({ reservationId }) })
	);
	ownReservationCache.delete(session.userId);
	await reservationLog.record(session.userId, "cancel").catch(error => app.log.warn({ err: error }, "failed to record cancellation"));
	return reply.send({ success: true });
});

app.get("/v1/auth/session", async (request, reply) => {
	const session = await getSession(request, reply);
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
	setSessionCookie(reply, session);
	return reply.send(publicSession(session));
});

app.post("/v1/auth/logout", async (request, reply) => {
	const session = await sessions.get(request.cookies[sessionCookie]);
	if (session) {
		rideAutomations.cancelForUser(session.userId);
	}
	await sessions.delete(request.cookies[sessionCookie]);
	reply.clearCookie(sessionCookie, { path: "/" });
	return reply.send({ success: true });
});

app.setErrorHandler(async (error, request, reply) => {
	app.log.error({ err: error }, "request failed");
	if (error instanceof OlooUpstreamError && error.status === 401) {
		// oloo revoked or expired the credential: drop the local session so the client asks the rider to sign in again.
		const id = request.cookies[sessionCookie];
		if (id) {
			await sessions.delete(id).catch(() => undefined);
			reply.clearCookie(sessionCookie, { path: "/" });
		}
		return reply.code(401).send({ code: "AUTH_REQUIRED", message: "oloo session expired; please sign in again" });
	}
	if (error instanceof OlooUpstreamError) {
		return reply.code(error.status >= 400 && error.status < 500 ? error.status : 502).send({ code: "UPSTREAM_ERROR", message: error.message });
	}
	if (error instanceof z.ZodError) return reply.code(400).send({ code: "INVALID_REQUEST", message: "Invalid request" });
	return reply.code(500).send({ code: "INTERNAL_ERROR", message: "Request failed" });
});

const pruneIdempotency = setInterval(() => void idempotency.prune().catch(error => app.log.warn({ err: error }, "failed to prune idempotency keys")), 60 * 60_000);
pruneIdempotency.unref();

app.addHook("onClose", async () => {
	clearInterval(pruneIdempotency);
	rideAutomations.close();
	await database?.end();
});

async function restoreScheduledAction(stored: StoredScheduledAction) {
	const session = await sessions.getForProviderUser(stored.userId);
	if (!session) {
		await scheduledActions.fail(stored.id, "No unexpired provider session is available");
		return;
	}
	startRideAutomation(session, {
		id: stored.id,
		createdAt: stored.createdAt,
		rideId: stored.rideId,
		scooterId: stored.scooterId,
		action: stored.action,
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

await app.listen({ host: environment.HOST, port: environment.PORT });
