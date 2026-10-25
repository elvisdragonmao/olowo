import { summarizeFleet, summarizeStation, type FleetSnapshot, type ScooterSummary, type ScooterWarning, type StationSummary, type UnavailableReason } from "./fleet.js";
import { olooRequest } from "./oloo.js";

interface RawInfo {
	id?: unknown;
	imei?: unknown;
	EngineLicenseNumber?: unknown;
	VehicleModel?: unknown;
	isActive?: unknown;
	AvailableDistance?: unknown;
	accountId?: unknown;
	scooterRentalStationId?: unknown;
}

interface RawStatus {
	imei?: unknown;
	latitude?: unknown;
	longitude?: unknown;
	power?: unknown;
	errorMsg?: unknown;
	updatedAt?: unknown;
}

interface RawStation {
	id?: unknown;
	name?: unknown;
	latitude?: unknown;
	longitude?: unknown;
	totalParkingSpace?: unknown;
	stationType?: unknown;
	isActive?: unknown;
}

interface RawReservation {
	scootersInfoId?: unknown;
}

export interface ProviderScooterIdentity {
	id: number;
	imei: string;
	EngineLicenseNumber: string;
}

export interface RegionConfig {
	regions: Array<{ code: string; rings: Array<Array<[number, number]>> }>;
	lowBatteryPercent: Record<string, number>;
}

export interface RawFleet {
	fetchedAt: number;
	regionConfig: RegionConfig;
	infos: RawInfo[];
	statuses: Map<string, RawStatus>;
	stations: RawStation[];
	reservedIds: Set<number>;
}

const staleStatusMs = 5 * 60_000;
// Used when a station falls outside every known region or oloo's power_settings is unavailable.
const defaultLowBatteryPercent = 35;
const unassignedStationRadiusMeters = 150;

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

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
	const latM = (a.latitude - b.latitude) * 111_320;
	const lonM = (a.longitude - b.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180);
	return Math.hypot(latM, lonM);
}

function rangeKm(value: unknown, batteryPercent: number) {
	const upstream = number(value);
	if (upstream != null && upstream >= 0) return Math.round((upstream > 100 ? upstream / 1000 : upstream) * 10) / 10;
	return Math.round(batteryPercent * 0.21);
}

/** `errorMsg` is the controller's last reported event, not a live fault; movement alarms and transport noise are dropped. */
function faultCode(error: unknown) {
	const value = text(error);
	if (!value || value === "illegalMovement" || value === "illegalDisassembly" || value === "Connection: close") return null;
	return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(value) ? value : "unknown";
}

export function reservationList(value: unknown): RawReservation[] {
	if (Array.isArray(value)) return value as RawReservation[];
	return value && typeof value === "object" && Object.keys(value).length > 0 ? [value as RawReservation] : [];
}

export function reservedScooterIds(value: unknown) {
	return new Set(
		reservationList(value)
			.map(item => number(item.scootersInfoId))
			.filter((id): id is number => id != null)
	);
}

/** `[latitude, longitude]` ring test (ray casting). */
function insideRing(point: { latitude: number; longitude: number }, ring: Array<[number, number]>) {
	let inside = false;
	for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
		const [latA, lonA] = ring[index]!;
		const [latB, lonB] = ring[previous]!;
		if (lonA > point.longitude !== lonB > point.longitude && point.latitude < ((latB - latA) * (point.longitude - lonA)) / (lonB - lonA) + latA) inside = !inside;
	}
	return inside;
}

export function regionFor(config: RegionConfig, point: { latitude: number; longitude: number }) {
	return config.regions.find(region => region.rings.some(ring => insideRing(point, ring)))?.code ?? null;
}

/** Operating regions (`efence-display-ranges`) and their rental battery floors (`oloo-options` power_settings). */
export async function fetchRegionConfig(baseUrl: string, token: string): Promise<RegionConfig> {
	const [ranges, options] = await Promise.all([olooRequest<unknown>(baseUrl, "/location-meta/cache/efence-display-ranges", token), olooRequest<unknown>(baseUrl, "/oloo-options", token)]);
	const regions = asArray<{ name?: unknown; metaValue?: unknown }>(ranges).flatMap(range => {
		const code = text(range.name);
		if (!code || typeof range.metaValue !== "string") return [];
		try {
			const polygons = JSON.parse(range.metaValue) as unknown;
			const rings = (Array.isArray(polygons) ? polygons : []).filter(
				(ring): ring is Array<[number, number]> => Array.isArray(ring) && ring.every(point => Array.isArray(point) && point.length >= 2 && point.every(Number.isFinite))
			);
			return rings.length > 0 ? [{ code, rings }] : [];
		} catch {
			return [];
		}
	});
	const lowBatteryPercent: Record<string, number> = {};
	const power = asArray<{ name?: unknown; value?: unknown }>(options).find(option => option.name === "power_settings");
	try {
		for (const [code, value] of Object.entries(JSON.parse(String(power?.value ?? "{}")) as Record<string, unknown>)) {
			const percent = number(value);
			if (percent != null && percent >= 0 && percent <= 100) lowBatteryPercent[code] = percent;
		}
	} catch {
		// Fall back to the default floor.
	}
	return { regions, lowBatteryPercent };
}

