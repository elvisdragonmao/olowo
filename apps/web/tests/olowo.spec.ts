import { expect, test, type Page } from "@playwright/test";
import { mockMapbox, mockOlowoApi, samplePhoto } from "./mock-api";

const realTiles = process.env.OLOWO_REAL_TILES === "1";

async function open(page: Page, path = "/", options: { authenticated?: boolean } = {}) {
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	page.on("console", message => {
		if (message.type() === "error") errors.push(message.text());
	});
	await mockMapbox(page, { realTiles });
	const api = await mockOlowoApi(page, options);
	await page.goto(path);
	await expect(page.locator(".mapboxgl-canvas")).toBeVisible();
	return { api, errors };
}

async function signIn(page: Page) {
	await panel(page).getByLabel("Email").fill("rider@example.com");
	await panel(page).getByRole("button", { name: "寄送驗證碼" }).click();
	await panel(page).getByLabel("驗證碼").fill("123456");
	await panel(page).getByRole("button", { name: "登入", exact: true }).click();
}

const panel = (page: Page) => page.getByRole("region", { name: "站點與車輛" }).or(page.getByRole("complementary", { name: "站點與車輛" }));

test("the map shows stations; a scooter appears only at its own GPS fix once selected", async ({ page }, testInfo) => {
	const { errors } = await open(page);
	await expect(page.locator(".station-pin")).toHaveCount(3);
	await expect(panel(page).getByRole("list", { name: "交大車況" }).or(panel(page).locator(".fleet-summary .stat-strip"))).toBeVisible();
	const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
	expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
	if (realTiles) await page.waitForTimeout(1500);
	await page.screenshot({ path: testInfo.outputPath("nearby.png") });

	await page.getByRole("button", { name: "浩然圖書館，3 台可借" }).click();
	await expect(page).toHaveURL(/station=101/);
	await expect(panel(page).getByRole("heading", { name: "浩然圖書館" })).toBeVisible();
	await expect(page.locator(".station-pin[data-selected='true']")).toHaveCount(1);
	await expect(page.locator(".scooter-fix")).toHaveCount(0);
	await expect(page.locator(".scooter-dot")).toHaveCount(4);
	await expect(page.getByRole("button", { name: /浩然圖書館，3 台可借，共 4 台/ })).toContainText("3/4");
	await expect(panel(page).locator(".scooter-row")).toHaveCount(4);
	const flagged = panel(page).locator(".scooter-row", { hasText: "KA-104" });
	await expect(flagged).toContainText("可借");
	await expect(flagged).toContainText("回報油門訊號異常");
	await expect(panel(page).getByText(/^交大 · /)).toBeVisible();

	await page.getByRole("button", { name: "JZ-551，電量 62%" }).click();
	await expect(page).toHaveURL(/scooter=1513/);
	await expect(page.locator(".scooter-fix")).toContainText("JZ-551");
	await expect(page.locator(".scooter-dot")).toHaveCount(3, { timeout: 2000 });
	await expect(panel(page).getByRole("button", { name: "立即借用" })).toBeVisible();
	await expect(panel(page).getByRole("button", { name: "預約 5 分鐘" })).toBeVisible();
	if (realTiles) await page.waitForTimeout(1500);
	await page.screenshot({ path: testInfo.outputPath("scooter.png") });

	// A controller fault is only a warning: the scooter can still be borrowed, as in the official app.
	await page.goBack();
	if (testInfo.project.name === "mobile") await page.locator(".sheet-handle").click();
	await panel(page).locator(".scooter-row", { hasText: "KA-104" }).click();
	await expect(panel(page).getByRole("note")).toContainText("回報油門訊號異常");
	await expect(panel(page).getByRole("button", { name: "立即借用" })).toBeEnabled();
	await page.goBack();
	await expect(page.locator(".scooter-fix")).toHaveCount(0);
	await page.goBack();
	await expect(page.locator(".station-pin[data-selected='true']")).toHaveCount(0);
	expect(errors).toEqual([]);
});

