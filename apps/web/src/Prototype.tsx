import { CaretRight, MagnifyingGlass, SlidersHorizontal, User, WarningCircle } from "@phosphor-icons/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AuthPanel } from "./features/auth/AuthPanel";
import type { LiveMapHandle } from "./features/map/LiveMap";
import { ScooterRow } from "./features/map/ScooterRow";
import { useFleetQuery } from "./features/map/useFleetQuery";
import { useMapStore } from "./features/map/useMapStore";
import { RidePanel } from "./features/ride/RidePanel";
import { ScooterActionPanel } from "./features/ride/ScooterActionPanel";
import { useCurrentRideQuery } from "./features/ride/useCurrentRideQuery";
import { BottomSheet, MobileScroll } from "./mobile";

const LiveMap = lazy(() => import("./features/map/LiveMap").then(module => ({ default: module.LiveMap })));

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			refetchOnWindowFocus: false
		}
	}
});

type Sheet = "filters" | "reasons" | "profile" | "scooter" | "ride" | null;

function OluwuPrototype() {
	const mapRef = useRef<LiveMapHandle>(null);
	const [sheet, setSheet] = useState<Sheet>(null);
	const { data } = useFleetQuery();
	const currentRide = useCurrentRideQuery().data?.activeRide ?? null;
	const selectedId = useMapStore(state => state.selectedId);
	const setSelectedId = useMapStore(state => state.setSelectedId);
	const availableOnly = useMapStore(state => state.availableOnly);
	const setAvailableOnly = useMapStore(state => state.setAvailableOnly);
	const minBattery = useMapStore(state => state.minBattery);
	const setMinBattery = useMapStore(state => state.setMinBattery);

	useEffect(() => {
		if (import.meta.env.PROD && "serviceWorker" in navigator) {
			void navigator.serviceWorker.register("/sw.js");
		}
	}, []);

	const scooters = useMemo(
		() => data.scooters.filter(scooter => (!availableOnly || scooter.availability === "available") && scooter.batteryPercent >= minBattery),
		[availableOnly, data.scooters, minBattery]
	);

	const selected = data.scooters.find(scooter => scooter.id === selectedId) ?? data.scooters[0];

	const focusScooter = (id: string) => {
		const scooter = data.scooters.find(item => item.id === id);
		if (!scooter) return;

		setSelectedId(id);
		mapRef.current?.focusScooter(scooter);
	};

	return (
		<div className="oluwu-shell">
			<MobileScroll className="app-screen oluwu-screen">
				<main className="oluwu-content" aria-label="oluwu 附近車輛">
					<header className="oluwu-header">
						<img className="oloo-wordmark" src="/assets/brand/oloo-wordmark.png" alt="oloo" />
						<div className="header-actions">
							<button className="btn btn-circle header-icon-button" type="button" aria-label="搜尋與篩選" onClick={() => setSheet("filters")}>
								<MagnifyingGlass size={22} weight="bold" />
							</button>
							<button className="btn btn-circle header-icon-button" type="button" aria-label="帳號" onClick={() => setSheet("profile")}>
								<User size={22} weight="bold" />
							</button>
						</div>
					</header>

					<Suspense fallback={<section className="map-panel map-panel-loading" aria-label="正在載入附近車輛地圖" />}>
						<LiveMap ref={mapRef} scooters={data.scooters} selectedId={selectedId} onSelect={focusScooter} />
					</Suspense>

					<section className="availability-heading" aria-labelledby="available-title">
						<div>
							<h1 id="available-title">
								<strong>{data.availableCount}</strong> 台可借
							</h1>
							<p>附近共 {data.totalCount} 台</p>
						</div>
						<button type="button" className="filter-shortcut" aria-label="開啟篩選" onClick={() => setSheet("filters")}>
							<SlidersHorizontal size={19} weight="bold" />
							篩選
						</button>
					</section>

					<section className="scooter-list" aria-label="附近車輛清單">
						{scooters.map(scooter => (
							<ScooterRow key={scooter.id} scooter={scooter} selected={scooter.id === selectedId} onSelect={() => focusScooter(scooter.id)} />
						))}
						{scooters.length === 0 ? (
							<div className="empty-list">
								<p>沒有符合篩選條件的車</p>
								<button
									type="button"
									onClick={() => {
										setAvailableOnly(false);
										setMinBattery(0);
									}}
								>
									清除篩選
								</button>
							</div>
						) : null}
					</section>

					<button className="reason-disclosure" type="button" onClick={() => setSheet("reasons")}>
						<WarningCircle size={23} weight="bold" />
						<span>
							{data.unavailableCount} 台暫不可借 · 電量 {data.reasons.lowBattery} · 硬體 {data.reasons.hardware} · 定位 {data.reasons.location}
						</span>
						<CaretRight size={18} weight="bold" />
					</button>
				</main>
			</MobileScroll>

			<footer className="selected-scooter-bar" aria-label={currentRide ? "目前騎乘" : "目前選擇"}>
				<img src="/assets/brand/oloo-scooter-c5.png" alt="" />
				<div className="selected-scooter-summary">
					<strong>{currentRide?.label ?? selected.id}</strong>
					<span>{currentRide ? "騎乘中 · 點此管理" : `${selected.batteryPercent}% · 約 ${selected.rangeKm} 公里`}</span>
				</div>
				<button className="btn selected-scooter-action" type="button" onClick={() => setSheet(currentRide ? "ride" : "scooter")}>
					{currentRide ? "管理騎乘" : "借用資訊"}
				</button>
			</footer>

			<BottomSheet open={sheet === "filters"} onOpenChange={open => setSheet(open ? "filters" : null)} title="篩選附近車輛" description="清單與地圖會一起更新" snap={0.42}>
				<div className="sheet-section">
					<p className="sheet-label">可借狀態</p>
					<button type="button" className="sheet-toggle" aria-pressed={availableOnly} onClick={() => setAvailableOnly(!availableOnly)}>
						<span>只顯示可借車輛</span>
						<span className="toggle-track" data-active={availableOnly}>
							<span />
						</span>
					</button>
					<p className="sheet-label">最低電量</p>
					<div className="battery-filter" aria-label="最低電量">
						{[0, 35, 50, 70].map(value => (
							<button key={value} type="button" aria-pressed={minBattery === value} onClick={() => setMinBattery(value)}>
								{value === 0 ? "不限" : `${value}%`}
							</button>
						))}
					</div>
				</div>
			</BottomSheet>

			<BottomSheet
				open={sheet === "reasons"}
				onOpenChange={open => setSheet(open ? "reasons" : null)}
				title={`${data.unavailableCount} 台暫不可借`}
				description="同一台車可能同時出現多個訊號"
				snap={0.42}
			>
				<div className="reason-list">
					<div>
						<span>電量不足</span>
						<strong>{data.reasons.lowBattery}</strong>
					</div>
					<div>
						<span>硬體異常</span>
						<strong>{data.reasons.hardware}</strong>
					</div>
					<div>
						<span>定位異常</span>
						<strong>{data.reasons.location}</strong>
					</div>
				</div>
			</BottomSheet>

			<BottomSheet open={sheet === "profile"} onOpenChange={open => setSheet(open ? "profile" : null)} title="帳號" description="登入後才能借車與查看騎乘紀錄" snap={0.34}>
				<AuthPanel />
			</BottomSheet>

			<BottomSheet open={sheet === "scooter"} onOpenChange={open => setSheet(open ? "scooter" : null)} title="借用資訊" description="費率與操作都以送出當下的 staging 狀態為準" snap={0.62}>
				<ScooterActionPanel scooter={selected} onNeedLogin={() => setSheet("profile")} />
			</BottomSheet>

			<BottomSheet open={sheet === "ride"} onOpenChange={open => setSheet(open ? "ride" : null)} title="目前騎乘" description="計費與歸還狀態來自 oloo staging" snap={0.62}>
				{currentRide ? <RidePanel ride={currentRide} /> : <p className="no-active-ride">目前沒有進行中的騎乘。</p>}
			</BottomSheet>
		</div>
	);
}

export default function Prototype() {
	return (
		<QueryClientProvider client={queryClient}>
			<OluwuPrototype />
		</QueryClientProvider>
	);
}
