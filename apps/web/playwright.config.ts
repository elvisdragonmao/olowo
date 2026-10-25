import { defineConfig, devices } from "@playwright/test";

const testPort = Number(process.env.OLOWO_E2E_PORT ?? 4174);
const webgl = { launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } };

export default defineConfig({
	testDir: "./tests",
	testMatch: "**/*.spec.ts",
	timeout: 30_000,
	workers: 1,
	use: {
		baseURL: `http://127.0.0.1:${testPort}`,
		channel: "chromium",
		...webgl
	},
	projects: [
		{ name: "mobile", use: { ...devices["iPhone 14"], defaultBrowserType: "chromium", channel: "chromium", ...webgl } },
		{ name: "desktop", use: { viewport: { width: 1440, height: 900 } } }
	],
	webServer: {
		command: `pnpm exec vite --host 127.0.0.1 --port ${testPort} --strictPort`,
		env: { VITE_MAPBOX_ACCESS_TOKEN: "pk.e2e-test-token", VITE_API_BASE_URL: "" },
		url: `http://127.0.0.1:${testPort}/`,
		reuseExistingServer: false
	}
});