test("anonymous riders sign in before stations load", async ({ page }) => {
	const { errors } = await open(page, "/", { authenticated: false });
	await expect(panel(page).getByRole("heading", { name: "登入看即時站點" })).toBeVisible();
	await expect(page.locator(".station-pin")).toHaveCount(0);
	await signIn(page);
	await expect(page.locator(".station-pin")).toHaveCount(3);
	await expect(panel(page).getByRole("list", { name: "交大車況" }).or(panel(page).locator(".fleet-summary .stat-strip"))).toBeVisible();
	expect(errors.filter(error => !error.includes("401"))).toEqual([]);
});

test("counts follow the campus on screen and empty stations sink to the bottom", async ({ page }) => {
	await open(page);
	const rows = panel(page).locator(".station-row");
	await expect(panel(page).getByRole("button", { name: /^交大/ })).toHaveAttribute("aria-pressed", "true");
	await expect(rows).toHaveCount(2);
	await expect(rows.first()).toContainText("浩然圖書館");
	await expect(rows.last()).toContainText("工程四館");
	const overview = panel(page).getByRole("definition");
	await expect(panel(page).locator(".fleet-summary")).toContainText("全交大");
	await expect(overview).toHaveText(["3", "2", "1"]);
	await expect(rows.last()).toContainText("1 沒電 · 1 故障");
	await expect(panel(page).getByRole("list", { name: "電子圍籬圖例" })).toContainText("空檔區");
	await expect(panel(page).getByRole("button", { name: "有車可借" })).toHaveCount(0);

	await panel(page).getByRole("button", { name: /^清大/ }).click();
	await expect(panel(page).getByRole("button", { name: /^清大/ })).toHaveAttribute("aria-pressed", "true");
	await expect(rows).toHaveCount(1);
	await expect(rows).toContainText("第二餐廳");
	await expect(overview).toHaveText(["0", "0", "0"]);

	await panel(page).getByRole("searchbox", { name: "搜尋站點" }).fill("館");
	await expect(rows).toHaveCount(2);
	await panel(page).getByRole("searchbox", { name: "搜尋站點" }).fill("不存在");
	await expect(panel(page).getByText("沒有符合的站點。")).toBeVisible();
});

test("scan to borrow falls back to typing the plate", async ({ page }) => {
	const { errors } = await open(page);
	await page.getByRole("button", { name: "掃碼借車" }).first().click();
	await expect(page).toHaveURL(/view=scan/);
	await expect(panel(page).getByRole("heading", { name: "掃碼借車" })).toBeVisible();
	// Headless Chromium has no camera, so the scanner explains itself and the plate field remains.
	await expect(panel(page).locator(".scan-message")).toBeVisible();
	await panel(page).getByLabel("或輸入車號").fill("zz-1");
	await panel(page).getByRole("button", { name: "前往" }).click();
	await expect(panel(page).getByText("這不是 oloo 車輛的 QR Code 或車號")).toBeVisible();
	await panel(page).getByLabel("或輸入車號").fill("jz-333");
	await panel(page).getByRole("button", { name: "前往" }).click();
	await expect(page).toHaveURL(/station=101&scooter=1512/);
	await expect(panel(page).getByRole("button", { name: "立即借用" })).toBeVisible();
	expect(errors.filter(error => !error.includes("404"))).toEqual([]);
});

test("the phone sheet snaps between peek, half and full", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== "mobile", "the sheet only exists on narrow viewports");
	await open(page);
	const sheet = page.locator(".panel-sheet");
	await expect(sheet).toHaveAttribute("data-snap", "half");
	const handle = await page.locator(".sheet-handle").boundingBox();
	const drag = async (dy: number) => {
		await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
		await page.mouse.down();
		for (let step = 1; step <= 8; step += 1) await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2 + (dy * step) / 8);
		await page.mouse.up();
	};
	await drag(-260);
	await expect(sheet).toHaveAttribute("data-snap", "full");
	await page
		.locator(".view-head")
		.first()
		.click({ position: { x: 4, y: 4 } });
	await expect(sheet).toHaveAttribute("data-snap", "full");
	await page.locator(".sheet-handle").click();
	await expect(sheet).toHaveAttribute("data-snap", "half");
	// Wait for the spring to settle so the tap lands on the map rather than the moving sheet.
	await expect.poll(async () => (await sheet.boundingBox())?.y).toBeGreaterThan(300);
	const map = await page.locator(".mapboxgl-canvas").boundingBox();
	await page.mouse.click(map!.x + 24, map!.y + 220);
	await expect(sheet).toHaveAttribute("data-snap", "peek");
	await page.getByRole("button", { name: "浩然圖書館，3 台可借" }).click();
	await expect(sheet).toHaveAttribute("data-snap", "half");
});

