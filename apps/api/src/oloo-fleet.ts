import type { FleetSummary, ScooterSummary } from "./fleet.js";

interface RawInfo {
	id?: unknown;
	imei?: unknown;
	EngineLicenseNumber?: unknown;
	isActive?: unknown;
	AvailableDistance?: unknown;
	accountId?: unknown;
}

interface RawStatus {
	imei?: unknown;
	latitude?: unknown;
	longitude?: unknown;
	power?: unknown;
	errorMsg?: unknown;
	updatedAt?: unknown;
}

interface RawReservation {
	scootersInfoId?: unknown;
}

const origin = { latitude: 24.7938, longitude: 120.9937 };

function asArray<T>(value: unknown): T[] {
	if (Array.isArray(value)) return value as T[];
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const key of ["data", "result", "items"]) if (Array.isArray(record[key])) return record[key] as T[];
	}
	throw new Error("Unexpected upstream fleet response");
}

function number(value: unknown): number | null {
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function distanceKm(latitude: number, longitude: number) {
	const latKm = (latitude - origin.latitude) * 111.32;
	const lonKm = (longitude - origin.longitude) * 111.32 * Math.cos((origin.latitude * Math.PI) / 180);
	return Math.hypot(latKm, lonKm);
}

function rangeKm(value: unknown, batteryPercent: number) {
	const upstream = number(value);
	if (upstream != null && upstream >= 0) return Math.round((upstream > 100 ? upstream / 1000 : upstream) * 10) / 10;
	return Math.round(batteryPercent * 0.21);
}

function blocksRental(error: unknown) {
	const value = text(error);
	if (!value || value === "illegalMovement" || value === "illegalDisassembly") return false;
	return value !== "Connection: close";
}

export async function fetchOlooFleet(baseUrl: string, token: string): Promise<FleetSummary> {
	const headers = { authorization: token, accept: "application/json" };
	const signal = AbortSignal.timeout(15_000);
	const infosUrl = new URL(`${baseUrl}/scooters-infos`);
	const statusesUrl = new URL(`${baseUrl}/scooter-statuses`);
	infosUrl.searchParams.set("access_token", token);
	statusesUrl.searchParams.set("access_token", token);
	const overallReservationsUrl = new URL(`${baseUrl}/reservation/overall-current`);
	const currentReservationUrl = new URL(`${baseUrl}/reservation/current`);
	overallReservationsUrl.searchParams.set("access_token", token);
	currentReservationUrl.searchParams.set("access_token", token);
	const [infosResponse, statusesResponse, overallReservationsResponse, currentReservationResponse] = await Promise.all([
		fetch(infosUrl, { headers, signal }),
		fetch(statusesUrl, { headers, signal }),
		fetch(overallReservationsUrl, { headers, signal }),
		fetch(currentReservationUrl, { headers, signal })
	]);
	if (!infosResponse.ok || !statusesResponse.ok || !overallReservationsResponse.ok || !currentReservationResponse.ok) {
		throw new Error(`Upstream fleet failed: ${infosResponse.status}/${statusesResponse.status}/${overallReservationsResponse.status}/${currentReservationResponse.status}`);
	}

	const infos = asArray<RawInfo>(await infosResponse.json());
	const statuses = asArray<RawStatus>(await statusesResponse.json());
	const overallReservations = asArray<RawReservation>(await overallReservationsResponse.json());
	const currentReservationValue = (await currentReservationResponse.json()) as RawReservation | RawReservation[] | null;
	const currentReservations = Array.isArray(currentReservationValue)
		? currentReservationValue
		: currentReservationValue && typeof currentReservationValue === "object" && Object.keys(currentReservationValue).length > 0
			? [currentReservationValue]
			: [];
	const ownReservedIds = new Set(currentReservations.map(item => number(item.scootersInfoId)).filter((id): id is number => id != null));
	const reservedIds = new Set(overallReservations.map(item => number(item.scootersInfoId)).filter((id): id is number => id != null && !ownReservedIds.has(id)));
	const statusByImei = new Map(statuses.map(status => [text(status.imei), status]));

	const candidates = infos.flatMap(info => {
		const imei = text(info.imei);
		const status = imei ? statusByImei.get(imei) : undefined;
		const latitude = number(status?.latitude);
		const longitude = number(status?.longitude);
		if (latitude == null || longitude == null || latitude === 0 || longitude === 0) return [];
		const batteryPercent = Math.max(0, Math.min(100, Math.round(number(status?.power) ?? 0)));
		const hasHardwareError = blocksRental(status?.errorMsg);
		const updatedAt = typeof status?.updatedAt === "string" ? Date.parse(status.updatedAt) : Number.NaN;
		const hasLocationError = !Number.isFinite(updatedAt) || Date.now() - updatedAt > 5 * 60_000;
		const inUse = info.accountId != null;
		const reserved = reservedIds.has(number(info.id) ?? -1);
		const active = info.isActive !== false;
		const availability: ScooterSummary["availability"] = !active || inUse || reserved || hasHardwareError || hasLocationError ? "unavailable" : batteryPercent < 35 ? "low_battery" : "available";
		const distance = distanceKm(latitude, longitude);
		return [
			{
				scooter: {
					providerId: number(info.id) ?? 0,
					id: text(info.EngineLicenseNumber) ?? `車輛 ${String(info.id ?? "未知")}`,
					batteryPercent,
					rangeKm: rangeKm(info.AvailableDistance, batteryPercent),
					walkMinutes: Math.max(1, Math.round((distance * 1000) / 80)),
					latitude,
					longitude,
					availability
				} satisfies ScooterSummary,
				distance,
				hasHardwareError,
				hasLocationError,
				reserved
			}
		];
	});

	const availabilityRank: Record<ScooterSummary["availability"], number> = { available: 0, low_battery: 1, unavailable: 2 };
	const nearby = candidates
		.sort((a, b) => a.distance - b.distance)
		.slice(0, 24)
		.sort((a, b) => availabilityRank[a.scooter.availability] - availabilityRank[b.scooter.availability] || a.distance - b.distance);
	const scooters = nearby.map(item => item.scooter);
	const lowBattery = scooters.filter(item => item.availability === "low_battery").length;
	const hardware = nearby.filter(item => item.hasHardwareError).length;
	const location = nearby.filter(item => item.hasLocationError).length;
	const reserved = nearby.filter(item => item.reserved).length;
	const availableCount = scooters.filter(item => item.availability === "available").length;

	return {
		totalCount: scooters.length,
		availableCount,
		unavailableCount: scooters.length - availableCount,
		reasons: { lowBattery, hardware, location, reserved },
		scooters
	};
}
