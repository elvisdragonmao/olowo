import { z } from "zod";

const jsonText = <T extends z.ZodTypeAny>(schema: T) =>
	z
		.string()
		.nullish()
		.transform(value => {
			try {
				return value ? (JSON.parse(value) as unknown) : null;
			} catch {
				return null;
			}
		})
		.pipe(schema.nullable().catch(null));

const onOffSchema = z.array(z.object({ type: z.enum(["on", "off"]), totalTime: z.coerce.number().default(0) }).passthrough());

const rentalLogSchema = z
	.object({
		id: z.coerce.number().int().positive(),
		engineLicenseNumber: z.string().nullish(),
		lastRentalStartedAt: z.string(),
		lastRentalEndedAt: z.string().nullish(),
		cost: z.coerce.number().nullish(),
		normalMinutes: z.coerce.number().nullish(),
		discountNormalMinutes: z.coerce.number().nullish(),
		stopMinutes: z.coerce.number().nullish(),
		discountStopMinutes: z.coerce.number().nullish(),
		isPaid: z.boolean().nullish(),
		startStationId: z.coerce.number().nullish(),
		endStationId: z.coerce.number().nullish(),
		ridePlan: jsonText(z.object({ name: z.string().nullish() }).passthrough()),
		onOffActionsRecord: jsonText(onOffSchema)
	})
	.passthrough();

/**
 * Seconds with the motor on and off. oloo bills each separately, rounded up to whole minutes
 * (observed on every ride since 2024: `normalMinutes = ⌈on⌉`, `stopMinutes = ⌈off⌉`); each record's
 * `totalTime` is how long the previous state lasted.
 */
function engineTime(records: z.infer<typeof onOffSchema> | null) {
	let on = 0;
	let off = 0;
	records?.forEach((record, index) => {
		const previous = records[index - 1];
		if (!previous) return;
		if (previous.type === "on") on += record.totalTime;
		else off += record.totalTime;
	});
	return { engineOnSeconds: Math.round(on / 100) / 10, engineOffSeconds: Math.round(off / 100) / 10 };
}

/** Rider-facing ride history; account, card, IMEI and invoice fields stay on the server. */
export function toRideHistory(value: unknown, stationName: (id: number) => string | null) {
	const logs = z.array(z.unknown()).parse(value);
	return logs.flatMap(raw => {
		const parsed = rentalLogSchema.safeParse(raw);
		if (!parsed.success) return [];
		const log = parsed.data;
		const endedAt = log.lastRentalEndedAt ?? null;
		return [
			{
				id: log.id,
				label: log.engineLicenseNumber ?? null,
				startedAt: log.lastRentalStartedAt,
				endedAt,
				durationSeconds: endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(log.lastRentalStartedAt)) / 1000)) : null,
				cost: log.cost ?? null,
				ridingMinutes: (log.normalMinutes ?? 0) + (log.discountNormalMinutes ?? 0),
				parkedMinutes: (log.stopMinutes ?? 0) + (log.discountStopMinutes ?? 0),
				...engineTime(log.onOffActionsRecord),
				paid: log.isPaid === true,
				planName: log.ridePlan?.name ?? null,
				startStation: log.startStationId ? stationName(log.startStationId) : null,
				endStation: log.endStationId ? stationName(log.endStationId) : null
			}
		];
	});
}
