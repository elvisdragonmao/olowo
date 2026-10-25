import type pg from "pg";
import type { RideAutomation } from "./ride-automation.js";

export interface StoredScheduledAction {
	id: string;
	userId: number;
	rideId: number;
	scooterId: number;
	action: RideAutomation["action"];
	triggerAt: number;
	createdAt: number;
}

export class ScheduledActionRepository {
	constructor(readonly database: pg.Pool | null) {}

	async saveRide(task: RideAutomation) {
		if (!this.database) return;
		await this.database.query(
			`INSERT INTO scheduled_actions (id, provider_user_id, ride_id, scooter_id, action, trigger_at, state, error, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			 ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, error = EXCLUDED.error, updated_at = EXCLUDED.updated_at`,
			[task.id, task.userId, task.rideId, task.scooterId, task.action, new Date(task.triggerAt), task.state, task.error ?? null, new Date(task.createdAt), new Date(task.updatedAt)]
		);
	}

	async loadPending(): Promise<StoredScheduledAction[]> {
		if (!this.database) return [];
		const result = await this.database.query<{
			id: string;
			provider_user_id: string;
			ride_id: string;
			scooter_id: string;
			action: RideAutomation["action"];
			trigger_at: Date;
			created_at: Date;
		}>("SELECT id, provider_user_id, ride_id, scooter_id, action, trigger_at, created_at FROM scheduled_actions WHERE state IN ('scheduled', 'running') ORDER BY trigger_at");
		return result.rows.map(row => ({
			id: row.id,
			userId: Number(row.provider_user_id),
			rideId: Number(row.ride_id),
			scooterId: Number(row.scooter_id),
			action: row.action,
			triggerAt: row.trigger_at.getTime(),
			createdAt: row.created_at.getTime()
		}));
	}

	/**
	 * Atomically takes a due job. Every instance restores pending jobs at startup, so only the one that
	 * wins this update may execute. A `running` row older than a minute was interrupted and may be retaken;
	 * the executor's active-ride re-check keeps that retry safe.
	 */
	async claim(id: string) {
		if (!this.database) return true;
		const result = await this.database.query(
			`UPDATE scheduled_actions SET state = 'running', updated_at = now()
			 WHERE id = $1 AND (state = 'scheduled' OR (state = 'running' AND updated_at < now() - interval '1 minute'))
			 RETURNING id`,
			[id]
		);
		return (result.rowCount ?? 0) > 0;
	}

	async fail(id: string, error: string) {
		if (this.database) await this.database.query("UPDATE scheduled_actions SET state = 'failed', error = $2, updated_at = now() WHERE id = $1", [id, error]);
	}
}
