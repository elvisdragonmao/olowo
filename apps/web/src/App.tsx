import { Crosshair, QrCode, User } from "@phosphor-icons/react";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { motion } from "motion/react";
import { lazy, Suspense, useEffect } from "react";
import { Panel } from "./app/Panel";
import { installHistorySync, useUiStore, type View } from "./app/useUiStore";
import { AccountView } from "./features/auth/AccountView";
import { SignInView } from "./features/auth/SignInView";
import { useSession } from "./features/auth/useSession";
import { useNeedsSignIn } from "./features/fleet/useFleetQuery";
import { resumeGrantedLocation, useLocationStore } from "./features/location/useLocationStore";
import { RideDock } from "./features/ride/RideDock";
import { CheckoutView } from "./features/ride/CheckoutView";
import { RideView } from "./features/ride/RideView";
import { ScooterView } from "./features/scooter/ScooterView";
import { NearbyView } from "./features/stations/NearbyView";
import { ScanView } from "./features/scan/ScanView";
import { StationView } from "./features/stations/StationView";
import { ApiError } from "./shared/api";

const MapCanvas = lazy(() => import("./features/map/MapCanvas"));

const queryClient: QueryClient = new QueryClient({
	defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false } },
	queryCache: new QueryCache({
		onError: error => {
			// The API drops the session when oloo rejects the credential; reflect that everywhere at once.
			if (error instanceof ApiError && error.status === 401) queryClient.setQueryData(["auth", "session"], { authenticated: false });
		}
	})
});

function viewKey(view: View, needsSignIn: boolean) {
	if (needsSignIn && (view.kind === "nearby" || view.kind === "station" || view.kind === "scooter" || view.kind === "scan")) return "sign-in";
	if (view.kind === "station") return `station:${view.stationId}`;
	if (view.kind === "scooter") return `scooter:${view.scooterId}`;
	return view.kind;
}

function ViewContent({ view }: { view: View }) {
	const needsSignIn = useNeedsSignIn();
	if (needsSignIn && (view.kind === "nearby" || view.kind === "station" || view.kind === "scooter" || view.kind === "scan")) return <SignInView />;
	if (view.kind === "station") return <StationView stationId={view.stationId} />;
	if (view.kind === "scooter") return <ScooterView stationId={view.stationId} scooterId={view.scooterId} />;
	if (view.kind === "ride") return <RideView />;
	if (view.kind === "checkout") return <CheckoutView />;
	if (view.kind === "scan") return <ScanView />;
	if (view.kind === "account") return <AccountView />;
	return <NearbyView />;
}

function Wordmark() {
	return (
		<span className="wordmark" aria-label="olowo">
			ol<span>owo</span>
		</span>
	);
}

function AccountButton() {
	const session = useSession();
	const navigate = useUiStore(state => state.navigate);
	const email = session.data?.authenticated ? session.data.email : null;
	return (
		<button type="button" className="icon-button icon-button-float" aria-label={email ? `帳號 ${email}` : "帳號與登入"} onClick={() => navigate({ kind: "account" })}>
			{email ? <span className="avatar avatar-small">{email.slice(0, 1).toUpperCase()}</span> : <User size={18} weight="bold" />}
		</button>
	);
}

function ScanButton() {
	const navigate = useUiStore(state => state.navigate);
	return (
		<button type="button" className="scan-button" onClick={() => navigate({ kind: "scan" })}>
			<QrCode size={18} weight="bold" aria-hidden />
			掃碼借車
		</button>
	);
}

function LocateButton() {
	const status = useLocationStore(state => state.status);
	const start = useLocationStore(state => state.start);
	return (
		<button
			type="button"
			className="icon-button icon-button-float"
			data-active={status === "watching"}
			aria-label={status === "denied" ? "定位權限被拒絕" : "移到我的位置"}
			title={status === "denied" ? "請在瀏覽器設定允許定位" : undefined}
			onClick={() => start(true)}
		>
			<Crosshair size={18} weight={status === "watching" ? "fill" : "bold"} />
		</button>
	);
}

function Shell() {
	const view = useUiStore(state => state.view);
	const needsSignIn = useNeedsSignIn();
	useEffect(() => installHistorySync(), []);
	useEffect(() => {
		void resumeGrantedLocation();
		if (import.meta.env.PROD && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
	}, []);

	return (
		<div className="app">
			<Suspense fallback={<div className="map-canvas map-loading" />}>
				<MapCanvas />
			</Suspense>
			<header className="top-bar">
				<span className="brand-chip">
					<Wordmark />
				</span>
				<div className="top-bar-actions">
					<ScanButton />
					<LocateButton />
					<AccountButton />
				</div>
			</header>
			<Panel
				dock={<RideDock />}
				brand={
					<div className="panel-brand">
						<Wordmark />
						<div className="panel-brand-actions">
							<ScanButton />
							<AccountButton />
						</div>
					</div>
				}
			>
				<motion.div key={viewKey(view, needsSignIn)} className="view" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
					<ViewContent view={view} />
				</motion.div>
			</Panel>
			<div className="map-controls">
				<LocateButton />
			</div>
		</div>
	);
}

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<Shell />
		</QueryClientProvider>
	);
}
