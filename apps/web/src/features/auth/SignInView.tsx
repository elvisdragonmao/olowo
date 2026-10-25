import { LoginForm } from "./LoginForm";

/** First screen when the API needs a rider session before it can read stations from oloo. */
export function SignInView() {
	return (
		<>
			<header className="view-head view-head-stack" data-sheet-drag>
				<div className="view-head-title">
					<h2>登入看即時站點</h2>
					<p>站點與車況直接來自 oloo，需要先用你的 oloo 帳號登入。</p>
				</div>
			</header>
			<div className="view-body">
				<LoginForm />
			</div>
		</>
	);
}