export async function fetchRawFleet(baseUrl: string, token: string, regionConfig: RegionConfig = { regions: [], lowBatteryPercent: {} }): Promise<RawFleet> {
	const signal = AbortSignal.timeout(15_000);
	const [infos, statuses, stations, overallReservations] = await Promise.all([
		olooRequest<unknown>(baseUrl, "/scooters-infos", token, { signal }),
		olooRequest<unknown>(baseUrl, "/scooter-statuses", token, { signal }),
		olooRequest<unknown>(baseUrl, "/scooter-rental-stations/active-stations", token, { signal }),
		olooRequest<unknown>(baseUrl, "/reservation/overall-current", token, { signal })
	]);
	return {
		fetchedAt: Date.now(),
		regionConfig,
		infos: asArray<RawInfo>(infos),
		statuses: new Map(asArray<RawStatus>(statuses).flatMap(status => (text(status.imei) ? [[text(status.imei)!, status] as const] : []))),
		stations: asArray<RawStation>(stations),
		reservedIds: reservedScooterIds(overallReservations)
	};
}

/** Joins identity, telemetry and stations into the public station DTO. `ownReservedIds` are this rider's own reservations, which must not block them. */
export function buildFleetSnapshot(raw: RawFleet, ownReservedIds: ReadonlySet<number> = new Set()): FleetSnapshot {
	const stations = new Map<number, Omit<StationSummary, "availableCount" | "lowBatteryCount" | "outOfServiceCount" | "unavailableCount">>();
	for (const station of raw.stations) {
		const id = number(station.id);
		const latitude = number(station.latitude);
		const longitude = number(station.longitude);
		if (id == null || latitude == null || longitude == null || station.isActive === false) continue;
		const region = regionFor(raw.regionConfig, { latitude, longitude });
		stations.set(id, {
			id,
			name: text(station.name) ?? `站點 ${id}`,
			latitude,
			longitude,
			capacity: Math.max(0, Math.round(number(station.totalParkingSpace) ?? 0)),
			type: text(station.stationType) ?? "normal",
			region,
			lowBatteryPercent: (region ? raw.regionConfig.lowBatteryPercent[region] : undefined) ?? defaultLowBatteryPercent,
			scooters: []
		});
	}
	const stationList = [...stations.values()];

	let inUseCount = 0;
	for (const info of raw.infos) {
		const providerId = number(info.id);
		if (providerId == null) continue;
		if (info.accountId != null) {
			inUseCount += 1;
			continue;
		}
		const imei = text(info.imei);
		const status = imei ? raw.statuses.get(imei) : undefined;
		const latitude = number(status?.latitude);
		const longitude = number(status?.longitude);
		const hasPosition = latitude != null && longitude != null && latitude !== 0 && longitude !== 0;
		const position = hasPosition ? { latitude, longitude } : null;

		let station = stations.get(number(info.scooterRentalStationId) ?? -1);
		// Only in-service scooters are matched to a nearby station; switched-off ones without a valid station are in depots.
		if (!station && position && info.isActive !== false) {
			const nearest = stationList.reduce<{ station?: (typeof stationList)[number]; meters: number }>(
				(best, candidate) => {
					const meters = distanceMeters(position, candidate);
					return meters < best.meters ? { station: candidate, meters } : best;
				},
				{ meters: unassignedStationRadiusMeters }
			);
			station = nearest.station;
		}
		if (!station) continue;

		const batteryPercent = Math.max(0, Math.min(100, Math.round(number(status?.power) ?? 0)));
		const updatedAt = typeof status?.updatedAt === "string" ? Date.parse(status.updatedAt) : Number.NaN;
		const reasons: UnavailableReason[] = [];
		// oloo switches docked scooters off (overnight, maintenance); they stay listed so riders see why a station is empty.
		if (info.isActive === false) reasons.push("inactive");
		if (batteryPercent < station.lowBatteryPercent) reasons.push("low_battery");
		if (raw.reservedIds.has(providerId) && !ownReservedIds.has(providerId)) reasons.push("reserved");
		const fault = faultCode(status?.errorMsg);
		const warnings: ScooterWarning[] = [];
		if (fault) warnings.push("hardware");
		if (!Number.isFinite(updatedAt) || raw.fetchedAt - updatedAt > staleStatusMs) warnings.push("communication");
		if (!position) warnings.push("location");

		station.scooters.push({
			providerId,
			id: text(info.EngineLicenseNumber) ?? `車輛 ${providerId}`,
			model: text(info.VehicleModel),
			batteryPercent,
			rangeKm: rangeKm(info.AvailableDistance, batteryPercent),
			latitude: position?.latitude ?? null,
			longitude: position?.longitude ?? null,
			availability: reasons.includes("inactive") || reasons.includes("reserved") ? "unavailable" : reasons.includes("low_battery") ? "low_battery" : "available",
			reasons,
			warnings,
			fault,
			updatedAt: Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : null
		} satisfies ScooterSummary);
	}

	const rank: Record<ScooterSummary["availability"], number> = { available: 0, low_battery: 1, unavailable: 2 };
	const summaries = stationList.map(station => {
		station.scooters.sort((a, b) => rank[a.availability] - rank[b.availability] || b.batteryPercent - a.batteryPercent);
		return summarizeStation(station);
	});
	return summarizeFleet(summaries, inUseCount, new Date(raw.fetchedAt));
}

