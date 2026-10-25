export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${apiBaseUrl}${path}`, {
		...init,
		credentials: "include",
		headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers }
	});
	const body = (await response.json().catch(() => null)) as T | { message?: string } | null;
	const message = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : null;
	if (!response.ok) throw new Error(message || `Request failed with ${response.status}`);
	return body as T;
}
