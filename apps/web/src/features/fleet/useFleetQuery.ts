import { useQuery } from "@tanstack/react-query";
import { ApiError, apiRequest } from "../../shared/api";
import type { FleetSnapshot } from "./model";

/** Resolves to `null` when the API needs a rider session first; that is a normal state, not an error. */
async function fetchStations() {
	try {
		return await apiRequest<FleetSnapshot>("/v1/map/stations");
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) return null;
		throw error;
	}
}

export function useFleetQuery() {
	return useQuery({
		queryKey: ["fleet", "stations"],
		queryFn: fetchStations,
		refetchInterval: query => (query.state.data === null ? false : 30_000),
		refetchOnWindowFocus: true,
		retry: 2
	});
}

export function useNeedsSignIn() {
	return useFleetQuery().data === null;
}

export function useStation(stationId: number | null) {
	const { data } = useFleetQuery();
	return stationId == null ? null : (data?.stations.find(station => station.id === stationId) ?? null);
}
