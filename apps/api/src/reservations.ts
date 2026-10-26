import { z } from "zod";

/** oloo holds a reserved scooter for five minutes (help centre: 「預約滑板車後將為您保留5分鐘，逾時則會自動取消」). */
export const reservationHoldMs = 5 * 60_000;
/** Help centre: 「一小時內車輛預約不能超過兩次」. */
export const reservationsPerHour = 2;

// oloo sends `expired` as epoch milliseconds (reservation/current, overall-current) and sometimes as an ISO string.
const instant = z.union([z.number(), z.string()]).transform(value => {
	const millis = typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : Date.parse(value);
	return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
});

const reservationSchema = z
	.object({
		id: z.coerce.number().int().positive().optional(),
		reservationId: z.coerce.number().int().positive().optional(),
		type: z.string().nullish(),
		scootersInfoId: z.coerce.number().int().positive().nullish(),
		vehiclesInfoId: z.coerce.number().int().positive().nullish(),
		EngineLicenseNumber: z.string().nullish(),
		scootersInfo: z.object({ EngineLicenseNumber: z.string().nullish() }).partial().passthrough().nullish(),
		createdAt: instant.nullish(),
		expired: instant.nullish()
	})
	.passthrough();

export function toPublicReservation(value: unknown) {
	const item = reservationSchema.parse(value);
	const createdAt = item.createdAt ?? null;
	return {
		id: item.id ?? item.reservationId ?? null,
		type: item.type ?? null,
		scooterId: item.scootersInfoId ?? null,
		vehicleId: item.vehiclesInfoId ?? null,
		label: item.EngineLicenseNumber ?? item.scootersInfo?.EngineLicenseNumber ?? null,
		createdAt,
		// Fall back to the documented hold when oloo leaves the deadline out.
		expiresAt: item.expired ?? (createdAt ? new Date(Date.parse(createdAt) + reservationHoldMs).toISOString() : null)
	};
}

const recentSchema = z.array(z.object({ isCancel: z.boolean().nullish(), isPickUp: z.boolean().nullish(), createdAt: z.string() }).passthrough()).catch([]);

/**
 * Usage from oloo's own `reservation/self-anhour` (what the official app counts for 「一個小時內你還可預約 N 次」),
 * so reservations made in the official app count too.
 */
export function reservationUsage(selfAnHour: unknown, now = Date.now()) {
	const recent = recentSchema.parse(selfAnHour ?? []).filter(item => now - Date.parse(item.createdAt) < 60 * 60_000);
	const oldest = recent.map(item => Date.parse(item.createdAt)).sort((a, b) => a - b)[0];
	return {
		limitPerHour: reservationsPerHour,
		reservedLastHour: recent.length,
		cancelledLastHour: recent.filter(item => item.isCancel).length,
		remaining: Math.max(0, reservationsPerHour - recent.length),
		// When the oldest one leaves the window, one slot opens again.
		nextSlotAt: recent.length >= reservationsPerHour && oldest != null ? new Date(oldest + 60 * 60_000).toISOString() : null
	};
}
