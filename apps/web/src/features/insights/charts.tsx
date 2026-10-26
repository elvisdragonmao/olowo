import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Width of an element, tracked so SVG text stays at its real size instead of scaling with a viewBox. */
function useWidth<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
		observer.observe(element);
		setWidth(Math.floor(element.getBoundingClientRect().width));
		return () => observer.disconnect();
	}, []);
	return [ref, width] as const;
}

/** Clean axis steps: 1, 2 or 5 × 10ⁿ, about three of them. */
function niceTicks(max: number, count = 3) {
	if (max <= 0) return [0, 1];
	const raw = max / count;
	const power = 10 ** Math.floor(Math.log10(raw));
	const step = ([1, 2, 5, 10].find(multiple => multiple * power >= raw) ?? 10) * power;
	const ticks: number[] = [];
	for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(Math.round(value * 1000) / 1000);
	if (ticks.at(-1)! < max) ticks.push(ticks.at(-1)! + step);
	return ticks;
}

export const compact = (value: number) =>
	value >= 10_000 ? `${Math.round(value / 1000)}K` : value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(Math.round(value * 10) / 10);

interface Tip {
	x: number;
	y: number;
	value: string;
	label: string;
}

function Tooltip({ tip }: { tip: Tip | null }) {
	if (!tip) return null;
	return (
		<div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
			<strong>{tip.value}</strong>
			<span>{tip.label}</span>
		</div>
	);
}

export interface Column {
	key: string;
	label: string;
	value: number;
	/** The tooltip's secondary line, e.g. the full date. */
	detail: string;
}

/**
 * One series of columns from a single baseline: ≤ 24 px thick, 4 px rounded caps, hairline grid, the tallest
 * column labelled on its cap and every column readable on hover or focus.
 */
export function ColumnChart({ data, format, height = 200, label }: { data: Column[]; format: (value: number) => string; height?: number; label: string }) {
	const [ref, width] = useWidth<HTMLDivElement>();
	const [tip, setTip] = useState<Tip | null>(null);
	const [active, setActive] = useState<string | null>(null);
	const max = Math.max(0, ...data.map(column => column.value));
	const ticks = niceTicks(max);
	const top = ticks.at(-1)!;
	const left = 36;
	const right = 8;
	const padTop = 20;
	const padBottom = 24;
	const plotWidth = Math.max(0, width - left - right);
	const plotHeight = height - padTop - padBottom;
	const band = data.length ? plotWidth / data.length : 0;
	const barWidth = Math.max(2, Math.min(24, band - 2));
	const y = (value: number) => padTop + plotHeight - (top ? (value / top) * plotHeight : 0);
	const labelEvery = Math.max(1, Math.ceil((data.length * 44) / Math.max(1, plotWidth)));
	const peak = data.reduce<Column | null>((best, column) => (column.value > 0 && (!best || column.value > best.value) ? column : best), null);

	const show = (column: Column, index: number) => {
		setActive(column.key);
		setTip({ x: left + band * index + band / 2, y: y(column.value), value: format(column.value), label: column.detail });
	};
	const hide = () => (setActive(null), setTip(null));

	return (
		<div ref={ref} className="chart" onPointerLeave={hide}>
			{width > 0 ? (
				<svg width={width} height={height} role="img" aria-label={label}>
					{ticks.map(tick => (
						<g key={tick}>
							<line className="chart-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
							<text className="chart-axis" x={left - 6} y={y(tick)} dy="0.32em" textAnchor="end">
								{compact(tick)}
							</text>
						</g>
					))}
					{data.map((column, index) => {
						const x = left + band * index + (band - barWidth) / 2;
						const barHeight = Math.max(0, padTop + plotHeight - y(column.value));
						const radius = Math.min(4, barHeight, barWidth / 2);
						const base = padTop + plotHeight;
						return (
							<g key={column.key}>
								{barHeight > 0 ? (
									<path
										className="chart-bar"
										data-active={active === column.key}
										d={`M${x},${base} V${base - barHeight + radius} Q${x},${base - barHeight} ${x + radius},${base - barHeight} H${x + barWidth - radius} Q${x + barWidth},${base - barHeight} ${x + barWidth},${base - barHeight + radius} V${base} Z`}
									/>
								) : null}
								<rect
									className="chart-hit"
									x={left + band * index}
									y={padTop}
									width={band}
									height={plotHeight}
									tabIndex={0}
									aria-label={`${column.detail}：${format(column.value)}`}
									onPointerEnter={() => show(column, index)}
									onFocus={() => show(column, index)}
									onBlur={hide}
								/>
								{index % labelEvery === 0 ? (
									<text className="chart-axis" x={left + band * index + band / 2} y={height - 6} textAnchor="middle">
										{column.label}
									</text>
								) : null}
								{peak?.key === column.key ? (
									<text className="chart-value" x={left + band * index + band / 2} y={y(column.value) - 6} textAnchor="middle">
										{format(column.value)}
									</text>
								) : null}
							</g>
						);
					})}
				</svg>
			) : (
				<div style={{ height }} />
			)}
			<Tooltip tip={tip} />
		</div>
	);
}

