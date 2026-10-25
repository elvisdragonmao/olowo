import type { StyleSpecification } from "mapbox-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import MapGL, { AttributionControl, Layer, Marker, Source, type MapRef } from "react-map-gl/mapbox";
import { useIsDesktop } from "../../app/Panel";
import { campusCenter, useUiStore } from "../../app/useUiStore";
import { stationLabel, type StationSummary } from "../fleet/model";
import { groupCampuses, nearestCampus } from "../fleet/useCampus";
import { useFleetQuery } from "../fleet/useFleetQuery";
import { distanceMeters } from "../location/geo";
import { useLocationStore } from "../location/useLocationStore";
import { useEfences, type EfenceCollection } from "./useEfences";
import "mapbox-gl/dist/mapbox-gl.css";

const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const darkQuery = "(prefers-color-scheme: dark)";

type Tier = "far" | "mid" | "near";
const tierFor = (zoom: number): Tier => (zoom < 14.2 ? "far" : zoom < 16.4 ? "mid" : "near");

function basemapStyle(dark: boolean): StyleSpecification {
	return {
		version: 8,
		imports: [
			{
				id: "basemap",
				url: "mapbox://styles/mapbox/standard",
				config: {
					lightPreset: dark ? "night" : "day",
					theme: "faded",
					showPointOfInterestLabels: false,
					showTransitLabels: false,
					show3dObjects: false
				}
			}
		],
		sources: {},
		layers: []
	} as StyleSpecification;
}

/**
 * One polygon covering the world with every riding area cut out, so everything outside oloo's operating
 * zones can be dimmed. Riding areas nested inside another are dropped to keep the holes disjoint.
 */
function outsideOperatingAreas(collection: EfenceCollection) {
	const rings = collection.features.filter(feature => feature.properties.zone === "normalSpeedArea").map(feature => feature.geometry.coordinates[0]!);
	const holes = rings.filter((ring, index) => !rings.some((other, otherIndex) => otherIndex !== index && other.length > ring.length && insideRing(ring[0]!, other)));
	if (holes.length === 0) return null;
	const world: Array<[number, number]> = [
		[-180, -85],
		[180, -85],
		[180, 85],
		[-180, 85],
		[-180, -85]
	];
	return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [world, ...holes] } };
}

function insideRing([x, y]: [number, number], ring: Array<[number, number]>) {
	let inside = false;
	for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
		const [xA, yA] = ring[index]!;
		const [xB, yB] = ring[previous]!;
		if (yA > y !== yB > y && x < ((xB - xA) * (y - yA)) / (yB - yA) + xA) inside = !inside;
	}
	return inside;
}

const cameraKey = "olowo:camera";

function readSavedCamera(): { longitude: number; latitude: number; zoom: number } | null {
	try {
		const value = JSON.parse(localStorage.getItem(cameraKey) ?? "null") as { longitude?: unknown; latitude?: unknown; zoom?: unknown } | null;
		return value && typeof value.longitude === "number" && typeof value.latitude === "number" && typeof value.zoom === "number"
			? { longitude: value.longitude, latitude: value.latitude, zoom: value.zoom }
			: null;
	} catch {
		return null;
	}
}

function saveCamera(camera: { longitude: number; latitude: number; zoom: number }) {
	try {
		localStorage.setItem(cameraKey, JSON.stringify(camera));
	} catch {
		// Storage can be unavailable (private mode); the map still works without it.
	}
}

