import { ArrowLeft, Power, Repeat, X } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useUiStore } from "../../app/useUiStore";
import { apiRequest, idempotencyKey } from "../../shared/api";
import { clock, durationLabel, timeOfDay } from "../../shared/format";
import { automationLabels, DurationPicker, type AutomationAction } from "./automation";
import { useCurrentRide, useNow, type ActiveRide } from "./useCurrentRide";

type Automation = {
	id: string;
	rideId: number;
	action: AutomationAction | "notify";
	triggerAt: string;
	state: "scheduled" | "running" | "due" | "completed" | "failed" | "cancelled";
	error?: string;
};
type Estimate = { cost: number; ridingMinutes: number; parkedMinutes: number; ratePerMinute: number | null };

const actions: Array<{ value: AutomationAction; detail: string; icon: typeof Power }> = [
	{ value: "return", detail: "到時結束騎乘", icon: Power },
	{ value: "return_and_reborrow", detail: "歸還後立刻重借同一台", icon: Repeat }
];

export function RideView() {
	const back = useUiStore(state => state.back);
	const ride = useCurrentRide();
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
					<RideDetail ride={ride.data} />
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
	const [action, setAction] = useState<AutomationAction>("return_and_reborrow");
	const [afterRideSeconds, setAfterRideSeconds] = useState(88);
	const [confirmAutomation, setConfirmAutomation] = useState(false);
	const [confirmReturn, setConfirmReturn] = useState(false);
	const elapsed = Math.max(0, (now - Date.parse(ride.startedAt)) / 1000);

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
	const schedule = useMutation({
		mutationFn: () => apiRequest<{ automation: Automation }>(`/v1/rides/${ride.id}/automation`, { method: "PUT", body: JSON.stringify({ action, afterRideSeconds }) }),
		onSuccess: data => {
			queryClient.setQueryData(["ride", ride.id, "automation"], data);
			setConfirmAutomation(false);
		}
	});
	const cancel = useMutation({
		mutationFn: () => apiRequest(`/v1/rides/${ride.id}/automation`, { method: "DELETE" }),
		onSuccess: () => queryClient.setQueryData(["ride", ride.id, "automation"], { automation: null })
	});
	const returnRide = useMutation({
		mutationFn: () => apiRequest(`/v1/rides/${ride.id}/return`, { method: "POST", headers: { "idempotency-key": idempotencyKey() }, body: JSON.stringify({ scooterId: ride.scooterId }) }),
		onSuccess: async () => {
			await Promise.all(["ride", "fleet"].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
			navigate({ kind: "checkout" }, { replace: true });
		}
	});

	const task = automation.data ?? null;
	const tooLate = afterRideSeconds <= elapsed + 10;
	const taskLabel = task && task.action !== "notify" ? automationLabels[task.action] : "計時";

	return (
		<>
			<section className="ride-hero">
				<span className="hero-number hero-clock">{clock(elapsed)}</span>
				<span className="hero-caption">
					開始於 {timeOfDay(ride.startedAt)} · {estimate.data ? `預估 $${estimate.data.cost}` : `目前 $${ride.cost ?? 0}`}
					{estimate.data?.ratePerMinute != null ? ` · 每分 $${estimate.data.ratePerMinute}` : ""}
				</span>
			</section>

			{task && task.state !== "cancelled" ? (
				<div className="status-card" data-state={task.state}>
					<div>
						<strong>
							{task.state === "scheduled"
								? `${taskLabel} · 剩 ${clock((Date.parse(task.triggerAt) - now) / 1000)}`
								: task.state === "running"
									? "正在執行…"
									: task.state === "completed"
										? `${taskLabel}已執行`
										: task.state === "failed"
											? `${taskLabel}失敗`
											: "已到設定時間"}
						</strong>
						<span>{task.error ?? `預定 ${new Date(task.triggerAt).toLocaleTimeString("zh-TW", { hour12: false })}`}</span>
					</div>
					{task.state === "scheduled" ? (
						<button type="button" className="icon-button" aria-label="取消騎乘排程" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
							<X size={16} weight="bold" />
						</button>
					) : null}
				</div>
			) : (
				<section className="section">
					<h3 className="section-title">騎乘計時</h3>
					<div className="choice-grid choice-grid-two" role="radiogroup" aria-label="計時動作">
						{actions.map(option => {
							const Icon = option.icon;
							return (
								<button key={option.value} type="button" role="radio" aria-checked={action === option.value} onClick={() => (setAction(option.value), setConfirmAutomation(false))}>
									<Icon size={18} weight={action === option.value ? "fill" : "regular"} aria-hidden />
									<strong>{automationLabels[option.value]}</strong>
									<span>{option.detail}</span>
								</button>
							);
						})}
					</div>
					<DurationPicker value={afterRideSeconds} onChange={seconds => (setAfterRideSeconds(seconds), setConfirmAutomation(false))} />
					{confirmAutomation ? (
						<div className="confirm-card" role="alertdialog" aria-label="確認騎乘計時">
							<p>
								騎乘 {durationLabel(afterRideSeconds)} 時會{action === "return_and_reborrow" ? "歸還並立刻重借，開始下一段計費" : "直接歸還並結束騎乘"}。
							</p>
							<div className="button-pair">
								<button type="button" className="button button-quiet" onClick={() => setConfirmAutomation(false)}>
									取消
								</button>
								<button type="button" className="button button-primary" onClick={() => schedule.mutate()} disabled={schedule.isPending}>
									{schedule.isPending ? "設定中…" : "確認設定"}
								</button>
							</div>
						</div>
					) : (
						<button type="button" className="button button-quiet button-block" disabled={schedule.isPending || tooLate} onClick={() => setConfirmAutomation(true)}>
							{tooLate ? "這個時間已經過了" : `設定${automationLabels[action]}`}
						</button>
					)}
					{schedule.error ? <p className="inline-error">排程未建立：{schedule.error.message}</p> : null}
				</section>
			)}

			<section className="section">
				<h3 className="section-title">歸還</h3>
				<p className="muted small">停進站點格位並上鎖後再歸還；歸還後會請你拍還車照片並付款。</p>
				{confirmReturn ? (
					<div className="confirm-card" role="alertdialog" aria-label="確認歸還">
						<p>確認 {ride.label} 已停妥並上鎖？送出後立即結束騎乘。</p>
						<div className="button-pair">
							<button type="button" className="button button-quiet" onClick={() => setConfirmReturn(false)}>
								繼續騎乘
							</button>
							<button type="button" className="button button-danger" onClick={() => returnRide.mutate()} disabled={returnRide.isPending}>
								{returnRide.isPending ? "歸還中…" : "確認歸還"}
							</button>
						</div>
					</div>
				) : (
					<button type="button" className="button button-primary button-block" onClick={() => setConfirmReturn(true)}>
						<Power size={16} weight="bold" aria-hidden /> 歸還車輛
					</button>
				)}
				{returnRide.error ? <p className="inline-error">歸還失敗，車輛仍在騎乘中：{returnRide.error.message}</p> : null}
			</section>
		</>
	);
}
