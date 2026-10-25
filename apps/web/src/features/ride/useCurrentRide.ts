import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiRequest } from "../../shared/api";
import { useIsSignedIn } from "../auth/useSession";

export interface ActiveRide {
	id: number;
	scooterId: number;
	label: string;
	startedAt: string;
	cost: number;
}

export function useCurrentRide() {
	const signedIn = useIsSignedIn();
	return useQuery({
		queryKey: ["ride", "current"],
		queryFn: () => apiRequest<{ activeRide: ActiveRide | null }>("/v1/rides/current"),
		enabled: signedIn,
		retry: false,
		refetchInterval: 15_000,
		select: data => data.activeRide
	});
}

/** Display-only ticking clock; authoritative timers live on Fastify. */
export function useNow(intervalMs = 1000) {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs]);
	return now;
}
