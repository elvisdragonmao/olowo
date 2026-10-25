import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { demoFleet } from "./fleet.js";

const environment = z
	.object({
		PORT: z.coerce.number().int().min(1).max(65535).default(8787),
		WEB_ORIGIN: z.string().url().default("http://127.0.0.1:4173")
	})
	.parse(process.env);

const app = Fastify({ logger: true, trustProxy: true });

await app.register(cors, {
	origin: environment.WEB_ORIGIN,
	credentials: true
});

app.get("/v1/health", async () => ({ ok: true, service: "oluwu-api" }));

app.get("/v1/map/scooters", async (_request, reply) => {
	reply.header("cache-control", "private, max-age=15, stale-while-revalidate=30");
	return demoFleet;
});

app.get("/v1/map/availability-summary", async () => ({
	totalCount: demoFleet.totalCount,
	availableCount: demoFleet.availableCount,
	unavailableCount: demoFleet.unavailableCount,
	reasons: demoFleet.reasons
}));

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

await app.listen({ host: "127.0.0.1", port: environment.PORT });
