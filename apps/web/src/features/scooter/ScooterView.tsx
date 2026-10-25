import { ArrowLeft, CaretDown, Lightning, X } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useUiStore } from "../../app/useUiStore";
import { apiRequest, idempotencyKey } from "../../shared/api";
import { clock, durationLabel, relativeTime } from "../../shared/format";
import { useIsSignedIn } from "../auth/useSession";
import { availabilityLabel, modelLabel, reasonLabels, stationLabel, warningLabel, type ScooterSummary } from "../fleet/model";
import { useFleetQuery, useStation } from "../fleet/useFleetQuery";
import { automationLabels, DurationPicker, type AutomationAction } from "../ride/automation";
import { useCurrentRide, useNow } from "../ride/useCurrentRide";
import { useUnpaidRide } from "../ride/useUnpaidRide";

type RidePlan = { id?: number; name?: string; minMinute?: number; minPrice?: number; normalRate?: number; stopRate?: number };
type RidePlanResponse = { possibleRidePlan?: { ridePlan?: RidePlan }; basicOrStationRidePlan?: RidePlan; basicRidePlan?: RidePlan };
type Reservation = { id: number; scooterId?: number; label?: string; createdAt?: string; expiresAt?: string };
type ReservationUsage = { reservedLastHour: number; cancelledThisWeek: number };

export function ScooterView({ stationId, scooterId }: { stationId: number; scooterId: number }) {
	const fleet = useFleetQuery();
	const station = useStation(stationId);
	const back = useUiStore(state => state.back);
	const scooter = station?.scooters.find(item => item.providerId === scooterId) ?? null;

	return (
		<>
			<header className="view-head" data-sheet-drag>
				<button type="button" className="icon-button" aria-label="返回" onClick={back}>
					<ArrowLeft size={18} weight="bold" />
				</button>
				<div className="view-head-title">
					<h2 className="plate">
						{scooter?.id ?? (fleet.isPending ? "載入中" : "找不到這台車")}
						{scooter && modelLabel(scooter.model) ? <em>{modelLabel(scooter.model)}</em> : null}
					</h2>
					{station ? <p>{stationLabel(station.name).name}</p> : null}
				</div>
			</header>
			<div className="view-body">{scooter ? <ScooterDetail scooter={scooter} lowBatteryPercent={station?.lowBatteryPercent ?? null} /> : null}</div>
		</>
	);
}

function ScooterDetail({ scooter, lowBatteryPercent }: { scooter: ScooterSummary; lowBatteryPercent: number | null }) {
	const now = useNow(10_000);
	const signedIn = useIsSignedIn();
	const navigate = useUiStore(state => state.navigate);

	return (
		<>
			<section className="scooter-hero" data-tone={scooter.availability}>
				<div className="scooter-hero-figure">
					<span className="hero-number">
						{scooter.batteryPercent}
						<small>%</small>
					</span>
					<span className="hero-caption">電量 · 約 {scooter.rangeKm} km</span>
				</div>
				<span className="status-tag status-tag-large" data-tone={scooter.availability}>
					{availabilityLabel(scooter)}
				</span>
				<span className="hero-meter" aria-hidden>
					<span style={{ width: `${scooter.batteryPercent}%` }} />
				</span>
			</section>
			{signedIn ? (
				<BorrowActions scooter={scooter} />
			) : (
				<div className="cta-card">
					<div>
						<strong>登入後才能借車</strong>
						<span>使用 oloo 帳號的 Email 驗證碼</span>
					</div>
					<button type="button" className="button button-primary" onClick={() => navigate({ kind: "account" })}>
						登入
					</button>
				</div>
			)}
			{scooter.reasons.length > 0 ? (
				<ul className="reason-list" aria-label="暫不可借原因">
					{scooter.reasons.map(reason => (
						<li key={reason}>{reason === "low_battery" && lowBatteryPercent != null ? `電量低於 ${lowBatteryPercent}%` : reasonLabels[reason]}</li>
					))}
				</ul>
			) : null}
			{scooter.warnings.length > 0 ? (
				<div className="warning-note" role="note">
					<strong>{scooter.warnings.map(warning => warningLabel(warning, scooter)).join("、")}</strong>
					<span>這是車機回報的提醒，不影響借用；oloo 會在借車當下判斷。若發動不了，直接歸還即可。</span>
				</div>
			) : null}
			<p className="muted small">車況更新 {relativeTime(scooter.updatedAt, now)}</p>
		</>
	);
}

