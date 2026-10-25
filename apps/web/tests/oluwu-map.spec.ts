import { expect, test } from "@playwright/test";
import { mockOluwuApi } from "./mock-api";

test.use({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 1 });

test("map list stays usable and matches the selected mobile direction", async ({ page }) => {
	const consoleErrors: string[] = [];
	page.on("console", message => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});

	await mockOluwuApi(page);
	await page.goto("/");

	const screen = page.getByTestId("device-screen");
	await expect(screen).toBeVisible();
	const box = await screen.boundingBox();
	expect(box?.width).toBe(393);
	expect(box?.height).toBe(852);

	await expect(screen.getByRole("heading", { name: "9 台可借" })).toBeVisible();
	await expect(screen.getByText("附近共 24 台")).toBeVisible();
	await expect(screen.locator(".scooter-row", { hasText: "JZ-333" })).toBeVisible();
	await expect(screen.locator(".scooter-row", { hasText: "JZ-551" })).toBeVisible();
	await expect(screen.locator(".scooter-row", { hasText: "JZ-772" })).toBeVisible();
	await expect(screen.locator(".map-scooter-marker")).toHaveCount(3);

	const shellOverflow = await screen.locator(".oluwu-shell").evaluate(element => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth
	}));
	expect(shellOverflow.scrollWidth).toBeLessThanOrEqual(shellOverflow.clientWidth);

	await screen.screenshot({ path: "design/implementation-iphone.png" });

	await screen.locator(".scooter-row", { hasText: "JZ-551" }).click();
	await expect(screen.locator(".selected-scooter-summary strong")).toHaveText("JZ-551");

	await screen.getByRole("button", { name: "搜尋與篩選" }).click();
	await expect(screen.getByText("篩選附近車輛")).toBeVisible();
	await screen.getByRole("button", { name: "70%" }).click();
	await expect(screen.locator(".scooter-row", { hasText: "JZ-551" })).toHaveCount(0);
	await page.keyboard.press("Escape");

	await screen.getByRole("button", { name: /15 台暫不可借/ }).click();
	await expect(screen.getByText("15 台暫不可借", { exact: true })).toBeVisible();
	await expect(screen.getByText("電量不足")).toBeVisible();

	expect(consoleErrors).toEqual([]);
});

test("email login, scheduled reservation, timed ride and return confirmations work", async ({ page }) => {
	const api = await mockOluwuApi(page);
	await page.goto("/");
	const screen = page.getByTestId("device-screen");

	await screen.getByRole("button", { name: "帳號" }).click();
	await screen.getByLabel("Email").fill("info@elvismao.com");
	await screen.getByRole("button", { name: "寄送驗證碼" }).click();
	await screen.getByLabel("六位數驗證碼").fill("123456");
	await screen.getByRole("button", { name: "登入", exact: true }).click();
	await expect(screen.getByText("已登入", { exact: true })).toBeVisible();
	await page.keyboard.press("Escape");

	await screen.getByRole("button", { name: "借用資訊" }).click();
	await expect(screen.getByText("普通費率")).toBeVisible();
	await page.waitForTimeout(500);
	await screen.screenshot({ path: "design/implementation-borrow.png" });
	await screen.getByRole("radio", { name: "5 分" }).first().click();
	await screen.getByRole("button", { name: "設定 5 分後預約" }).click();
	await expect(screen.getByText("將預約 JZ-333")).toBeVisible();
	await screen.getByRole("button", { name: "取消定時預約" }).click();

	await screen.getByRole("radio", { name: "歸還", exact: true }).click();
	await screen.getByRole("button", { name: "借用這台車" }).click();
	await expect(screen.getByText(/1:29自動歸還/)).toBeVisible();
	await screen.getByRole("button", { name: "確認借用" }).click();
	await expect(screen.getByText("已開始騎乘")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(screen.getByRole("button", { name: "管理騎乘" })).toBeVisible();

	const rentRequest = api.requests.find(request => request.method === "POST" && request.path === "/v1/rides");
	expect(rentRequest?.body).toMatchObject({ scooterId: 12, automation: { action: "return", afterRideSeconds: 89 } });

	await screen.getByRole("button", { name: "管理騎乘" }).click();
	await page.waitForTimeout(500);
	await screen.screenshot({ path: "design/implementation-ride.png" });
	await screen.getByRole("radio", { name: "歸還並重借" }).click();
	await screen.getByRole("button", { name: "設定歸還並重借" }).click();
	await expect(screen.getByText(/可能開始下一段計費/)).toBeVisible();
	await screen.getByRole("button", { name: "確認設定" }).click();
	await expect(screen.getByText(/歸還並重借倒數/)).toBeVisible();

	await screen.getByRole("button", { name: "歸還車輛" }).click();
	await expect(screen.getByText("確認車輛已停妥並上鎖？送出後會立即結束騎乘。")).toBeVisible();
	await expect(screen.getByRole("button", { name: "確認歸還" })).toBeVisible();

	const automationRequest = api.requests.find(request => request.method === "PUT" && request.path === "/v1/rides/9123/automation");
	expect(automationRequest?.body).toMatchObject({ action: "return_and_reborrow", afterRideSeconds: 89 });
});
