import { useDrag } from "@use-gesture/react";
import { animate, motion, useMotionValue } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useUiStore, type Snap } from "./useUiStore";

const desktopQuery = "(min-width: 920px)";
const spring = { type: "spring", stiffness: 420, damping: 42, mass: 0.9 } as const;

export function useIsDesktop() {
	const [desktop, setDesktop] = useState(() => window.matchMedia(desktopQuery).matches);
	useEffect(() => {
		const media = window.matchMedia(desktopQuery);
		const onChange = () => setDesktop(media.matches);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);
	return desktop;
}

function useSheetMetrics() {
	const probe = useRef<HTMLDivElement>(null);
	const [metrics, setMetrics] = useState({ viewport: window.innerHeight, safeTop: 0, safeBottom: 0 });
	useLayoutEffect(() => {
		const measure = () => {
			const style = probe.current ? getComputedStyle(probe.current) : null;
			setMetrics({ viewport: window.innerHeight, safeTop: parseFloat(style?.paddingTop ?? "0") || 0, safeBottom: parseFloat(style?.paddingBottom ?? "0") || 0 });
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, []);
	const full = metrics.viewport - metrics.safeTop - 68;
	const heights: Record<Snap, number> = {
		peek: Math.min(full, 128 + metrics.safeBottom),
		half: Math.min(full, Math.max(320, Math.round(metrics.viewport * 0.48))),
		full
	};
	return { probe, full, heights };
}

export function Panel({ children, dock, brand }: { children: ReactNode; dock?: ReactNode; brand?: ReactNode }) {
	const desktop = useIsDesktop();
	if (desktop) {
		return (
			<aside className="panel panel-desktop" aria-label="站點與車輛">
				{brand}
				{dock}
				<div className="panel-scroll">{children}</div>
			</aside>
		);
	}
	return (
		<Sheet dock={dock}>
			<div className="panel-scroll">{children}</div>
		</Sheet>
	);
}

function Sheet({ children, dock }: { children: ReactNode; dock?: ReactNode }) {
	const snap = useUiStore(state => state.snap);
	const setSnap = useUiStore(state => state.setSnap);
	const setSheetVisibleHeight = useUiStore(state => state.setSheetVisibleHeight);
	const { probe, full, heights } = useSheetMetrics();
	const sheetRef = useRef<HTMLDivElement>(null);
	const y = useMotionValue(full - heights[snap]);

	useEffect(() => {
		const controls = animate(y, full - heights[snap], spring);
		setSheetVisibleHeight(heights[snap]);
		return () => controls.stop();
	}, [full, heights[snap], setSheetVisibleHeight, snap, y]);

	const settle = (offset: number, velocity: number) => {
		const projected = full - (offset + velocity * 160);
		const order: Snap[] = ["peek", "half", "full"];
		const next = order.reduce((best, candidate) => (Math.abs(heights[candidate] - projected) < Math.abs(heights[best] - projected) ? candidate : best), order[0]!);
		if (next === snap) void animate(y, full - heights[next], spring);
		else setSnap(next);
	};

	const bind = useDrag(
		({ first, last, tap, event, movement: [, my], velocity: [, vy], direction: [, dy], memo, cancel }) => {
			if (first) {
				const target = event.target as HTMLElement;
				const scroller = sheetRef.current?.querySelector<HTMLElement>(".panel-scroll");
				const fromHandle = target.closest("[data-sheet-drag]") != null && target.closest("input, textarea") == null;
				const fromContentTop = dy > 0 && (scroller?.scrollTop ?? 0) <= 0;
				if (snap === "full" && !fromHandle && !fromContentTop) {
					cancel();
					return;
				}
			}
			const start = (memo as number | undefined) ?? y.get();
			if (tap) return start;
			const max = full - heights.peek;
			const raw = start + my;
			const next = raw < 0 ? -Math.sqrt(-raw) : raw > max ? max + Math.sqrt(raw - max) : raw;
			// use-gesture swallows the click that ends a real drag, so rows under the finger stay inert.
			if (last) settle(Math.min(max, Math.max(0, next)), vy * dy);
			else y.set(next);
			return start;
		},
		{ axis: "y", filterTaps: true, threshold: 6 }
	);

	return (
		<>
			<div ref={probe} className="safe-area-probe" aria-hidden />
			<motion.section ref={sheetRef} className="panel panel-sheet" data-snap={snap} style={{ y, height: full }} aria-label="站點與車輛">
				{dock ? <div className="sheet-dock">{dock}</div> : null}
				<div className="sheet-body" {...bind()}>
					<button
						type="button"
						className="sheet-handle"
						data-sheet-drag
						aria-label={snap === "full" ? "收合面板" : "展開面板"}
						onClick={() => setSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "half")}
					/>
					{children}
				</div>
			</motion.section>
		</>
	);
}