function BorrowActions({ scooter }: { scooter: ScooterSummary }) {
	const queryClient = useQueryClient();
	const navigate = useUiStore(state => state.navigate);
	const now = useNow();
	const activeRide = useCurrentRide().data ?? null;
	const unpaidRide = useUnpaidRide().data ?? null;
	const [confirming, setConfirming] = useState(false);
	const [automation, setAutomation] = useState<"none" | AutomationAction>("none");
	const [rideTimer, setRideTimer] = useState(88);

	const plan = useQuery({
		queryKey: ["scooter", scooter.providerId, "ride-plan"],
		queryFn: () => apiRequest<RidePlanResponse>(`/v1/scooters/${scooter.providerId}/ride-plan`),
		select: data => data.possibleRidePlan?.ridePlan ?? data.basicOrStationRidePlan ?? data.basicRidePlan ?? null,
		retry: false
	});
	const reservations = useQuery({
		queryKey: ["reservation", "current"],
		queryFn: () => apiRequest<Reservation[]>("/v1/reservations/current"),
		refetchInterval: 15_000,
		retry: false
	});
	const usage = useQuery({ queryKey: ["reservation", "usage"], queryFn: () => apiRequest<ReservationUsage>("/v1/reservations/usage"), retry: false });
	const reservation = reservations.data?.[0] ?? null;
	const reservationLeft = reservation?.expiresAt ? (Date.parse(reservation.expiresAt) - now) / 1000 : null;
	const reservationLive = reservation != null && (reservationLeft == null || reservationLeft > 0);
	const ownReservation = reservationLive && (reservation.scooterId === scooter.providerId || reservation.label === scooter.id) ? reservation : null;
	const refreshAfterChange = () => Promise.all(["ride", "fleet", "reservation"].map(key => queryClient.invalidateQueries({ queryKey: [key] })));

	const rent = useMutation({
		mutationFn: () =>
			apiRequest<{ success: true }>("/v1/rides", {
				method: "POST",
				headers: { "idempotency-key": idempotencyKey() },
				body: JSON.stringify({
					scooterId: scooter.providerId,
					reservationId: ownReservation?.id ?? null,
					automation: automation === "none" ? undefined : { action: automation, afterRideSeconds: rideTimer }
				})
			}),
		onSuccess: async () => {
			await refreshAfterChange();
			navigate({ kind: "ride" }, { replace: true });
		}
	});
	const reserve = useMutation({
		mutationFn: () => apiRequest("/v1/reservations", { method: "POST", headers: { "idempotency-key": idempotencyKey() }, body: JSON.stringify({ engineLicenseNumber: scooter.id }) }),
		onSuccess: refreshAfterChange
	});
	const cancelReservation = useMutation({
		mutationFn: (id: number) => apiRequest(`/v1/reservations/${id}`, { method: "DELETE", headers: { "idempotency-key": idempotencyKey() } }),
		onSuccess: refreshAfterChange
	});

	if (unpaidRide) {
		return (
			<div className="cta-card">
				<div>
					<strong>上一趟 {unpaidRide.label} 還沒結帳</strong>
					<span>完成還車照片與付款後才能再借</span>
				</div>
				<button type="button" className="button button-primary" onClick={() => navigate({ kind: "checkout" })}>
					去結帳
				</button>
			</div>
		);
	}

	if (activeRide) {
		return (
			<div className="cta-card">
				<div>
					<strong>你正在騎乘 {activeRide.label}</strong>
					<span>歸還後才能借下一台</span>
				</div>
				<button type="button" className="button button-primary" onClick={() => navigate({ kind: "ride" })}>
					查看騎乘
				</button>
			</div>
		);
	}

	const borrowable = scooter.availability === "available" || (ownReservation != null && scooter.reasons.every(reason => reason === "reserved"));
	const consequence =
		automation === "return"
			? `，騎乘滿 ${durationLabel(rideTimer)} 時自動歸還`
			: automation === "return_and_reborrow"
				? `，騎乘滿 ${durationLabel(rideTimer)} 時歸還、以空白照片自動結帳後重借（開始下一段計費）`
				: "";

	return (
		<>
			<div className="plan-line">
				<Lightning size={16} weight="fill" aria-hidden />
				{plan.isPending ? (
					<span className="skeleton-text">讀取費率</span>
				) : plan.data ? (
					<span>
						<strong>{plan.data.name ?? "一般費率"}</strong> 前 {plan.data.minMinute ?? 0} 分 ${plan.data.minPrice ?? 0}，之後每分 ${plan.data.normalRate ?? 0}
					</span>
				) : (
					<span>無法取得費率，借用前請確認</span>
				)}
			</div>

			{reservationLive ? (
				<div className="status-card" data-state="scheduled">
					<div>
						<strong>{ownReservation ? "已預約這台車" : `已預約 ${reservation.label ?? `車輛 ${reservation.scooterId ?? ""}`}`}</strong>
						<span>{reservationLeft != null ? `取車時間剩 ${clock(reservationLeft)}` : "預約中"}</span>
					</div>
					<button type="button" className="icon-button" aria-label="取消預約" onClick={() => cancelReservation.mutate(reservation.id)} disabled={cancelReservation.isPending}>
						<X size={16} weight="bold" />
					</button>
				</div>
			) : null}

			{confirming ? (
				<div className="confirm-card" role="alertdialog" aria-label="確認借用">
					<p>
						借用 <strong>{scooter.id}</strong> 會立即開始計費{consequence}。
					</p>
					<div className="button-pair">
						<button type="button" className="button button-quiet" onClick={() => setConfirming(false)}>
							取消
						</button>
						<button type="button" className="button button-primary" onClick={() => rent.mutate()} disabled={rent.isPending}>
							{rent.isPending ? "借用中…" : "確認借用"}
						</button>
					</div>
				</div>
			) : (
				<div className="button-pair">
					<button type="button" className="button button-primary" disabled={!borrowable || plan.isPending} onClick={() => setConfirming(true)}>
						{ownReservation ? "借用預約的車" : "立即借用"}
					</button>
					<button type="button" className="button button-quiet" disabled={reservationLive || reserve.isPending || scooter.availability !== "available"} onClick={() => reserve.mutate()}>
						{reserve.isPending ? "預約中…" : "預約 5 分鐘"}
					</button>
				</div>
			)}
			{rent.error ? <p className="inline-error">借用失敗：{rent.error.message}</p> : null}
			{reserve.error || cancelReservation.error ? <p className="inline-error">預約操作失敗：{(reserve.error ?? cancelReservation.error)?.message}</p> : null}
			{usage.data ? (
				<p className="muted small">
					透過 olowo：最近一小時預約 {usage.data.reservedLastHour} 次、本週取消 {usage.data.cancelledThisWeek} 次。oloo 會限制每小時的預約次數，一週內多次取消會暫停預約。
				</p>
			) : null}

			<details className="disclosure">
				<summary>
					借用後計時 <span>{automation === "none" ? "未設定" : `${automationLabels[automation]} · ${durationLabel(rideTimer)}`}</span>
					<CaretDown size={14} weight="bold" aria-hidden />
				</summary>
				<div className="segmented" role="radiogroup" aria-label="借用後計時動作">
					{(["none", "return", "return_and_reborrow"] as const).map(choice => (
						<button key={choice} type="button" role="radio" aria-checked={automation === choice} onClick={() => (setAutomation(choice), setConfirming(false))}>
							{choice === "none" ? "不設定" : automationLabels[choice]}
						</button>
					))}
				</div>
				{automation !== "none" ? <DurationPicker value={rideTimer} onChange={seconds => (setRideTimer(seconds), setConfirming(false))} /> : null}
				<p className="muted small">由伺服器計時，關掉網頁也會執行。歸還前會再次確認騎乘中的是同一台車。</p>
			</details>
		</>
	);
}
