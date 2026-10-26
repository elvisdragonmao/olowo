import { stationLabel } from "../fleet/model";
import type { RideRecord } from "../account/useRideHistory";

/** A ride with the fields every analysis needs; rides still in progress are left out. */
export interface Ride {
	id: number;
	label: string | null;
	start: Date;
	seconds: number;
	cost: number;
	from: string;
	to: string;
	planName: string | null;
}

export const unknownStation = "未知站點";

const stationName = (name: string | null) => (name ? stationLabel(name).name : unknownStation);

export function toRides(records: RideRecord[]): Ride[] {
	return records.flatMap(record =>
		record.endedAt && record.durationSeconds != null
			? [
					{
						id: record.id,
						label: record.label,
						start: new Date(record.startedAt),
						seconds: record.durationSeconds,
						cost: record.cost ?? 0,
						from: stationName(record.startStation),
						to: stationName(record.endStation),
						planName: record.planName
					}
				]
			: []
	);
}

// ---------- time ranges ----------

export type RangeKey = "this-week" | "this-month" | "last-month" | "30d" | "90d" | "this-year" | "last-year" | "all" | "custom";

/** `to` is exclusive; `null` bounds are open. */
export interface Range {
	from: Date | null;
	to: Date | null;
}

export const rangePresets: Array<{ key: Exclude<RangeKey, "custom">; label: string }> = [
	{ key: "this-week", label: "本週" },
	{ key: "this-month", label: "本月" },
	{ key: "last-month", label: "上個月" },
	{ key: "30d", label: "近 30 天" },
	{ key: "90d", label: "近 90 天" },
	{ key: "this-year", label: "今年" },
	{ key: "last-year", label: "去年" },
	{ key: "all", label: "全部" }
];

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const startOfWeek = (date: Date) => addDays(startOfDay(date), -((date.getDay() + 6) % 7));

export function presetRange(key: Exclude<RangeKey, "custom">, now = new Date()): Range {
	const today = startOfDay(now);
	const tomorrow = addDays(today, 1);
	switch (key) {
		case "this-week":
			return { from: startOfWeek(now), to: tomorrow };
		case "this-month":
			return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: tomorrow };
		case "last-month":
			return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) };
		case "30d":
			return { from: addDays(today, -29), to: tomorrow };
		case "90d":
			return { from: addDays(today, -89), to: tomorrow };
		case "this-year":
			return { from: new Date(now.getFullYear(), 0, 1), to: tomorrow };
		case "last-year":
			return { from: new Date(now.getFullYear() - 1, 0, 1), to: new Date(now.getFullYear(), 0, 1) };
		case "all":
			return { from: null, to: null };
	}
}

/** The period just before `range` to compare against: the previous calendar month or year for those presets, otherwise the same length. */
export function previousRange(key: RangeKey, range: Range): Range | null {
	if (!range.from || !range.to) return null;
	const { from, to } = range;
	const elapsed = Math.round((to.getTime() - from.getTime()) / 86_400_000);
	// Month or year to date compares with the same number of days at the start of the previous one.
	if (key === "this-month" || key === "last-month") {
		const start = new Date(from.getFullYear(), from.getMonth() - 1, 1);
		const end = key === "this-month" ? addDays(start, elapsed) : from;
		return { from: start, to: end < from ? end : from };
	}
	if (key === "this-year" || key === "last-year") {
		const start = new Date(from.getFullYear() - 1, 0, 1);
		const end = key === "this-year" ? addDays(start, elapsed) : from;
		return { from: start, to: end < from ? end : from };
	}
	return { from: addDays(from, -elapsed), to: from };
}

export const inRange = (rides: Ride[], range: Range) => rides.filter(ride => (!range.from || ride.start >= range.from) && (!range.to || ride.start < range.to));

