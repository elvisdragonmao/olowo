import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css";

// 騎乘分析 is its own page without the map, so it loads none of it.
const InsightsPage = lazy(() => import("./features/insights/InsightsPage"));
const insights = window.location.pathname.replace(/\/+$/, "") === "/insights";

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		{insights ? (
			<Suspense fallback={null}>
				<InsightsPage />
			</Suspense>
		) : (
			<App />
		)}
	</React.StrictMode>
);
