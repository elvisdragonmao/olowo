import { CheckCircle, EnvelopeSimple, SignOut } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { KeyboardInput, useKeyboard } from "../../mobile";
import { apiRequest } from "../../shared/api";

type Session = { authenticated: false } | { authenticated: true; email: string; userId: number; roles: string[]; expiresAt: string };

export function AuthPanel() {
	const queryClient = useQueryClient();
	const keyboard = useKeyboard();
	const [email, setEmail] = useState("");
	const [captcha, setCaptcha] = useState("");
	const [codeSent, setCodeSent] = useState(false);
	const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => apiRequest<Session>("/v1/auth/session") });
	const refreshAuthenticatedData = async () => {
		await Promise.all([queryClient.invalidateQueries({ queryKey: ["auth", "session"] }), queryClient.invalidateQueries({ queryKey: ["fleet"] })]);
	};
	const start = useMutation({
		mutationFn: () => apiRequest<{ success: true }>("/v1/auth/email/start", { method: "POST", body: JSON.stringify({ email }) }),
		onSuccess: () => setCodeSent(true)
	});
	const verify = useMutation({
		mutationFn: () => apiRequest<Session>("/v1/auth/email/verify", { method: "POST", body: JSON.stringify({ email, captcha }) }),
		onSuccess: async () => {
			keyboard.hide();
			await refreshAuthenticatedData();
		}
	});
	const logout = useMutation({
		mutationFn: () => apiRequest<{ success: true }>("/v1/auth/logout", { method: "POST" }),
		onSuccess: refreshAuthenticatedData
	});

	if (session.data?.authenticated) {
		return (
			<div className="signed-in-panel">
				<div className="signed-in-mark">
					<CheckCircle size={30} weight="fill" />
				</div>
				<div>
					<strong>已登入</strong>
					<p>{session.data.email}</p>
				</div>
				<button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
					<SignOut size={18} weight="bold" /> 登出
				</button>
			</div>
		);
	}

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (codeSent) verify.mutate();
		else start.mutate();
	};
	const error = start.error ?? verify.error ?? session.error;

	return (
		<form className="email-login-form" onSubmit={submit}>
			<label>
				<span>Email</span>
				<div className="login-input-wrap">
					<EnvelopeSimple size={20} />
					<KeyboardInput type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required readOnly={codeSent} />
				</div>
			</label>
			{codeSent ? (
				<label>
					<span>六位數驗證碼</span>
					<KeyboardInput
						className="captcha-input"
						inputMode="numeric"
						autoComplete="one-time-code"
						pattern="[0-9]{6}"
						maxLength={6}
						value={captcha}
						onChange={event => setCaptcha(event.target.value.replace(/\D/g, ""))}
						required
					/>
				</label>
			) : null}
			{error ? <p className="login-error">登入失敗，請確認驗證碼後重試。</p> : null}
			<button className="login-submit" type="submit" disabled={start.isPending || verify.isPending || (codeSent && captcha.length !== 6)}>
				{start.isPending || verify.isPending ? "處理中…" : codeSent ? "登入" : "寄送驗證碼"}
			</button>
			{codeSent ? (
				<button className="login-secondary" type="button" onClick={() => start.mutate()} disabled={start.isPending}>
					重新寄送
				</button>
			) : null}
		</form>
	);
}
