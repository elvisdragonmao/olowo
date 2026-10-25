import { create } from "zustand";
import type { LngLat } from "./geo";

type LocationStatus = "idle" | "locating" | "watching" | "denied" | "unavailable";

interface LocationState {
	position: LngLat | null;
	accuracy: number | null;
	status: LocationStatus;
	/** Incremented whenever the rider explicitly asks to be centered. */
	recenterRequest: number;
	start: (recenter?: boolean) => void;
}

let watchId: number | null = null;

export const useLocationStore = create<LocationState>((set, get) => ({
	position: null,
	accuracy: null,
	status: "idle",
	recenterRequest: 0,
	start(recenter = true) {
		if (recenter) set({ recenterRequest: get().recenterRequest + 1 });
		if (watchId != null || !("geolocation" in navigator)) {
			if (!("geolocation" in navigator)) set({ status: "unavailable" });
			return;
		}
		set({ status: "locating" });
		watchId = navigator.geolocation.watchPosition(
			position => set({ position: { latitude: position.coords.latitude, longitude: position.coords.longitude }, accuracy: position.coords.accuracy, status: "watching" }),
			error => {
				if (watchId != null) navigator.geolocation.clearWatch(watchId);
				watchId = null;
				set({ status: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable" });
			},
			{ enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 }
		);
	}
}));

/** Resume location silently when the rider already granted it in an earlier visit. */
export async function resumeGrantedLocation() {
	try {
		const permission = await navigator.permissions?.query({ name: "geolocation" });
		if (permission?.state === "granted") useLocationStore.getState().start(false);
	} catch {
		// Permissions API is optional; the locate button still works.
	}
}
