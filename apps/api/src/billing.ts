import { z } from "zod";
import { olooRequest, OlooUpstreamError } from "./oloo.js";

/** Public view of oloo's bill / estimate-bill. Per-minute buckets are reduced to durations and costs. */
export interface PublicBill {
	rideId: number | null;
	label: string | null;
	cost: number;
	minimumPrice: number;
	ridingMinutes: number;
	parkedMinutes: number;
	ratePerMinute: number | null;
	planName: string | null;
	startedAt: string | null;
	endedAt: string | null;
}

const bucket = z.object({ duration: z.coerce.number().default(0), cost: z.coerce.number().default(0), costPerMin: z.coerce.number().optional() }).partial();

const billSchema = z
	.object({
		rentalCost: z.coerce.number(),
		minPrice: z.coerce.number().default(0),
		costPerMinDurationsAndCosts: z
			.object({ normalMinutes: bucket.optional(), discountNormalMinutes: bucket.optional(), stopMinutes: bucket.optional(), discountStopMinutes: bucket.optional() })
			.partial()
			.nullish(),
		ridePlan: z.object({ name: z.string().optional(), normalRate: z.coerce.number().optional() }).partial().nullish(),
		rentalStartedAt: z.string().nullish(),
		rentalEndedAt: z.string().nullish(),
		engineLicenseNumber: z.string().nullish(),
		scooterRentalLogId: z.coerce.number().nullish()
	})
	.passthrough();

const minutes = (milliseconds: number | undefined) => Math.round(((milliseconds ?? 0) / 60_000) * 10) / 10;

export function toPublicBill(value: unknown): PublicBill {
	const bill = billSchema.parse(value);
	const buckets = bill.costPerMinDurationsAndCosts ?? {};
	return {
		rideId: bill.scooterRentalLogId ?? null,
		label: bill.engineLicenseNumber ?? null,
		cost: bill.rentalCost,
		minimumPrice: bill.minPrice,
		ridingMinutes: minutes((buckets.normalMinutes?.duration ?? 0) + (buckets.discountNormalMinutes?.duration ?? 0)),
		parkedMinutes: minutes((buckets.stopMinutes?.duration ?? 0) + (buckets.discountStopMinutes?.duration ?? 0)),
		ratePerMinute: buckets.normalMinutes?.costPerMin ?? bill.ridePlan?.normalRate ?? null,
		planName: bill.ridePlan?.name ?? null,
		startedAt: bill.rentalStartedAt ?? null,
		endedAt: bill.rentalEndedAt ?? null
	};
}

const cardSchema = z.array(z.object({ id: z.coerce.number(), issuer: z.string().nullish(), lastFour: z.string().nullish(), isValid: z.boolean().nullish() }).passthrough());

/** Card id, issuer and last four only; the provider account id never leaves the server. */
export async function fetchCards(baseUrl: string, token: string) {
	const cards = cardSchema.parse(await olooRequest<unknown>(baseUrl, "/transaction-logs/get-card", token));
	return cards.map(card => ({ id: card.id, issuer: card.issuer ?? null, lastFour: card.lastFour ?? null, valid: card.isValid !== false }));
}

/** Uploads a genuine return photo the rider took; oloo answers with the image record used by checkout. */
export async function uploadReturnPhoto(baseUrl: string, token: string, rideId: number, image: Buffer, contentType: string) {
	const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
	const form = new FormData();
	form.append("file", new Blob([new Uint8Array(image)], { type: contentType }), `${rideId}-${new Date().toISOString()}.${extension}`);
	const result = z
		.object({ success: z.boolean().optional(), raw: z.object({ id: z.coerce.number(), rentalId: z.coerce.number().nullish() }).passthrough() })
		.parse(await olooRequest<unknown>(baseUrl, "/account-rental-images/upload/?type=SCOOTER&when=RETURN", token, { method: "POST", body: form }));
	if (result.success === false) throw new OlooUpstreamError(409, "oloo rejected the return photo");
	if (result.raw.rentalId != null && result.raw.rentalId !== rideId) throw new OlooUpstreamError(409, "The photo was attached to a different ride");
	return { imageId: result.raw.id };
}
