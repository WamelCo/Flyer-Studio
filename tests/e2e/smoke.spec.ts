import { expect, test, type Page } from "@playwright/test";

/** Console errors and uncaught exceptions on a page, ignoring expected 401s from signed-out API calls. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/401|Failed to load resource/.test(message.text())) errors.push(message.text());
  });
  return errors;
}

test.describe("public pages", () => {
  test("landing: hero, sections, footer, no errors", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Describe it.");
    await expect(page.getByRole("link", { name: "Start creating" }).first()).toBeVisible();
    for (const id of ["examples", "features", "how-it-works", "faq"]) await expect(page.locator(`#${id}`)).toHaveCount(1);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Privacy Policy" }).first()).toBeVisible();
    await expect(footer.getByRole("link", { name: "Terms of Use" }).first()).toBeVisible();
    await expect(footer).toContainText(`Copyright © ${new Date().getFullYear()}`);
    expect(errors).toEqual([]);
  });

  test("FAQ disclosure opens and closes", async ({ page }) => {
    await page.goto("/#faq");
    const question = page.getByRole("button", { name: "Can I edit everything?" });
    await question.click();
    await expect(question).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Every word, colour, shape and photo is a layer")).toBeVisible();
    await question.click();
    await expect(question).toHaveAttribute("aria-expanded", "false");
  });

  test("pricing lists every plan; upgrading while signed out asks to sign in", async ({ page }) => {
    await page.goto("/pricing");
    for (const plan of ["Free", "Pro", "Max"]) await expect(page.getByRole("heading", { name: plan, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Upgrade to Pro" }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("sign-in form needs an email before it continues", async ({ page }) => {
    await page.goto("/login");
    const submit = page.getByRole("button", { name: /Continue with email/ });
    await expect(submit).toBeDisabled();
    await page.getByLabel("Email").fill("someone@example.com");
    await expect(submit).toBeEnabled();
  });

  test("legal pages render", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
    await page.goto("/terms");
    await expect(page.getByRole("heading", { level: 1, name: "Terms of Use" })).toBeVisible();
  });
});

test.describe("security", () => {
  test("every page sends the security headers", async ({ request }) => {
    for (const path of ["/", "/pricing", "/login"]) {
      const response = await request.get(path);
      const headers = response.headers();
      expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(headers["content-security-policy"]).toContain("object-src 'none'");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["strict-transport-security"]).toContain("max-age=");
      expect(headers["x-powered-by"]).toBeUndefined();
    }
  });

  test("app pages redirect to sign-in when signed out", async ({ page }) => {
    for (const path of ["/dashboard", "/projects", "/billing"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("APIs refuse signed-out calls with the typed error", async ({ request }) => {
    const generate = await request.post("/api/generate", { data: { prompt: "Jazz night", format: "poster" } });
    expect(generate.status()).toBe(401);
    expect(await generate.json()).toMatchObject({ error: "UNAUTHORIZED" });
    const job = await request.get("/api/generate/00000000-0000-4000-8000-000000000000");
    expect(job.status()).toBe(401);
  });

  test("the dev playground does not exist in production", async ({ request }) => {
    expect((await request.get("/dev-playground")).status()).toBe(404);
    expect((await request.get("/dev-playground/gallery")).status()).toBe(404);
  });
});
