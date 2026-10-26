import { ArrowLeft, CaretRight, ClockCounterClockwise, SignOut, Ticket } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUiStore } from "../../app/useUiStore";
import { apiRequest } from "../../shared/api";
import { LoginForm } from "./LoginForm";
import { useSession } from "./useSession";

export function AccountView() {
	const back = useUiStore(state => state.back);
	const navigate = useUiStore(state => state.navigate);
	const queryClient = useQueryClient();
	const session = useSession();
	const logout = useMutation({
		mutationFn: () => apiRequest<{ success: true }>("/v1/auth/logout", { method: "POST" }),
		onSuccess: async () => {
			queryClient.setQueryData(["auth", "session"], { authenticated: false });
			await queryClient.invalidateQueries();
		}
	});

	return (
		<>
			<header className="view-head" data-sheet-drag>
				<button type="button" className="icon-button" aria-label="返回" onClick={back}>
					<ArrowLeft size={18} weight="bold" />
				</button>
				<div className="view-head-title">
					<h2>帳號</h2>
				</div>
			</header>
			<div className="view-body">
				{session.data?.authenticated ? (
					<>
						<section className="account-card">
							<span className="avatar" aria-hidden>
								{session.data.email.slice(0, 1).toUpperCase()}
							</span>
							<div>
								<strong>{session.data.email}</strong>
								<span>登入到 {new Date(session.data.expiresAt).toLocaleDateString("zh-TW")}，使用中會自動延長</span>
							</div>
							<button type="button" className="button button-quiet" onClick={() => logout.mutate()} disabled={logout.isPending}>
								<SignOut size={16} weight="bold" /> 登出
							</button>
						</section>
						<nav className="menu-list" aria-label="帳號">
							<button type="button" className="menu-row" onClick={() => navigate({ kind: "history" })}>
								<ClockCounterClockwise size={18} weight="bold" aria-hidden />
								<span>騎乘紀錄</span>
								<CaretRight size={14} weight="bold" aria-hidden />
							</button>
							<button type="button" className="menu-row" onClick={() => navigate({ kind: "plans" })}>
								<Ticket size={18} weight="bold" aria-hidden />
								<span>訂閱方案</span>
								<CaretRight size={14} weight="bold" aria-hidden />
							</button>
						</nav>
					</>
				) : (
					<>
						<p className="muted">用 oloo 帳號的 Email 登入。</p>
						<LoginForm onSignedIn={back} />
					</>
				)}
			</div>
		</>
	);
}
