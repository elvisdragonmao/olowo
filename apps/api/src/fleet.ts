export interface ScooterSummary {
	id: string;
	batteryPercent: number;
	rangeKm: number;
	walkMinutes: number;
	latitude: number;
	longitude: number;
	availability: "available" | "low_battery" | "unavailable";
}

export interface FleetSummary {
	totalCount: number;
	availableCount: number;
	unavailableCount: number;
	reasons: { lowBattery: number; hardware: number; location: number };
	scooters: ScooterSummary[];
}

export const demoFleet: FleetSummary = {
	totalCount: 24,
	availableCount: 9,
	unavailableCount: 15,
	reasons: { lowBattery: 8, hardware: 4, location: 3 },
	scooters: [
		{ id: "JZ-333", batteryPercent: 84, rangeKm: 18, walkMinutes: 2, latitude: 24.79315, longitude: 120.99327, availability: "available" },
		{ id: "JZ-551", batteryPercent: 62, rangeKm: 14, walkMinutes: 4, latitude: 24.79403, longitude: 120.99188, availability: "available" },
		{ id: "JZ-772", batteryPercent: 31, rangeKm: 8, walkMinutes: 6, latitude: 24.79384, longitude: 120.99516, availability: "low_battery" }
	] satisfies ScooterSummary[]
};
