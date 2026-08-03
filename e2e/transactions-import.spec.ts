import { expect, test, type Locator, type Page } from "@playwright/test";

function uniqueSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

function buildValidCsv(suffix: string) {
  return [
    "Date,Category,Necessity,Outcome Account,Outcome Amount,Outcome Currency,Income Account,Income Amount,Income Currency",
    `2026-07-01,Groceries ${suffix},ESSENTIAL,Checking ${suffix},54.30,USD,,,`,
    `2026-07-02,Salary ${suffix},,,,,Checking ${suffix},3200.00,USD`,
    `2026-07-03,Dining Out ${suffix},LOW,Checking ${suffix},32.10,USD,,,`,
    `2026-07-05,Utilities ${suffix},HIGH,Checking ${suffix},120.00,USD,,,`,
    `2026-07-08,Transfer ${suffix},MEDIUM,Savings ${suffix},500.00,USD,Checking ${suffix},500.00,USD`,
    "",
  ].join("\n");
}

const HEADERS_ONLY_CSV =
  "Date,Category,Necessity,Outcome Account,Outcome Amount,Outcome Currency,Income Account,Income Amount,Income Currency\n";

async function uploadCsv(page: Page, content: string, fileName = "transactions.csv") {
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: fileName, mimeType: "text/csv", buffer: Buffer.from(content, "utf-8") });
}

/** Simulates a native OS drag-and-drop of a file onto `zone`, bypassing the file picker. */
async function dropFile(
  page: Page,
  zone: Locator,
  fileName: string,
  mimeType: string,
  content: string,
) {
  const base64 = Buffer.from(content, "utf-8").toString("base64");
  const dataTransfer = await page.evaluateHandle(
    (args) => {
      const binary = atob(args.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], args.fileName, { type: args.mimeType });
      const dt = new DataTransfer();
      dt.items.add(file);
      return dt;
    },
    { base64, fileName, mimeType },
  );
  await zone.dispatchEvent("drop", { dataTransfer });
}

function section(page: Page, title: string) {
  return page.locator("section").filter({ hasText: title });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/transactions-import");
  // TanStack Start SSRs the shell before the client bundle hydrates; interacting
  // with the file input before hydration finishes makes the app miss the change
  // event entirely, so wait for the network (incl. hydration chunks) to settle.
  await page.waitForLoadState("networkidle");
});

test.describe("transactions import", () => {
  test("imports a CSV end-to-end: upload, resolve bindings, map columns, create transactions", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    await uploadCsv(page, buildValidCsv(suffix));

    const accounts = section(page, "Accounts");
    await accounts.locator("select[multiple]").selectOption(["Outcome Account", "Income Account"]);
    const addMissingAccounts = accounts.getByRole("button", { name: "Add missing (2)" });
    await expect(addMissingAccounts).toBeEnabled();
    await addMissingAccounts.click();
    await expect(accounts.getByRole("button", { name: "Add missing (0)" })).toBeDisabled();

    const categories = section(page, "Categories");
    await categories.locator("select[multiple]").selectOption(["Category"]);
    const addMissingCategories = categories.getByRole("button", { name: "Add missing (5)" });
    await expect(addMissingCategories).toBeEnabled();
    await addMissingCategories.click();
    await expect(categories.getByRole("button", { name: "Add missing (0)" })).toBeDisabled();

    const proceed = page.getByRole("button", { name: "Proceed" });
    await expect(proceed).toBeEnabled();
    await proceed.click();

    // Column order is fixed by getMapColumnsTableColumns: createdAt, category,
    // necessityLevel, then the income (incomeAccountId/Amount/Currency) group,
    // then the outcome (outcomeAccountId/Amount/Currency) group.
    const headerSelects = page.locator("table thead select");
    await expect(headerSelects).toHaveCount(9);
    await headerSelects.nth(0).selectOption("Date");
    await headerSelects.nth(1).selectOption("Category");
    await headerSelects.nth(2).selectOption("Necessity");
    await headerSelects.nth(3).selectOption("Income Account");
    await headerSelects.nth(4).selectOption("Income Amount");
    await headerSelects.nth(5).selectOption("Income Currency");
    await headerSelects.nth(6).selectOption("Outcome Account");
    await headerSelects.nth(7).selectOption("Outcome Amount");
    await headerSelects.nth(8).selectOption("Outcome Currency");

    await page.getByRole("button", { name: "Create transactions" }).click();

    await expect(page).toHaveURL("/transactions");

    // Widen the page size so the freshly imported row is findable regardless
    // of how the (unordered) transactions list happens to sort it.
    await page.getByLabel("Page size").selectOption("100");
    const groceriesRow = page.getByRole("row", { name: new RegExp(`Groceries ${suffix}`) });
    await expect(groceriesRow).toBeVisible();
    await expect(groceriesRow).toContainText("$54.30");
  });

  test("keeps Proceed disabled until accounts and categories are resolved", async ({ page }) => {
    const suffix = uniqueSuffix();
    await uploadCsv(page, buildValidCsv(suffix));

    const accounts = section(page, "Accounts");
    await accounts.locator("select[multiple]").selectOption(["Outcome Account", "Income Account"]);
    await expect(accounts.getByRole("button", { name: "Add missing (2)" })).toBeEnabled();

    const categories = section(page, "Categories");
    await categories.locator("select[multiple]").selectOption(["Category"]);
    await expect(categories.getByRole("button", { name: "Add missing (5)" })).toBeEnabled();

    // Neither section's missing names have been created yet, so bindings
    // stay unresolved and Proceed must remain disabled.
    await expect(page.getByRole("button", { name: "Proceed" })).toBeDisabled();
  });

  test("rejects a non-CSV file dropped onto the upload zone", async ({ page }) => {
    const zone = page.locator("label").locator("..");
    await dropFile(page, zone, "not-a-csv.txt", "text/plain", "just plain text");

    // FileInput's isAccepted() re-checks the mime/extension on drop (drag-and-drop
    // bypasses the native <input accept> filter), so the file is silently ignored.
    await expect(page.getByText("Choose a file or drag it here")).toBeVisible();
    await expect(page.getByText("Accounts", { exact: true })).toHaveCount(0);
  });

  test("shows an inline error and stays on the upload step for a CSV with no data rows", async ({
    page,
  }) => {
    await uploadCsv(page, HEADERS_ONLY_CSV, "headers-only.csv");

    await expect(page.getByText("This file has no data rows to import.")).toBeVisible();
    await expect(page.getByText("Choose a file or drag it here")).toBeVisible();
    await expect(page.getByRole("button", { name: "Proceed" })).toHaveCount(0);
  });
});
