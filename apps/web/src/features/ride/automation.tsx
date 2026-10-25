import { useState } from "react";
import { durationLabel, parseDuration } from "../../shared/format";

export type AutomationAction = "return" | "return_and_reborrow";

export const automationLabels: Record<AutomationAction, string> = {
	return: "自動歸還",
	return_and_reborrow: "歸還後重借"
};

export const minimumTimerSeconds = 20;
export const maximumTimerSeconds = 6 * 60 * 60;
const presets = [28, 88, 148];

/** Ride-length picker: 0:28, 1:28, 2:28 or a custom `m:ss`, measured from the provider-confirmed ride start. */
export function DurationPicker({ value, onChange }: { value: number; onChange: (seconds: number) => void }) {
	const [custom, setCustom] = useState(!presets.includes(value));
	const [text, setText] = useState(presets.includes(value) ? "" : durationLabel(value).replace(" 秒", ""));
	const parsed = parseDuration(text);
	const invalid = custom && text !== "" && (parsed == null || parsed < minimumTimerSeconds || parsed > maximumTimerSeconds);

	return (
		<div className="duration-picker">
			<div className="segmented" role="radiogroup" aria-label="騎乘時長">
				{presets.map(seconds => (
					<button key={seconds} type="button" role="radio" aria-checked={!custom && value === seconds} onClick={() => (setCustom(false), onChange(seconds))}>
						{durationLabel(seconds)}
					</button>
				))}
				<button type="button" role="radio" aria-checked={custom} onClick={() => setCustom(true)}>
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
						onChange={event => {
							setText(event.target.value);
							const seconds = parseDuration(event.target.value);
							if (seconds != null && seconds >= minimumTimerSeconds && seconds <= maximumTimerSeconds) onChange(seconds);
						}}
						autoFocus
					/>
				</label>
			) : null}
			{invalid ? <p className="inline-error">請輸入 0:20 到 6:00:00 之間的時長。</p> : null}
		</div>
	);
}
