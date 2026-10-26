import { ArrowLeft } from "@phosphor-icons/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { durationLabel } from "../../shared/format";
import { useRideHistory } from "../account/useRideHistory";
import { Avatar } from "../auth/Avatar";
import { useSession } from "../auth/useSession";
import {
	customRange,
	dateKey,
	durationHistogram,
	earliestStart,
	inRange,
	parseDateKey,
	presetRange,
	previousRange,
	rangePresets,
	routeStats,
	summarize,
	toRides,
	topCounts,
	topRoutes,
	trend,
	weekdays,
	weekHourGrid,
	type Metric,
	type RangeKey,
	type Ride,
	type Summary
} from "./analysis";
import { BarList, ColumnChart, DataTable, Heatmap } from "./charts";
import "./insights.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } } });

/** 騎乘分析 at `/insights`: its own page (opened in a new tab), no map. */
export default function InsightsPage() {
	useEffect(() => {
		document.title = "騎乘分析 · olowo";
		document.documentElement.classList.add("page-scroll");
		// Personal data behind a sign-in: keep it out of search results.
		const robots = document.querySelector('meta[name="robots"]');
		robots?.setAttribute("content", "noindex, nofollow");
	}, []);
	return (
		<QueryClientProvider client={queryClient}>
			<Insights />
		</QueryClientProvider>
	);
}

const metricLabels: Record<Metric, string> = { count: "趟數", minutes: "分鐘", cost: "花費" };
const metricFormat: Record<Metric, (value: number) => string> = {
	count: value => `${value} 趟`,
	minutes: value => `${Math.round(value)} 分`,
	cost: value => `$${Math.round(value)}`
};

function readRange() {
	const params = new URLSearchParams(window.location.search);
	const key = (params.get("range") ?? "this-month") as RangeKey;
	const valid = key === "custom" || rangePresets.some(preset => preset.key === key);
	return { key: valid ? key : "this-month", from: params.get("from") ?? "", through: params.get("to") ?? "" };
}

function hours(seconds: number) {
	if (seconds < 3600) return `${Math.round(seconds / 60)} 分`;
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
}

const seconds = (value: number) => durationLabel(Math.round(value));
const money = (value: number) => `$${Math.round(value * 10) / 10}`;
const longDate = (date: Date) => date.toLocaleDateString("zh-TW", { year: "numeric", month: "numeric", day: "numeric" });

