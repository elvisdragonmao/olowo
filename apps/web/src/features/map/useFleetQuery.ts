import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../shared/api";
import { demoFleet, type FleetSummary } from "./model";

async function getFleetSummary(): Promise<FleetSummary> {
	return apiRequest<FleetSummary>("/v1/map/scooters");
}

export function useFleetQuery() {
	return useQuery({
		queryKey: ["fleet", "nearby"],
		queryFn: getFleetSummary,
		initialData: demoFleet,
		retry: 1,
		refetchInterval: 30_000
	});
}
