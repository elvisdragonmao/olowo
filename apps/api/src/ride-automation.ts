import { randomUUID } from "node:crypto";

export type AutomationAction = "notify" | "return" | "return_and_reborrow";
export type AutomationState = "scheduled" | "running" | "due" | "completed" | "failed" | "cancelled";

export interface RideAutomation {
	id: string;
	userId: number;
	rideId: number;
	scooterId: number;
	action: AutomationAction;
	triggerAt: number;
	state: AutomationState;
	error?: string;
	createdAt: number;
	updatedAt: number;
	timer?: NodeJS.Timeout;
}

export class RideAutomationStore {
	readonly #automations = new Map<string, RideAutomation>();

	schedule(input: Omit<RideAutomation, "id" | "state" | "error" | "createdAt" | "updatedAt" | "timer">, execute: (automation: RideAutomation) => Promise<void>) {
		const key = `${input.userId}:${input.rideId}`;
		this.cancel(input.userId, input.rideId);
		const now = Date.now();
		const automation: RideAutomation = { ...input, id: randomUUID(), state: "scheduled", createdAt: now, updatedAt: now };
		automation.timer = setTimeout(
			async () => {
				automation.state = "running";
				automation.updatedAt = Date.now();
				try {
					await execute(automation);
					automation.state = automation.action === "notify" ? "due" : "completed";
				} catch (error) {
					automation.state = "failed";
					automation.error = error instanceof Error ? error.message : "Automation failed";
				}
				automation.updatedAt = Date.now();
			},
			Math.max(0, input.triggerAt - Date.now())
		);
		automation.timer.unref();
		this.#automations.set(key, automation);
		return automation;
	}

	get(userId: number, rideId: number) {
		return this.#automations.get(`${userId}:${rideId}`) ?? null;
	}

	cancel(userId: number, rideId: number) {
		const automation = this.get(userId, rideId);
		if (!automation) return false;
		if (automation.timer) clearTimeout(automation.timer);
		automation.state = "cancelled";
		automation.updatedAt = Date.now();
		this.#automations.delete(`${userId}:${rideId}`);
		return true;
	}

	cancelForUser(userId: number) {
		for (const automation of this.#automations.values()) {
			if (automation.userId === userId) this.cancel(userId, automation.rideId);
		}
	}

	close() {
		for (const automation of this.#automations.values()) if (automation.timer) clearTimeout(automation.timer);
		this.#automations.clear();
	}
}

export function publicAutomation(automation: RideAutomation | null) {
	if (!automation) return null;
	return {
		id: automation.id,
		rideId: automation.rideId,
		scooterId: automation.scooterId,
		action: automation.action,
		triggerAt: new Date(automation.triggerAt).toISOString(),
		state: automation.state,
		error: automation.error,
		createdAt: new Date(automation.createdAt).toISOString(),
		updatedAt: new Date(automation.updatedAt).toISOString()
	};
}
