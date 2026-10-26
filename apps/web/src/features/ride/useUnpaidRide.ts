import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../shared/api";
import { useIsSignedIn } from "../auth/useSession";

export interface UnpaidRide {
	id: number;
	scooterId: number;
	label: string;
	startedAt: string;
	endedAt: string;
	cost: number | null;
}

/** A returned ride oloo has not been paid for; it blocks the next rental until checkout completes. */
export function useUnpaidRide(options: { poll?: boolean } = {}) {
	const signedIn = useIsSignedIn();
	return useQuery({
		queryKey: ["ride", "unpaid"],
		queryFn: () => apiRequest<{ ride: UnpaidRide | null }>("/v1/rides/unpaid"),
		enabled: signedIn,
		retry: false,
		refetchInterval: query => (options.poll && !query.state.data?.ride ? 1_500 : 30_000),
		select: data => data.ride
	});
}
