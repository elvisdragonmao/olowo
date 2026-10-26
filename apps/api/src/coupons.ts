import { z } from "zod";
import { olooRequest, OlooUpstreamError } from "./oloo.js";

const jsonText = <T extends z.ZodTypeAny>(schema: T) =>
	z.preprocess(value => {
		if (typeof value !== "string") return value;
		try {
			return JSON.parse(value) as unknown;
		} catch {
			return null;
		}
	}, schema.nullable().catch(null));

const couponSchema = z
	.object({
		id: z.coerce.number(),
		name: z.string(),
		description: z.string().nullish(),
		attributes: jsonText(z.object({ information: z.string().nullish() }).passthrough()),
		usableConditions: jsonText(z.array(z.array(z.record(z.string(), z.unknown()))))
	})
	.passthrough();

const userCouponSchema = z
	.object({
		id: z.coerce.number(),
		couponId: z.coerce.number(),
		isApplied: z.boolean().nullish(),
		appliedAt: z.string().nullish(),
		usableStart: z.string().nullish(),
		usableEnd: z.string().nullish()
	})
	.passthrough();

export type CouponScope = "ride" | "plan" | "topUp" | "any";

/** `usableConditions` is OR-of-AND; the flags name what a coupon can be spent on. */
function couponScope(conditions: Array<Array<Record<string, unknown>>> | null): CouponScope {
	const flags = new Set((conditions ?? []).flat().flatMap(condition => Object.keys(condition)));
	if (flags.has("forContractPurchase")) return "plan";
	if (flags.has("forTopUp")) return "topUp";
	if (flags.has("forScooterRental") || flags.has("rentalCost")) return "ride";
	return "any";
}

/** The rider's coupons (`user-coupons/self`) joined with oloo's catalog (`coupons`), newest first. */
export async function fetchCoupons(baseUrl: string, token: string) {
	const [owned, catalog] = await Promise.all([olooRequest<unknown>(baseUrl, "/user-coupons/self", token), olooRequest<unknown>(baseUrl, "/coupons", token)]);
	const coupons = new Map(
		z
			.array(z.unknown())
			.parse(catalog)
			.flatMap(raw => {
				const parsed = couponSchema.safeParse(raw);
				return parsed.success ? [[parsed.data.id, parsed.data] as const] : [];
			})
	);
	const now = Date.now();
	return z
		.array(userCouponSchema)
		.parse(owned)
		.map(userCoupon => {
			const coupon = coupons.get(userCoupon.couponId);
			const endsAt = userCoupon.usableEnd ?? null;
			const startsAt = userCoupon.usableStart ?? null;
			const used = userCoupon.isApplied === true;
			const expired = endsAt != null && Date.parse(endsAt) < now;
			const pending = startsAt != null && Date.parse(startsAt) > now;
			return {
				id: userCoupon.id,
				name: coupon?.name ?? "優惠券",
				description: coupon?.description || null,
				information: coupon?.attributes?.information?.trim() || null,
				scope: couponScope(coupon?.usableConditions ?? null),
				startsAt,
				endsAt,
				usedAt: userCoupon.appliedAt ?? null,
				state: used ? ("used" as const) : expired ? ("expired" as const) : pending ? ("pending" as const) : ("usable" as const)
			};
		})
		.sort((a, b) => Date.parse(b.startsAt ?? "") - Date.parse(a.startsAt ?? "") || b.id - a.id);
}

/**
 * Redeems a code the way the official app does: `coupons/detect-code-type/:code` says whether it is a campaign code
 * (`coupons/acquire-by-code`) or a code another rider shared (`user-coupons/acquire-by-code`).
 */
export async function redeemCoupon(baseUrl: string, token: string, code: string) {
	const path = encodeURIComponent(code);
	const type = z
		.object({ isCoupon: z.boolean().default(false), isUserCoupon: z.boolean().default(false) })
		.passthrough()
		.parse(await olooRequest<unknown>(baseUrl, `/coupons/detect-code-type/${path}`, token));
	if (!type.isCoupon && !type.isUserCoupon) throw new OlooUpstreamError(404, "Unknown coupon code");
	const result = z
		.object({ success: z.boolean().optional(), message: z.string().nullish() })
		.passthrough()
		.parse((await olooRequest<unknown>(baseUrl, `/${type.isCoupon ? "coupons" : "user-coupons"}/acquire-by-code/${path}`, token, { method: "POST" })) ?? {});
	if (result.success === false) throw new OlooUpstreamError(409, result.message ?? "oloo rejected the code");
	return { success: true };
}
