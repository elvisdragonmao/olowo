import { useQuery } from "@tanstack/react-query";
import { demoFleet } from "./model";

async function getFleetSummary() {
	return demoFleet;
}

export function useFleetQuery() {
	return useQuery({
		queryKey: ["fleet", "nearby"],
		queryFn: getFleetSummary,
		initialData: demoFleet
	});
}
