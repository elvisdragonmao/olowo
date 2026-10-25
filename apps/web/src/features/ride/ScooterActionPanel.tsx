import { CalendarCheck, CheckCircle, Lightning, Timer, WarningCircle, X } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ScooterSummary } from "../map/model";
import { apiRequest } from "../../shared/api";

type Session = { authenticated: false } | { authenticated: true };
type RidePlan = { id?: number; name?: string; minMinute?: number; minPrice?: number; normalRate?: number; stopRate?: number };
type RidePlanResponse = { possibleRidePlan?: { ridePlan?: RidePlan }; basicOrStationRidePlan?: RidePlan; basicRidePlan?: RidePlan };
type Reservation = { id: number; scooterId?: number; label?: string; createdAt?: string; expiresAt?: string };
type ReservationSchedule = {
	id: string;
	scooterId: number;
	engineLicenseNumber: string;
	triggerAt: string;
	state: "scheduled" | "running" | "completed" | "failed";
	reservationId?: number;
	expiresAt?: string;
	error?: string;
};
type AutomationAction = "notify" | "return" | "return_and_reborrow";

const reserveTimes = [
	{ seconds: 0, label: "現在" },
	{ seconds: 5 * 60, label: "5 分" },
	{ seconds: 15 * 60, label: "15 分" },
	{ seconds: 30 * 60, label: "30 分" }
];

