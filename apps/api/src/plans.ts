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

const descriptionLine = z.object({ prefixTag: z.string().nullish(), text: z.string().nullish(), suffixTag: z.string().nullish() }).passthrough();

const ridePlanSchema = z
	.object({
		id: z.coerce.number(),
		name: z.string(),
		isActive: z.boolean().nullish(),
		minMinute: z.coerce.number().nullish(),
		minPrice: z.coerce.number().nullish(),
		normalRate: z.coerce.number().nullish(),
		actualPayPrice: z.coerce.number().nullish(),
		planMinutes: z.coerce.number().nullish(),
		period: z.coerce.number().nullish(),
		description: jsonText(z.array(descriptionLine)),
		details: jsonText(z.object({ cardBanner: z.object({ title: z.coerce.string().nullish() }).partial().nullish() }).passthrough())
	})
	.passthrough();

const contractSchema = z
	.object({
		id: z.coerce.number(),
		name: z.string(),
		paymentType: z.string().nullish(),
		itemId: z.coerce.number().nullish(),
		details: jsonText(
			z
				.object({
					disabled: z.boolean().nullish(),
					actualPayPrice: z.coerce.number().nullish(),
					topUp: z.array(z.object({ id: z.coerce.number(), minutes: z.coerce.number(), price: z.coerce.number(), tag: z.string().nullish() }).passthrough()).nullish()
				})
				.passthrough()
		)
	})
	.passthrough();

const takeEffectSchema = z
	.object({
		activeUserContract: z
			.array(
				z
					.object({
						id: z.coerce.number().nullish(),
						contractId: z.coerce.number(),
						details: jsonText(z.object({ autoRenewCanceled: z.boolean().nullish(), opts: z.object({ autoRenewCanceled: z.boolean().nullish() }).partial().nullish() }).passthrough())
					})
					.passthrough()
			)
			.nullish(),
		activatedUserRidePlan: z
			.object({
				startDate: z.string().nullish(),
				endDate: z.string().nullish(),
				remainingMinutes: z.coerce.number().nullish(),
				ridePlanId: z.coerce.number().nullish(),
				ridePlan: z.object({ name: z.string().nullish(), planMinutes: z.coerce.number().nullish(), normalRate: z.coerce.number().nullish() }).partial().passthrough().nullish()
			})
			.passthrough()
			.nullish(),
		nextActivateRidePlan: z.object({ id: z.coerce.number().nullish(), name: z.string().nullish() }).partial().passthrough().nullish()
	})
	.passthrough();
type TakeEffect = z.infer<typeof takeEffectSchema>;
type Contract = z.infer<typeof contractSchema>;
type RidePlan = z.infer<typeof ridePlanSchema>;

const availabilityOrder = { other_region: 0, unlisted: 1, retired: 2 } as const;

const optionSchema = z.array(z.object({ name: z.string(), value: z.string().nullish() }).passthrough());
const canPurchaseSchema = z.object({ canPurchase: z.boolean(), reasons: z.array(z.string()).default([]) }).passthrough();

/** oloo's reason codes from `contracts/can-purchase/:id`; unknown ones are shown as-is. */
const reasonLabels: Record<string, string> = {
	CONTRACT_DISABLED: "已停售"
};

function lines(description: z.infer<typeof descriptionLine>[] | null) {
	return (description ?? []).map(line => [line.prefixTag, line.text, line.suffixTag].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean);
}

function areaMapping(options: unknown) {
	const mappingText = optionSchema.parse(options).find(option => option.name === "area_contract_mapping")?.value;
	return z
		.record(z.string(), z.array(z.coerce.number()))
		.catch({})
		.parse(mappingText ? JSON.parse(mappingText) : {});
}

/** `passport_schools`: region code → `{ shortName, name }`, e.g. NCHU → 中興. */
function schoolNames(options: unknown) {
	const text = optionSchema.parse(options).find(option => option.name === "passport_schools")?.value;
	try {
		return z
			.record(z.string(), z.object({ shortName: z.string() }).passthrough())
			.catch({})
			.parse(text ? JSON.parse(text) : {});
	} catch {
		return {};
	}
}

/** Every contract some region offers; hidden campaign and staff contracts are not sold through olowo. */
function offeredContractIds(options: unknown) {
	return new Set(Object.values(areaMapping(options)).flat());
}

/**
 * The plans oloo offers in a region (`oloo-options.area_contract_mapping`), each checked with the same
 * `contracts/can-purchase/:id` the official app uses, plus the rider's current plan.
 */
