import { Crosshair } from "@phosphor-icons/react";
import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { forwardRef, useImperativeHandle, useRef } from "react";
import Map, { Marker, type MapRef } from "react-map-gl/maplibre";
import type { ScooterSummary } from "./model";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(maplibreWorkerUrl);

const currentPosition = { longitude: 120.9938, latitude: 24.79225 };

const campusStyle: StyleSpecification = {
	version: 8,
	sources: {
		osm: {
			type: "raster",
			tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
			tileSize: 256,
			attribution: "© OpenStreetMap contributors"
		}
	},
	layers: [
		{
			id: "osm",
			type: "raster",
			source: "osm",
			paint: {
				"raster-saturation": -0.7,
				"raster-contrast": -0.12,
				"raster-brightness-min": 0.23,
				"raster-brightness-max": 0.96
			}
		}
	]
};

export interface LiveMapHandle {
	focusScooter: (scooter: ScooterSummary) => void;
}

interface LiveMapProps {
	scooters: ScooterSummary[];
	selectedId: string;
	onSelect: (id: string) => void;
}

export const LiveMap = forwardRef<LiveMapHandle, LiveMapProps>(function LiveMap({ scooters, selectedId, onSelect }, ref) {
	const mapRef = useRef<MapRef>(null);

	useImperativeHandle(ref, () => ({
		focusScooter(scooter) {
			mapRef.current?.flyTo({
				center: [scooter.longitude, scooter.latitude],
				zoom: 17,
				duration: 650
			});
		}
	}));

	return (
		<section className="map-panel" aria-label="附近車輛地圖">
			<Map
				ref={mapRef}
				initialViewState={{
					longitude: 120.9937,
					latitude: 24.79335,
					zoom: 15.2
				}}
				mapStyle={campusStyle}
				attributionControl={{ compact: true }}
				dragRotate={false}
				touchPitch={false}
				pitchWithRotate={false}
				reuseMaps
			>
				{scooters.map(scooter => (
					<Marker key={scooter.id} longitude={scooter.longitude} latitude={scooter.latitude} anchor="bottom">
						<button
							type="button"
							className="map-scooter-marker"
							data-state={scooter.id === selectedId ? "selected" : scooter.availability}
							aria-label={`${scooter.id}，電量 ${scooter.batteryPercent}%`}
							onClick={() => onSelect(scooter.id)}
						>
							<span>{scooter.batteryPercent}%</span>
						</button>
					</Marker>
				))}
				<Marker longitude={currentPosition.longitude} latitude={currentPosition.latitude}>
					<span className="current-position" aria-label="你的位置" />
				</Marker>
			</Map>
			<button
				className="map-locate-button"
				type="button"
				aria-label="回到目前位置"
				onClick={() =>
					mapRef.current?.flyTo({
						center: [currentPosition.longitude, currentPosition.latitude],
						zoom: 16.1,
						duration: 500
					})
				}
			>
				<Crosshair size={20} weight="bold" />
			</button>
		</section>
	);
});
