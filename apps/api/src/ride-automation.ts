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

type RideAutomationInput = Omit<RideAutomation, "id" | "state" | "error" | "createdAt" | "updatedAt" | "timer"> & { id?: string; createdAt?: number };

export class RideAutomationStore {
	readonly #automations = new Map<string, RideAutomation>();
	readonly #onChange?: (automation: RideAutomation) => void;
	readonly #claim?: (automation: RideAutomation) => Promise<boolean>;

	/** `claim` lets a shared database decide which API instance executes a due job. */
	constructor(onChange?: (automation: RideAutomation) => void, claim?: (automation: RideAutomation) => Promise<boolean>) {
		this.#onChange = onChange;
		this.#claim = claim;
	}

	schedule(input: RideAutomationInput, execute: (automation: RideAutomation) => Promise<void>) {
		const key = `${input.userId}:${input.rideId}`;
		this.cancel(input.userId, input.rideId);
		const now = Date.now();
		const automation: RideAutomation = { ...input, id: input.id ?? randomUUID(), state: "scheduled", createdAt: input.createdAt ?? now, updatedAt: now };
		automation.timer = setTimeout(
			async () => {
				if (this.#claim && !(await this.#claim(automation).catch(() => false))) {
					// Another instance owns this job; forget the local copy without reporting a state change.
					if (this.#automations.get(key) === automation) this.#automations.delete(key);
					return;
				}
				automation.state = "running";
				automation.updatedAt = Date.now();
				this.#onChange?.(automation);
				try {
					await execute(automation);
					automation.state = automation.action === "notify" ? "due" : "completed";
				} catch (error) {
					automation.state = "failed";
					automation.error = error instanceof Error ? error.message : "Automation failed";
				}
				automation.updatedAt = Date.now();
				this.#onChange?.(automation);
			},
			Math.max(0, input.triggerAt - Date.now())
		);
		automation.timer.unref();
		this.#automations.set(key, automation);
		this.#onChange?.(automation);
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
		this.#onChange?.(automation);
		this.#automations.delete(`${userId}:${rideId}`);
		return true;
	}

	cancelForUser(userId: number) {
		for (const automation of this.#automations.values()) if (automation.userId === userId) this.cancel(userId, automation.rideId);
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
