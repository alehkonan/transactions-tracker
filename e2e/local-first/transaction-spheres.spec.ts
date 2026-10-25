import { expect } from "@playwright/test";
import { E2E_ACCOUNT_NAME, openSecondDevice, test, waitForSynced } from "../fixtures/auth";
import { readFinancialReplica } from "../fixtures/transfers";
import type { Page } from "@playwright/test";

async function prepareSpheres(page: Page, currency = "USD") {
  await page.goto("/accounts");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))))
    await page.reload();
  await waitForSynced(page);
  await page.getByTestId("account-create").click();
  await page.getByTestId("account-name").fill("Bank card");
  await page.getByTestId("account-currency").selectOption(currency);
  await page.getByTestId("account-submit").click();
  await expect(page.getByTestId("account-form")).toHaveCount(0);
  for (const [type, name] of [
    ["FUNDS", "Travel"],
    ["CAPITAL", "Savings"],
  ]) {
    await page.getByTestId("sphere-create-type").selectOption(type);
    await page.getByTestId("sphere-create-name").fill(name);
    await page.getByTestId("sphere-create").click();
    await expect(page.getByTestId("sphere-create-name")).toHaveValue("");
  }
  await waitForSynced(page);
  const replica = await readFinancialReplica(page);
  const source = replica.accounts.find((row) => row.name === E2E_ACCOUNT_NAME)!;
  const destination = replica.accounts.find((row) => row.name === "Bank card")!;
  const funds = replica.spheres.find((row) => row.name === "Travel")!;
  const capital = replica.spheres.find((row) => row.name === "Savings")!;
  await page.goto("/transactions");
  return { source, destination, funds, capital };
}

test("reserved income can fund spending on another account with warnings and complete offline edit/delete effects", async ({
  onboardedPage: page,
  context,
  authCredentials,
}, testInfo) => {
  const { source, destination, funds, capital } = await prepareSpheres(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.setOffline(true);
  await page.getByTestId("transaction-create").click();
  await page.getByTestId("transaction-type-INCOME").click();
  await expect(page.getByTestId("transaction-sphere")).toHaveValue("");
  await page.getByTestId("transaction-account").selectOption(source.id);
  await page.getByTestId("transaction-amount").fill("100.00");
  await page.getByTestId("transaction-sphere").selectOption(funds.id);
  await page.getByTestId("transaction-comment").fill("Reserved income");
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  await page.getByTestId("transaction-create").click();
  await expect(page.getByTestId("transaction-sphere")).toHaveValue("");
  await page.getByTestId("transaction-account").selectOption(destination.id);
  await page.getByTestId("transaction-amount").fill("120.00");
  await page.getByTestId("transaction-sphere").selectOption(funds.id);
  await expect(page.getByTestId("transaction-sphere-warning")).toContainText("−$20.00");
  await expect(page.getByTestId("transaction-submit")).toBeEnabled();
  await expect(page.getByTestId("transaction-form").locator("..")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("mobile.png"), animations: "disabled" });
  await page.getByTestId("transaction-amount").fill("25.00");
  await expect(page.getByTestId("transaction-sphere-warning")).toHaveCount(0);
  await page.getByTestId("transaction-comment").fill("Travel expense");
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  const original = await readFinancialReplica(page);
  const expense = original.transactions.find((row) => row.type === "EXPENSE")!;
  await expect(
    page.getByTestId(`transaction-${expense.id}`).getByTestId("transaction-sphere-label"),
  ).toHaveText("Funds / Travel");
  await page.getByTestId("nav-accounts").click();
  await expect(page.getByTestId(`account-${source.id}`)).toContainText("$100.00");
  await expect(page.getByTestId(`account-${destination.id}`)).toContainText("−$25.00");
  await expect(page.getByTestId(`sphere-${funds.id}`).getByTestId("sphere-balances")).toContainText(
    "$75.00",
  );
  await page.getByTestId("nav-transactions").click();
  await page.getByTestId(`transaction-${expense.id}`).click();
  await expect(page.getByTestId("transaction-sphere")).toHaveValue(funds.id);
  await page.getByTestId("transaction-sphere").selectOption(capital.id);
  await page.getByTestId("transaction-account").selectOption(source.id);
  await page.getByTestId("transaction-amount").fill("30.00");
  await expect(page.getByTestId("transaction-sphere-warning")).toContainText("−$30.00");
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByTestId(`transaction-${expense.id}`).getByTestId("transaction-sphere-label"),
  ).toHaveText("Capital / Savings");
  await page.getByTestId("nav-accounts").click();
  await expect(page.getByTestId(`account-${source.id}`)).toContainText("$70.00");
  await expect(page.getByTestId(`account-${destination.id}`)).toContainText("$0.00");
  await expect(page.getByTestId(`sphere-${funds.id}`).getByTestId("sphere-balances")).toContainText(
    "$100.00",
  );
  await expect(
    page.getByTestId(`sphere-${capital.id}`).getByTestId("sphere-balances"),
  ).toContainText("−$30.00");
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await waitForSynced(page);
  const second = await openSecondDevice(page, authCredentials);
  try {
    await expect(
      second.page.getByTestId(`transaction-${expense.id}`).getByTestId("transaction-sphere-label"),
    ).toHaveText("Capital / Savings");
    await second.page.getByTestId(`transaction-${expense.id}`).click();
    await expect(second.page.getByTestId("transaction-sphere")).toHaveValue(capital.id);
    await second.page.getByTestId("transaction-delete").click();
    await second.page.getByTestId("transaction-delete-confirm").click();
    await expect(second.page.getByTestId("transaction-form")).toHaveCount(0);
    await waitForSynced(second.page);
    await second.page.getByTestId("nav-accounts").click();
    await expect(second.page.getByTestId(`account-${source.id}`)).toContainText("$100.00");
    await expect(
      second.page.getByTestId(`sphere-${capital.id}`).getByTestId("sphere-balances"),
    ).not.toContainText("−$30.00");
  } finally {
    await second.context.close();
  }
});

