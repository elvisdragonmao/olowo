import type { Availability } from "../fleet/model";

export function BatteryRing({ percent, availability, size = 40 }: { percent: number; availability: Availability; size?: number }) {
	const stroke = 3;
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	return (
		<span className="battery-ring" data-tone={availability} style={{ width: size, height: size }}>
			<svg viewBox={`0 0 ${size} ${size}`} aria-hidden>
				<circle className="battery-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
				<circle
					className="battery-ring-value"
					cx={size / 2}
					cy={size / 2}
					r={radius}
					strokeWidth={stroke}
					strokeDasharray={`${(circumference * percent) / 100} ${circumference}`}
					transform={`rotate(-90 ${size / 2} ${size / 2})`}
				/>
			</svg>
			<span className="battery-ring-label">{percent}</span>
		</span>
	);
}

/** Stacked available / low battery / out-of-service bar against total docks. */
export function DockBar({ available, lowBattery, unavailable, capacity }: { available: number; lowBattery: number; unavailable: number; capacity: number }) {
	const total = Math.max(capacity, available + lowBattery + unavailable, 1);
	return (
		<span className="dock-bar" aria-hidden>
			<span data-tone="available" style={{ width: `${(available / total) * 100}%` }} />
			<span data-tone="low_battery" style={{ width: `${(lowBattery / total) * 100}%` }} />
			<span data-tone="unavailable" style={{ width: `${(unavailable / total) * 100}%` }} />
		</span>
	);
}

/** The three numbers riders ask first, shared by the campus overview and a single station. */
export function StatStrip({ available, lowBattery, outOfService, label }: { available: number; lowBattery: number; outOfService: number; label: string }) {
	return (
		<dl className="stat-strip" aria-label={label}>
			<div data-tone="available">
				<dt>可借</dt>
				<dd>{available}</dd>
			</div>
			<div data-tone="low_battery">
				<dt>沒電</dt>
				<dd>{lowBattery}</dd>
			</div>
			<div data-tone="unavailable">
				<dt>故障</dt>
				<dd>{outOfService}</dd>
			</div>
		</dl>
	);
}
