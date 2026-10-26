import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

async function gravatarHash(email: string) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The rider's Gravatar (SHA-256 of the email, as Gravatar accepts), or their initial when there is none. */
export function Avatar({ email, small }: { email: string; small?: boolean }) {
	const size = small ? 30 : 40;
	const hash = useQuery({ queryKey: ["gravatar", email], queryFn: () => gravatarHash(email), staleTime: Infinity, enabled: Boolean(globalThis.crypto?.subtle) });
	const [missing, setMissing] = useState<string | null>(null);
	const src = hash.data && missing !== hash.data ? `https://gravatar.com/avatar/${hash.data}?s=${size * 3}&d=404` : null;
	return (
		<span className={small ? "avatar avatar-small" : "avatar"} aria-hidden>
			{src ? <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setMissing(hash.data ?? null)} /> : email.slice(0, 1).toUpperCase()}
		</span>
	);
}
