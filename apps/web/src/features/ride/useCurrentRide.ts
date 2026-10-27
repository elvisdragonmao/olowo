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
	/** `idle` until first started; `parked` is 臨停. */
	engine: "idle" | "running" | "parked";
}

type CurrentRide = { activeRide: ActiveRide | null; reborrowing?: boolean };
const fetchCurrentRide = () => apiRequest<CurrentRide>("/v1/rides/current");

export function useCurrentRide() {
	const signedIn = useIsSignedIn();
	return useQuery({
		queryKey: ["ride", "current"],
		queryFn: fetchCurrentRide,
		enabled: signedIn,
		retry: false,
		// Poll quickly while a return-and-reborrow is swapping rides, so the new one shows up without a reload.
		refetchInterval: query => (query.state.data?.reborrowing ? 1500 : 15_000),
		select: data => data.activeRide
	});
}

/** True while the server is between returning a ride and starting the reborrowed one. */
export function useReborrowing() {
	const signedIn = useIsSignedIn();
	return useQuery({ queryKey: ["ride", "current"], queryFn: fetchCurrentRide, enabled: signedIn, retry: false, select: data => data.reborrowing === true }).data === true;
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
