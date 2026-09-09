import type { ConnectionOptions } from "mysql2/promise";

/** Shared by migrations and runtime; Azure always requires verified TLS. */
export function mysqlConnectionOptions(raw: string): ConnectionOptions {
  const url = new URL(raw);
  if (url.protocol !== "mysql:") throw new Error("MYSQL_URL must use the mysql protocol.");
  if (url.searchParams.has("ssl")) throw new Error("Use ssl-mode=REQUIRED instead of an embedded ssl option.");
  const mode = url.searchParams.get("ssl-mode");
  if (mode !== null && !["REQUIRED", "VERIFY_IDENTITY"].includes(mode)) {
    throw new Error("MYSQL_URL ssl-mode must be REQUIRED or VERIFY_IDENTITY.");
  }
  url.searchParams.delete("ssl-mode");
  const tls = mode !== null || url.hostname.endsWith(".mysql.database.azure.com");
  return {uri:url.href, timezone:"Z", ...(tls ? {
    ssl:{rejectUnauthorized:true, verifyIdentity:true, minVersion:"TLSv1.2"}
  } : {})};
}
