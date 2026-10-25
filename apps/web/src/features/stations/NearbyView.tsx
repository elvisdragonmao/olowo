import { ArrowClockwise, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useUiStore } from "../../app/useUiStore";
import { distanceLabel, relativeTime } from "../../shared/format";
import { stationLabel, type StationSummary } from "../fleet/model";
import { useCampuses } from "../fleet/useCampus";
import { useFleetQuery } from "../fleet/useFleetQuery";
import { distanceMeters, walkMinutes } from "../location/geo";
import { useLocationStore } from "../location/useLocationStore";
import { useEfences } from "../map/useEfences";
import { useNow } from "../ride/useCurrentRide";
import { DockBar, StatStrip } from "./Battery";

export function NearbyView() {
	const fleet = useFleetQuery();
	const now = useNow(10_000);
	const position = useLocationStore(state => state.position);
	const { mapCenter, query, navigate, setQuery, setSnap, focusBounds } = useUiStore();
	const { campuses, current } = useCampuses();
	const origin = position ?? mapCenter;

	// Counts and the list describe the campus on screen; search reaches every campus.
	const stations = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return (
			(needle ? (fleet.data?.stations ?? []) : (current?.stations ?? []))
				.map(station => ({ station, label: stationLabel(station.name), meters: distanceMeters(origin, station) }))
				.filter(item => !needle || item.station.name.toLowerCase().includes(needle))
				// Nearest first, but stations with nothing to borrow sink to the bottom.
				.sort((a, b) => Number(a.station.availableCount === 0) - Number(b.station.availableCount === 0) || a.meters - b.meters)
		);
	}, [current, fleet.data?.stations, origin, query]);

	return (
		<>
			<header className="view-head view-head-stack" data-sheet-drag>
				{fleet.data ? (
					<div className="fleet-summary" aria-live="polite">
						<p className="fleet-meta">
							<strong>{current ? `全${current.name}` : "全部站點"}</strong> · {current?.stations.length ?? fleet.data.stationCount} 站 · 更新 {relativeTime(fleet.data.updatedAt, now)}
						</p>
						<StatStrip
							label={current ? `${current.name}車況` : "車況"}
							available={current?.availableCount ?? fleet.data.availableCount}
							lowBattery={current?.lowBatteryCount ?? fleet.data.lowBatteryCount}
							outOfService={current?.outOfServiceCount ?? fleet.data.outOfServiceCount}
						/>
					</div>
				) : (
					<p className="fleet-meta skeleton-text">{fleet.isError ? "無法取得車況" : "載入車況中"}</p>
				)}
				<div className="search-row">
					<label className="search-field">
						<MagnifyingGlass size={16} weight="bold" aria-hidden />
						<input type="search" value={query} placeholder="搜尋站點或校區" aria-label="搜尋站點" onFocus={() => setSnap("full")} onChange={event => setQuery(event.target.value)} />
						{query ? (
							<button type="button" aria-label="清除搜尋" onClick={() => setQuery("")}>
								<X size={14} weight="bold" />
							</button>
						) : null}
					</label>
				</div>
				{campuses.length > 1 ? (
					<div className="chip-row" role="toolbar" aria-label="校區">
						{campuses.map(campus => (
							<button key={campus.name} type="button" className="chip campus-chip" aria-pressed={campus === current} onClick={() => focusBounds(campus.bounds)}>
								{campus.name}
								<span>{campus.availableCount}</span>
							</button>
						))}
					</div>
				) : null}
			</header>
			<div className="view-body">
				{fleet.isError && !fleet.data ? (
					<div className="empty-state">
						<p>連不上 olowo 伺服器。</p>
						<button type="button" className="button button-quiet" onClick={() => fleet.refetch()}>
							<ArrowClockwise size={16} weight="bold" /> 重試
						</button>
					</div>
				) : null}
				{fleet.isPending ? <StationSkeleton /> : null}
				<ol className="station-list" aria-label="附近站點">
					{stations.map(({ station, label, meters }) => (
						<li key={station.id}>
							<StationRow station={station} label={label} showCampus={query.trim() !== ""} meters={position ? meters : null} onSelect={() => navigate({ kind: "station", stationId: station.id })} />
						</li>
					))}
				</ol>
				<EfenceLegend />
				{fleet.data && stations.length === 0 ? (
					<div className="empty-state">
						<p>沒有符合的站點。</p>
						<button type="button" className="button button-quiet" onClick={() => setQuery("")}>
							清除搜尋
						</button>
					</div>
				) : null}
			</div>
		</>
	);
}

function StationRow({
	station,
	label,
	showCampus,
	meters,
	onSelect
}: {
	station: StationSummary;
	label: ReturnType<typeof stationLabel>;
	showCampus: boolean;
	meters: number | null;
	onSelect: () => void;
}) {
	const lowBattery = station.lowBatteryCount;
	const outOfService = station.outOfServiceCount;
	const available = station.availableCount;
	const notes = [lowBattery > 0 ? `${lowBattery} 沒電` : null, outOfService > 0 ? `${outOfService} 故障` : null].filter(Boolean).join(" · ");
	return (
		<button type="button" className="station-row" onClick={onSelect}>
			<span className="station-row-count" data-tone={available > 0 ? "available" : lowBattery > 0 ? "low_battery" : "empty"}>
				{available}
			</span>
			<span className="station-row-main">
				<strong>
					{showCampus && label.campus ? <em>{label.campus}</em> : null}
					{label.name}
				</strong>
				<span>
					{meters != null ? `步行 ${walkMinutes(meters)} 分 · ${distanceLabel(meters)}` : `${station.scooters.length} 台在站`}
					{notes ? ` · ${notes}` : ""}
				</span>
				<DockBar available={available} lowBattery={lowBattery} unavailable={station.scooters.length - available - lowBattery} capacity={station.capacity} />
			</span>
		</button>
	);
}

function EfenceLegend() {
	const efences = useEfences().data;
	const zones = useMemo(() => {
		const seen = new Map<string, { name: string; color: string; description: string | null }>();
		for (const feature of efences?.features ?? []) if (!seen.has(feature.properties.zone)) seen.set(feature.properties.zone, feature.properties);
		return [...seen].map(([zone, properties]) => ({ zone, ...properties }));
	}, [efences]);
	if (zones.length === 0) return null;
	return (
		<ul className="efence-legend" aria-label="電子圍籬圖例">
			{zones.map(zone => (
				<li key={zone.zone} data-zone={zone.zone} style={{ ["--zone" as string]: zone.zone === "normalSpeedArea" ? "var(--available)" : zone.color }} title={zone.description ?? undefined}>
					{zone.zone === "normalSpeedArea" ? "可騎乘範圍" : zone.name}
				</li>
			))}
		</ul>
	);
}

function StationSkeleton() {
	return (
		<ol className="station-list" aria-hidden>
			{Array.from({ length: 5 }, (_, index) => (
				<li key={index} className="station-row station-row-skeleton">
					<span className="station-row-count" />
					<span className="station-row-main">
						<strong className="skeleton-text">站點名稱</strong>
						<span className="skeleton-text">步行時間</span>
					</span>
				</li>
			))}
		</ol>
	);
}