function usePrefersDark() {
	const [dark, setDark] = useState(() => window.matchMedia(darkQuery).matches);
	useEffect(() => {
		const media = window.matchMedia(darkQuery);
		const onChange = () => setDark(media.matches);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);
	return dark;
}

export default function MapCanvas() {
	if (!accessToken) {
		return (
			<div className="map-canvas map-fallback">
				<p>
					地圖需要 Mapbox token：在 <code>apps/web/.env.local</code> 設定 <code>VITE_MAPBOX_ACCESS_TOKEN</code>。
				</p>
			</div>
		);
	}
	return <LiveMap />;
}

function LiveMap() {
	const mapRef = useRef<MapRef>(null);
	const desktop = useIsDesktop();
	const dark = usePrefersDark();
	const [initialDark] = useState(dark);
	const [tier, setTier] = useState<Tier>("mid");
	const [ready, setReady] = useState(false);
	const fleet = useFleetQuery();
	const { view, snap, sheetVisibleHeight, focusRequest, navigate, back, setSnap, setMapCenter } = useUiStore();
	const efences = useEfences().data;
	const outside = useMemo(() => (efences ? outsideOperatingAreas(efences) : null), [efences]);
	const [savedCamera] = useState(readSavedCamera);
	const position = useLocationStore(state => state.position);
	const accuracy = useLocationStore(state => state.accuracy);
	const recenterRequest = useLocationStore(state => state.recenterRequest);
	const handledRecenter = useRef(0);
	const style = useMemo(() => basemapStyle(initialDark), [initialDark]);

	const stations = fleet.data?.stations ?? [];
	const selectedStationId = view.kind === "station" || view.kind === "scooter" ? view.stationId : null;
	const selectedScooterId = view.kind === "scooter" ? view.scooterId : null;
	const selectedStation = stations.find(station => station.id === selectedStationId) ?? null;
	const selectedScooter = selectedStation?.scooters.find(scooter => scooter.providerId === selectedScooterId) ?? null;
	const scooterFix = selectedScooter?.latitude != null && selectedScooter.longitude != null ? { latitude: selectedScooter.latitude, longitude: selectedScooter.longitude } : null;

	const padding = useMemo(
		() => (desktop ? { top: 32, bottom: 32, left: 456, right: 32 } : { top: 72, bottom: Math.max(sheetVisibleHeight, 120) + 16, left: 16, right: 16 }),
		[desktop, sheetVisibleHeight]
	);

	const appliedDark = useRef(initialDark);
	useEffect(() => {
		if (!ready || appliedDark.current === dark) return;
		appliedDark.current = dark;
		try {
			mapRef.current?.getMap().setConfigProperty("basemap", "lightPreset", dark ? "night" : "day");
		} catch {
			// Only the Mapbox Standard import exposes this config.
		}
	}, [dark, ready]);

	useEffect(() => {
		if (!ready || !selectedStation) return;
		// Frame the station together with its scooters' fixes, close enough that the dots separate.
		// A stray fix hundreds of metres away should not zoom the whole station out.
		const fixes = selectedStation.scooters.flatMap(scooter => (scooter.latitude != null && scooter.longitude != null ? [{ latitude: scooter.latitude, longitude: scooter.longitude }] : []));
		const points = [selectedStation, ...fixes.filter(fix => distanceMeters(fix, selectedStation) < 150)];
		const longitudes = points.map(point => point.longitude);
		const latitudes = points.map(point => point.latitude);
		mapRef.current?.fitBounds(
			[
				[Math.min(...longitudes), Math.min(...latitudes)],
				[Math.max(...longitudes), Math.max(...latitudes)]
			],
			{ padding: framePadding(padding), maxZoom: 19, duration: 700, essential: true }
		);
		// Recentre only when the selected station changes, not on every sheet movement.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ready, selectedStation?.id]);

	const framedInitially = useRef(false);
	useEffect(() => {
		if (!ready || framedInitially.current || stations.length === 0 || !mapRef.current) return;
		framedInitially.current = true;
		if (savedCamera || selectedStationId != null || position) return;
		// Stations span campuses across Taiwan; open on the default campus rather than the whole island.
		const campus = nearestCampus(groupCampuses(stations), campusCenter);
		if (campus) mapRef.current.fitBounds(campus.bounds, { padding: framePadding(padding), maxZoom: 16.2, duration: 0 });
	}, [padding, position, ready, savedCamera, selectedStationId, stations]);

	const handledFocus = useRef(0);
	useEffect(() => {
		if (!ready || !focusRequest || focusRequest.seq === handledFocus.current) return;
		handledFocus.current = focusRequest.seq;
		mapRef.current?.fitBounds(focusRequest.bounds, { padding: framePadding(padding), maxZoom: 16.2, duration: 800 });
	}, [focusRequest, padding, ready]);

	useEffect(() => {
		if (!ready || !position || recenterRequest === handledRecenter.current) return;
		handledRecenter.current = recenterRequest;
		mapRef.current?.flyTo({ center: [position.longitude, position.latitude], zoom: 16.4, padding, duration: 700 });
	}, [padding, position, ready, recenterRequest]);

	// A selected scooter with a GPS fix is shown where it actually is.
	useEffect(() => {
		if (!ready || !scooterFix) return;
		mapRef.current?.flyTo({ center: [scooterFix.longitude, scooterFix.latitude], zoom: Math.max(mapRef.current.getZoom(), 18), padding, duration: 600 });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ready, selectedScooter?.providerId]);

	return (
		<div className="map-canvas">
			<MapGL
				ref={mapRef}
				mapboxAccessToken={accessToken}
				initialViewState={savedCamera ?? { longitude: campusCenter.longitude, latitude: campusCenter.latitude, zoom: 15.4 }}
				mapStyle={style}
				dragRotate={false}
				pitchWithRotate={false}
				touchPitch={false}
				maxPitch={0}
				attributionControl={false}
				onLoad={event => {
					const center = event.target.getCenter();
					setMapCenter({ latitude: center.lat, longitude: center.lng });
					setReady(true);
				}}
				onMoveEnd={event => {
					setTier(tierFor(event.viewState.zoom));
					setMapCenter({ latitude: event.viewState.latitude, longitude: event.viewState.longitude });
					saveCamera({ longitude: event.viewState.longitude, latitude: event.viewState.latitude, zoom: event.viewState.zoom });
				}}
				onZoom={event => {
					const next = tierFor(event.viewState.zoom);
					if (next !== tier) setTier(next);
				}}
				onClick={() => {
					if (view.kind === "station" || view.kind === "scooter") back();
					else if (!desktop && snap !== "peek") setSnap("peek");
				}}
			>
				<AttributionControl compact />
				{ready && outside ? (
					<Source id="outside-operating-areas" type="geojson" data={outside}>
						<Layer id="outside-operating-areas" type="fill" slot="middle" paint={{ "fill-color": dark ? "#000000" : "#0f1a17", "fill-opacity": dark ? 0.55 : 0.4 }} />
					</Source>
				) : null}
				{ready && efences ? (
					<Source id="efences" type="geojson" data={efences}>
						<Layer
							id="efence-riding-glow"
							type="line"
							slot="middle"
							filter={["==", ["get", "zone"], "normalSpeedArea"]}
							paint={{ "line-color": "#14b86c", "line-width": 9, "line-opacity": 0.22, "line-blur": 4 }}
						/>
						<Layer id="efence-riding-edge" type="line" slot="middle" filter={["==", ["get", "zone"], "normalSpeedArea"]} paint={{ "line-color": "#14b86c", "line-width": 2.5 }} />
						<Layer id="efence-restricted-fill" type="fill" slot="middle" filter={["!=", ["get", "zone"], "normalSpeedArea"]} paint={{ "fill-color": ["get", "color"], "fill-opacity": 0.32 }} />
						<Layer
							id="efence-restricted-edge"
							type="line"
							slot="middle"
							filter={["!=", ["get", "zone"], "normalSpeedArea"]}
							paint={{ "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [3, 2] }}
						/>
					</Source>
				) : null}
				{stations.map(station => (
					<StationPin
						key={station.id}
						station={station}
						tier={tier}
						selected={station.id === selectedStationId}
						dimmed={selectedStationId != null && station.id !== selectedStationId}
						onSelect={() => navigate({ kind: "station", stationId: station.id }, { replace: view.kind === "station" || view.kind === "scooter" })}
					/>
				))}
				{/* An opened station plots each docked scooter at its own GPS fix; tap a dot to open that scooter. */}
				{selectedStation?.scooters.map(scooter =>
					scooter.latitude != null && scooter.longitude != null && scooter.providerId !== selectedScooter?.providerId ? (
						<Marker
							key={scooter.providerId}
							longitude={scooter.longitude}
							latitude={scooter.latitude}
							style={{ zIndex: 4 }}
							onClick={event => {
								event.originalEvent.stopPropagation();
								navigate({ kind: "scooter", stationId: selectedStation.id, scooterId: scooter.providerId }, { replace: view.kind === "scooter" });
							}}
						>
							<button type="button" className="scooter-dot" data-tone={scooter.availability} aria-label={`${scooter.id}，電量 ${scooter.batteryPercent}%`} />
						</Marker>
					) : null
				)}
				{selectedScooter && scooterFix ? (
					<Marker longitude={scooterFix.longitude} latitude={scooterFix.latitude} anchor="bottom" style={{ zIndex: 6 }}>
						<span className="scooter-fix" data-tone={selectedScooter.availability} aria-label={`${selectedScooter.id} 的定位`}>
							<strong>{selectedScooter.id}</strong>
							<span>{selectedScooter.batteryPercent}%</span>
						</span>
					</Marker>
				) : null}
				{position ? (
					<Marker longitude={position.longitude} latitude={position.latitude} style={{ zIndex: 1 }}>
						<span className="user-dot" data-coarse={(accuracy ?? 0) > 80} aria-label="你的位置" />
					</Marker>
				) : null}
			</MapGL>
		</div>
	);
}

function framePadding(padding: { top: number; bottom: number; left: number; right: number }) {
	return { top: padding.top + 40, bottom: padding.bottom + 40, left: padding.left + 40, right: padding.right + 40 };
}

function StationPin({ station, tier, selected, dimmed, onSelect }: { station: StationSummary; tier: Tier; selected: boolean; dimmed: boolean; onSelect: () => void }) {
	const available = station.availableCount;
	const tone = available > 0 ? "available" : station.lowBatteryCount > 0 ? "low_battery" : "empty";
	const label = stationLabel(station.name);
	return (
		<Marker
			longitude={station.longitude}
			latitude={station.latitude}
			style={{ zIndex: selected ? 5 : available > 0 ? 2 : 1 }}
			onClick={event => {
				// Markers live inside the map container; stop the native event so the map click does not deselect.
				event.originalEvent.stopPropagation();
				onSelect();
			}}
		>
			<button
				type="button"
				className="station-pin"
				data-tier={tier}
				data-tone={tone}
				data-selected={selected}
				data-dimmed={dimmed}
				aria-label={`${label.name}，${available} 台可借，共 ${station.scooters.length} 台`}
			>
				<span className="station-pin-count">
					{available}
					<small>/{station.scooters.length}</small>
				</span>
				{tier === "near" && !selected ? <span className="station-pin-name">{label.name}</span> : null}
			</button>
		</Marker>
	);
}
