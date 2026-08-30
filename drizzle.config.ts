import path from "node:path";
import { defineConfig } from "drizzle-kit";

const encodedCertificate = process.env.POSTGRES_CA_CERT_BASE64;
const ca = encodedCertificate ? Buffer.from(encodedCertificate, "base64").toString("utf8") : "";
if (
  encodedCertificate &&
  (!ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----"))
) {
  throw new Error("POSTGRES_CA_CERT_BASE64 does not contain a valid PEM certificate");
}

const ssl = encodedCertificate ? { ca, rejectUnauthorized: true } : false;

export default defineConfig({
  dialect: "postgresql",
  schema: path.join("src", "database", "schema.ts"),
  out: path.join("src", "database", "migrations"),
  dbCredentials: {
    user: process.env.POSTGRES_USER!,
    password: process.env.POSTGRES_PASSWORD!,
    host: process.env.POSTGRES_HOST!,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB!,
    ssl,
  },
});
