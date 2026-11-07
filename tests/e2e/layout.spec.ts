import { expect, test } from "@playwright/test";

/** Runs on desktop and phone: nothing may scroll sideways, and the key actions are reachable. */
for (const path of ["/", "/pricing", "/login", "/privacy"]) {
  test(`${path} fits the viewport without sideways scrolling`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("link", { name: "Start creating" }).first()).toBeVisible();
  });
}
