import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../shared/api";

export interface RideRecord {
	id: number;
	label: string | null;
	startedAt: string;
	endedAt: string | null;
	durationSeconds: number | null;
	cost: number | null;
	ridingMinutes: number;
	parkedMinutes: number;
	engineOnSeconds: number;
	engineOffSeconds: number;
	paid: boolean;
	planName: string | null;
	startStation: string | null;
	endStation: string | null;
}

/** oloo's whole rental log for the account (it is not paginated), newest first. */
export function useRideHistory() {
	return useQuery({ queryKey: ["ride", "history"], queryFn: () => apiRequest<{ rides: RideRecord[] }>("/v1/rides/history"), select: data => data.rides });
}
