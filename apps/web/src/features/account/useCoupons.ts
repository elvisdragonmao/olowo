import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../shared/api";
import { useSession } from "../auth/useSession";

export type CouponScope = "ride" | "plan" | "topUp" | "any";

export interface Coupon {
	id: number;
	name: string;
	description: string | null;
	information: string | null;
	scope: CouponScope;
	startsAt: string | null;
	endsAt: string | null;
	usedAt: string | null;
	state: "usable" | "pending" | "used" | "expired";
}

export const couponScopeLabels: Record<CouponScope, string> = {
	ride: "騎乘",
	plan: "購買方案",
	topUp: "加值時數",
	any: "不限"
};

export function useCoupons() {
	const session = useSession();
	return useQuery({
		queryKey: ["coupons"],
		queryFn: () => apiRequest<{ coupons: Coupon[] }>("/v1/coupons"),
		select: data => data.coupons,
		enabled: session.data?.authenticated === true
	});
}
