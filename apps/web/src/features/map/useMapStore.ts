import { create } from "zustand";

interface MapState {
	selectedId: string;
	availableOnly: boolean;
	minBattery: number;
	setSelectedId: (id: string) => void;
	setAvailableOnly: (availableOnly: boolean) => void;
	setMinBattery: (minBattery: number) => void;
}

export const useMapStore = create<MapState>(set => ({
	selectedId: "JZ-333",
	availableOnly: false,
	minBattery: 0,
	setSelectedId: selectedId => set({ selectedId }),
	setAvailableOnly: availableOnly => set({ availableOnly }),
	setMinBattery: minBattery => set({ minBattery })
}));
