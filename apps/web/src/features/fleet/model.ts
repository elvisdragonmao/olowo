export type Availability = "available" | "low_battery" | "unavailable";
/** Facts that stop a rental. */
export type UnavailableReason = "inactive" | "low_battery" | "reserved";
/** Telemetry notes that do not stop a rental; oloo decides when the rider borrows. */
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
	region: string | null;
	lowBatteryPercent: number;
	availableCount: number;
	lowBatteryCount: number;
	outOfServiceCount: number;
	unavailableCount: number;
	scooters: ScooterSummary[];
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
	reasons: { inactive: number; lowBattery: number; hardware: number; communication: number; location: number; reserved: number };
	stations: StationSummary[];
}

export const reasonLabels: Record<UnavailableReason, string> = {
	inactive: "暫停服務",
	low_battery: "電量不足",
	reserved: "已被預約"
};

const faultLabels: Record<string, string> = {
	throttleAbnormal: "油門訊號異常",
	hallSensorAbnormal: "霍爾感測器異常"
};

export function warningLabel(warning: ScooterWarning, scooter: Pick<ScooterSummary, "fault">) {
	if (warning === "hardware") return scooter.fault && faultLabels[scooter.fault] ? `回報${faultLabels[scooter.fault]}` : "車機回報異常";
	if (warning === "communication") return "車況超過 5 分鐘沒更新";
	return "目前沒有定位";
}

export function availabilityLabel(scooter: ScooterSummary) {
	if (scooter.availability === "available") return "可借";
	const reason = (["inactive", "reserved", "low_battery"] as const).find(item => scooter.reasons.includes(item));
	return reason ? reasonLabels[reason] : "暫不可借";
}

export function modelLabel(model: string | null) {
	if (!model) return null;
	return model.length <= 3 ? model.toUpperCase() : model;
}

/** oloo names stations `校區-名稱站`; split them so the campus can be shown as a quiet prefix. */
export function stationLabel(name: string) {
	const match = /^([^-－]{1,6})[-－](.+?)站?$/.exec(name.trim());
	return match ? { campus: match[1]!, name: match[2]! } : { campus: null, name: name.replace(/站$/, "") };
}