function Insights() {
	const session = useSession();
	const signedIn = session.data?.authenticated === true;
	const history = useRideHistory();
	const [range, setRange] = useState(readRange);
	const [metric, setMetric] = useState<Metric>("count");

	useEffect(() => {
		const params = new URLSearchParams({ range: range.key });
		if (range.key === "custom") {
			if (range.from) params.set("from", range.from);
			if (range.through) params.set("to", range.through);
		}
		window.history.replaceState(null, "", `/insights?${params}`);
	}, [range]);

	const all = useMemo(() => toRides(history.data ?? []), [history.data]);
	const window_ = useMemo(() => (range.key === "custom" ? customRange(parseDateKey(range.from), parseDateKey(range.through)) : presetRange(range.key)), [range]);
	const rides = useMemo(() => inRange(all, window_), [all, window_]);
	const earliest = useMemo(() => earliestStart(all), [all]);
	const previous = useMemo(() => {
		const before = previousRange(range.key, window_);
		// Nothing to compare with when the previous period ends before the first ride.
		return before?.to && earliest && before.to > earliest ? summarize(inRange(all, before)) : null;
	}, [all, earliest, range.key, window_]);
	const summary = useMemo(() => summarize(rides), [rides]);
	const series = useMemo(() => trend(rides, window_, earliest), [rides, window_, earliest]);
	const grid = useMemo(() => weekHourGrid(rides), [rides]);
	const durations = useMemo(() => durationHistogram(rides), [rides]);
	const routes = useMemo(() => topRoutes(rides), [rides]);
	const starts = useMemo(() => topCounts(rides.map(ride => ride.from)), [rides]);
	const ends = useMemo(() => topCounts(rides.map(ride => ride.to)), [rides]);
	const scooters = useMemo(
		() =>
			topCounts(
				rides.flatMap(ride => (ride.label ? [ride.label] : [])),
				5
			),
		[rides]
	);
	const busiest = useMemo(() => {
		let best = { row: 0, column: 0, value: 0 };
		grid.forEach((row, rowIndex) => row.forEach((value, column) => (value > best.value ? (best = { row: rowIndex, column, value }) : null)));
		return best.value ? best : null;
	}, [grid]);

	return (
		<div className="insights">
			<header className="insights-head">
				<a className="icon-button" href="/" aria-label="回到地圖">
					<ArrowLeft size={18} weight="bold" />
				</a>
				<div>
					<a className="wordmark" href="/" aria-label="olowo">
						ol<span>owo</span>
					</a>
					<h1>騎乘分析</h1>
				</div>
				{session.data?.authenticated ? <Avatar email={session.data.email} /> : null}
			</header>

			{session.isPending ? null : !signedIn ? (
				<section className="insights-empty">
					<p>登入 oloo 帳號後才看得到你的騎乘紀錄。</p>
					<a className="button button-primary" href="/?view=account">
						去登入
					</a>
				</section>
			) : (
				<>
					<RangeBar range={range} onChange={setRange} />
					{history.error ? <p className="inline-error">讀不到騎乘紀錄：{history.error.message}</p> : null}
					<main className="insights-body" data-loading={history.isPending}>
						<Tiles summary={summary} previous={previous} />

						{summary.count === 0 && !history.isPending ? (
							<p className="insights-empty-range">這段期間沒有騎乘紀錄，換個時間範圍看看。</p>
						) : (
							<>
								<section className="insights-card insights-wide">
									<div className="insights-card-head">
										<div>
											<h2>{series.bucket === "day" ? "每日" : series.bucket === "week" ? "每週" : "每月"}騎乘</h2>
											<p>
												{metricLabels[metric]}，共 {metricFormat[metric](metric === "count" ? summary.count : metric === "minutes" ? summary.seconds / 60 : summary.cost)}
											</p>
										</div>
										<div className="segmented" role="radiogroup" aria-label="指標">
											{(Object.keys(metricLabels) as Metric[]).map(key => (
												<button key={key} type="button" role="radio" aria-checked={metric === key} onClick={() => setMetric(key)}>
													{metricLabels[key]}
												</button>
											))}
										</div>
									</div>
									<ColumnChart
										label={`${metricLabels[metric]}趨勢`}
										format={metricFormat[metric]}
										data={series.points.map(point => ({
											key: point.key,
											label: point.label,
											value: point[metric],
											detail:
												series.bucket === "day"
													? point.start.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" })
													: series.bucket === "week"
														? `${point.start.getMonth() + 1}/${point.start.getDate()} 起的一週`
														: `${point.start.getFullYear()} 年 ${point.start.getMonth() + 1} 月`
										}))}
									/>
									<DataTable
										head={["期間", "趟數", "分鐘", "花費"]}
										rows={series.points.filter(point => point.count > 0).map(point => [point.label, point.count, Math.round(point.minutes), `$${point.cost}`])}
									/>
								</section>

								<section className="insights-card insights-wide">
									<div className="insights-card-head">
										<div>
											<h2>什麼時候騎</h2>
											<p>{busiest ? `最常在星期${weekdays[busiest.row]} ${busiest.column} 點出發（${busiest.value} 趟）` : "依出發時間"}</p>
										</div>
									</div>
									<Heatmap rows={weekdays} columns={24} values={grid} describe={(row, column) => `星期${weekdays[row]} ${column}:00–${column + 1}:00`} />
									<DataTable head={["星期", ...Array.from({ length: 24 }, (_, hour) => `${hour}`)]} rows={grid.map((row, index) => [weekdays[index]!, ...row])} />
								</section>

								<section className="insights-card">
									<div className="insights-card-head">
										<div>
											<h2>每趟騎多久</h2>
											<p>
												平均 {seconds(summary.seconds / Math.max(1, summary.count))}，最長 {summary.longest ? seconds(summary.longest.seconds) : "—"}
											</p>
										</div>
									</div>
									<ColumnChart
										label="騎乘時長分布"
										height={180}
										format={value => `${value} 趟`}
										data={durations.map(bucket => ({ key: bucket.label, label: bucket.label.replace(" 以上", "+"), value: bucket.count, detail: `${bucket.label} · 花費 $${bucket.cost}` }))}
									/>
									<DataTable head={["時長", "趟數", "花費"]} rows={durations.map(bucket => [bucket.label, bucket.count, `$${bucket.cost}`])} />
								</section>

								<section className="insights-card">
									<div className="insights-card-head">
										<div>
											<h2>最常騎的路線</h2>
											<p>起點 → 終點，次數與平均時間</p>
										</div>
									</div>
									<BarList
										empty="沒有路線資料。"
										format={value => `${value} 次`}
										items={routes.map(route => ({
											key: `${route.from}→${route.to}`,
											label: route.from === route.to ? `${route.from}（原站歸還）` : `${route.from} → ${route.to}`,
											value: route.count,
											note: `平均 ${seconds(route.averageSeconds)} · 最快 ${seconds(route.fastestSeconds)} · 平均 ${money(route.averageCost)}`
										}))}
									/>
								</section>

								<RouteExplorer rides={rides} />

								<section className="insights-card">
									<div className="insights-card-head">
										<div>
											<h2>常用站點</h2>
											<p>借車與還車最多的站</p>
										</div>
									</div>
									<div className="insights-split">
										<div>
											<h3>借車</h3>
											<BarList empty="—" format={value => `${value}`} items={starts.map(item => ({ key: item.label, label: item.label, value: item.count }))} />
										</div>
										<div>
											<h3>還車</h3>
											<BarList empty="—" format={value => `${value}`} items={ends.map(item => ({ key: item.label, label: item.label, value: item.count }))} />
										</div>
									</div>
								</section>

								<section className="insights-card">
									<div className="insights-card-head">
										<div>
											<h2>最常騎的車</h2>
											<p>同一台車騎了幾次</p>
										</div>
									</div>
									<BarList
										empty="—"
										format={value => `${value} 次`}
										items={scooters.map(item => ({ key: item.label, label: <span className="plate-inline">{item.label}</span>, value: item.count }))}
									/>
								</section>
							</>
						)}
					</main>
					<p className="insights-foot">資料來自 oloo 的騎乘紀錄，以出發時間歸入期間；騎乘中的那趟不算。時間以你裝置的時區計算。</p>
				</>
			)}
		</div>
	);
}