export function ScooterActionPanel({ scooter, onNeedLogin }: { scooter: ScooterSummary; onNeedLogin: () => void }) {
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	const [reserveAfter, setReserveAfter] = useState(0);
	const [rentAutomation, setRentAutomation] = useState<"none" | AutomationAction>("none");
	const [rentDuration, setRentDuration] = useState(89);
	const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => apiRequest<Session>("/v1/auth/session") });
	const planQuery = useQuery({
		queryKey: ["scooter", scooter.providerId, "ride-plan"],
		queryFn: () => apiRequest<RidePlanResponse>(`/v1/scooters/${scooter.providerId}/ride-plan`),
		enabled: session.data?.authenticated === true,
		retry: false
	});
	const reservationQuery = useQuery({
		queryKey: ["reservation", "current"],
		queryFn: () => apiRequest<Reservation[]>("/v1/reservations/current"),
		enabled: session.data?.authenticated === true,
		retry: false
	});
	const scheduledReservationQuery = useQuery({
		queryKey: ["reservation", "scheduled"],
		queryFn: () => apiRequest<{ schedule: ReservationSchedule | null }>("/v1/reservations/scheduled"),
		enabled: session.data?.authenticated === true,
		refetchInterval: query => (query.state.data?.schedule?.state === "scheduled" || query.state.data?.schedule?.state === "running" ? 2_000 : 10_000),
		retry: false
	});
	const plan = useMemo(() => planQuery.data?.possibleRidePlan?.ridePlan ?? planQuery.data?.basicOrStationRidePlan ?? planQuery.data?.basicRidePlan, [planQuery.data]);
	const currentReservation = reservationQuery.data?.[0] ?? null;
	const scheduledReservation = scheduledReservationQuery.data?.schedule ?? null;

	const reserve = useMutation({
		mutationFn: () =>
			apiRequest<{ success: true }>("/v1/reservations", {
				method: "POST",
				headers: { "idempotency-key": crypto.randomUUID() },
				body: JSON.stringify({ engineLicenseNumber: scooter.id })
			}),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reservation"] })
	});
	const scheduleReservation = useMutation({
		mutationFn: () =>
			apiRequest<{ schedule: ReservationSchedule }>("/v1/reservations/scheduled", {
				method: "PUT",
				body: JSON.stringify({ scooterId: scooter.providerId, engineLicenseNumber: scooter.id, secondsFromNow: reserveAfter })
			}),
		onSuccess: data => queryClient.setQueryData(["reservation", "scheduled"], data)
	});
	const cancelReservation = useMutation({
		mutationFn: () => {
			if (!currentReservation) throw new Error("No reservation");
			return apiRequest<{ success: true }>(`/v1/reservations/${currentReservation.id}`, { method: "DELETE", headers: { "idempotency-key": crypto.randomUUID() } });
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reservation"] })
	});
	const cancelScheduledReservation = useMutation({
		mutationFn: () => apiRequest<{ success: true }>("/v1/reservations/scheduled", { method: "DELETE" }),
		onSuccess: () => queryClient.setQueryData(["reservation", "scheduled"], { schedule: null })
	});
	const rent = useMutation({
		mutationFn: () =>
			apiRequest<{ success: true }>("/v1/rides", {
				method: "POST",
				headers: { "idempotency-key": crypto.randomUUID() },
				body: JSON.stringify({
					scooterId: scooter.providerId,
					reservationId: currentReservation?.id ?? null,
					automation: rentAutomation === "none" ? undefined : { action: rentAutomation, afterRideSeconds: rentDuration }
				})
			}),
		onSuccess: async () => {
			await Promise.all([queryClient.invalidateQueries({ queryKey: ["ride"] }), queryClient.invalidateQueries({ queryKey: ["fleet"] }), queryClient.invalidateQueries({ queryKey: ["reservation"] })]);
		}
	});

	if (!session.data?.authenticated) {
		return (
			<div className="action-login-required">
				<WarningCircle size={28} weight="fill" />
				<strong>登入後才能借車</strong>
				<p>Email 六位數驗證，憑證只留在後端。</p>
				<button type="button" onClick={onNeedLogin}>
					Email 登入
				</button>
			</div>
		);
	}

	return (
		<div className="scooter-action-panel">
			<div className="selected-detail-heading">
				<img src="/assets/brand/oloo-scooter-c5.png" alt="" />
				<div>
					<strong>{scooter.id}</strong>
					<span>
						{scooter.batteryPercent}% · 約 {scooter.rangeKm} 公里
					</span>
				</div>
				<span className="detail-available">{scooter.availability === "available" ? "可借" : "暫不可借"}</span>
			</div>
			<div className="ride-plan-card">
				<Lightning size={22} weight="fill" />
				<div>
					<strong>{planQuery.isLoading ? "正在取得費率…" : (plan?.name ?? "一般費率")}</strong>
					<span>{plan ? `前 ${plan.minMinute ?? 0} 分鐘 $${plan.minPrice ?? 0}，之後每分鐘 $${plan.normalRate ?? 0}` : "借用前會再次確認費率"}</span>
				</div>
			</div>

			{currentReservation ? (
				<div className="reservation-status">
					<div>
						<strong>已預約 {currentReservation.label ?? `車輛 ${currentReservation.scooterId ?? ""}`}</strong>
						<span>{currentReservation.expiresAt ? `保留至 ${new Date(currentReservation.expiresAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}` : "預約有效中"}</span>
					</div>
					<button type="button" aria-label="取消預約" onClick={() => cancelReservation.mutate()} disabled={cancelReservation.isPending}>
						<X size={18} weight="bold" />
					</button>
				</div>
			) : scheduledReservation ? (
				<div className={`reservation-status schedule-${scheduledReservation.state}`}>
					<div>
						<strong>
							{scheduledReservation.state === "scheduled"
								? `將預約 ${scheduledReservation.engineLicenseNumber}`
								: scheduledReservation.state === "completed"
									? "已送出預約"
									: scheduledReservation.state === "failed"
										? "預約失敗"
										: "正在預約…"}
						</strong>
						<span>{new Date(scheduledReservation.triggerAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</span>
					</div>
					{scheduledReservation.state === "scheduled" ? (
						<button type="button" aria-label="取消定時預約" onClick={() => cancelScheduledReservation.mutate()} disabled={cancelScheduledReservation.isPending}>
							<X size={18} weight="bold" />
						</button>
					) : null}
					{scheduledReservation.error ? <p>{scheduledReservation.error}</p> : null}
				</div>
			) : (
				<div className="reservation-controls">
					<div className="compact-section-title">
						<CalendarCheck size={19} weight="duotone" />
						<strong>預約</strong>
					</div>
					<div className="duration-options" role="radiogroup" aria-label="預約時間">
						{reserveTimes.map(option => (
							<button
								key={option.seconds}
								type="button"
								role="radio"
								aria-checked={reserveAfter === option.seconds}
								className={reserveAfter === option.seconds ? "active" : ""}
								onClick={() => setReserveAfter(option.seconds)}
							>
								{option.label}
							</button>
						))}
					</div>
					<button
						className="reservation-action"
						type="button"
						onClick={() => (reserveAfter === 0 ? reserve.mutate() : scheduleReservation.mutate())}
						disabled={reserve.isPending || scheduleReservation.isPending || scooter.availability !== "available"}
					>
						<CalendarCheck size={20} weight="bold" />{" "}
						{reserve.isPending || scheduleReservation.isPending ? "設定中…" : reserveAfter === 0 ? "立即預約" : `設定 ${reserveTimes.find(item => item.seconds === reserveAfter)?.label}後預約`}
					</button>
				</div>
			)}

			<div className="rent-automation-controls">
				<div className="compact-section-title">
					<Timer size={19} weight="duotone" />
					<strong>借用後</strong>
				</div>
				<div className="compact-choice-row" role="radiogroup" aria-label="借用後計時動作">
					{[
						["none", "不排程"],
						["notify", "提醒"],
						["return", "歸還"],
						["return_and_reborrow", "重借"]
					].map(([value, label]) => (
						<button
							key={value}
							type="button"
							role="radio"
							aria-checked={rentAutomation === value}
							className={rentAutomation === value ? "active" : ""}
							onClick={() => setRentAutomation(value as "none" | AutomationAction)}
						>
							{label}
						</button>
					))}
				</div>
				{rentAutomation !== "none" ? (
					<div className="duration-options" role="radiogroup" aria-label="借用後時間">
						{[
							[89, "1:29"],
							[300, "5 分"],
							[600, "10 分"]
						].map(([seconds, label]) => (
							<button
								key={seconds}
								type="button"
								role="radio"
								aria-checked={rentDuration === seconds}
								className={rentDuration === seconds ? "active" : ""}
								onClick={() => setRentDuration(Number(seconds))}
							>
								{label}
							</button>
						))}
					</div>
				) : null}
			</div>

			{rent.isSuccess ? (
				<div className="action-success">
					<CheckCircle size={22} weight="fill" /> 已開始騎乘
				</div>
			) : null}
			{rent.error || reserve.error || scheduleReservation.error || cancelReservation.error ? <p className="action-error">操作失敗，請確認帳號資格、車輛狀態與預約限制。</p> : null}
			{confirming ? (
				<div className="rent-confirmation">
					<p>
						確認借用 {scooter.id}？送出後會立即開始計費
						{rentAutomation === "return"
							? `，並在 ${rentDuration === 89 ? "1:29" : `${rentDuration / 60} 分`}自動歸還`
							: rentAutomation === "return_and_reborrow"
								? `，並在 ${rentDuration === 89 ? "1:29" : `${rentDuration / 60} 分`}歸還再開始下一段計費`
								: rentAutomation === "notify"
									? `，於 ${rentDuration === 89 ? "1:29" : `${rentDuration / 60} 分`}提醒`
									: ""}
						。
					</p>
					<div>
						<button type="button" onClick={() => setConfirming(false)}>
							取消
						</button>
						<button type="button" onClick={() => rent.mutate()} disabled={rent.isPending}>
							{rent.isPending ? "借用中…" : "確認借用"}
						</button>
					</div>
				</div>
			) : (
				<button className="primary-rent-action" type="button" disabled={scooter.availability !== "available" || planQuery.isLoading} onClick={() => setConfirming(true)}>
					借用這台車
				</button>
			)}
		</div>
	);
}
