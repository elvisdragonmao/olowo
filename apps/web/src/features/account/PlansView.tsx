import { ArrowLeft, Check } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../app/useUiStore";
import { apiRequest } from "../../shared/api";
import { useCampuses } from "../fleet/useCampus";

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
		name: string | null;
		startsAt: string | null;
		endsAt: string | null;
		includedMinutes: number | null;
		remainingMinutes: number | null;
		ratePerMinute: number | null;
		autoRenew: boolean | null;
		nextPlanName: string | null;
		topUps: Array<{ minutes: number; price: number; tag: string | null }>;
	} | null;
	plans: Plan[];
}

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }) : "—");

function period(plan: Plan) {
	if (plan.periodDays == null) return null;
	if (plan.periodDays >= 1) return `${Math.round(plan.periodDays)} 天`;
	return `${Math.round(plan.periodDays * 24 * 10) / 10} 小時`;
}

/** The plans oloo sells on this campus and whether this account can buy each one (oloo's own check). */
export function PlansView() {
	const back = useUiStore(state => state.back);
	const { current: campus } = useCampuses();
	const region = campus?.stations.find(station => station.region)?.region ?? null;
	const catalog = useQuery({
		queryKey: ["plans", region],
		queryFn: () => apiRequest<Catalog>(`/v1/plans${region ? `?region=${encodeURIComponent(region)}` : ""}`)
	});
	const current = catalog.data?.current ?? null;

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
						{current.topUps.length > 0 ? <p className="muted small">可加值：{current.topUps.map(item => `${item.minutes} 分 $${item.price}`).join("、")}</p> : null}
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
								) : plan.canPurchase === true ? (
									"可以訂閱"
								) : plan.canPurchase === false ? (
									`不能訂閱${plan.reasons.length ? `：${plan.reasons.join("、")}` : ""}`
								) : (
									"oloo 沒有回覆能否訂閱"
								)}
							</p>
						</li>
					))}
				</ol>
				<p className="muted small">能否訂閱由 oloo 判斷（與官方 App 相同的檢查）。付款訂閱請在 oloo App 的「優惠方案」完成。</p>
			</div>
		</>
	);
}