function RangeBar({ range, onChange }: { range: ReturnType<typeof readRange>; onChange: (next: ReturnType<typeof readRange>) => void }) {
	const today = dateKey(new Date());
	return (
		<nav className="insights-range" aria-label="統計時間範圍">
			<div className="chip-row" role="radiogroup" aria-label="時間範圍">
				{rangePresets.map(preset => (
					<button key={preset.key} type="button" className="chip" role="radio" aria-checked={range.key === preset.key} onClick={() => onChange({ key: preset.key, from: "", through: "" })}>
						{preset.label}
					</button>
				))}
				<button
					type="button"
					className="chip"
					role="radio"
					aria-checked={range.key === "custom"}
					onClick={() => {
						const current = range.key === "custom" ? null : presetRange(range.key);
						onChange({ key: "custom", from: range.from || (current?.from ? dateKey(current.from) : ""), through: range.through || today });
					}}
				>
					自訂
				</button>
			</div>
			{range.key === "custom" ? (
				<div className="insights-custom">
					<label className="field field-inline">
						<span>從</span>
						<input type="date" value={range.from} max={range.through || today} onChange={event => onChange({ ...range, from: event.target.value })} />
					</label>
					<label className="field field-inline">
						<span>到</span>
						<input type="date" value={range.through} min={range.from || undefined} max={today} onChange={event => onChange({ ...range, through: event.target.value })} />
					</label>
				</div>
			) : null}
		</nav>
	);
}

