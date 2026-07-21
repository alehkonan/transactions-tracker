import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { AccountSchema } from "~/model/account";
import { accounts } from "~/drizzle/schema";
import { getDb } from "./db";

export const getAccounts = createServerFn({ method: "GET" }).handler(async () => {
  return getDb().select().from(accounts);
});

// Insert payload = an Account without its DB-generated id.
const CreateAccountSchema = AccountSchema.omit({ id: true });

export const createAccount = createServerFn({ method: "POST" })
  .validator(CreateAccountSchema)
  .handler(async ({ data }) => {
    const [account] = await getDb().insert(accounts).values(data).returning();
    return account;
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .validator(AccountSchema.shape.id)
  .handler(async ({ data: id }) => {
    await getDb().delete(accounts).where(eq(accounts.id, id));
  });
