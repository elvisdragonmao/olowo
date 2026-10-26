import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, idempotencyKey } from "../../shared/api";
import { useCoupons, type CouponScope } from "./useCoupons";

export interface Estimate {
	amount: number | null;
	startsAt?: string | null;
	endsAt?: string | null;
	minutes?: number;
}

const dateTime = (iso: string) => new Date(iso).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * Prices a plan or top-up with oloo's own estimate (optionally with a coupon) and pays it with the card selected
 * in the rider's oloo account. Nothing is charged until 「付款」.
 */
export function PaymentPanel({ path, scope, onPaid }: { path: string; scope: Exclude<CouponScope, "ride" | "any">; onPaid: () => void }) {
	const queryClient = useQueryClient();
	const coupons = useCoupons();
	const usable = (coupons.data ?? []).filter(coupon => coupon.state === "usable" && (coupon.scope === scope || coupon.scope === "any"));
	const [couponId, setCouponId] = useState<number | null>(null);
	// One key per panel, so a retry after a dropped response cannot charge twice.
	const [key] = useState(idempotencyKey);
	const estimate = useQuery({
		queryKey: ["estimate", path, couponId],
		queryFn: () => apiRequest<Estimate>(`${path}/estimate`, { method: "POST", body: JSON.stringify({ userCouponId: couponId }) }),
		retry: false
	});
	const pay = useMutation({
		mutationFn: () => apiRequest(`${path}/purchase`, { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ userCouponId: couponId }) }),
		onSuccess: () => {
			void Promise.all(["plans", "coupons"].map(name => queryClient.invalidateQueries({ queryKey: [name] })));
			onPaid();
		}
	});
	const amount = estimate.data?.amount ?? null;

	return (
		<div className="payment-panel">
			{usable.length > 0 ? (
				<div className="choice-grid coupon-pick" role="radiogroup" aria-label="優惠券">
					<button type="button" role="radio" aria-checked={couponId === null} onClick={() => setCouponId(null)} disabled={pay.isPending}>
						不用優惠券
					</button>
					{usable.map(coupon => (
						<button key={coupon.id} type="button" role="radio" aria-checked={couponId === coupon.id} onClick={() => setCouponId(coupon.id)} disabled={pay.isPending}>
							{coupon.name}
							{coupon.description ? <span>{coupon.description}</span> : null}
						</button>
					))}
				</div>
			) : null}
			<p className="payment-summary" aria-live="polite">
				{estimate.isPending ? (
					"向 oloo 試算金額…"
				) : estimate.error ? (
					<span className="inline-error">試算失敗：{estimate.error.message}</span>
				) : (
					<>
						<strong>{amount != null ? `$${amount}` : "金額未知"}</strong>
						<span>
							{estimate.data?.minutes != null ? `加值 ${estimate.data.minutes} 分` : null}
							{estimate.data?.startsAt ? `${dateTime(estimate.data.startsAt)} 生效` : null}
							{estimate.data?.endsAt ? ` · 到 ${dateTime(estimate.data.endsAt)}` : null}
						</span>
					</>
				)}
			</p>
			<button type="button" className="button button-primary button-block" onClick={() => pay.mutate()} disabled={pay.isPending || estimate.isPending || estimate.isError}>
				{pay.isPending ? "付款中…" : `付款${amount != null ? ` $${amount}` : ""}`}
			</button>
			<p className="muted small">用 oloo 帳號目前選定的信用卡付款。</p>
			{pay.error ? <p className="inline-error">付款沒有完成：{pay.error.message}</p> : null}
		</div>
	);
}
