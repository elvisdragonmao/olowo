import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../shared/api";

export interface ActiveRide {
	id: number;
	scooterId: number;
	label: string;
	startedAt: string;
	cost: number;
}

export function useCurrentRideQuery() {
	return useQuery({
		queryKey: ["ride", "current"],
		queryFn: () => apiRequest<{ activeRide: ActiveRide | null }>("/v1/rides/current"),
		retry: false,
		refetchInterval: 15_000
	});
}
