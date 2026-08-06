---
name: drizzle-recipes
description: Condensed recipes from Drizzle ORM's official guides (orm.drizzle.team/docs/guides) — conditional filters, column selection, counting, increment/decrement/toggle, upsert, bulk updates, pagination, schema defaults, unique case-insensitive email, full-text & vector search, seeding, local DB setup. Activate whenever writing or reviewing Drizzle queries, schema (src/database/schema.ts), or drizzle-kit config in this repo.
---

# Drizzle ORM Recipes

This repo's dialect is **PostgreSQL via `postgres-js`** (see `src/database/`), so PostgreSQL
snippets below are the primary reference; MySQL/SQLite/other-dialect notes are kept short and
only matter if this project ever adds another database. Schema lives in `src/database/schema.ts`,
queries in `src/api/*.functions.ts` — see the `project-structure` skill for file placement.

Source: the guides at https://orm.drizzle.team/docs/guides (condensed, not verbatim).

## Query Operations

**Conditional filters** — pass `undefined` to `.where()`/`and()` for filters that don't apply; Drizzle drops them:

```ts
import { and, gt, ilike, inArray } from "drizzle-orm";

await db
  .select()
  .from(posts)
  .where(
    and(
      term ? ilike(posts.title, term) : undefined,
      categories.length > 0 ? inArray(posts.category, categories) : undefined,
      views > 100 ? gt(posts.views, views) : undefined,
    ),
  );
```

For a custom operator, wrap it in `sql`: `const lenLt = (col, v) => sql\`length(${col}) < ${v}\`;`

**Include/exclude columns** — use `getColumns()` to spread-and-omit, or the relational query API's `columns` option:

```ts
import { getColumns } from "drizzle-orm";

const { content, ...rest } = getColumns(posts);
await db.select({ ...rest }).from(posts);

await db.query.posts.findMany({ columns: { content: false } }); // relational API
```

**Count rows** — use `count()`, not `.length` on a fetched array:

```ts
import { count, gt } from "drizzle-orm";

await db.select({ count: count() }).from(products).where(gt(products.price, 100));
```

Postgres/MySQL/CockroachDB may return count as a string from raw `sql` counts — cast if you drop to `sql<number>\`count(*)\``.

## Data Modification

**Increment / decrement** — do the arithmetic in SQL, not by reading-then-writing:

```ts
import { eq, sql } from "drizzle-orm";

const increment = (column: AnyColumn, value = 1) => sql`${column} + ${value}`;

await db
  .update(table)
  .set({ counter: increment(table.counter) })
  .where(eq(table.id, 1));
```

(Decrement is the same with `-`.)

**Toggle a boolean** — use `not()` instead of reading the current value first:

```ts
import { eq, not } from "drizzle-orm";
await db
  .update(table)
  .set({ isActive: not(table.isActive) })
  .where(eq(table.id, 1));
```

**Upsert** — Postgres/SQLite use `.onConflictDoUpdate()`; MySQL uses `.onDuplicateKeyUpdate()` (no `target`):

```ts
await db
  .insert(users)
  .values({ id: 1, name: "John" })
  .onConflictDoUpdate({ target: users.id, set: { name: "Super John" } });
```

Composite keys: `target: [inventory.warehouseId, inventory.productId]`. For bulk upserts referencing
the row being inserted, use `sql.raw(\`excluded.${users.lastLogin.name}\`)`in`set`.

**Update many rows with different values per row** — build a SQL `CASE` instead of N separate updates:

```ts
import { inArray, sql, type SQL } from "drizzle-orm";

const chunks: SQL[] = [sql`(case`];
const ids: number[] = [];
for (const input of inputs) {
  chunks.push(sql`when ${users.id} = ${input.id} then ${input.city}`);
  ids.push(input.id);
}
chunks.push(sql`end)`);

await db
  .update(users)
  .set({ city: sql.join(chunks, sql.raw(" ")) })
  .where(inArray(users.id, ids));
```

## Pagination

**Limit/offset** — simple, but large offsets get slow and pages can shift if rows are inserted/deleted mid-pagination:

```ts
await db
  .select()
  .from(users)
  .orderBy(asc(users.id))
  .limit(pageSize)
  .offset((page - 1) * pageSize);
// relational API: db.query.users.findMany({ orderBy: (u, { asc }) => asc(u.id), limit, offset })
```

**Cursor-based** — prefer this when data changes between page requests; needs a unique, ordered column (or tuple):

```ts
import { asc, gt } from "drizzle-orm";

const nextPage = (cursor?: number, pageSize = 20) =>
  db
    .select()
    .from(users)
    .where(cursor ? gt(users.id, cursor) : undefined)
    .orderBy(asc(users.id))
    .limit(pageSize);
```

Multi-column cursor (non-unique sort field) uses `or(gt(sortCol, cursor.sortVal), and(eq(sortCol, cursor.sortVal), gt(id, cursor.id)))`.
Index the cursor column(s).

## Schema Defaults

**Timestamp default** — use `.defaultNow()`, or `sql` for unix-epoch/precision variants:

