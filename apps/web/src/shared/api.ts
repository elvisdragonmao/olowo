// Same-origin by default; Vite and the deployment worker proxy `/v1` to Fastify.
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string | null,
		message: string
	) {
		super(message);
	}
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${apiBaseUrl}${path}`, {
		...init,
		credentials: "include",
		headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers }
	});
	const body = (await response.json().catch(() => null)) as T | { code?: string; message?: string } | null;
	if (!response.ok) {
		const error = body && typeof body === "object" ? (body as { code?: string; message?: string }) : {};
		throw new ApiError(response.status, error.code ?? null, error.message ?? `Request failed with ${response.status}`);
	}
	return body as T;
}

export function idempotencyKey() {
	return crypto.randomUUID();
}
