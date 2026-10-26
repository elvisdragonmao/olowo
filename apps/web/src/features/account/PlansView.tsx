import { ArrowLeft, Check } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useUiStore } from "../../app/useUiStore";
import { apiRequest } from "../../shared/api";
import { useCampuses } from "../fleet/useCampus";
import { PaymentPanel } from "./PaymentPanel";

interface Plan {
	contractId: number;
	name: string;
	tagline: string | null;
	kind: "monthly" | "pass";
	price: number | null;
	includedMinutes: number | null;
	periodDays: number | null;
	ratePerMinute: number | null;
	lines: string[];
	current: boolean;
	next: boolean;
	canPurchase: boolean | null;
	reasons: string[];
}

interface Catalog {
	region: string | null;
	current: {
		userContractId: number | null;
		contractId: number | null;
		name: string | null;
		startsAt: string | null;
		endsAt: string | null;
		includedMinutes: number | null;
		remainingMinutes: number | null;
		ratePerMinute: number | null;
		autoRenew: boolean | null;
		nextPlanName: string | null;
		topUps: Array<{ id: number; minutes: number; price: number; tag: string | null }>;
	} | null;
	plans: Plan[];
}

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }) : "—");

function period(plan: Plan) {
	if (plan.periodDays == null) return null;
	if (plan.periodDays >= 1) return `${Math.round(plan.periodDays)} 天`;
	return `${Math.round(plan.periodDays * 24 * 10) / 10} 小時`;
}

