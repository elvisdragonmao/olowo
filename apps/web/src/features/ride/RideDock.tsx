import { CaretRight } from "@phosphor-icons/react";
import { useUiStore } from "../../app/useUiStore";
import { clock } from "../../shared/format";
import { useCurrentRide, useNow } from "./useCurrentRide";
import { useUnpaidRide } from "./useUnpaidRide";

/** Persistent shortcut to the ride in progress, or to a returned ride that still needs checkout. */
export function RideDock() {
	const ride = useCurrentRide().data;
	const unpaid = useUnpaidRide().data;
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
	return null;
}