function delta(current: number, before: number | undefined, format: (value: number) => string) {
	if (before == null) return null;
	const change = current - before;
	if (Math.abs(change) < 0.5) return "與上期持平";
	return `比上期 ${change > 0 ? "+" : "−"}${format(Math.abs(change))}`;
}

function Tiles({ summary, previous }: { summary: Summary; previous: Summary | null }) {
	const average = summary.count ? summary.seconds / summary.count : 0;
	const tiles = [
		{ label: "騎乘次數", value: `${summary.count} 趟`, note: delta(summary.count, previous?.count, value => `${value} 趟`) },
		{ label: "騎乘時間", value: hours(summary.seconds), note: delta(summary.seconds, previous?.seconds, hours) },
		{ label: "花費", value: `$${summary.cost}`, note: delta(summary.cost, previous?.cost, value => `$${value}`) },
		{ label: "免費趟數", value: `${summary.freeCount} 趟`, note: summary.count ? `佔 ${Math.round((summary.freeCount / summary.count) * 100)}%` : null },
		{ label: "平均每趟", value: summary.count ? seconds(average) : "—", note: summary.count ? `平均 ${money(summary.cost / summary.count)}` : null },
		{ label: "騎乘天數", value: `${summary.days} 天`, note: summary.longestStreak > 1 ? `最長連續 ${summary.longestStreak} 天` : null }
	];
	return (
		<section className="insights-tiles" aria-label="總覽">
			{tiles.map(tile => (
				<div key={tile.label} className="insights-tile">
					<span>{tile.label}</span>
					<strong>{tile.value}</strong>
					{tile.note ? <small>{tile.note}</small> : null}
				</div>
			))}
		</section>
	);
}

/** Pick any two stations and see how that trip usually goes. */
function RouteExplorer({ rides }: { rides: Ride[] }) {
	const stations = useMemo(() => [...new Set(rides.flatMap(ride => [ride.from, ride.to]))].sort((a, b) => a.localeCompare(b, "zh-Hant")), [rides]);
	const top = useMemo(() => topRoutes(rides, 1)[0] ?? null, [rides]);
	const [picked, setPicked] = useState<{ from: string; to: string } | null>(null);
	const from = picked && stations.includes(picked.from) ? picked.from : (top?.from ?? "");
	const to = picked && stations.includes(picked.to) ? picked.to : (top?.to ?? "");
	const stats = from && to ? routeStats(rides, from, to) : null;

	return (
		<section className="insights-card">
			<div className="insights-card-head">
				<div>
					<h2>站到站要多久</h2>
					<p>選起點和終點，看這段路平常騎多久</p>
				</div>
			</div>
			<div className="insights-route-pick">
				<label className="field">
					<span>起點</span>
					<select value={from} onChange={event => setPicked({ from: event.target.value, to })}>
						{stations.map(station => (
							<option key={station}>{station}</option>
						))}
					</select>
				</label>
				<label className="field">
					<span>終點</span>
					<select value={to} onChange={event => setPicked({ from, to: event.target.value })}>
						{stations.map(station => (
							<option key={station}>{station}</option>
						))}
					</select>
				</label>
			</div>
			{stats ? (
				<>
					<dl className="insights-route-stats">
						<div>
							<dt>平均</dt>
							<dd>{seconds(stats.averageSeconds)}</dd>
						</div>
						<div>
							<dt>中位數</dt>
							<dd>{seconds(stats.medianSeconds)}</dd>
						</div>
						<div>
							<dt>最快</dt>
							<dd>{seconds(stats.fastestSeconds)}</dd>
						</div>
						<div>
							<dt>最慢</dt>
							<dd>{seconds(stats.slowestSeconds)}</dd>
						</div>
					</dl>
					<p className="muted small">
						騎過 {stats.count} 次，平均花費 {money(stats.averageCost)}，最近一次 {longDate(stats.rides[0]!.start)}。
					</p>
				</>
			) : (
				<p className="muted small">
					這段期間沒有從 {from || "—"} 騎到 {to || "—"} 的紀錄。
				</p>
			)}
		</section>
	);
}
