import type pg from "pg";
import type { ReservationAutomation } from "./reservation-automation.js";
import type { RideAutomation } from "./ride-automation.js";

export type StoredScheduledAction =
	| { id: string; kind: "ride"; userId: number; rideId: number; scooterId: number; action: RideAutomation["action"]; triggerAt: number; createdAt: number }
	| { id: string; kind: "reservation"; userId: number; scooterId: number; engineLicenseNumber: string; triggerAt: number; createdAt: number };

export class ScheduledActionRepository {
	constructor(readonly database: pg.Pool | null) {}

	async saveRide(task: RideAutomation) {
		if (!this.database) return;
		await this.database.query(
			`INSERT INTO scheduled_actions (id, provider_user_id, kind, ride_id, scooter_id, action, trigger_at, state, error, created_at, updated_at)
			 VALUES ($1, $2, 'ride', $3, $4, $5, $6, $7, $8, $9, $10)
			 ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, error = EXCLUDED.error, updated_at = EXCLUDED.updated_at`,
			[task.id, task.userId, task.rideId, task.scooterId, task.action, new Date(task.triggerAt), task.state, task.error ?? null, new Date(task.createdAt), new Date(task.updatedAt)]
		);
	}

	async saveReservation(task: ReservationAutomation) {
		if (!this.database) return;
		await this.database.query(
			`INSERT INTO scheduled_actions (id, provider_user_id, kind, scooter_id, engine_license_number, trigger_at, state, error, result, created_at, updated_at)
			 VALUES ($1, $2, 'reservation', $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
			 ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, error = EXCLUDED.error, result = EXCLUDED.result, updated_at = EXCLUDED.updated_at`,
			[
				task.id,
				task.userId,
				task.scooterId,
				task.engineLicenseNumber,
				new Date(task.triggerAt),
				task.state,
				task.error ?? null,
				JSON.stringify({ reservationId: task.reservationId, expiresAt: task.expiresAt }),
				new Date(task.createdAt),
				new Date(task.updatedAt)
			]
		);
	}

	async loadPending(): Promise<StoredScheduledAction[]> {
		if (!this.database) return [];
		const result = await this.database.query<{
			id: string;
			provider_user_id: string;
			kind: "ride" | "reservation";
			ride_id: string | null;
			scooter_id: string;
			engine_license_number: string | null;
			action: RideAutomation["action"] | null;
			trigger_at: Date;
			created_at: Date;
		}>(
			"SELECT id, provider_user_id, kind, ride_id, scooter_id, engine_license_number, action, trigger_at, created_at FROM scheduled_actions WHERE state IN ('scheduled', 'running') ORDER BY trigger_at"
		);
		const stored: StoredScheduledAction[] = [];
		for (const row of result.rows) {
			const common = { id: row.id, userId: Number(row.provider_user_id), scooterId: Number(row.scooter_id), triggerAt: row.trigger_at.getTime(), createdAt: row.created_at.getTime() };
			if (row.kind === "ride" && row.ride_id && row.action) stored.push({ ...common, kind: "ride", rideId: Number(row.ride_id), action: row.action });
			if (row.kind === "reservation" && row.engine_license_number) stored.push({ ...common, kind: "reservation", engineLicenseNumber: row.engine_license_number });
		}
		return stored;
	}

	async fail(id: string, error: string) {
		if (this.database) await this.database.query("UPDATE scheduled_actions SET state = 'failed', error = $2, updated_at = now() WHERE id = $1", [id, error]);
	}
}
