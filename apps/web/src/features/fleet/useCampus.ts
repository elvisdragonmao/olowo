import { useMemo } from "react";
import { useUiStore } from "../../app/useUiStore";
import { distanceMeters, type LngLat } from "../location/geo";
import { useLocationStore } from "../location/useLocationStore";
import { stationLabel, type StationSummary } from "./model";
import { useFleetQuery } from "./useFleetQuery";

export interface Campus {
	name: string;
	stations: StationSummary[];
	availableCount: number;
	lowBatteryCount: number;
	outOfServiceCount: number;
	scooterCount: number;
	bounds: [[number, number], [number, number]];
}

export function campusOf(station: StationSummary) {
	return stationLabel(station.name).campus ?? "其他";
}

export function groupCampuses(stations: StationSummary[]): Campus[] {
	const groups = new Map<string, StationSummary[]>();
	for (const station of stations) groups.set(campusOf(station), [...(groups.get(campusOf(station)) ?? []), station]);
	return [...groups].map(([name, members]) => ({
		name,
		stations: members,
		availableCount: members.reduce((sum, station) => sum + station.availableCount, 0),
		lowBatteryCount: members.reduce((sum, station) => sum + station.lowBatteryCount, 0),
		outOfServiceCount: members.reduce((sum, station) => sum + station.outOfServiceCount, 0),
		scooterCount: members.reduce((sum, station) => sum + station.scooters.length, 0),
		bounds: [
			[Math.min(...members.map(station => station.longitude)), Math.min(...members.map(station => station.latitude))],
			[Math.max(...members.map(station => station.longitude)), Math.max(...members.map(station => station.latitude))]
		]
	}));
}

/** The campus of the station nearest to `origin`. */
export function nearestCampus(campuses: Campus[], origin: LngLat) {
	let best: { campus: Campus; meters: number } | null = null;
	for (const campus of campuses) {
		for (const station of campus.stations) {
			const meters = distanceMeters(origin, station);
			if (!best || meters < best.meters) best = { campus, meters };
		}
	}
	return best?.campus ?? null;
}

/** Campuses ordered by distance, plus the one the rider is looking at (map centre) or standing in. */
export function useCampuses() {
	const stations = useFleetQuery().data?.stations;
	const mapCenter = useUiStore(state => state.mapCenter);
	const position = useLocationStore(state => state.position);
	return useMemo(() => {
		const campuses = groupCampuses(stations ?? []);
		const current = nearestCampus(campuses, mapCenter) ?? nearestCampus(campuses, position ?? mapCenter);
		const origin = position ?? mapCenter;
		const ordered = [...campuses].sort((a, b) => (nearestDistance(a, origin) ?? 0) - (nearestDistance(b, origin) ?? 0));
		return { campuses: ordered, current };
	}, [mapCenter, position, stations]);
}

function nearestDistance(campus: Campus, origin: LngLat) {
	return Math.min(...campus.stations.map(station => distanceMeters(origin, station)));
}
