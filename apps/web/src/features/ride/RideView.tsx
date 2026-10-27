import { ArrowLeft, Pause, Play, Power } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useUiStore } from "../../app/useUiStore";
import { apiRequest, idempotencyKey } from "../../shared/api";
import { clock, durationLabel, timeOfDay } from "../../shared/format";
import { useLocationStore } from "../location/useLocationStore";
import { automationLabels, defaultTimerSeconds, TimerControl, type AutomationAction } from "./automation";
import { useCurrentRide, useNow, type ActiveRide } from "./useCurrentRide";
import { useUnpaidRide } from "./useUnpaidRide";

type Automation = {
	id: string;
	rideId: number;
	action: AutomationAction | "notify";
	triggerAt: string;
	state: "scheduled" | "running" | "due" | "completed" | "failed" | "cancelled";
	error?: string;
};
type Estimate = { cost: number; ridingMinutes: number; parkedMinutes: number; ratePerMinute: number | null };

export function RideView() {
	const back = useUiStore(state => state.back);
	const navigate = useUiStore(state => state.navigate);
	const ride = useCurrentRide();
	const unpaid = useUnpaidRide();
	// A ride the server returned on a timer lands on checkout like a manual return does.
	const waitingForCheckout = !ride.isPending && !ride.data && unpaid.data != null;
	useEffect(() => {
		if (waitingForCheckout) navigate({ kind: "checkout" }, { replace: true });
	}, [waitingForCheckout, navigate]);
	return (
		<>
			<header className="view-head" data-sheet-drag>
				<button type="button" className="icon-button" aria-label="返回" onClick={back}>
					<ArrowLeft size={18} weight="bold" />
				</button>
				<div className="view-head-title">
					<h2>{ride.data ? "騎乘中" : "目前騎乘"}</h2>
					{ride.data ? <p className="plate-inline">{ride.data.label}</p> : null}
				</div>
			</header>
			<div className="view-body">
				{ride.data ? (
					<RideDetail key={ride.data.id} ride={ride.data} />
				) : (
					<div className="empty-state">
						<p>{ride.isPending ? "讀取騎乘狀態…" : "目前沒有進行中的騎乘。"}</p>
					</div>
				)}
			</div>
		</>
	);
}

