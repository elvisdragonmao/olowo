import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 1 });

test("map list stays usable and matches the selected mobile direction", async ({ page }) => {
	const consoleErrors: string[] = [];
	page.on("console", message => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});

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
