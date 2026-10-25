export interface LngLat {
	latitude: number;
	longitude: number;
}

export function distanceMeters(a: LngLat, b: LngLat) {
	const toRad = Math.PI / 180;
	const dLat = (b.latitude - a.latitude) * toRad;
	const dLon = (b.longitude - a.longitude) * toRad;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLon / 2) ** 2;
	return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

// Straight-line distance understates campus paths; 1.3 detour factor at 75 m/min.
export function walkMinutes(meters: number) {
	return Math.max(1, Math.round((meters * 1.3) / 75));
}

export function walkingDirectionsUrl(target: LngLat) {
	return `https://www.google.com/maps/dir/?api=1&destination=${target.latitude},${target.longitude}&travelmode=walking`;
}