```ts
timestamp("created_at").notNull().defaultNow(); // Postgres/MySQL now()
integer("created_at")
  .notNull()
  .default(sql`extract(epoch from now())`); // unix epoch, pg
text("created_at")
  .notNull()
  .default(sql`(current_timestamp)`); // SQLite
```

**Empty array default** — syntax is dialect-specific:

```ts
text("tags")
  .array()
  .notNull()
  .default(sql`'{}'::text[]`); // Postgres
json("tags").$type<string[]>().notNull().default([]); // MySQL
text("tags", { mode: "json" })
  .$type<string[]>()
  .default(sql`(json_array())`); // SQLite
```

**Unique, case-insensitive column (e.g. email)** — index a lowercased functional expression, not the raw column:

```ts
export function lower(col: AnyPgColumn): SQL {
  return sql`lower(${col})`;
}

export const users = pgTable("users", { email: text("email").notNull() }, (t) => [
  uniqueIndex("emailUniqueIndex").on(lower(t.email)),
]);

// query with the same expression:
db.select()
  .from(users)
  .where(eq(lower(users.email), email.toLowerCase()));
```

**Postgres `point` / PostGIS `geometry`** — for coordinates and spatial queries:

```ts
location: point("location", { mode: "xy" }).notNull();
// or with PostGIS + spatial index:
location: geometry("location", { type: "point", mode: "xy", srid: 4326 });
// (index: index("spatial_index").using("gist", table.location))

// nearest-neighbor: order by the distance operator
const dist = sql`location <-> point(${x}, ${y})`;
db.select({ ...getColumns(stores), distance: sql`round((${dist})::numeric, 2)` })
  .from(stores)
  .orderBy(dist);
```

## Search

**pgvector similarity search** — `vector` column + HNSW index + `cosineDistance`:

```ts
embedding: vector("embedding", { dimensions: 1536 }),
// index: index("embeddingIndex").using("hnsw", table.embedding.op("vector_cosine_ops"))

import { cosineDistance, desc, gt, sql } from "drizzle-orm";
const similarity = sql<number>`1 - (${cosineDistance(guides.embedding, queryEmbedding)})`;
await db.select({ name: guides.title, similarity }).from(guides)
  .where(gt(similarity, 0.5)).orderBy((t) => desc(t.similarity));
```

**Full-text search (Postgres `tsvector`)** — either compute at query time or precompute via a generated column (cheaper on read):

```ts
// query-time:
db.select().from(posts).where(sql`to_tsvector('english', ${posts.title}) @@ to_tsquery('english', ${term})`);

// generated column (avoids recomputing tsvector every query):
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
bodySearch: tsvector("body_search").notNull()
  .generatedAlwaysAs((): SQL => sql`to_tsvector('english', ${posts.body})`),
// index: index("idx_body_search").using("gin", t.bodySearch)
```

Weight multiple columns: `setweight(to_tsvector(...), 'A') || setweight(to_tsvector(...), 'B')`.
Rank results with `ts_rank(...)`. Query functions: `to_tsquery`, `plainto_tsquery`, `phraseto_tsquery`, `websearch_to_tsquery`.

## Relations

**Parent rows with at least one child row** — inner join if you need child data too, `exists()` if you only need parents:

```ts
// need child rows too:
db.select({ user: users, post: posts }).from(users).innerJoin(posts, eq(users.id, posts.userId));

// parents only (no duplicate parent rows per child):
const sq = db
  .select({ id: sql`1` })
  .from(posts)
  .where(eq(posts.userId, users.id));
db.select().from(users).where(exists(sq));
```

## Seeding (`drizzle-seed`)

**FK to a table not passed into `seed()`** — either include the parent table, or `.refine()` the FK column to pick from existing IDs:

```ts
await seed(db, { bloodPressure, users }); // simplest: expose the parent table too

// or, if parent rows already exist in the DB:
await seed(db, { bloodPressure }).refine((f) => ({
  bloodPressure: { columns: { userId: f.valuesFromArray({ values: [1, 2] }) } },
}));
```

**One-to-many via `with`** — seed from the "one" side; child count goes in `with`, and the FK column must be `.notNull().references(...)`:

```ts
await seed(db, { users, posts }).refine(() => ({
  users: { count: 2, with: { posts: 3 } }, // 3 posts per user
}));
```

Reversing the direction (many parents nested under a child) or self-referential `with` isn't supported.

## Local DB setup

**Postgres (this repo's dialect) via Docker:**

```bash
docker pull postgres
docker run --name drizzle-postgres -e POSTGRES_PASSWORD=mypassword -d -p 5432:5432 postgres
# DATABASE_URL=postgres://postgres:mypassword@localhost:5432/postgres
```

MySQL is the same shape (`docker run ... -e MYSQL_ROOT_PASSWORD=... -p 3306:3306 mysql`, url `mysql://root:pw@localhost:3306/mysql`) —
not relevant unless this project adds a second dialect.

## Not relevant to this repo (noted for completeness)

- **Cloudflare D1 over HTTP** (`driver: 'd1-http'` in `drizzle.config.ts`) — only applies to D1/SQLite deployments, not `postgres-js`.
- **Gel (EdgeDB) auth extension** (`dialect: 'gel'`, `drizzle-kit pull` against `ext::auth`) — only applies to Gel-backed projects.