export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function parseDateKey(value: string | null) {
	const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
	return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

/** The custom range as picked: both days inclusive. */
export const customRange = (from: Date | null, through: Date | null): Range => ({ from, to: through ? addDays(through, 1) : null });

// ---------- summary ----------

export interface Summary {
	count: number;
	seconds: number;
	cost: number;
	freeCount: number;
	days: number;
	longestStreak: number;
	longest: Ride | null;
}

export function summarize(rides: Ride[]): Summary {
	const days = [...new Set(rides.map(ride => dateKey(ride.start)))].sort();
	let longestStreak = 0;
	let streak = 0;
	let previous: Date | null = null;
	for (const day of days) {
		const date = parseDateKey(day)!;
		streak = previous && dateKey(addDays(previous, 1)) === day ? streak + 1 : 1;
		longestStreak = Math.max(longestStreak, streak);
		previous = date;
	}
	return {
		count: rides.length,
		seconds: rides.reduce((sum, ride) => sum + ride.seconds, 0),
		cost: rides.reduce((sum, ride) => sum + ride.cost, 0),
		freeCount: rides.filter(ride => ride.cost === 0).length,
		days: days.length,
		longestStreak,
		longest: rides.reduce<Ride | null>((best, ride) => (!best || ride.seconds > best.seconds ? ride : best), null)
	};
}

// ---------- trend ----------

export type Metric = "count" | "minutes" | "cost";
export type Bucket = "day" | "week" | "month";

export interface TrendPoint {
	key: string;
	label: string;
	start: Date;
	count: number;
	minutes: number;
	cost: number;
}

export const earliestStart = (rides: Ride[]) => rides.reduce<Date | null>((min, ride) => (!min || ride.start < min ? ride.start : min), null);

/**
 * Days for up to two months, weeks up to half a year, months beyond. The axis starts at `range.from`, or at the
 * account's first ride (`earliest`) when the range reaches back before it.
 */
export function trend(rides: Ride[], range: Range, earliest: Date | null, now = new Date()): { bucket: Bucket; points: TrendPoint[] } {
	const first = (range.from && (!earliest || range.from > earliest) ? range.from : earliest) ?? startOfDay(now);
	const end = range.to ?? addDays(startOfDay(now), 1);
	const days = Math.max(1, Math.round((end.getTime() - startOfDay(first).getTime()) / 86_400_000));
	const bucket: Bucket = days <= 62 ? "day" : days <= 183 ? "week" : "month";
	const bucketStart = (date: Date) => (bucket === "day" ? startOfDay(date) : bucket === "week" ? startOfWeek(date) : new Date(date.getFullYear(), date.getMonth(), 1));
	const next = (date: Date) => (bucket === "day" ? addDays(date, 1) : bucket === "week" ? addDays(date, 7) : new Date(date.getFullYear(), date.getMonth() + 1, 1));

	const points: TrendPoint[] = [];
	const byKey = new Map<string, TrendPoint>();
	const spansYears = first.getFullYear() !== addDays(end, -1).getFullYear();
	for (let cursor = bucketStart(first); cursor < end; cursor = next(cursor)) {
		const label =
			bucket === "month"
				? cursor.getMonth() === 0 || (spansYears && points.length === 0)
					? `${cursor.getFullYear()}/${cursor.getMonth() + 1}`
					: `${cursor.getMonth() + 1}月`
				: `${cursor.getMonth() + 1}/${cursor.getDate()}`;
		const point = { key: dateKey(cursor), label, start: cursor, count: 0, minutes: 0, cost: 0 };
		points.push(point);
		byKey.set(point.key, point);
	}
	for (const ride of rides) {
		const point = byKey.get(dateKey(bucketStart(ride.start)));
		if (!point) continue;
		point.count += 1;
		point.minutes += ride.seconds / 60;
		point.cost += ride.cost;
	}
	for (const point of points) point.minutes = Math.round(point.minutes * 10) / 10;
	return { bucket, points };
}

// ---------- when ----------

export const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

/** Rides per weekday (Monday first) and hour of day. */
export function weekHourGrid(rides: Ride[]) {
	const grid = weekdays.map(() => Array.from({ length: 24 }, () => 0));
	for (const ride of rides) grid[(ride.start.getDay() + 6) % 7]![ride.start.getHours()]! += 1;
	return grid;
}

// ---------- durations ----------

const durationBuckets = [
	{ label: "< 30 秒", max: 30 },
	{ label: "30–60 秒", max: 60 },
	{ label: "1–2 分", max: 120 },
	{ label: "2–5 分", max: 300 },
	{ label: "5–10 分", max: 600 },
	{ label: "10–20 分", max: 1200 },
	{ label: "20–40 分", max: 2400 },
	{ label: "40 分以上", max: Number.POSITIVE_INFINITY }
];

export function durationHistogram(rides: Ride[]) {
	const counts = durationBuckets.map(bucket => ({ label: bucket.label, count: 0, cost: 0 }));
	for (const ride of rides) {
		const index = durationBuckets.findIndex(bucket => ride.seconds < bucket.max);
		counts[index]!.count += 1;
		counts[index]!.cost += ride.cost;
	}
	return counts;
}

// ---------- routes and stations ----------

export interface RouteStats {
	from: string;
	to: string;
	count: number;
	averageSeconds: number;
	medianSeconds: number;
	fastestSeconds: number;
	slowestSeconds: number;
	averageCost: number;
	rides: Ride[];
}

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

export function routeStats(rides: Ride[], from: string, to: string): RouteStats | null {
	const matching = rides.filter(ride => ride.from === from && ride.to === to);
	if (matching.length === 0) return null;
	const seconds = matching.map(ride => ride.seconds);
	return {
		from,
		to,
		count: matching.length,
		averageSeconds: seconds.reduce((sum, value) => sum + value, 0) / matching.length,
		medianSeconds: median(seconds),
		fastestSeconds: Math.min(...seconds),
		slowestSeconds: Math.max(...seconds),
		averageCost: matching.reduce((sum, ride) => sum + ride.cost, 0) / matching.length,
		rides: [...matching].sort((a, b) => b.start.getTime() - a.start.getTime())
	};
}

/** Routes by how often they were ridden; same-station returns count as their own route. */
export function topRoutes(rides: Ride[], limit = 8) {
	const counts = new Map<string, { from: string; to: string; count: number }>();
	for (const ride of rides) {
		const key = `${ride.from}\u0000${ride.to}`;
		const entry = counts.get(key) ?? { from: ride.from, to: ride.to, count: 0 };
		entry.count += 1;
		counts.set(key, entry);
	}
	return [...counts.values()]
		.sort((a, b) => b.count - a.count)
		.slice(0, limit)
		.map(entry => routeStats(rides, entry.from, entry.to)!);
}

export function topCounts(values: string[], limit = 6) {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()]
		.map(([label, count]) => ({ label, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, limit);
}
