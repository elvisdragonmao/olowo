export type Availability = "available" | "low_battery" | "unavailable";
/** Facts that stop a rental: taken out of service by oloo, below the region's battery floor, or reserved by another rider. */
export type UnavailableReason = "inactive" | "low_battery" | "reserved";
/**
 * Telemetry worth telling the rider about that does not stop a rental. The official app ignores
 * `errorMsg`, and oloo decides at `new-rent`, so these never mark a scooter unavailable.
 */
export type ScooterWarning = "hardware" | "communication" | "location";

export interface ScooterSummary {
	providerId: number;
	id: string;
	model: string | null;
	batteryPercent: number;
	rangeKm: number;
	latitude: number | null;
	longitude: number | null;
	availability: Availability;
	reasons: UnavailableReason[];
	warnings: ScooterWarning[];
	/** Last fault code the controller reported (e.g. `throttleAbnormal`), when it is one oloo might act on. */
	fault: string | null;
	updatedAt: string | null;
}

export interface StationSummary {
	id: number;
	name: string;
	latitude: number;
	longitude: number;
	capacity: number;
	type: string;
	/** oloo operating region (e.g. `NCTU-NTHU`) and its rental battery floor. */
	region: string | null;
	lowBatteryPercent: number;
	availableCount: number;
	lowBatteryCount: number;
	/** Docked but switched off by oloo (`isActive: false`), e.g. overnight or for maintenance. */
	outOfServiceCount: number;
	unavailableCount: number;
	scooters: ScooterSummary[];
}

export interface ReasonCounts {
	inactive: number;
	lowBattery: number;
	hardware: number;
	communication: number;
	location: number;
	reserved: number;
}

export interface FleetSnapshot {
	updatedAt: string;
	stationCount: number;
	totalCount: number;
	availableCount: number;
	lowBatteryCount: number;
	outOfServiceCount: number;
	unavailableCount: number;
	inUseCount: number;
	reasons: ReasonCounts;
	stations: StationSummary[];
}

export function emptyReasonCounts(): ReasonCounts {
	return { inactive: 0, lowBattery: 0, hardware: 0, communication: 0, location: 0, reserved: 0 };
}

export function countReasons(scooters: Iterable<ScooterSummary>, counts = emptyReasonCounts()) {
	for (const scooter of scooters) {
		for (const reason of scooter.reasons) {
			if (reason === "low_battery") counts.lowBattery += 1;
			else counts[reason] += 1;
		}
		for (const warning of scooter.warnings) counts[warning] += 1;
	}
	return counts;
}

export function summarizeStation(station: Omit<StationSummary, "availableCount" | "lowBatteryCount" | "outOfServiceCount" | "unavailableCount">): StationSummary {
	const availableCount = station.scooters.filter(item => item.availability === "available").length;
	const lowBatteryCount = station.scooters.filter(item => item.availability === "low_battery").length;
	const outOfServiceCount = station.scooters.filter(item => item.reasons.includes("inactive")).length;
	return { ...station, availableCount, lowBatteryCount, outOfServiceCount, unavailableCount: station.scooters.length - availableCount };
}

export function summarizeFleet(stations: StationSummary[], inUseCount: number, updatedAt = new Date()): FleetSnapshot {
	const scooters = stations.flatMap(station => station.scooters);
	const availableCount = stations.reduce((sum, station) => sum + station.availableCount, 0);
	return {
		updatedAt: updatedAt.toISOString(),
		stationCount: stations.length,
		totalCount: scooters.length,
		availableCount,
		lowBatteryCount: stations.reduce((sum, station) => sum + station.lowBatteryCount, 0),
		outOfServiceCount: stations.reduce((sum, station) => sum + station.outOfServiceCount, 0),
		unavailableCount: scooters.length - availableCount,
		inUseCount,
		reasons: countReasons(scooters),
		stations
	};
}