test("transfer spheres default independently, cancel in one currency, and converge after a lost acceptance response", async ({
  onboardedPage: page,
  context,
  authCredentials,
}, testInfo) => {
  const { source, destination, funds, capital } = await prepareSpheres(page);
  await page.getByTestId("nav-accounts").click();
  await page.getByTestId("account-create").click();
  await page.getByTestId("account-name").fill("Euro account");
  await page.getByTestId("account-currency").selectOption("EUR");
  await page.getByTestId("account-submit").click();
  await expect(page.getByTestId("account-form")).toHaveCount(0);
  await waitForSynced(page);
  const euro = (await readFinancialReplica(page)).accounts.find(
    (row) => row.name === "Euro account",
  )!;
  await page.getByTestId("nav-transactions").click();
  await context.setOffline(true);
  await page.getByTestId("transaction-create").click();
  await page.getByTestId("transaction-type-TRANSFER").click();
  await expect(page.getByTestId("transaction-sphere")).toHaveValue("");
  await expect(page.getByTestId("transaction-to-sphere")).toHaveValue("");
  await page.getByTestId("transaction-sphere").selectOption(funds.id);
  await expect(page.getByTestId("transaction-to-sphere")).toHaveValue("");
  await page.getByTestId("transaction-account").selectOption(source.id);
  await page.getByTestId("transaction-to-account").selectOption(destination.id);
  await page.getByTestId("transaction-amount").fill("10.00");
  await page.getByTestId("transaction-to-amount").fill("10.00");
  await page.getByTestId("transaction-to-sphere").selectOption(funds.id);
  await expect(page.getByTestId("transaction-sphere-warning")).toHaveCount(0);
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  const created = await readFinancialReplica(page);
  const incoming = created.transactions.find((row) => Number(row.amount) > 0)!;
  await page.getByTestId("nav-accounts").click();
  await expect(page.getByTestId(`sphere-${funds.id}`).getByTestId("sphere-balances")).toContainText(
    "$0.00",
  );
  await page.getByTestId("nav-transactions").click();
  await page.getByTestId(`transaction-${incoming.id}`).click();
  await expect(page.getByTestId("transaction-sphere")).toHaveValue(funds.id);
  await expect(page.getByTestId("transaction-to-sphere")).toHaveValue(funds.id);
  await page.getByTestId("transaction-to-account").selectOption(euro.id);
  await page.getByTestId("transaction-amount").fill("20.00");
  await page.getByTestId("transaction-to-amount").fill("18.50");
  await page.getByTestId("transaction-to-sphere").selectOption(capital.id);
  await expect(page.getByTestId("transaction-sphere")).toHaveValue(funds.id);
  await expect(page.getByTestId("transaction-sphere-warning")).toContainText("−$20.00");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByTestId("transaction-form").locator("..")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("desktop.png"), animations: "disabled" });
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  const pending = await readFinancialReplica(page);
  expect(pending.outbox).toHaveLength(4);
  let lost = false;
  await page.route("**/_serverFn/**", async (route) => {
    const body = route.request().postData() ?? "";
    if (!lost && body.includes('"mutations"') && body.includes('"TRANSFER"')) {
      await route.fetch();
      lost = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await expect.poll(() => lost).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId(`transaction-${incoming.id}`)).toBeVisible();
  expect((await readFinancialReplica(page)).outbox).toEqual(pending.outbox);
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await waitForSynced(page);
  expect((await readFinancialReplica(page)).outbox).toEqual([]);
  const second = await openSecondDevice(page, authCredentials);
  try {
    const remote = await readFinancialReplica(second.page);
    expect(remote.transactions).toHaveLength(2);
    expect(remote.allocations.filter((row) => row.transactionId != null)).toHaveLength(2);
    await second.page.getByTestId("nav-accounts").click();
    await expect(second.page.getByTestId(`account-${source.id}`)).toContainText("−$20.00");
    await expect(second.page.getByTestId(`account-${destination.id}`)).toContainText("$0.00");
    await expect(second.page.getByTestId(`account-${euro.id}`)).toContainText("€18.50");
    await expect(
      second.page.getByTestId(`sphere-${funds.id}`).getByTestId("sphere-balances"),
    ).toContainText("−$20.00");
    await expect(
      second.page.getByTestId(`sphere-${capital.id}`).getByTestId("sphere-balances"),
    ).toContainText("€18.50");
    await second.page.getByTestId("nav-transactions").click();
    await second.page.getByTestId(`transaction-${incoming.id}`).click();
    await expect(second.page.getByTestId("transaction-sphere")).toHaveValue(funds.id);
    await expect(second.page.getByTestId("transaction-to-sphere")).toHaveValue(capital.id);
    await second.page.getByTestId("transaction-delete").click();
    await second.page.getByTestId("transaction-delete-confirm").click();
    await expect(second.page.getByTestId("transaction-form")).toHaveCount(0);
    await waitForSynced(second.page);
    expect((await readFinancialReplica(second.page)).transactions).toEqual([]);
    expect(
      (await readFinancialReplica(second.page)).allocations.filter(
        (row) => row.transactionId != null,
      ),
    ).toEqual([]);
  } finally {
    await second.context.close();
  }
});
