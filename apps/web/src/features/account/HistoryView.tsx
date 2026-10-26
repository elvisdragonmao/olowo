import { ArrowLeft } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useUiStore } from "../../app/useUiStore";
import { clock, timeOfDay } from "../../shared/format";
import { stationLabel } from "../fleet/model";
import { useRideHistory } from "./useRideHistory";

const pageSize = 30;

function dayLabel(iso: string) {
	return new Date(iso).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" });
}

/** oloo's rental log: what each ride cost and how its minutes were counted. */
export function HistoryView() {
	const back = useUiStore(state => state.back);
	const navigate = useUiStore(state => state.navigate);
	const [shown, setShown] = useState(pageSize);
	const history = useRideHistory();
	const month = useMemo(() => {
		const since = Date.now() - 30 * 86_400_000;
		const recent = (history.data ?? []).filter(ride => Date.parse(ride.startedAt) > since);
		return { count: recent.length, spent: recent.reduce((sum, ride) => sum + (ride.cost ?? 0), 0) };
	}, [history.data]);

	return (
		<>
			<header className="view-head" data-sheet-drag>
				<button type="button" className="icon-button" aria-label="返回" onClick={back}>
					<ArrowLeft size={18} weight="bold" />
				</button>
				<div className="view-head-title">
					<h2>騎乘紀錄</h2>
					{history.data ? (
						<p>
							近 30 天 {month.count} 趟 · ${month.spent} ·{" "}
							<a className="text-button" href="/insights" target="_blank" rel="noopener">
								看騎乘分析
							</a>
						</p>
					) : null}
				</div>
			</header>
			<div className="view-body">
				{history.isPending ? <p className="skeleton-text">讀取騎乘紀錄</p> : null}
				{history.error ? <p className="inline-error">讀不到騎乘紀錄：{history.error.message}</p> : null}
				<p className="muted small">從 oloo 的紀錄看，發動和熄火的時間分開計費、各自無條件進位到整分鐘，所以通常會多一分鐘臨停；30 秒內還車的騎乘都沒有收費。</p>
				<ol className="history-list" aria-label="騎乘紀錄">
					{(history.data ?? []).slice(0, shown).map(ride => (
						<li key={ride.id} className="history-row">
							<div className="history-row-main">
								<strong>
									<span className="plate-inline">{ride.label ?? "—"}</span>
									<span>
										{dayLabel(ride.startedAt)} {timeOfDay(ride.startedAt)}
									</span>
								</strong>
								<span>
									{ride.durationSeconds != null ? clock(ride.durationSeconds) : "騎乘中"}
									{ride.endedAt ? ` · 騎乘 ${ride.ridingMinutes} 分 + 臨停 ${ride.parkedMinutes} 分` : ""}
									{ride.endedAt && (ride.engineOnSeconds > 0 || ride.engineOffSeconds > 0) ? `（發動 ${clock(ride.engineOnSeconds)}、熄火 ${clock(ride.engineOffSeconds)}）` : ""}
								</span>
								{ride.startStation || ride.endStation ? (
									<span>
										{ride.startStation ? stationLabel(ride.startStation).name : "?"} → {ride.endStation ? stationLabel(ride.endStation).name : "?"}
									</span>
								) : null}
							</div>
							<div className="history-row-cost">
								<strong>${ride.cost ?? "—"}</strong>
								{ride.endedAt && !ride.paid ? (
									<button type="button" className="status-tag" data-tone="low_battery" onClick={() => navigate({ kind: "checkout" })}>
										待結帳
									</button>
								) : null}
							</div>
						</li>
					))}
				</ol>
				{history.data && history.data.length > shown ? (
					<button type="button" className="button button-quiet button-block" onClick={() => setShown(count => count + pageSize)}>
						顯示更多
					</button>
				) : null}
				{history.data?.length === 0 ? (
					<div className="empty-state">
						<p>還沒有騎乘紀錄。</p>
					</div>
				) : null}
			</div>
		</>
	);
}
