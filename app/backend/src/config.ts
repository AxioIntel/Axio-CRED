import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { paypalConfiguration } from "./paypal-config.js";

loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env") });

export const config = {
  port: Number(process.env.PORT ?? 8080),
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  dataMode: process.env.DATA_MODE ?? "demo",
  mysqlUrl: process.env.MYSQL_URL ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "local-preview-session-secret-change-before-production",
  sessionSecretConfigured: Boolean(process.env.SESSION_SECRET && !process.env.SESSION_SECRET.startsWith("replace-")),
  googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_ID.startsWith("placeholder")),
  placesConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY && !process.env.GOOGLE_MAPS_API_KEY.startsWith("placeholder")),
  paypalConfigured: paypalConfiguration(process.env).configured,
  paypalEnv: process.env.PAYPAL_ENV ?? "sandbox",
  enterpriseApiKey: process.env.ENTERPRISE_API_KEY?.startsWith("placeholder") ? "" : process.env.ENTERPRISE_API_KEY ?? ""
};
