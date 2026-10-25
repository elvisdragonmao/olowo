import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useUiStore } from "../../app/useUiStore";
import { apiRequest } from "../../shared/api";
import type { Session } from "./useSession";

/** Email OTP sign-in. Every query is refetched afterwards so stations and the current ride load with the new session. */
export function LoginForm({ onSignedIn }: { onSignedIn?: () => void }) {
	const queryClient = useQueryClient();
	const setSnap = useUiStore(state => state.setSnap);
	const [email, setEmail] = useState("");
	const [captcha, setCaptcha] = useState("");
	const [codeSent, setCodeSent] = useState(false);

	const start = useMutation({
		mutationFn: () => apiRequest<{ success: true }>("/v1/auth/email/start", { method: "POST", body: JSON.stringify({ email }) }),
		onSuccess: () => setCodeSent(true)
	});
	const verify = useMutation({
		mutationFn: () => apiRequest<Session>("/v1/auth/email/verify", { method: "POST", body: JSON.stringify({ email, captcha }) }),
		onSuccess: async session => {
			queryClient.setQueryData(["auth", "session"], session);
			await queryClient.invalidateQueries();
			// The form opened the sheet fully for the keyboard; hand the map back once signed in.
			setSnap("half");
			onSignedIn?.();
		}
	});

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (codeSent) verify.mutate();
		else start.mutate();
	};

	return (
		<form className="login-form" onSubmit={submit}>
			<label className="field">
				<span>Email</span>
				<input
					type="email"
					autoComplete="email"
					value={email}
					onChange={event => setEmail(event.target.value)}
					onFocus={() => setSnap("full")}
					placeholder="you@example.com"
					required
					readOnly={codeSent}
				/>
			</label>
			{codeSent ? (
				<label className="field">
					<span>驗證碼</span>
					<input
						className="otp-input"
						inputMode="numeric"
						autoComplete="one-time-code"
						pattern="[0-9]{6}"
						maxLength={6}
						value={captcha}
						onChange={event => setCaptcha(event.target.value.replace(/\D/g, ""))}
						placeholder="XXXXXX"
						autoFocus
						required
					/>
				</label>
			) : null}
			{(start.error ?? verify.error) ? <p className="inline-error">{codeSent ? "驗證碼不正確或已過期。" : "無法寄送驗證碼，請確認 Email。"}</p> : null}
			<button className="button button-primary" type="submit" disabled={start.isPending || verify.isPending || (codeSent && captcha.length !== 6)}>
				{start.isPending || verify.isPending ? "處理中…" : codeSent ? "登入" : "寄送驗證碼"}
			</button>
			{codeSent ? (
				<div className="login-secondary">
					<button type="button" className="text-button" onClick={() => start.mutate()} disabled={start.isPending}>
						重新寄送
					</button>
					<button type="button" className="text-button" onClick={() => (setCodeSent(false), setCaptcha(""))}>
						換一個 Email
					</button>
				</div>
			) : null}
		</form>
	);
}
