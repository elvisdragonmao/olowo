import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The browser talks to Fastify through the same origin so the HttpOnly session cookie stays first-party.
export default defineConfig({
	build: {
		outDir: "dist/client"
	},
	server: {
		host: "0.0.0.0",
		proxy: {
			"/v1": process.env.OLOWO_API_ORIGIN ?? "http://127.0.0.1:8787"
		}
	},
	plugins: [react()]
});
