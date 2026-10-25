import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../shared/api";

export type Session = { authenticated: false } | { authenticated: true; email: string; userId: number; roles: string[]; expiresAt: string };

export function useSession() {
	return useQuery({ queryKey: ["auth", "session"], queryFn: () => apiRequest<Session>("/v1/auth/session"), staleTime: 60_000 });
}

export function useIsSignedIn() {
	return useSession().data?.authenticated === true;
}
