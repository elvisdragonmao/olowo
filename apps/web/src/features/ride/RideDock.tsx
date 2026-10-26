import { CaretRight } from "@phosphor-icons/react";
import { useUiStore } from "../../app/useUiStore";
import { useFleetQuery } from "../fleet/useFleetQuery";
import { clock } from "../../shared/format";
import { useCurrentRide, useNow } from "./useCurrentRide";
import { useReservation } from "./useReservation";
import { useUnpaidRide } from "./useUnpaidRide";

/** Persistent shortcut to the ride in progress, a returned ride that still needs checkout, or a reserved scooter. */
export function RideDock() {
	const ride = useCurrentRide().data;
	const unpaid = useUnpaidRide().data;
	const reservation = useReservation();
	const fleet = useFleetQuery();
	const view = useUiStore(state => state.view);
	const navigate = useUiStore(state => state.navigate);
	const now = useNow();
	if (ride && view.kind !== "ride") {
		return (
			<button type="button" className="ride-dock" onClick={() => navigate({ kind: "ride" })}>
				<span className="pulse-dot" aria-hidden />
				<span className="ride-dock-text">
					<strong>騎乘中 · {ride.label}</strong>
					<span>{clock((now - Date.parse(ride.startedAt)) / 1000)}</span>
				</span>
				<CaretRight size={14} weight="bold" aria-hidden />
			</button>
		);
	}
	if (!ride && unpaid && view.kind !== "checkout") {
		return (
			<button type="button" className="ride-dock ride-dock-warning" onClick={() => navigate({ kind: "checkout" })}>
				<span className="ride-dock-text">
					<strong>{unpaid.label} 待結帳</strong>
					<span>拍照付款</span>
				</span>
				<CaretRight size={14} weight="bold" aria-hidden />
			</button>
		);
	}
	if (!ride && !unpaid && reservation?.expiresAt && !(view.kind === "scooter" && view.scooterId === reservation.scooterId)) {
		const station = fleet.data?.stations.find(item => item.scooters.some(scooter => scooter.providerId === reservation.scooterId));
		return (
			<button
				type="button"
				className="ride-dock"
				disabled={!station}
				onClick={() => station && reservation.scooterId != null && navigate({ kind: "scooter", stationId: station.id, scooterId: reservation.scooterId })}
			>
				<span className="pulse-dot" aria-hidden />
				<span className="ride-dock-text">
					<strong>已預約 · {reservation.label ?? "車輛"}</strong>
					<span>取車剩 {clock((Date.parse(reservation.expiresAt) - now) / 1000)}</span>
				</span>
				<CaretRight size={14} weight="bold" aria-hidden />
			</button>
		);
	}
	return null;
}
