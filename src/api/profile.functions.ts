import { createServerFn } from "@tanstack/react-start";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/get-db.server";
import { accountsTable, profilesTable, transactionsTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { getUsdRates } from "./currency-rates.server";
import { loggerMiddleware } from "./logger.middleware";
import { profileMiddleware } from "./profile.middleware";
import { setSelectedProfileCookie } from "./selected-profile.server";

/**
 * Records the caller's profile choice, having first proven they own it. That check is why this is
 * a mutation rather than something the client can set for itself: the resulting cookie is signed,
 * so every request afterwards trusts the id without asking the database again.
 */
export const selectProfile = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.object({ profileId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const [profile] = await getDb()
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(and(eq(profilesTable.id, data.profileId), eq(profilesTable.userId, context.user.id)));

    if (!profile) throw new Response("No such profile.", { status: 404 });

    setSelectedProfileCookie({ profileId: profile.id, userId: context.user.id });
  });

export const getCurrentProfile = createServerFn()
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .handler(async ({ context }) => {
    if (context.profileId == null) return null;

    const [profile] = await getDb()
      .select({ id: profilesTable.id, name: profilesTable.name })
      .from(profilesTable)
      .where(eq(profilesTable.id, context.profileId));
    return profile ?? null;
  });

export const getProfiles = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const [profiles, activeAccounts, rates] = await Promise.all([
      getDb()
        .select({
          id: profilesTable.id,
          name: profilesTable.name,
          accountCount: sql<number>`count(distinct ${accountsTable.id})::int`,
          transactionCount: sql<number>`count(distinct ${transactionsTable.id})::int`,
        })
        .from(profilesTable)
        .leftJoin(accountsTable, eq(accountsTable.profileId, profilesTable.id))
        // Transactions carry their profile directly now, so this no longer has to reach them
        // through the accounts join above.
        .leftJoin(transactionsTable, eq(transactionsTable.profileId, profilesTable.id))
        .where(eq(profilesTable.userId, context.user.id))
        .groupBy(profilesTable.id),
      getDb()
        .select({
          profileId: accountsTable.profileId,
          balance: accountsTable.balance,
          currencyCode: accountsTable.currencyCode,
          type: accountsTable.type,
        })
        .from(accountsTable)
        .innerJoin(profilesTable, eq(profilesTable.id, accountsTable.profileId))
        .where(and(eq(accountsTable.status, "ACTIVE"), eq(profilesTable.userId, context.user.id))),
      getUsdRates(),
    ]);

    // Accounts can be in different currencies, so balances are converted to USD before summing.
    const balancesByProfile = new Map<
      string,
      { currentBalanceUsd: number; savingsBalanceUsd: number }
    >();
    for (const account of activeAccounts) {
      if (account.profileId == null) continue;

      const totals = balancesByProfile.get(account.profileId) ?? {
        currentBalanceUsd: 0,
        savingsBalanceUsd: 0,
      };
      const usdAmount = Number(account.balance) / (rates[account.currencyCode] ?? 1);
      if (account.type === "SAVING") totals.savingsBalanceUsd += usdAmount;
      else totals.currentBalanceUsd += usdAmount;
      balancesByProfile.set(account.profileId, totals);
    }

    return profiles.map((profile) => {
      const totals = balancesByProfile.get(profile.id) ?? {
        currentBalanceUsd: 0,
        savingsBalanceUsd: 0,
      };
      return Object.assign(profile, {
        currentBalanceUsd: totals.currentBalanceUsd.toFixed(2),
        savingsBalanceUsd: totals.savingsBalanceUsd.toFixed(2),
      });
    });
  });

export const createProfile = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.object({ name: z.string().trim().min(1) }))
  .handler(async ({ data, context }) => {
    const [profile] = await getDb()
      .insert(profilesTable)
      .values({ name: data.name, userId: context.user.id })
      .returning();
    return profile;
  });
