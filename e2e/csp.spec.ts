// Spec 039: the browser refuses connections to other sites.
import { expect, test } from "@playwright/test";
import { firstPage, openFixture, saveAndRead } from "./helpers";

test("the site sends its CSP, and the app works under it", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy"))
      violations.push(message.text());
  });

  for (const path of ["/", "/app/"]) {
    const response = await page.goto(path);
    expect(response?.headers()["content-security-policy"]).toContain(
      "connect-src 'self'",
    );
  }

  await openFixture(page, "simple-text.pdf");
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await saveAndRead(page);
  expect(violations).toEqual([]);

  // A connection to any other site is refused by the browser itself.
  const sent = await page.evaluate(() =>
    fetch("https://example.com/", { method: "POST", body: "x" }).then(
      () => "sent",
      () => "refused",
    ),
  );
  expect(sent).toBe("refused");
  expect(violations.join("\n")).toContain("example.com");
});