/**
 * Process-wide fleet cache. Fleet data is identical for every rider, so one upstream
 * refresh serves all sessions, concurrent misses share one request, and a recent
 * snapshot is served when a refresh fails.
 */
export class FleetCache {
	#raw: RawFleet | null = null;
	#inflight: Promise<RawFleet> | null = null;
	#identities = new Map<number, ProviderScooterIdentity>();
	#regions: { fetchedAt: number; config: RegionConfig } | null = null;

	constructor(
		readonly baseUrl: string,
		readonly ttlMs = 25_000,
		readonly staleMs = 5 * 60_000
	) {}

	async get(token: string): Promise<RawFleet> {
		if (this.#raw && Date.now() - this.#raw.fetchedAt < this.ttlMs) return this.#raw;
		this.#inflight ??= this.#regionConfig(token)
			.then(config => fetchRawFleet(this.baseUrl, token, config))
			.then(raw => {
				this.#raw = raw;
				this.#identities = new Map(
					raw.infos.flatMap(info => {
						const id = number(info.id);
						const imei = text(info.imei);
						const label = text(info.EngineLicenseNumber);
						return id != null && imei && label ? [[id, { id, imei, EngineLicenseNumber: label }] as const] : [];
					})
				);
				return raw;
			})
			.finally(() => {
				this.#inflight = null;
			});
		try {
			return await this.#inflight;
		} catch (error) {
			if (this.#raw && Date.now() - this.#raw.fetchedAt < this.staleMs) return this.#raw;
			throw error;
		}
	}

	/** Regions change rarely: refresh hourly and keep the previous copy when oloo is unavailable. */
	async #regionConfig(token: string) {
		if (this.#regions && Date.now() - this.#regions.fetchedAt < 60 * 60_000) return this.#regions.config;
		try {
			const config = await fetchRegionConfig(this.baseUrl, token);
			this.#regions = { fetchedAt: Date.now(), config };
			return config;
		} catch {
			return this.#regions?.config ?? { regions: [], lowBatteryPercent: {} };
		}
	}

	/** Last known telemetry position, used as the return location for the final bill. */
	position(scooterId: number) {
		const identity = this.#identities.get(scooterId);
		const status = identity ? this.#raw?.statuses.get(identity.imei) : undefined;
		const latitude = number(status?.latitude);
		const longitude = number(status?.longitude);
		return latitude && longitude ? { latitude, longitude } : null;
	}

	/** Provider identity from the last snapshot; IMEI never leaves the server. */
	identity(scooterId: number) {
		return this.#identities.get(scooterId) ?? null;
	}

	/** Resolves a scanned QR payload or a typed plate to a scooter id; see `codeCandidates`. */
	lookupCode(code: string) {
		const candidates = codeCandidates(code);
		for (const identity of this.#identities.values()) {
			if (candidates.has(normalizePlate(identity.EngineLicenseNumber)) || candidates.has(identity.imei)) return identity.id;
		}
		return null;
	}
}

function normalizePlate(value: string) {
	return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The official scooter QR format was not captured, so accept the plain plate ("JZ-333", "jz333"), a URL that
 * carries the plate or IMEI in a query value or path segment, and a bare 15-digit IMEI.
 */
export function codeCandidates(code: string) {
	const values = [code.trim()];
	try {
		const url = new URL(code.trim());
		values.push(...url.searchParams.values(), ...url.pathname.split("/"), url.hash.replace(/^#/, ""));
	} catch {
		// Not a URL.
	}
	const candidates = new Set<string>();
	for (const value of values) {
		for (const token of value.split(/[\s,;&=?#/]+/)) {
			if (/^\d{15}$/.test(token)) candidates.add(token);
			const plate = normalizePlate(token);
			if (/^[A-Z]{1,4}\d{2,5}$/.test(plate)) candidates.add(plate);
		}
	}
	return candidates;
}