/** Weekday × hour counts on one sequential hue; empty cells sit at the surface. */
export function Heatmap({ rows, columns, values, describe }: { rows: string[]; columns: number; values: number[][]; describe: (row: number, column: number, value: number) => string }) {
	const max = Math.max(1, ...values.flat());
	const [tip, setTip] = useState<Tip | null>(null);
	const ref = useRef<HTMLDivElement>(null);
	const show = (target: HTMLElement, row: number, column: number) => {
		const box = ref.current!.getBoundingClientRect();
		const cell = target.getBoundingClientRect();
		const value = values[row]![column]!;
		setTip({ x: cell.left - box.left + cell.width / 2, y: cell.top - box.top, value: `${value} 趟`, label: describe(row, column, value) });
	};
	return (
		<div ref={ref} className="chart heatmap" onPointerLeave={() => setTip(null)}>
			<div className="heatmap-grid" style={{ gridTemplateColumns: `20px repeat(${columns}, minmax(0, 1fr))` }}>
				{rows.map((row, rowIndex) => (
					<div key={row} className="heatmap-row" style={{ display: "contents" }}>
						<span className="chart-axis heatmap-label">{row}</span>
						{values[rowIndex]!.map((value, column) => (
							<span
								key={column}
								className="heatmap-cell"
								style={{ "--level": value ? 0.18 + 0.82 * (value / max) : 0 } as CSSProperties}
								tabIndex={0}
								aria-label={`${describe(rowIndex, column, value)}：${value} 趟`}
								onPointerEnter={event => show(event.currentTarget, rowIndex, column)}
								onFocus={event => show(event.currentTarget, rowIndex, column)}
								onBlur={() => setTip(null)}
							/>
						))}
					</div>
				))}
				<span />
				{Array.from({ length: columns }, (_, column) => (
					<span key={column} className="chart-axis heatmap-hour">
						{column % 3 === 0 ? column : ""}
					</span>
				))}
			</div>
			<div className="heatmap-scale" aria-hidden>
				<span>少</span>
				{[0.18, 0.45, 0.72, 1].map(level => (
					<i key={level} style={{ "--level": level } as CSSProperties} />
				))}
				<span>多</span>
			</div>
			<Tooltip tip={tip} />
		</div>
	);
}

/** Ranked rows with the value written out; the bar is a quiet length cue beside it. */
export function BarList({ items, format, empty }: { items: Array<{ key: string; label: ReactNode; value: number; note?: string }>; format: (value: number) => string; empty: string }) {
	if (items.length === 0) return <p className="muted small">{empty}</p>;
	const max = Math.max(...items.map(item => item.value));
	return (
		<ol className="bar-list">
			{items.map(item => (
				<li key={item.key}>
					<div className="bar-list-text">
						<span>{item.label}</span>
						<strong>{format(item.value)}</strong>
					</div>
					<div className="bar-list-track" aria-hidden>
						<i style={{ width: `${(item.value / max) * 100}%` }} />
					</div>
					{item.note ? <p className="bar-list-note">{item.note}</p> : null}
				</li>
			))}
		</ol>
	);
}

/** A chart's numbers as a table, so nothing depends on hovering. */
export function DataTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
	return (
		<details className="chart-table">
			<summary>看數據</summary>
			<div className="chart-table-scroll">
				<table>
					<thead>
						<tr>
							{head.map(cell => (
								<th key={cell} scope="col">
									{cell}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row, index) => (
							<tr key={index}>
								{row.map((cell, column) => (
									<td key={column}>{cell}</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</details>
	);
}
