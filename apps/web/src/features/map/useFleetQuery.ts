import { useQuery } from "@tanstack/react-query";
import { demoFleet, type FleetSummary } from "./model";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

async function getFleetSummary(): Promise<FleetSummary> {
	const response = await fetch(`${apiBaseUrl}/v1/map/scooters`);
	if (!response.ok) throw new Error(`Fleet request failed with ${response.status}`);
	return (await response.json()) as FleetSummary;
}

export function useFleetQuery() {
	return useQuery({
		queryKey: ["fleet", "nearby"],
		queryFn: getFleetSummary,
		initialData: demoFleet,
		retry: 1
	});
}
