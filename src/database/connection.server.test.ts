import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresClient, getDatabaseCredentials } from "./connection.server";

describe("database connection boundary", () => {
  beforeEach(() => {
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("NETLIFY_DEV", "");
    vi.stubEnv("NETLIFY_DB_URL", "");
    vi.stubEnv("POSTGRES_HOST", "localhost");
    vi.stubEnv("POSTGRES_PORT", "5432");
    vi.stubEnv("POSTGRES_USER", "local-user");
    vi.stubEnv("POSTGRES_PASSWORD", "local-password");
    vi.stubEnv("POSTGRES_DB", "local-database");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("never falls back to POSTGRES credentials in a deployed process", () => {
    vi.stubEnv("NETLIFY", "true");
    expect(() => getDatabaseCredentials()).toThrow();
  });

  it("uses the injected branch and verifies TLS despite sslmode=require", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv(
      "NETLIFY_DB_URL",
      "postgres://branch-user:branch-password@preview.example.test/branch?sslmode=require",
    );

    // postgres.js is lazy: examining its options must not open a network connection.
    const client = createPostgresClient("connection-boundary-test");
    try {
      expect(client.options.host).toEqual(["preview.example.test"]);
      expect(client.options.ssl).toEqual({ rejectUnauthorized: true });
      expect(client.options.max).toBe(1);
      expect(client.options.prepare).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("keeps the local Docker endpoint separate from the hosted URL", () => {
    expect(getDatabaseCredentials()).toEqual({
      user: "local-user",
      password: "local-password",
      host: "localhost",
      port: 5432,
      database: "local-database",
      ssl: false,
    });
  });

  it("uses local credentials even when a Netlify URL is present", () => {
    vi.stubEnv("NETLIFY_DB_URL", "postgres://hosted.example.test/hosted-database");
    vi.stubEnv("POSTGRES_PASSWORD", "p@ss:word#1/%");

    expect(getDatabaseCredentials()).toEqual({
      user: "local-user",
      password: "p@ss:word#1/%",
      host: "localhost",
      port: 5432,
      database: "local-database",
      ssl: false,
    });
  });

  it("uses local credentials under Netlify Dev", () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("NETLIFY_DEV", "true");
    expect(getDatabaseCredentials()).toMatchObject({ host: "localhost", ssl: false });
  });
});
