import { z } from "zod";
import { olooRequest } from "./oloo.js";

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

const optionSchema = z.array(z.object({ name: z.string(), value: z.string().nullish() }).passthrough());
const canPurchaseSchema = z.object({ canPurchase: z.boolean(), reasons: z.array(z.string()).default([]) }).passthrough();

/** oloo's reason codes from `contracts/can-purchase/:id`; unknown ones are shown as-is. */
const reasonLabels: Record<string, string> = {
	CONTRACT_DISABLED: "已停售"
};

function lines(description: z.infer<typeof descriptionLine>[] | null) {
	return (description ?? []).map(line => [line.prefixTag, line.text, line.suffixTag].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean);
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
	const mappingText = optionSchema.parse(optionsRaw).find(option => option.name === "area_contract_mapping")?.value;
	const mapping = z
		.record(z.string(), z.array(z.coerce.number()))
		.catch({})
		.parse(mappingText ? JSON.parse(mappingText) : {});
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

	const plans = offered.flatMap((contractId, index) => {
		const contract = contracts.get(contractId);
		const plan = contract?.itemId != null ? ridePlans.get(contract.itemId) : undefined;
		if (!contract || !plan || contract.details?.disabled === true || plan.isActive === false) return [];
		const check = checks[index];
		return [
			{
				contractId,
				name: plan.name,
				tagline: plan.details?.cardBanner?.title ?? null,
				kind: contract.paymentType === "Monthly" ? ("monthly" as const) : ("pass" as const),
				price: contract.details?.actualPayPrice ?? plan.actualPayPrice ?? null,
				includedMinutes: plan.planMinutes ?? null,
				periodDays: plan.period ?? null,
				ratePerMinute: plan.normalRate ?? null,
				lines: lines(plan.description),
				current: activeContract?.contractId === contractId,
				next: takeEffect.nextActivateRidePlan?.id === plan.id,
				canPurchase: check?.canPurchase ?? null,
				reasons: (check?.reasons ?? []).map(reason => reasonLabels[reason] ?? reason)
			}
		];
	});

	const autoRenewCanceled = activeContract?.details?.autoRenewCanceled ?? activeContract?.details?.opts?.autoRenewCanceled ?? null;
	return {
		region,
		current: activePlan
			? {
					name: activePlan.ridePlan?.name ?? null,
					startsAt: activePlan.startDate ?? null,
					endsAt: activePlan.endDate ?? null,
					includedMinutes: activePlan.ridePlan?.planMinutes ?? null,
					remainingMinutes: activePlan.remainingMinutes ?? null,
					ratePerMinute: activePlan.ridePlan?.normalRate ?? null,
					autoRenew: autoRenewCanceled === null ? null : !autoRenewCanceled,
					nextPlanName: takeEffect.nextActivateRidePlan?.name ?? null,
					topUps: (activeContract ? contracts.get(activeContract.contractId)?.details?.topUp : null)?.map(item => ({ minutes: item.minutes, price: item.price, tag: item.tag ?? null })) ?? []
				}
			: null,
		plans
	};
}
