import { Power, Repeat } from "@phosphor-icons/react";
import { useState } from "react";
import { durationLabel, parseDuration } from "../../shared/format";

export type AutomationAction = "return" | "return_and_reborrow";

export const automationLabels: Record<AutomationAction, string> = {
	return: "自動歸還",
	return_and_reborrow: "歸還後重借"
};

export const minimumTimerSeconds = 20;
export const maximumTimerSeconds = 6 * 60 * 60;
export const defaultTimerSeconds = 58;
const presets = [30, 58, 298];

const actions: Array<{ value: AutomationAction; detail: string; icon: typeof Power }> = [
	{ value: "return", detail: "時間到就還車", icon: Power },
	{ value: "return_and_reborrow", detail: "還車、空白照片結帳，再借同一台", icon: Repeat }
];

/**
 * The two ride timers as toggles: tapping one applies it at once, tapping it again turns it off, and the
 * duration can be changed at any time. Durations are ride length from oloo's recorded start.
 */
export function TimerControl({
	action,
	seconds,
	onChange,
	disabled
}: {
	action: AutomationAction | null;
	seconds: number;
	onChange: (next: { action: AutomationAction | null; seconds: number }) => void;
	disabled?: boolean;
}) {
	return (
		<div className="timer-control">
			<div className="choice-grid choice-grid-two" role="group" aria-label="借用後計時">
				{actions.map(option => {
					const Icon = option.icon;
					const on = action === option.value;
					return (
						<button key={option.value} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange({ action: on ? null : option.value, seconds })}>
							<Icon size={18} weight={on ? "fill" : "regular"} aria-hidden />
							<strong>{automationLabels[option.value]}</strong>
							<span>{option.detail}</span>
						</button>
					);
				})}
			</div>
			<DurationPicker value={seconds} onChange={next => onChange({ action, seconds: next })} disabled={disabled} />
		</div>
	);
}

/** Ride-length picker: 0:30, 0:58, 4:58 or a custom `m:ss`. */
export function DurationPicker({ value, onChange, disabled }: { value: number; onChange: (seconds: number) => void; disabled?: boolean }) {
	const [custom, setCustom] = useState(!presets.includes(value));
	const [text, setText] = useState(presets.includes(value) ? "" : durationLabel(value).replace(" 秒", ""));
	const parsed = parseDuration(text);
	const invalid = custom && text !== "" && (parsed == null || parsed < minimumTimerSeconds || parsed > maximumTimerSeconds);

	return (
		<div className="duration-picker">
			<div className="segmented" role="radiogroup" aria-label="騎乘時長">
				{presets.map(seconds => (
					<button key={seconds} type="button" role="radio" aria-checked={!custom && value === seconds} disabled={disabled} onClick={() => (setCustom(false), onChange(seconds))}>
						{durationLabel(seconds)}
					</button>
				))}
				<button type="button" role="radio" aria-checked={custom} disabled={disabled} onClick={() => setCustom(true)}>
					自訂
				</button>
			</div>
			{custom ? (
				<label className="field field-inline">
					<span>時長（分:秒）</span>
					<input
						inputMode="numeric"
						placeholder="例如 3:28"
						value={text}
						aria-invalid={invalid}
						disabled={disabled}
						onChange={event => setText(event.target.value)}
						// Applied on blur or Enter so a half-typed value never reschedules a running timer.
						onBlur={() => parsed != null && !invalid && parsed !== value && onChange(parsed)}
						onKeyDown={event => event.key === "Enter" && event.currentTarget.blur()}
						autoFocus
					/>
				</label>
			) : null}
			{invalid ? <p className="inline-error">請輸入 0:20 到 6:00:00 之間的時長。</p> : null}
		</div>
	);
}
