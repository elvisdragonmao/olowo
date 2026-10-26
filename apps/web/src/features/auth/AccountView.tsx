import { ArrowLeft, ArrowSquareOut, CaretRight, ChartBar, ClockCounterClockwise, GithubLogo, Percent, SignOut, Star, Ticket } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUiStore } from "../../app/useUiStore";
import { apiRequest } from "../../shared/api";
import { Avatar } from "./Avatar";
import { LoginForm } from "./LoginForm";
import { useSession } from "./useSession";

const repositoryUrl = "https://github.com/elvisdragonmao/olowo";

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
							<Avatar email={session.data.email} />
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
							<a className="menu-row" href="/insights" target="_blank" rel="noopener">
								<ChartBar size={18} weight="bold" aria-hidden />
								<span>騎乘分析</span>
								<ArrowSquareOut size={14} weight="bold" aria-label="在新分頁開啟" />
							</a>
							<button type="button" className="menu-row" onClick={() => navigate({ kind: "plans" })}>
								<Ticket size={18} weight="bold" aria-hidden />
								<span>訂閱方案</span>
								<CaretRight size={14} weight="bold" aria-hidden />
							</button>
							<button type="button" className="menu-row" onClick={() => navigate({ kind: "coupons" })}>
								<Percent size={18} weight="bold" aria-hidden />
								<span>優惠券</span>
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
				<footer className="credits">
					<p>
						<span className="wordmark" aria-label="olowo">
							ol<span>owo</span>
						</span>{" "}
						由 毛哥EM 製作，不是 oloo 官方 App。
					</p>
					<a className="button button-quiet" href={repositoryUrl} target="_blank" rel="noreferrer">
						<GithubLogo size={16} weight="bold" aria-hidden /> 在 GitHub 給顆 <Star size={14} weight="fill" aria-hidden />
					</a>
				</footer>
			</div>
		</>
	);
}
