import { useQuery } from "@tanstack/react-query";
import { ApiError, apiRequest } from "../../shared/api";
import { useNeedsSignIn } from "../fleet/useFleetQuery";

export interface EfenceCollection {
	type: "FeatureCollection";
	features: Array<{
		type: "Feature";
		id: number;
		properties: { zone: string; name: string; description: string | null; color: string; priority: number };
		geometry: { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
	}>;
}

export function useEfences() {
	const needsSignIn = useNeedsSignIn();
	return useQuery({
		queryKey: ["map", "efences"],
		queryFn: async () => {
			try {
				return await apiRequest<EfenceCollection>("/v1/map/efences");
			} catch (error) {
				if (error instanceof ApiError && error.status === 401) return null;
				throw error;
			}
		},
		enabled: !needsSignIn,
		staleTime: 10 * 60_000
	});
}
