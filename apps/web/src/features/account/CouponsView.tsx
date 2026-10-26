import { ArrowLeft } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useUiStore } from "../../app/useUiStore";
import { apiRequest } from "../../shared/api";
import { couponScopeLabels, useCoupons, type Coupon } from "./useCoupons";

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }) : null);

const stateLabels: Record<Coupon["state"], string> = { usable: "可使用", pending: "尚未開始", used: "已使用", expired: "已過期" };

/** The rider's oloo coupons and redeeming a code, as in the official app's 優惠券. */
export function CouponsView() {
	const back = useUiStore(state => state.back);
	const queryClient = useQueryClient();
	const coupons = useCoupons();
	const [code, setCode] = useState("");
	const [redeemed, setRedeemed] = useState<string | null>(null);
	const redeem = useMutation({
		mutationFn: (value: string) => apiRequest("/v1/coupons/redeem", { method: "POST", body: JSON.stringify({ code: value }) }),
		onSuccess: (_, value) => {
			setRedeemed(value);
			setCode("");
			void queryClient.invalidateQueries({ queryKey: ["coupons"] });
		}
	});
	const submit = (event: FormEvent) => {
		event.preventDefault();
		setRedeemed(null);
		if (code.trim()) redeem.mutate(code.trim());
	};
	const open = (coupons.data ?? []).filter(coupon => coupon.state === "usable" || coupon.state === "pending");
	const closed = (coupons.data ?? []).filter(coupon => coupon.state === "used" || coupon.state === "expired");

	return (
		<>
			<header className="view-head" data-sheet-drag>
				<button type="button" className="icon-button" aria-label="返回" onClick={back}>
					<ArrowLeft size={18} weight="bold" />
				</button>
				<div className="view-head-title">
					<h2>優惠券</h2>
				</div>
			</header>
			<div className="view-body">
				<form className="redeem-form" onSubmit={submit}>
					<label className="field">
						<span>優惠代碼</span>
						<input value={code} onChange={event => setCode(event.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="輸入代碼" />
					</label>
					<button type="submit" className="button button-primary" disabled={redeem.isPending || !code.trim()}>
						{redeem.isPending ? "兌換中…" : "兌換"}
					</button>
				</form>
				{redeemed ? <p className="muted small">已兌換 {redeemed}。</p> : null}
				{redeem.error ? <p className="inline-error">兌換失敗：{redeem.error.message}</p> : null}

				{coupons.isPending ? <p className="skeleton-text">讀取優惠券</p> : null}
				{coupons.error ? <p className="inline-error">讀不到優惠券：{coupons.error.message}</p> : null}
				{coupons.data && open.length === 0 ? <p className="muted">目前沒有可用的優惠券。</p> : null}
				<CouponList coupons={open} label="可用的優惠券" />
				{closed.length > 0 ? (
					<section className="section">
						<h3 className="section-title">已使用或過期</h3>
						<CouponList coupons={closed} label="已使用或過期的優惠券" />
					</section>
				) : null}
				<p className="muted small">騎乘用的優惠券由 oloo 在結帳時套用；購買方案或加值時可以在付款前選擇。</p>
			</div>
		</>
	);
}

function CouponList({ coupons, label }: { coupons: Coupon[]; label: string }) {
	if (coupons.length === 0) return null;
	return (
		<ul className="coupon-list" aria-label={label}>
			{coupons.map(coupon => (
				<li key={coupon.id} className="coupon-card" data-state={coupon.state}>
					<div className="plan-card-head">
						<div>
							<strong>{coupon.name}</strong>
							<span>
								{couponScopeLabels[coupon.scope]}
								{coupon.description ? ` · ${coupon.description}` : ""}
							</span>
						</div>
						<span className="status-tag" data-tone={coupon.state === "usable" ? "available" : coupon.state === "pending" ? "low_battery" : "unavailable"}>
							{stateLabels[coupon.state]}
						</span>
					</div>
					<p className="muted small">
						{coupon.state === "used" && coupon.usedAt
							? `${date(coupon.usedAt)} 使用`
							: [date(coupon.startsAt), date(coupon.endsAt)].every(Boolean)
								? `${date(coupon.startsAt)} – ${date(coupon.endsAt)}`
								: date(coupon.endsAt)
									? `到 ${date(coupon.endsAt)}`
									: "沒有期限"}
					</p>
					{coupon.information ? (
						<details className="coupon-details">
							<summary>使用說明</summary>
							<p>{coupon.information}</p>
						</details>
					) : null}
				</li>
			))}
		</ul>
	);
}
