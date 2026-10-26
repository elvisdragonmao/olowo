import { expect, test, type Page } from "@playwright/test";
import { mockOlowoApi } from "./mock-api";

// README screenshots with real Mapbox tiles and the mocked API: `pnpm screenshots` (needs VITE_MAPBOX_ACCESS_TOKEN in .env.local).
test.skip(process.env.OLOWO_SCREENSHOTS !== "1", "set OLOWO_SCREENSHOTS=1 to refresh the README screenshots");

const out = (name: string) => new URL(`../../../docs/screenshots/${name}.png`, import.meta.url).pathname;
const panel = (page: Page) => page.getByRole("region", { name: "站點與車輛" }).or(page.getByRole("complementary", { name: "站點與車輛" }));

type Seed = [name: string, latitude: number, longitude: number, capacity: number, batteries: number[]];

// A fuller campus than the test fixture; plates and batteries are made up.
const seeds: Seed[] = [
	["交大-浩然圖書館站", 24.78694, 120.99749, 16, [84, 62, 31, 90, 77]],
	["交大-工程四館站", 24.78716, 120.99558, 8, [18, 70]],
	["交大-第二餐廳站", 24.78907, 120.99862, 12, [55, 91, 66]],
	["交大-十三舍站", 24.78892, 121.00276, 10, [12, 23]],
	["交大-電子資訊大樓站", 24.78683, 121.00063, 10, [88, 47, 59, 73]],
	["交大-學生活動中心站", 24.78812, 120.99693, 14, [95, 40, 81]],
	["交大-綜合一館站", 24.78553, 120.99847, 6, [29]],
	["清大-小吃部站", 24.79568, 120.99354, 20, [64, 83, 52, 71, 38, 90]],
	["清大-台達館站", 24.79587, 120.99216, 8, [44, 26]],
	["清大-旺宏館站", 24.79466, 120.99485, 12, [79, 68, 15]]
];

function campusFleet() {
	let plate = 296;
	const stations = seeds.map(([name, latitude, longitude, capacity, batteries], index) => {
		const scooters = batteries.map((batteryPercent, slot) => {
			plate += 37;
			const offline = index === 1 && slot === 1;
			const availability = offline ? "unavailable" : batteryPercent < 35 ? "low_battery" : "available";
			return {
				providerId: 1512 + index * 10 + slot,
				id: `${index % 3 === 0 ? "JZ" : index % 3 === 1 ? "MB" : "KA"}-${plate % 1000}`,
				model: index % 4 === 1 ? "wgt" : "c5",
				batteryPercent,
				rangeKm: Math.round(batteryPercent * 0.35),
				latitude: latitude + ((slot % 3) - 1) * 0.00007,
				longitude: longitude + (Math.floor(slot / 3) - 0.5) * 0.00009,
				availability,
				reasons: availability === "low_battery" ? ["low_battery"] : offline ? ["inactive"] : [],
				warnings: [],
				fault: null,
				updatedAt: new Date().toISOString()
			};
		});
		const count = (kind: string) => scooters.filter(item => item.availability === kind).length;
		return {
			id: 101 + index,
			name,
			latitude,
			longitude,
			capacity,
			type: index === 1 ? "rfid" : "normal",
			region: "NCTU-NTHU",
			lowBatteryPercent: 35,
			availableCount: count("available"),
			lowBatteryCount: count("low_battery"),
			outOfServiceCount: count("unavailable"),
			unavailableCount: scooters.length - count("available"),
			scooters
		};
	});
	const all = stations.flatMap(station => station.scooters);
	const count = (kind: string) => all.filter(item => item.availability === kind).length;
	return {
		updatedAt: new Date().toISOString(),
		stationCount: stations.length,
		totalCount: all.length,
		availableCount: count("available"),
		lowBatteryCount: count("low_battery"),
		outOfServiceCount: count("unavailable"),
		unavailableCount: all.length - count("available"),
		inUseCount: 2,
		reasons: { lowBattery: count("low_battery"), hardware: 0, communication: count("unavailable"), location: 0, reserved: 0 },
		stations
	};
}

const ring = (points: Array<[number, number]>) => [[...points, points[0]]];
const efences = {
	type: "FeatureCollection",
	features: [
		{
			type: "Feature",
			id: 11,
			properties: { zone: "normalSpeedArea", name: "正常騎乘區", description: null, color: "#FFD700", priority: 10000 },
			geometry: {
				type: "Polygon",
				coordinates: ring([
					[120.9905, 24.7978],
					[120.9968, 24.7985],
					[120.9985, 24.7915],
					[121.0048, 24.7905],
					[121.0042, 24.7838],
					[120.994, 24.784],
					[120.9898, 24.7905]
				])
			}
		},
		{
			type: "Feature",
			id: 25,
			properties: { zone: "noThrottleArea", name: "空檔區", description: "車子會被切換為空檔", color: "#FF7C6A", priority: 2500 },
			geometry: {
				type: "Polygon",
				coordinates: ring([
					[120.9963, 24.7896],
					[120.9978, 24.7896],
					[120.9978, 24.7884],
					[120.9963, 24.7884]
				])
			}
		}
	]
};

async function open(page: Page, path: string) {
	const api = await mockOlowoApi(page);
	// Registered after the shared mock, so these answer first.
	await page.route("**/v1/map/stations", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(campusFleet()) }));
	await page.route("**/v1/map/efences", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(efences) }));
	await page.goto(path);
	await expect(page.locator(".mapboxgl-canvas")).toBeVisible();
	// Let tiles, pins and the sheet settle.
	await page.waitForTimeout(3500);
	return api;
}

test("desktop map", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== "desktop");
	await open(page, "/");
	await page.screenshot({ path: out("desktop-map") });
});

test("phone views", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== "mobile");
	await open(page, "/?station=101");
	await page.screenshot({ path: out("phone-station") });

	await page.goto("/?station=101&scooter=1512");
	await page.locator(".sheet-handle").click();
	await panel(page)
		.getByRole("button", { name: /自動歸還/ })
		.click();
	await panel(page).getByRole("radio", { name: "58 秒" }).click();
	await panel(page).getByRole("button", { name: "立即借用" }).click();
	await expect(page).toHaveURL(/view=ride/);
	await page.locator(".sheet-handle").click();
	await expect(panel(page).getByText(/騎乘滿 58 秒 時自動歸還/)).toBeVisible();
	await page.waitForTimeout(6000);
	await page.screenshot({ path: out("phone-ride") });

	await page.goto("/?view=plans");
	await expect(panel(page).getByText("月用量 Plus")).toBeVisible();
	await page.waitForTimeout(1500);
	await page.screenshot({ path: out("phone-plans") });
});
