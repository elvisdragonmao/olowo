import { BellRinging, CheckCircle, ClockCountdown, Power, Repeat, ShieldCheck, WarningCircle, X } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../shared/api";
import type { ActiveRide } from "./useCurrentRideQuery";

type AutomationAction = "notify" | "return" | "return_and_reborrow";
type Automation = {
	id: string;
	rideId: number;
	scooterId: number;
	action: AutomationAction;
	triggerAt: string;
	state: "scheduled" | "running" | "due" | "completed" | "failed" | "cancelled";
	error?: string;
};

const actionOptions: Array<{ value: AutomationAction; label: string; detail: string; icon: typeof BellRinging }> = [
	{ value: "notify", label: "提醒我", detail: "到時通知，不動車況", icon: BellRinging },
	{ value: "return", label: "自動歸還", detail: "結束本次騎乘", icon: Power },
	{ value: "return_and_reborrow", label: "歸還並重借", detail: "開始下一段計費", icon: Repeat }
];

const durationOptions = [
	{ seconds: 89, label: "1:29" },
	{ seconds: 5 * 60, label: "5 分" },
	{ seconds: 10 * 60, label: "10 分" }
];

function elapsedSeconds(startedAt: string, now: number) {
	return Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
}

function clock(seconds: number) {
	const safe = Math.max(0, seconds);
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const remainder = safe % 60;
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function actionLabel(action: AutomationAction) {
	return actionOptions.find(option => option.value === action)?.label ?? action;
}

export function RidePanel({ ride }: { ride: ActiveRide }) {
	const queryClient = useQueryClient();
	const [now, setNow] = useState(Date.now());
	const [confirmReturn, setConfirmReturn] = useState(false);
	const [action, setAction] = useState<AutomationAction>("notify");
	const [afterRideSeconds, setAfterRideSeconds] = useState(89);
	const [confirmAutomation, setConfirmAutomation] = useState(false);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);

	const automationQuery = useQuery({
		queryKey: ["ride", ride.id, "automation"],
		queryFn: () => apiRequest<{ automation: Automation | null }>(`/v1/rides/${ride.id}/automation`),
		refetchInterval: query => (query.state.data?.automation?.state === "scheduled" || query.state.data?.automation?.state === "running" ? 2_000 : 10_000),
		retry: false
	});
	const automation = automationQuery.data?.automation ?? null;
	const elapsed = elapsedSeconds(ride.startedAt, now);
	const remaining = automation ? Math.max(0, Math.ceil((Date.parse(automation.triggerAt) - now) / 1000)) : 0;
	const selectedAction = useMemo(() => actionOptions.find(option => option.value === action)!, [action]);

	const returnRide = useMutation({
		mutationFn: () =>
			apiRequest<{ success: true }>(`/v1/rides/${ride.id}/return`, {
				method: "POST",
				headers: { "idempotency-key": crypto.randomUUID() },
				body: JSON.stringify({ scooterId: ride.scooterId })
			}),
		onSuccess: async () => Promise.all([queryClient.invalidateQueries({ queryKey: ["ride"] }), queryClient.invalidateQueries({ queryKey: ["fleet"] })])
	});
	const schedule = useMutation({
		mutationFn: () =>
			apiRequest<{ automation: Automation }>(`/v1/rides/${ride.id}/automation`, {
				method: "PUT",
				body: JSON.stringify({ action, afterRideSeconds })
			}),
		onSuccess: async data => {
			queryClient.setQueryData(["ride", ride.id, "automation"], data);
			setConfirmAutomation(false);
			if (action === "notify" && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
		}
	});
	const cancelSchedule = useMutation({
		mutationFn: () => apiRequest<{ success: true }>(`/v1/rides/${ride.id}/automation`, { method: "DELETE" }),
		onSuccess: () => queryClient.setQueryData(["ride", ride.id, "automation"], { automation: null })
	});

	useEffect(() => {
		if (automation?.state !== "due" || !("Notification" in window) || Notification.permission !== "granted") return;
		new Notification("oluwu 騎乘提醒", { body: `${ride.label} 已到設定時間`, tag: automation.id });
	}, [automation?.id, automation?.state, ride.label]);

	return (
		<div className="ride-panel">
			<div className="ride-clock">
				<ClockCountdown size={28} weight="duotone" />
				<strong>{clock(elapsed)}</strong>
				<span>
					{ride.label} · 目前 ${ride.cost ?? 0}
				</span>
			</div>

			{automation ? (
				<div className={`automation-status automation-${automation.state}`}>
					<div>
						<strong>
							{automation.state === "scheduled"
								? `${actionLabel(automation.action)}倒數 ${clock(remaining)}`
								: automation.state === "running"
									? "正在執行…"
									: automation.state === "due"
										? "時間到了"
										: automation.state === "completed"
											? "已執行"
											: "排程失敗"}
						</strong>
						<span>{new Date(automation.triggerAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
					</div>
					{automation.state === "scheduled" ? (
						<button type="button" aria-label="取消騎乘排程" onClick={() => cancelSchedule.mutate()} disabled={cancelSchedule.isPending}>
							<X size={18} weight="bold" />
						</button>
					) : null}
					{automation.error ? <p>{automation.error}</p> : null}
				</div>
			) : (
				<div className="automation-card">
					<div className="automation-heading">
						<div>
							<strong>騎乘計時</strong>
							<span>依本次開始時間計算</span>
						</div>
						<ShieldCheck size={23} weight="duotone" />
					</div>
					<div className="automation-actions" role="radiogroup" aria-label="計時動作">
						{actionOptions.map(option => {
							const Icon = option.icon;
							return (
								<button
									key={option.value}
									type="button"
									role="radio"
									aria-checked={action === option.value}
									className={action === option.value ? "active" : ""}
									onClick={() => (setAction(option.value), setConfirmAutomation(false))}
								>
									<Icon size={18} weight={action === option.value ? "fill" : "regular"} />
									<strong>{option.label}</strong>
									<span>{option.detail}</span>
								</button>
							);
						})}
					</div>
					<div className="duration-options" role="radiogroup" aria-label="騎乘時間">
						{durationOptions.map(option => (
							<button
								key={option.seconds}
								type="button"
								role="radio"
								aria-checked={afterRideSeconds === option.seconds}
								className={afterRideSeconds === option.seconds ? "active" : ""}
								onClick={() => (setAfterRideSeconds(option.seconds), setConfirmAutomation(false))}
							>
								{option.label}
							</button>
						))}
					</div>
					{confirmAutomation && action !== "notify" ? (
						<div className="automation-confirmation">
							<WarningCircle size={20} weight="fill" />
							<p>
								{selectedAction.label}會在騎乘 {durationOptions.find(item => item.seconds === afterRideSeconds)?.label} 時直接改變車況
								{action === "return_and_reborrow" ? "，並可能開始下一段計費" : ""}。
							</p>
							<button type="button" onClick={() => schedule.mutate()} disabled={schedule.isPending}>
								{schedule.isPending ? "設定中…" : "確認設定"}
							</button>
						</div>
					) : (
						<button
							className="schedule-action"
							type="button"
							onClick={() => (action === "notify" ? schedule.mutate() : setConfirmAutomation(true))}
							disabled={schedule.isPending || afterRideSeconds <= elapsed + 10}
						>
							設定{selectedAction.label}
						</button>
					)}
					{afterRideSeconds <= elapsed + 10 ? <p className="action-error">這個時間已經過了，請選較長時間。</p> : null}
					{schedule.error ? <p className="action-error">排程未建立；請確認時間與目前騎乘。</p> : null}
				</div>
			)}

			<div className="photo-free-return">
				<CheckCircle size={24} weight="fill" />
				<div>
					<strong>停妥上鎖後直接歸還</strong>
					<p>介面不要求拍照；若 staging 尚未開放無圖結帳，系統不會把未完成狀態顯示為成功。</p>
				</div>
			</div>
			{confirmReturn ? (
				<div className="return-confirmation">
					<WarningCircle size={23} weight="fill" />
					<p>確認車輛已停妥並上鎖？送出後會立即結束騎乘。</p>
					<div>
						<button type="button" onClick={() => setConfirmReturn(false)}>
							繼續騎乘
						</button>
						<button type="button" onClick={() => returnRide.mutate()} disabled={returnRide.isPending}>
							{returnRide.isPending ? "歸還中…" : "確認歸還"}
						</button>
					</div>
				</div>
			) : (
				<button className="return-action" type="button" onClick={() => setConfirmReturn(true)}>
					<Power size={21} weight="bold" /> 歸還車輛
				</button>
			)}
			{returnRide.error ? <p className="action-error">歸還失敗；車輛仍視為騎乘中，請勿離開。</p> : null}
		</div>
	);
}
