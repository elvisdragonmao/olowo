import { olooRequest } from "./oloo.js";

interface RawEfence {
	id?: unknown;
	type?: unknown;
	properties?: { name?: unknown; description?: unknown; color?: unknown; priority?: unknown; polygon?: unknown };
}

export interface EfenceFeature {
	type: "Feature";
	id: number;
	properties: { zone: string; name: string; description: string | null; color: string; priority: number };
	geometry: { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
}

export interface EfenceCollection {
	type: "FeatureCollection";
	features: EfenceFeature[];
}

const hexColor = /^#[0-9a-f]{6}$/i;

/** oloo polygons are `[latitude, longitude]` rings; GeoJSON needs closed `[longitude, latitude]` rings. */
export function toEfenceCollection(value: unknown): EfenceCollection {
	const raw = Array.isArray(value) ? (value as RawEfence[]) : [];
	const features = raw.flatMap((item): EfenceFeature[] => {
		const id = typeof item.id === "number" ? item.id : Number(item.id);
		const points = Array.isArray(item.properties?.polygon) ? (item.properties.polygon as unknown[]) : [];
		const ring = points.flatMap(point => {
			if (!Array.isArray(point)) return [];
			const [latitude, longitude] = point.map(Number);
			return Number.isFinite(latitude) && Number.isFinite(longitude) ? [[longitude, latitude] as [number, number]] : [];
		});
		if (!Number.isFinite(id) || ring.length < 3 || typeof item.type !== "string") return [];
		const [first, last] = [ring[0]!, ring[ring.length - 1]!];
		if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
		const color = typeof item.properties?.color === "string" && hexColor.test(item.properties.color) ? item.properties.color : "#888888";
		return [
			{
				type: "Feature",
				id,
				properties: {
					zone: item.type,
					name: typeof item.properties?.name === "string" ? item.properties.name : item.type,
					description: typeof item.properties?.description === "string" ? item.properties.description : null,
					color,
					priority: typeof item.properties?.priority === "number" ? item.properties.priority : 0
				},
				geometry: { type: "Polygon", coordinates: [ring] }
			}
		];
	});
	// Lower priority numbers are the stricter zones; draw them last so they sit on top.
	features.sort((a, b) => b.properties.priority - a.properties.priority);
	return { type: "FeatureCollection", features };
}

/** E-fences change rarely and are the same for every rider: one shared copy, refreshed every ten minutes. */
export class EfenceCache {
	#value: { fetchedAt: number; collection: EfenceCollection } | null = null;
	#inflight: Promise<EfenceCollection> | null = null;

	constructor(
		readonly baseUrl: string,
		readonly ttlMs = 10 * 60_000
	) {}

	async get(token: string) {
		if (this.#value && Date.now() - this.#value.fetchedAt < this.ttlMs) return this.#value.collection;
		this.#inflight ??= olooRequest<unknown>(this.baseUrl, "/location-meta/multi-feature-efences", token)
			.then(value => {
				const collection = toEfenceCollection(value);
				this.#value = { fetchedAt: Date.now(), collection };
				return collection;
			})
			.finally(() => {
				this.#inflight = null;
			});
		try {
			return await this.#inflight;
		} catch (error) {
			if (this.#value) return this.#value.collection;
			throw error;
		}
	}
}
