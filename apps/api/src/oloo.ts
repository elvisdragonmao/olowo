export class OlooUpstreamError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

export async function olooRequest<T>(baseUrl: string, path: string, token: string, init?: RequestInit): Promise<T> {
	const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
	url.searchParams.set("access_token", token);
	const response = await fetch(url, {
		...init,
		headers: {
			accept: "application/json",
			authorization: token,
			...(init?.body ? { "content-type": "application/json" } : {}),
			...init?.headers
		},
		signal: init?.signal ?? AbortSignal.timeout(20_000)
	});
	const body = (await response.json().catch(() => null)) as T | { message?: string } | null;
	if (!response.ok) {
		const message = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "Upstream request failed";
		throw new OlooUpstreamError(response.status, message);
	}
	return body as T;
}

interface ProviderScooter {
	id: number;
	imei: string;
	EngineLicenseNumber: string;
}

export async function resolveProviderScooter(baseUrl: string, token: string, scooterId: number) {
	const scooters = await olooRequest<ProviderScooter[]>(baseUrl, "/scooters-infos", token);
	const scooter = scooters.find(item => item.id === scooterId);
	if (!scooter) throw new OlooUpstreamError(404, "Scooter not found");
	return scooter;
}
