export function clock(totalSeconds: number) {
	const safe = Math.max(0, Math.floor(totalSeconds));
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const seconds = String(safe % 60).padStart(2, "0");
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${String(minutes).padStart(2, "0")}:${seconds}`;
}

export function durationLabel(seconds: number) {
	if (seconds < 60) return `${seconds} 秒`;
	if (seconds % 60 === 0) return `${seconds / 60} 分`;
	return clock(seconds).replace(/^0/, "");
}

/** Parses `ss`, `m:ss` or `h:mm:ss` into seconds. */
export function parseDuration(value: string) {
	const parts = value
		.trim()
		.split(":")
		.map(part => (part.trim() === "" ? Number.NaN : Number(part)));
	if (parts.length === 0 || parts.length > 3 || parts.some(part => !Number.isInteger(part) || part < 0)) return null;
	const seconds = parts.reduce((total, part) => total * 60 + part, 0);
	return parts.slice(1).every(part => part < 60) ? seconds : null;
}

export function relativeTime(iso: string | null | undefined, now = Date.now()) {
	if (!iso) return "時間未知";
	const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
	if (seconds < 10) return "剛剛";
	if (seconds < 60) return `${seconds} 秒前`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)} 分鐘前`;
	return `${Math.floor(seconds / 3600)} 小時前`;
}

export function timeOfDay(iso: string) {
	return new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function distanceLabel(meters: number) {
	return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}
