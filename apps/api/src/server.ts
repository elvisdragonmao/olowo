import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadEnvFile } from "node:process";
import { z } from "zod";
import { createDatabase } from "./database.js";
import { demoFleet } from "./fleet.js";
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
		OLOO_ACCESS_TOKEN: z.string().min(20).optional(),
		OLOO_API_BASE_URL: z.string().url().default("https://looplus-api-staging.loopluscooter.com/nest/api")
	})
	.parse(process.env);

const app = Fastify({ logger: true, trustProxy: true });
const database = createDatabase(environment.DATABASE_URL);
let fleetCache: { expiresAt: number; value: typeof demoFleet } | null = null;

async function getFleet() {
	if (!environment.OLOO_ACCESS_TOKEN) return demoFleet;
	if (fleetCache && fleetCache.expiresAt > Date.now()) return fleetCache.value;
	const value = await fetchOlooFleet(environment.OLOO_API_BASE_URL, environment.OLOO_ACCESS_TOKEN);
	fleetCache = { expiresAt: Date.now() + 25_000, value };
	return value;
}

await app.register(cors, {
	origin: environment.WEB_ORIGINS,
	credentials: true
});

app.get("/v1/health", async () => {
	if (!database) return { ok: true, service: "oluwu-api", database: "not_configured" };
	await database.query("SELECT 1");
	return { ok: true, service: "oluwu-api", database: "ready" };
});

app.get("/v1/map/scooters", async (_request, reply) => {
	reply.header("cache-control", "private, max-age=15, stale-while-revalidate=30");
	return getFleet();
});

app.get("/v1/map/availability-summary", async () => {
	const fleet = await getFleet();
	return {
		totalCount: fleet.totalCount,
		availableCount: fleet.availableCount,
		unavailableCount: fleet.unavailableCount,
		reasons: fleet.reasons
	};
});

const pendingAuth = async (_request: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) =>
	reply.code(501).send({
		code: "UPSTREAM_CONTRACT_PENDING",
		message: "Email authentication remains disabled until the approved upstream contract is captured."
	});

app.post("/v1/auth/email/start", pendingAuth);
app.post("/v1/auth/email/verify", pendingAuth);

app.setErrorHandler((error, _request, reply) => {
	app.log.error({ err: error }, "request failed");
	void reply.code(500).send({ code: "INTERNAL_ERROR", message: "Request failed" });
});

app.addHook("onClose", async () => {
	await database?.end();
});

await app.listen({ host: "127.0.0.1", port: environment.PORT });