test("reserve with a countdown, borrow with a timer, return, photo and pay", async ({ page }) => {
	const { api, errors } = await open(page, "/?station=101&scooter=1512", { authenticated: false });
	await signIn(page);
	const mobile = test.info().project.name === "mobile";
	const expand = async () => {
		if (mobile && (await page.locator(".panel-sheet").getAttribute("data-snap")) !== "full") await page.locator(".sheet-handle").click();
	};

	await expect(panel(page).getByRole("heading", { name: /JZ-333/ })).toBeVisible();
	await panel(page).getByRole("button", { name: "預約 5 分鐘" }).click();
	await expect(panel(page).getByText(/取車時間剩 0[45]:\d\d/)).toBeVisible();
	await expect(panel(page).getByText(/最近一小時預約 1 次/)).toBeVisible();
	await expect(panel(page).getByRole("button", { name: "借用預約的車" })).toBeVisible();
	await page.screenshot({ path: test.info().outputPath("reserved.png") });

	await expand();
	await panel(page).getByText("借用後計時").click();
	await panel(page).getByRole("radio", { name: "歸還後重借" }).click();
	await panel(page).getByRole("radio", { name: "28 秒" }).click();
	await panel(page).getByRole("button", { name: "借用預約的車" }).click();
	await expect(panel(page).getByText(/28 秒 時歸還並立刻重借/)).toBeVisible();
	await panel(page).getByRole("button", { name: "確認借用" }).click();

	await expect(page).toHaveURL(/view=ride/);
	await expect(panel(page).getByText(/預估 \$4/)).toBeVisible();
	const rent = api.requests.find(request => request.method === "POST" && request.path === "/v1/rides");
	expect(rent?.body).toMatchObject({ scooterId: 1512, reservationId: 55, automation: { action: "return_and_reborrow", afterRideSeconds: 28 } });

	await expand();
	await expect(panel(page).getByRole("radio", { name: "提醒" })).toHaveCount(0);
	await panel(page).getByRole("radio", { name: "自動歸還" }).click();
	await panel(page).getByRole("radio", { name: "自訂" }).click();
	await panel(page).getByLabel("時長（分:秒）").fill("3:28");
	await panel(page).getByRole("button", { name: "設定自動歸還" }).click();
	await expect(panel(page).getByText(/3:28 時會直接歸還/)).toBeVisible();
	await panel(page).getByRole("button", { name: "確認設定" }).click();
	await expect(panel(page).getByText(/自動歸還 · 剩/)).toBeVisible();
	expect(api.requests.find(request => request.method === "PUT")?.body).toEqual({ action: "return", afterRideSeconds: 208 });
	await page.screenshot({ path: test.info().outputPath("ride.png") });

	await panel(page).getByRole("button", { name: "歸還車輛" }).click();
	await panel(page).getByRole("button", { name: "確認歸還" }).click();
	await expect(page).toHaveURL(/view=checkout/);
	await expect(panel(page).locator(".bill-total")).toHaveText("$9");
	await expect(panel(page).getByRole("button", { name: "付款 $9" })).toBeDisabled();
	await panel(page).getByLabel("拍攝還車照片").setInputFiles(samplePhoto);
	await expect(panel(page).getByText("已上傳，點此重拍")).toBeVisible();
	await page.screenshot({ path: test.info().outputPath("checkout.png") });
	await panel(page).getByRole("button", { name: "付款 $9" }).click();
	await expect(panel(page).getByRole("heading", { name: "已完成付款" })).toBeVisible();
	expect(api.photoUploads).toBe(1);
	expect(api.checkout).toEqual({ imageId: 777, cardId: 154060, useOlooCoin: true });
	expect(errors.filter(error => !error.includes("401"))).toEqual([]);
});
