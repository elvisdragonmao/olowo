import { randomUUID } from "node:crypto";

export type ReservationAutomationState = "scheduled" | "running" | "completed" | "failed" | "cancelled";

export interface ReservationAutomation {
	id: string;
	userId: number;
	scooterId: number;
	engineLicenseNumber: string;
	triggerAt: number;
	state: ReservationAutomationState;
	reservationId?: number;
	expiresAt?: string;
	error?: string;
	createdAt: number;
	updatedAt: number;
	timer?: NodeJS.Timeout;
}

type ReservationAutomationInput = Pick<ReservationAutomation, "userId" | "scooterId" | "engineLicenseNumber" | "triggerAt"> & { id?: string; createdAt?: number };

export class ReservationAutomationStore {
	readonly #automations = new Map<number, ReservationAutomation>();
	readonly #onChange?: (automation: ReservationAutomation) => void;

	constructor(onChange?: (automation: ReservationAutomation) => void) {
		this.#onChange = onChange;
	}

	schedule(input: ReservationAutomationInput, execute: (automation: ReservationAutomation) => Promise<{ reservationId?: number; expiresAt?: string }>) {
		this.cancel(input.userId);
		const now = Date.now();
		const automation: ReservationAutomation = { ...input, id: input.id ?? randomUUID(), state: "scheduled", createdAt: input.createdAt ?? now, updatedAt: now };
		automation.timer = setTimeout(
			async () => {
				automation.state = "running";
				automation.updatedAt = Date.now();
				this.#onChange?.(automation);
				try {
					const result = await execute(automation);
					automation.reservationId = result.reservationId;
					automation.expiresAt = result.expiresAt;
					automation.state = "completed";
				} catch (error) {
					automation.state = "failed";
					automation.error = error instanceof Error ? error.message : "Scheduled reservation failed";
				}
				automation.updatedAt = Date.now();
				this.#onChange?.(automation);
			},
			Math.max(0, input.triggerAt - now)
		);
		automation.timer.unref();
		this.#automations.set(input.userId, automation);
		this.#onChange?.(automation);
		return automation;
	}

	get(userId: number) {
		return this.#automations.get(userId) ?? null;
	}

	cancel(userId: number) {
		const automation = this.get(userId);
		if (!automation) return false;
		if (automation.timer) clearTimeout(automation.timer);
		automation.state = "cancelled";
		automation.updatedAt = Date.now();
		this.#onChange?.(automation);
		this.#automations.delete(userId);
		return true;
	}

	close() {
		for (const automation of this.#automations.values()) if (automation.timer) clearTimeout(automation.timer);
		this.#automations.clear();
	}
}

export function publicReservationAutomation(automation: ReservationAutomation | null) {
	if (!automation) return null;
	return {
		id: automation.id,
		scooterId: automation.scooterId,
		engineLicenseNumber: automation.engineLicenseNumber,
		triggerAt: new Date(automation.triggerAt).toISOString(),
		state: automation.state,
		reservationId: automation.reservationId,
		expiresAt: automation.expiresAt,
		error: automation.error,
		createdAt: new Date(automation.createdAt).toISOString(),
		updatedAt: new Date(automation.updatedAt).toISOString()
	};
}
