import { BatteryMedium, PersonSimpleWalk, RoadHorizon, Scooter } from "@phosphor-icons/react";
import type { ScooterSummary } from "./model";

interface ScooterRowProps {
	scooter: ScooterSummary;
	selected: boolean;
	onSelect: () => void;
}

export function ScooterRow({ scooter, selected, onSelect }: ScooterRowProps) {
	const available = scooter.availability === "available";

	return (
		<button className="scooter-row" data-selected={selected} type="button" aria-pressed={selected} onClick={onSelect}>
			<span className="scooter-row-visual" data-selected={selected}>
				{selected ? <img src="/assets/brand/oloo-scooter-c5.png" alt="" /> : <Scooter size={38} weight="duotone" />}
			</span>
			<span className="scooter-row-details">
				<strong>{scooter.id}</strong>
				<span>
					<PersonSimpleWalk size={17} weight="bold" />
					步行 {scooter.walkMinutes} 分鐘
				</span>
				<span>
					<BatteryMedium size={18} weight="bold" />
					<b>{scooter.batteryPercent}%</b>
				</span>
				<span>
					<RoadHorizon size={18} weight="bold" />約 {scooter.rangeKm} 公里
				</span>
			</span>
			<span className="availability-pill" data-available={available}>
				{available ? "可借" : "電量不足"}
			</span>
		</button>
	);
}