function RideDetail({ ride }: { ride: ActiveRide }) {
	const queryClient = useQueryClient();
	const navigate = useUiStore(state => state.navigate);
	const now = useNow();
	const startedAt = Date.parse(ride.startedAt);
	const elapsed = Math.max(0, (now - startedAt) / 1000);

	const estimate = useQuery({
		queryKey: ["ride", ride.id, "estimate"],
		queryFn: () => apiRequest<{ estimate: Estimate }>(`/v1/rides/${ride.id}/estimate`),
		select: data => data.estimate,
		refetchInterval: 15_000,
		retry: false
	});
	const automation = useQuery({
		queryKey: ["ride", ride.id, "automation"],
		queryFn: () => apiRequest<{ automation: Automation | null }>(`/v1/rides/${ride.id}/automation`),
		select: data => data.automation,
		refetchInterval: query => (["scheduled", "running"].includes(query.state.data?.automation?.state ?? "") ? 2_000 : 10_000),
		retry: false
	});
	const task = automation.data ?? null;
	const finished = task?.state === "completed" || task?.state === "failed";
	useEffect(() => {
		if (finished) void queryClient.invalidateQueries({ queryKey: ["ride"] });
	}, [finished, queryClient]);
	const scheduled = task?.state === "scheduled" && task.action !== "notify" ? task : null;
	const scheduledSeconds = scheduled ? Math.round((Date.parse(scheduled.triggerAt) - startedAt) / 1000) : null;
	// The picker remembers the last duration even while no timer is set.
	const [pickedSeconds, setPickedSeconds] = useState(defaultTimerSeconds);
	const seconds = scheduledSeconds ?? pickedSeconds;

	const schedule = useMutation({
		mutationFn: (next: { action: AutomationAction | null; seconds: number }): Promise<{ automation: Automation | null }> =>
			next.action
				? apiRequest<{ automation: Automation }>(`/v1/rides/${ride.id}/automation`, { method: "PUT", body: JSON.stringify({ action: next.action, afterRideSeconds: next.seconds }) })
				: apiRequest(`/v1/rides/${ride.id}/automation`, { method: "DELETE" }).then(() => ({ automation: null })),
		onSuccess: data => queryClient.setQueryData(["ride", ride.id, "automation"], data)
	});
	const position = useLocationStore(state => state.position);
	// The phone's location prices the return like the official app; without it the API uses the scooter's own GPS.
	const returnRide = useMutation({
		mutationFn: () =>
			apiRequest(`/v1/rides/${ride.id}/return`, {
				method: "POST",
				headers: { "idempotency-key": idempotencyKey() },
				body: JSON.stringify({ scooterId: ride.scooterId, ...(position ? { latitude: position.latitude, longitude: position.longitude } : {}) })
			}),
		onSuccess: () => {
			navigate({ kind: "checkout" }, { replace: true });
			void Promise.all(["ride", "fleet"].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
		}
	});

	const change = (next: { action: AutomationAction | null; seconds: number }) => {
		setPickedSeconds(next.seconds);
		// Changing only the duration while no timer is set just remembers it.
		if (next.action || scheduled) schedule.mutate(next);
	};
	const tooLate = scheduled == null && seconds <= elapsed + 10;

	return (
		<>
			<section className="ride-hero">
				<span className="hero-number hero-clock">{clock(elapsed)}</span>
				<span className="hero-caption">
					開始於 {timeOfDay(ride.startedAt)} · {estimate.data ? `預估 $${estimate.data.cost}` : `目前 $${ride.cost ?? 0}`}
					{estimate.data?.ratePerMinute != null ? ` · 每分 $${estimate.data.ratePerMinute}` : ""}
				</span>
			</section>

			<EngineControl ride={ride} />

			<section className="section">
				<h3 className="section-title">騎乘計時</h3>
				<TimerControl
					// Remount when the server's duration arrives so a custom value shows in the custom field.
					key={scheduledSeconds ?? "none"}
					action={scheduled ? (scheduled.action as AutomationAction) : null}
					seconds={seconds}
					onChange={change}
					disabled={schedule.isPending || task?.state === "running"}
				/>
				{task && task.state !== "cancelled" && task.action !== "notify" ? (
					<div className="status-card" data-state={task.state} aria-live="polite">
						<div>
							<strong>
								{task.state === "scheduled"
									? `騎乘滿 ${durationLabel(scheduledSeconds ?? 0)} 時${automationLabels[task.action]} · 還有 ${clock((Date.parse(task.triggerAt) - now) / 1000)}`
									: task.state === "running"
										? `${automationLabels[task.action]}執行中…`
										: task.state === "completed"
											? `${automationLabels[task.action]}已執行`
											: `${automationLabels[task.action]}失敗`}
							</strong>
							<span>{task.error ?? `預定 ${new Date(task.triggerAt).toLocaleTimeString("zh-TW", { hour12: false })}，由伺服器執行，關掉網頁也會跑`}</span>
						</div>
					</div>
				) : tooLate ? (
					<p className="muted small">已經騎超過 {durationLabel(seconds)}，請選更長的時間。</p>
				) : null}
				{schedule.error ? <p className="inline-error">計時沒有更新：{schedule.error.message}</p> : null}
			</section>

			<section className="section">
				<h3 className="section-title">歸還</h3>
				<p className="muted small">停進站點格位後再歸還，按下就停止計費。還車位置用{position ? "你手機的定位" : "車輛自己的 GPS（開啟定位會改用手機定位）"}。</p>
				<button type="button" className="button button-primary button-block" onClick={() => returnRide.mutate()} disabled={returnRide.isPending}>
					<Power size={16} weight="bold" aria-hidden /> {returnRide.isPending ? "歸還中…" : "歸還車輛"}
				</button>
				{returnRide.error ? <p className="inline-error">歸還失敗，車輛仍在騎乘中：{returnRide.error.message}</p> : null}
			</section>
		</>
	);
}

const engineActions = {
	idle: { action: "start", label: "啟動", hint: "借到車後先啟動，車子才會通電可以騎。", icon: Play },
	running: { action: "park", label: "臨停", hint: "熄火上鎖，車子還是你的；臨停時間照樣計費。", icon: Pause },
	parked: { action: "start", label: "重新啟動", hint: "按重新啟動就能繼續騎。", icon: Play }
} as const;

/** Only the one engine command that applies now: 啟動 before the first start, then 臨停 or 重新啟動. */
function EngineControl({ ride }: { ride: ActiveRide }) {
	const queryClient = useQueryClient();
	const now = useNow();
	// oloo's on/off record can lag the command by a few seconds; hold the confirmed state until it catches up.
	const [confirmed, setConfirmed] = useState<{ engine: ActiveRide["engine"]; until: number } | null>(null);
	const reported = ride.engine ?? "idle";
	const engine = confirmed && now < confirmed.until && reported !== confirmed.engine ? confirmed.engine : reported;
	const next = engineActions[engine];
	const command = useMutation({
		mutationFn: () => apiRequest<{ engine: ActiveRide["engine"] }>(`/v1/rides/${ride.id}/engine`, { method: "POST", body: JSON.stringify({ action: next.action }) }),
		onSuccess: data => {
			setConfirmed({ engine: data.engine, until: Date.now() + 20_000 });
			void queryClient.invalidateQueries({ queryKey: ["ride"] });
		}
	});
	const Icon = next.icon;
	return (
		<section className="section engine-control" data-engine={engine}>
			<div className="engine-state">
				<span className="engine-dot" aria-hidden />
				<strong>{engine === "running" ? "行駛中" : engine === "parked" ? "臨停中" : "尚未啟動"}</strong>
			</div>
			<button type="button" className={engine === "running" ? "button button-quiet button-block" : "button button-primary button-block"} onClick={() => command.mutate()} disabled={command.isPending}>
				<Icon size={16} weight="fill" aria-hidden /> {command.isPending ? `${next.label}中…` : next.label}
			</button>
			<p className="muted small">{next.hint}</p>
			{command.error ? (
				<p className="inline-error">
					{next.label}失敗：{command.error.message}
				</p>
			) : null}
		</section>
	);
}
