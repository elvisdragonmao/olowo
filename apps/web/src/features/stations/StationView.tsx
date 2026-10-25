import { ArrowLeft, ArrowUpRight, CaretRight } from "@phosphor-icons/react";
import { useUiStore } from "../../app/useUiStore";
import { distanceLabel } from "../../shared/format";
import { availabilityLabel, modelLabel, stationLabel, warningLabel, type ScooterSummary, type StationSummary } from "../fleet/model";
import { useFleetQuery, useStation } from "../fleet/useFleetQuery";
import { distanceMeters, walkingDirectionsUrl, walkMinutes } from "../location/geo";
import { useLocationStore } from "../location/useLocationStore";
import { BatteryRing, StatStrip } from "./Battery";

export function StationView({ stationId }: { stationId: number }) {
	const fleet = useFleetQuery();
	const station = useStation(stationId);
	const back = useUiStore(state => state.back);
	const navigate = useUiStore(state => state.navigate);
	const position = useLocationStore(state => state.position);

	if (!station) {
		return (
			<>
				<header className="view-head" data-sheet-drag>
					<button type="button" className="icon-button" aria-label="返回" onClick={back}>
						<ArrowLeft size={18} weight="bold" />
					</button>
					<div className="view-head-title">
						<h2>{fleet.isPending ? "載入中" : "找不到這個站點"}</h2>
					</div>
				</header>
				<div className="view-body" />
			</>
		);
	}

	const meters = position ? distanceMeters(position, station) : null;
	const available = station.availableCount;
	const label = stationLabel(station.name);

	return (
		<>
			<header className="view-head" data-sheet-drag>
				<button type="button" className="icon-button" aria-label="返回" onClick={back}>
					<ArrowLeft size={18} weight="bold" />
				</button>
				<div className="view-head-title">
					<h2>{label.name}</h2>
					<p>
						{label.campus ? `${label.campus} · ` : ""}
						{meters != null ? `步行 ${walkMinutes(meters)} 分 · ${distanceLabel(meters)} · ` : ""}
						{station.capacity > 0 ? `${station.capacity} 格車位` : "車位數未知"}
						{station.type === "rfid" ? " · RFID 還車" : ""}
					</p>
				</div>
				<a className="icon-button" href={walkingDirectionsUrl(station)} target="_blank" rel="noreferrer" aria-label="步行導航">
					<ArrowUpRight size={18} weight="bold" />
				</a>
			</header>
			<div className="view-body">
				<StatStrip label={`${label.name}車況`} available={available} lowBattery={station.lowBatteryCount} outOfService={station.outOfServiceCount} />
				{station.scooters.length === 0 ? (
					<div className="empty-state">
						<p>這個站點目前沒有車。</p>
					</div>
				) : (
					<ol className="scooter-list" aria-label={`${label.name}的車輛`}>
						{station.scooters.map(scooter => (
							<li key={scooter.providerId}>
								<ScooterRow scooter={scooter} onSelect={() => navigate({ kind: "scooter", stationId: station.id, scooterId: scooter.providerId })} />
							</li>
						))}
					</ol>
				)}
				<ReasonNote station={station} />
			</div>
		</>
	);
}

function ScooterRow({ scooter, onSelect }: { scooter: ScooterSummary; onSelect: () => void }) {
	return (
		<button type="button" className="scooter-row" onClick={onSelect}>
			<BatteryRing percent={scooter.batteryPercent} availability={scooter.availability} />
			<span className="scooter-row-main">
				<strong>
					{scooter.id}
					{modelLabel(scooter.model) ? <em>{modelLabel(scooter.model)}</em> : null}
				</strong>
				<span>
					約 {scooter.rangeKm} km
					{scooter.warnings.includes("hardware") ? <span className="row-warning"> · {warningLabel("hardware", scooter)}</span> : null}
				</span>
			</span>
			<span className="status-tag" data-tone={scooter.availability}>
				{availabilityLabel(scooter)}
			</span>
			<CaretRight size={14} weight="bold" className="row-caret" aria-hidden />
		</button>
	);
}

function ReasonNote({ station }: { station: StationSummary }) {
	const flagged = station.scooters.filter(scooter => scooter.warnings.includes("hardware")).length;
	return (
		<p className="reason-note">
			「沒電」是電量低於 {station.lowBatteryPercent}%（oloo 這一區的借車門檻）；「故障」是 oloo 暫停服務的車，夜間與維修時常見。
			{station.scooters.some(scooter => scooter.reasons.includes("reserved")) ? " 已被其他人預約的車不計入可借。" : ""}
			{flagged > 0 ? ` ${flagged} 台車機曾回報異常，olowo 只做提醒、不擋借用；能不能借由 oloo 在借車當下決定。` : ""}
		</p>
	);
}
