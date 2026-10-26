import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../shared/api";
import { useIsSignedIn } from "../auth/useSession";
import { useNow } from "./useCurrentRide";

export interface Reservation {
	id: number | null;
	scooterId: number | null;
	label: string | null;
	createdAt: string | null;
	/** ISO time; oloo holds the scooter for five minutes. */
	expiresAt: string | null;
}

export interface ReservationUsage {
	limitPerHour: number;
	reservedLastHour: number;
	cancelledLastHour: number;
	remaining: number;
	nextSlotAt: string | null;
}

/** The rider's live reservation, dropped locally the moment its hold runs out. */
export function useReservation() {
	const signedIn = useIsSignedIn();
	const now = useNow(5_000);
	const query = useQuery({
		queryKey: ["reservation", "current"],
		queryFn: () => apiRequest<Reservation[]>("/v1/reservations/current"),
		enabled: signedIn,
		refetchInterval: 15_000,
		retry: false
	});
	const reservation = query.data?.[0] ?? null;
	return reservation && (!reservation.expiresAt || Date.parse(reservation.expiresAt) > now) ? reservation : null;
}
