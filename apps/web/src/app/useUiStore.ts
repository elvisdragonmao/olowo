import { create } from "zustand";

export type View =
	| { kind: "nearby" }
	| { kind: "station"; stationId: number }
	| { kind: "scooter"; stationId: number; scooterId: number }
	| { kind: "ride" }
	| { kind: "checkout" }
	| { kind: "scan" }
	| { kind: "account" }
	| { kind: "history" }
	| { kind: "plans" }
	| { kind: "coupons" };

export type Snap = "peek" | "half" | "full";

interface HistoryEntry {
	olowo: true;
	view: View;
	depth: number;
}

interface UiState {
	view: View;
	/** How many entries this session pushed; `back` falls back to home when zero. */
	depth: number;
	snap: Snap;
	sheetVisibleHeight: number;
	query: string;
	mapCenter: { latitude: number; longitude: number };
	/** A one-shot camera request, e.g. "show this campus"; `seq` lets the same bounds be requested twice. */
	focusRequest: { bounds: [[number, number], [number, number]]; seq: number } | null;
	navigate: (view: View, options?: { replace?: boolean }) => void;
	back: () => void;
	setSnap: (snap: Snap) => void;
	setSheetVisibleHeight: (height: number) => void;
	setQuery: (query: string) => void;
	setMapCenter: (center: { latitude: number; longitude: number }) => void;
	focusBounds: (bounds: [[number, number], [number, number]]) => void;
}

export const campusCenter = { latitude: 24.7882, longitude: 120.9975 };

function viewToUrl(view: View) {
	const params = new URLSearchParams();
	if (view.kind === "station" || view.kind === "scooter") params.set("station", String(view.stationId));
	if (view.kind === "scooter") params.set("scooter", String(view.scooterId));
	if (pageViews.has(view.kind)) params.set("view", view.kind);
	const search = params.toString();
	return `${window.location.pathname}${search ? `?${search}` : ""}`;
}

function positiveInt(value: string | null) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const pageViews = new Set<string>(["ride", "checkout", "scan", "account", "history", "plans", "coupons"]);

export function viewFromUrl(search = window.location.search): View {
	const params = new URLSearchParams(search);
	const stationId = positiveInt(params.get("station"));
	const scooterId = positiveInt(params.get("scooter"));
	if (stationId != null && scooterId != null) return { kind: "scooter", stationId, scooterId };
	if (stationId != null) return { kind: "station", stationId };
	const page = params.get("view");
	if (page && pageViews.has(page)) return { kind: page } as View;
	return { kind: "nearby" };
}

// Detail views open at half height so the map context stays visible; the login form gets the full sheet.
function preferredSnap(view: View, current: Snap): Snap {
	if (view.kind === "account" || view.kind === "checkout" || view.kind === "scan" || view.kind === "history" || view.kind === "plans" || view.kind === "coupons") return "full";
	if (view.kind === "nearby") return current === "peek" ? "peek" : "half";
	return "half";
}

const initialView = viewFromUrl();

export const useUiStore = create<UiState>((set, get) => ({
	view: initialView,
	depth: 0,
	snap: initialView.kind === "nearby" ? "half" : preferredSnap(initialView, "half"),
	sheetVisibleHeight: 0,
	query: "",
	mapCenter: campusCenter,
	focusRequest: null,
	navigate(view, options) {
		const { depth, snap } = get();
		const nextDepth = options?.replace ? depth : depth + 1;
		const entry: HistoryEntry = { olowo: true, view, depth: nextDepth };
		if (options?.replace) window.history.replaceState(entry, "", viewToUrl(view));
		else window.history.pushState(entry, "", viewToUrl(view));
		set({ view, depth: nextDepth, snap: preferredSnap(view, snap) });
	},
	back() {
		const { depth, view } = get();
		if (depth > 0) {
			window.history.back();
			return;
		}
		const parent: View = view.kind === "scooter" ? { kind: "station", stationId: view.stationId } : { kind: "nearby" };
		get().navigate(parent, { replace: true });
	},
	setSnap: snap => set({ snap }),
	setSheetVisibleHeight: sheetVisibleHeight => set({ sheetVisibleHeight }),
	setQuery: query => set({ query }),
	setMapCenter: mapCenter => set({ mapCenter }),
	focusBounds: bounds => set(state => ({ focusRequest: { bounds, seq: (state.focusRequest?.seq ?? 0) + 1 } }))
}));

export function installHistorySync() {
	window.history.replaceState({ olowo: true, view: initialView, depth: 0 } satisfies HistoryEntry, "", window.location.href);
	const onPopState = (event: PopStateEvent) => {
		const entry = event.state as Partial<HistoryEntry> | null;
		const view = entry?.olowo && entry.view ? entry.view : viewFromUrl();
		useUiStore.setState(state => ({ view, depth: entry?.depth ?? 0, snap: preferredSnap(view, state.snap) }));
	};
	window.addEventListener("popstate", onPopState);
	return () => window.removeEventListener("popstate", onPopState);
}
