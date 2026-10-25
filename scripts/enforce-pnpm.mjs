const packageManager = process.env.npm_config_user_agent ?? "";

if (!packageManager.startsWith("pnpm/")) {
	console.error("This workspace uses pnpm. Run `pnpm install` from the repository root.");
	process.exit(1);
}