/** The plans oloo sells on this campus, oloo's own purchase check for each, and buying, topping up and renewal. */
export function PlansView() {
	const back = useUiStore(state => state.back);
	const queryClient = useQueryClient();
	// Which purchase panel is open: `plan:<contractId>` or `top-up:<id>`.
	const [open, setOpen] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const toggle = (id: string) => (setNotice(null), setOpen(value => (value === id ? null : id)));
	const paid = (message: string) => (setOpen(null), setNotice(message));
	const { current: campus } = useCampuses();
	const region = campus?.stations.find(station => station.region)?.region ?? null;
	const catalog = useQuery({
		queryKey: ["plans", region],
		queryFn: () => apiRequest<Catalog>(`/v1/plans${region ? `?region=${encodeURIComponent(region)}` : ""}`)
	});
	const current = catalog.data?.current ?? null;
	const renewal = useMutation({
		mutationFn: (next: { cancel: true } | { contractId: number }) =>
			"cancel" in next
				? apiRequest("/v1/plans/current/auto-renew", { method: "DELETE" })
				: apiRequest("/v1/plans/current/next", { method: "PUT", body: JSON.stringify({ contractId: next.contractId }) }),
		onSuccess: (_, next) => {
			setNotice("cancel" in next ? "已取消自動續約，方案用到到期日。" : "已更改下期方案。");
			void queryClient.invalidateQueries({ queryKey: ["plans"] });
		}
	});

	return (
		<>
			<header className="view-head" data-sheet-drag>
				<button type="button" className="icon-button" aria-label="返回" onClick={back}>
					<ArrowLeft size={18} weight="bold" />
				</button>
				<div className="view-head-title">
					<h2>訂閱方案</h2>
					{campus ? <p>{campus.name}可用的方案</p> : null}
				</div>
			</header>
			<div className="view-body">
				{catalog.isPending ? <p className="skeleton-text">讀取方案</p> : null}
				{catalog.error ? <p className="inline-error">讀不到方案：{catalog.error.message}</p> : null}
				{notice ? (
					<p className="status-card" data-state="completed" aria-live="polite">
						<strong>{notice}</strong>
					</p>
				) : null}
				{current ? (
					<section className="bill-card" aria-label="目前方案">
						<p className="muted small">
							目前方案 · {date(current.startsAt)} – {date(current.endsAt)}
						</p>
						<p className="plan-current">
							<strong>{current.name ?? "方案"}</strong>
							{current.remainingMinutes != null ? (
								<span>
									剩 {current.remainingMinutes}
									{current.includedMinutes ? ` / ${current.includedMinutes}` : ""} 分
								</span>
							) : null}
						</p>
						<p className="muted small">
							{current.remainingMinutes === 0 && current.ratePerMinute != null ? `免費時數用完，之後每分 $${current.ratePerMinute}。` : ""}
							{current.autoRenew === false ? "已取消自動續約。" : current.nextPlanName ? `到期後自動續約「${current.nextPlanName}」。` : ""}
						</p>
						{current.topUps.length > 0 ? (
							<>
								<h3 className="section-title">加值時數</h3>
								<div className="choice-grid top-up-grid">
									{current.topUps.map(item => (
										<button key={item.id} type="button" aria-pressed={open === `top-up:${item.id}`} onClick={() => toggle(`top-up:${item.id}`)}>
											<strong>{item.minutes} 分</strong>
											<span>
												${item.price}
												{item.tag ? ` · ${item.tag}` : ""}
											</span>
										</button>
									))}
								</div>
								{current.topUps.map(item =>
									open === `top-up:${item.id}` ? <PaymentPanel key={item.id} path={`/v1/plans/current/top-ups/${item.id}`} scope="topUp" onPaid={() => paid(`已加值 ${item.minutes} 分鐘。`)} /> : null
								)}
							</>
						) : null}
						{current.autoRenew !== false ? (
							<button type="button" className="button button-quiet" onClick={() => renewal.mutate({ cancel: true })} disabled={renewal.isPending}>
								取消自動續約
							</button>
						) : null}
						{renewal.error ? <p className="inline-error">續約設定沒有更新：{renewal.error.message}</p> : null}
					</section>
				) : catalog.data ? (
					<p className="muted">目前沒有方案，騎乘以一般費率計費。</p>
				) : null}

				<ol className="plan-list" aria-label="可訂閱的方案">
					{catalog.data?.plans.map(plan => (
						<li key={plan.contractId} className="plan-card" data-current={plan.current}>
							<div className="plan-card-head">
								<div>
									<strong>{plan.name}</strong>
									<span>
										{plan.kind === "monthly" ? "月方案" : "悠遊券"}
										{period(plan) ? ` · ${period(plan)}` : ""}
										{plan.tagline && plan.tagline !== plan.name ? ` · ${plan.tagline}` : ""}
									</span>
								</div>
								<p className="plan-price">{plan.price != null ? `$${plan.price}` : "—"}</p>
							</div>
							{plan.lines.length > 0 ? (
								<ul className="plan-lines">
									{plan.lines.map(line => (
										<li key={line}>{line}</li>
									))}
								</ul>
							) : null}
							<p className="plan-status" data-ok={plan.canPurchase === true && !plan.current}>
								{plan.current ? (
									<>
										<Check size={14} weight="bold" aria-hidden /> 使用中{plan.next ? "，到期自動續約" : ""}
									</>
								) : plan.next ? (
									"下期續約的方案"
								) : plan.canPurchase === true ? (
									"可以訂閱"
								) : plan.canPurchase === false ? (
									`不能訂閱${plan.reasons.length ? `：${plan.reasons.join("、")}` : ""}`
								) : (
									"oloo 沒有回覆能否訂閱"
								)}
							</p>
							{!plan.current && plan.canPurchase !== false ? (
								<div className="plan-actions">
									<button type="button" className="button button-quiet" aria-pressed={open === `plan:${plan.contractId}`} onClick={() => toggle(`plan:${plan.contractId}`)}>
										購買
									</button>
									{current && plan.kind === "monthly" && !plan.next ? (
										<button type="button" className="button button-quiet" onClick={() => renewal.mutate({ contractId: plan.contractId })} disabled={renewal.isPending}>
											設為下期方案
										</button>
									) : null}
								</div>
							) : null}
							{open === `plan:${plan.contractId}` ? <PaymentPanel path={`/v1/plans/${plan.contractId}`} scope="plan" onPaid={() => paid(`已購買「${plan.name}」。`)} /> : null}
						</li>
					))}
				</ol>
				<p className="muted small">
					這裡列的是 oloo 在{campus ? campus.name : "這個校區"}公開販售的方案，能否訂閱由 oloo 判斷（與官方 App 相同的檢查）。已有月方案時，新買的月方案會在目前方案到期後才開始；金額與生效時間以付款前
					oloo 的試算為準。
				</p>
			</div>
		</>
	);
}
