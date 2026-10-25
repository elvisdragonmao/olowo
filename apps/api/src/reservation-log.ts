import type pg from "pg";

export type ReservationAction = "reserve" | "cancel";

const hour = 60 * 60_000;
const week = 7 * 24 * hour;

/**
 * Reservations and cancellations made through olowo. oloo limits reservations per hour and penalises
 * frequent cancellations within a week; showing the rider's own recent count keeps them clear of it.
 * Actions taken in the official app are not visible here.
 */
export class ReservationLog {
	readonly #memory = new Map<number, Array<{ action: ReservationAction; at: number }>>();

	constructor(readonly database: pg.Pool | null) {}

	async record(userId: number, action: ReservationAction) {
		if (this.database) {
			await this.database.query("INSERT INTO reservation_events (provider_user_id, action) VALUES ($1, $2)", [userId, action]);
			return;
		}
		const events = (this.#memory.get(userId) ?? []).filter(event => Date.now() - event.at < week);
		events.push({ action, at: Date.now() });
		this.#memory.set(userId, events);
	}

	async usage(userId: number) {
		if (this.database) {
			const row = (
				await this.database.query<{ reserved_last_hour: string; cancelled_this_week: string }>(
					`SELECT count(*) FILTER (WHERE action = 'reserve' AND created_at > now() - interval '1 hour') AS reserved_last_hour,
					        count(*) FILTER (WHERE action = 'cancel' AND created_at > now() - interval '7 days') AS cancelled_this_week
					 FROM reservation_events WHERE provider_user_id = $1 AND created_at > now() - interval '7 days'`,
					[userId]
				)
			).rows[0];
			return { reservedLastHour: Number(row?.reserved_last_hour ?? 0), cancelledThisWeek: Number(row?.cancelled_this_week ?? 0) };
		}
		const events = this.#memory.get(userId) ?? [];
		return {
			reservedLastHour: events.filter(event => event.action === "reserve" && Date.now() - event.at < hour).length,
			cancelledThisWeek: events.filter(event => event.action === "cancel" && Date.now() - event.at < week).length
		};
	}
}
