import type { Page } from "@playwright/test";

export const testFleet = {
	totalCount: 24,
	availableCount: 9,
	unavailableCount: 15,
	reasons: { lowBattery: 8, hardware: 4, location: 3 },
	scooters: [
		{ providerId: 12, id: "JZ-333", batteryPercent: 84, rangeKm: 18, walkMinutes: 2, latitude: 24.79315, longitude: 120.99327, availability: "available" },
		{ providerId: 13, id: "JZ-551", batteryPercent: 62, rangeKm: 14, walkMinutes: 4, latitude: 24.79403, longitude: 120.99188, availability: "available" },
		{ providerId: 14, id: "JZ-772", batteryPercent: 31, rangeKm: 8, walkMinutes: 6, latitude: 24.79384, longitude: 120.99516, availability: "low_battery" }
	]
};

export async function mockOluwuApi(page: Page) {
	const state: {
		authenticated: boolean;
		activeRide: null | { id: number; scooterId: number; label: string; startedAt: string; cost: number };
		reservationSchedule: null | Record<string, unknown>;
		rideAutomation: null | Record<string, unknown>;
		requests: Array<{ method: string; path: string; body: unknown }>;
	} = { authenticated: false, activeRide: null, reservationSchedule: null, rideAutomation: null, requests: [] };
	await page.route("https://tile.openstreetmap.org/**", route =>
		route.fulfill({
			status: 200,
			contentType: "image/png",
			body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
		})
	);

	await page.route("http://127.0.0.1:8787/v1/**", async route => {
		const request = route.request();
		const url = new URL(request.url());
		const method = request.method();
		const body = request.postDataJSON?.() ?? null;
		state.requests.push({ method, path: url.pathname, body });
		const json = async (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });

		if (url.pathname === "/v1/map/scooters") return json(testFleet);
		if (url.pathname === "/v1/auth/session")
			return json(state.authenticated ? { authenticated: true, email: "info@elvismao.com", userId: 115827, roles: ["customer"], expiresAt: "2026-11-24T00:00:00.000Z" } : { authenticated: false });
		if (url.pathname === "/v1/auth/email/start") return json({ success: true });
		if (url.pathname === "/v1/auth/email/verify") {
			state.authenticated = true;
			return json({ authenticated: true, email: "info@elvismao.com", userId: 115827, roles: ["customer"], expiresAt: "2026-11-24T00:00:00.000Z" });
		}
		if (url.pathname === "/v1/rides/current") return json({ activeRide: state.activeRide });
		if (url.pathname.endsWith("/ride-plan")) return json({ basicOrStationRidePlan: { id: 73, name: "普通費率", minMinute: 30, minPrice: 60, normalRate: 2, stopRate: 2 } });
		if (url.pathname === "/v1/reservations/current") return json([]);
		if (url.pathname === "/v1/reservations/scheduled" && method === "GET") return json({ schedule: state.reservationSchedule });
		if (url.pathname === "/v1/reservations/scheduled" && method === "PUT") {
			state.reservationSchedule = {
				id: "reservation-task",
				scooterId: 12,
				engineLicenseNumber: "JZ-333",
				triggerAt: new Date(Date.now() + 300_000).toISOString(),
				state: "scheduled"
			};
			return json({ schedule: state.reservationSchedule });
		}
		if (url.pathname === "/v1/reservations/scheduled" && method === "DELETE") {
			state.reservationSchedule = null;
			return json({ success: true });
		}
		if (url.pathname === "/v1/rides" && method === "POST") {
			state.activeRide = { id: 9123, scooterId: 12, label: "JZ-333", startedAt: new Date().toISOString(), cost: 0 };
			return json({ success: true, activeRide: state.activeRide });
		}
		if (url.pathname === "/v1/rides/9123/automation" && method === "GET") return json({ automation: state.rideAutomation });
		if (url.pathname === "/v1/rides/9123/automation" && method === "PUT") {
			const requestBody = body as { action: string; afterRideSeconds: number };
			state.rideAutomation = {
				id: "ride-task",
				rideId: 9123,
				scooterId: 12,
				action: requestBody.action,
				triggerAt: new Date(Date.now() + requestBody.afterRideSeconds * 1000).toISOString(),
				state: "scheduled"
			};
			return json({ automation: state.rideAutomation });
		}
		if (url.pathname === "/v1/rides/9123/automation" && method === "DELETE") {
			state.rideAutomation = null;
			return json({ success: true });
		}
		if (url.pathname === "/v1/rides/9123/return" && method === "POST") {
			state.activeRide = null;
			return json({ success: true });
		}
		return json({ code: "NOT_MOCKED", message: `${method} ${url.pathname}` }, 404);
	});

	return state;
}