export async function fetchPlanCatalog(baseUrl: string, token: string, region: string | null) {
	const [contractsRaw, ridePlansRaw, optionsRaw, takeEffectRaw] = await Promise.all([
		olooRequest<unknown>(baseUrl, "/contracts", token),
		olooRequest<unknown>(baseUrl, "/ride-plans", token),
		olooRequest<unknown>(baseUrl, "/oloo-options", token),
		olooRequest<unknown>(baseUrl, "/user-contracts/take-self-effect", token)
	]);
	const contracts = new Map(
		z
			.array(contractSchema)
			.parse(contractsRaw)
			.map(contract => [contract.id, contract])
	);
	const ridePlans = new Map(
		z
			.array(ridePlanSchema)
			.parse(ridePlansRaw)
			.map(plan => [plan.id, plan])
	);
	const mapping = areaMapping(optionsRaw);
	const schools = schoolNames(optionsRaw);
	const offered = (region ? mapping[region] : undefined) ?? mapping.default ?? [];
	const takeEffect = takeEffectSchema.parse(takeEffectRaw ?? {});
	const activeContract = takeEffect.activeUserContract?.[0] ?? null;
	const activePlan = takeEffect.activatedUserRidePlan ?? null;

	const checks = await Promise.all(
		offered.map(id =>
			olooRequest<unknown>(baseUrl, `/contracts/can-purchase/${id}`, token)
				.then(value => canPurchaseSchema.parse(value))
				.catch(() => null)
		)
	);

	const describe = (contract: Contract, plan: RidePlan) => ({
		contractId: contract.id,
		name: plan.name,
		tagline: plan.details?.cardBanner?.title ?? null,
		kind: contract.paymentType === "Monthly" ? ("monthly" as const) : ("pass" as const),
		price: contract.details?.actualPayPrice ?? plan.actualPayPrice ?? null,
		includedMinutes: plan.planMinutes ?? null,
		periodDays: plan.period ?? null,
		ratePerMinute: plan.normalRate ?? null,
		startPrice: plan.minPrice ?? null,
		startMinutes: plan.minMinute ?? null,
		lines: lines(plan.description)
	});

	const plans = offered.flatMap((contractId, index) => {
		const contract = contracts.get(contractId);
		const plan = contract?.itemId != null ? ridePlans.get(contract.itemId) : undefined;
		if (!contract || !plan || contract.details?.disabled === true || plan.isActive === false) return [];
		const check = checks[index];
		return [
			{
				...describe(contract, plan),
				current: activeContract?.contractId === contractId,
				next: takeEffect.nextActivateRidePlan?.id === plan.id,
				canPurchase: check?.canPurchase ?? null,
				reasons: (check?.reasons ?? []).map(reason => reasonLabels[reason] ?? reason)
			}
		];
	});

	// Everything else in /contracts, to compare against: never sold through olowo. Variants that differ only in
	// installment count (e.g. Starter 1/4/10) share a ride plan and price, so one of each is kept.
	const listed = new Set(plans.map(plan => plan.contractId));
	const seen = new Set<string>();
	const others = [...contracts.values()]
		.flatMap(contract => {
			const plan = contract.itemId != null ? ridePlans.get(contract.itemId) : undefined;
			if (!plan || listed.has(contract.id)) return [];
			const described = describe(contract, plan);
			const key = `${plan.id}:${described.price}`;
			if (seen.has(key)) return [];
			seen.add(key);
			const regions = Object.entries(mapping)
				.filter(([name, ids]) => name !== "default" && ids.includes(contract.id))
				.map(([name]) => schools[name]?.shortName ?? name);
			// oloo parks some passes at $99999 instead of disabling them.
			const retired = contract.details?.disabled === true || plan.isActive === false || (described.price ?? 0) >= 99999;
			const availability = retired ? ("retired" as const) : regions.length > 0 ? ("other_region" as const) : ("unlisted" as const);
			return [{ ...described, availability, regions }];
		})
		.sort((a, b) => availabilityOrder[a.availability] - availabilityOrder[b.availability] || (a.price ?? 0) - (b.price ?? 0));

	const autoRenewCanceled = activeContract?.details?.autoRenewCanceled ?? activeContract?.details?.opts?.autoRenewCanceled ?? null;
	return {
		region,
		current: activePlan
			? {
					userContractId: activeContract?.id ?? null,
					contractId: activeContract?.contractId ?? null,
					name: activePlan.ridePlan?.name ?? null,
					startsAt: activePlan.startDate ?? null,
					endsAt: activePlan.endDate ?? null,
					includedMinutes: activePlan.ridePlan?.planMinutes ?? null,
					remainingMinutes: activePlan.remainingMinutes ?? null,
					ratePerMinute: activePlan.ridePlan?.normalRate ?? null,
					autoRenew: autoRenewCanceled === null ? null : !autoRenewCanceled,
					nextPlanName: takeEffect.nextActivateRidePlan?.name ?? null,
					topUps:
						(activeContract ? contracts.get(activeContract.contractId)?.details?.topUp : null)?.map(item => ({ id: item.id, minutes: item.minutes, price: item.price, tag: item.tag ?? null })) ?? []
				}
			: null,
		plans,
		others
	};
}

const estimateSchema = z
	.object({
		success: z.boolean().optional(),
		result: z
			.object({
				details: jsonText(
					z
						.object({
							startTime: z.string().nullish(),
							endTime: z.string().nullish(),
							activateDatas: z.array(z.object({ amount: z.coerce.number().nullish(), ridePlanTitle: z.string().nullish() }).passthrough()).nullish()
						})
						.passthrough()
				)
			})
			.passthrough()
			.nullish()
	})
	.passthrough();

const purchaseResultSchema = z.object({ success: z.boolean().optional(), message: z.string().nullish() }).passthrough();

// oloo writes these as "2026-11-01 15:59:59Z".
const isoTime = (value: string | null | undefined) => {
	const time = value ? Date.parse(value.replace(" ", "T")) : Number.NaN;
	return Number.isNaN(time) ? null : new Date(time).toISOString();
};

async function requireOffered(baseUrl: string, token: string, contractId: number) {
	if (!offeredContractIds(await olooRequest<unknown>(baseUrl, "/oloo-options", token)).has(contractId)) throw new OlooUpstreamError(404, "This plan is not on sale");
}

async function activeUserContractId(baseUrl: string, token: string) {
	const takeEffect: TakeEffect = takeEffectSchema.parse((await olooRequest<unknown>(baseUrl, "/user-contracts/take-self-effect", token)) ?? {});
	const id = takeEffect.activeUserContract?.[0]?.id;
	if (id == null) throw new OlooUpstreamError(409, "No active plan");
	return id;
}

/** The body the official app posts to purchase and estimate: the chosen coupon (`prime` is only for LINE Pay). */
const purchaseOptions = (userCouponId: number | null) => JSON.stringify(userCouponId ? { userCouponId } : {});

function requirePurchased(value: unknown, fallback: string) {
	const result = purchaseResultSchema.parse(value ?? {});
	if (result.success === false) throw new OlooUpstreamError(409, result.message ?? fallback);
}

/** What oloo would charge and when the plan would run (`contracts/estimate-purchase/:id`); nothing is charged. */
export async function estimatePlan(baseUrl: string, token: string, contractId: number, userCouponId: number | null) {
	await requireOffered(baseUrl, token, contractId);
	const estimate = estimateSchema.parse(await olooRequest<unknown>(baseUrl, `/contracts/estimate-purchase/${contractId}`, token, { method: "POST", body: purchaseOptions(userCouponId) }));
	if (estimate.success === false) throw new OlooUpstreamError(409, "oloo could not price this plan");
	const details = estimate.result?.details ?? null;
	const first = details?.activateDatas?.[0];
	return { contractId, amount: first?.amount ?? null, title: first?.ridePlanTitle ?? null, startsAt: isoTime(details?.startTime), endsAt: isoTime(details?.endTime) };
}

/** Buys a plan with the rider's selected card (`contracts/purchase-with-creditcard/:id`), as the official app does. */
export async function purchasePlan(baseUrl: string, token: string, contractId: number, userCouponId: number | null) {
	await requireOffered(baseUrl, token, contractId);
	requirePurchased(
		await olooRequest<unknown>(baseUrl, `/contracts/purchase-with-creditcard/${contractId}`, token, { method: "POST", body: purchaseOptions(userCouponId) }),
		"oloo rejected the purchase"
	);
	return { success: true, contractId };
}

export async function estimateTopUp(baseUrl: string, token: string, topUpId: number, userCouponId: number | null) {
	const userContractId = await activeUserContractId(baseUrl, token);
	const estimate = z
		.object({ estimatedResult: z.object({ minutes: z.coerce.number(), price: z.coerce.number() }).passthrough() })
		.passthrough()
		.parse(await olooRequest<unknown>(baseUrl, `/user-contracts/estimate-top-up/${userContractId}/${topUpId}`, token, { method: "POST", body: purchaseOptions(userCouponId) }));
	return { topUpId, minutes: estimate.estimatedResult.minutes, amount: estimate.estimatedResult.price };
}

/** Adds minutes to the running plan (`user-contracts/top-up-with-creditcard/:userContractId/:topUpId`). */
export async function purchaseTopUp(baseUrl: string, token: string, topUpId: number, userCouponId: number | null) {
	const userContractId = await activeUserContractId(baseUrl, token);
	requirePurchased(
		await olooRequest<unknown>(baseUrl, `/user-contracts/top-up-with-creditcard/${userContractId}/${topUpId}`, token, { method: "POST", body: purchaseOptions(userCouponId) }),
		"oloo rejected the top-up"
	);
	return { success: true, topUpId };
}

/** Stops the running plan from renewing (`user-contracts/cancel-auto-renew`). */
export async function cancelAutoRenew(baseUrl: string, token: string) {
	const id = await activeUserContractId(baseUrl, token);
	await olooRequest<unknown>(baseUrl, "/user-contracts/cancel-auto-renew", token, { method: "POST", body: JSON.stringify({ id }) });
	return { success: true };
}

/** Picks the plan the running one renews into (`user-contracts/specify-auto-renew-contract-id`). */
export async function setNextPlan(baseUrl: string, token: string, contractId: number) {
	await requireOffered(baseUrl, token, contractId);
	const userContractId = await activeUserContractId(baseUrl, token);
	await olooRequest<unknown>(baseUrl, "/user-contracts/specify-auto-renew-contract-id", token, { method: "POST", body: JSON.stringify({ userContractId, autoRenewContractId: contractId }) });
	return { success: true, contractId };
}
