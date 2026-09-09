import { createApp } from "./app.js";
import { config } from "./config.js";
import { DemoStore } from "./demo-store.js";
import { MySQLStore } from "./mysql-store.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const store = config.dataMode === "mysql" && config.mysqlUrl ? MySQLStore.create(config.mysqlUrl) : new DemoStore();
const app = createApp(store);
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");
if (existsSync(frontend)) {
  const express = (await import("express")).default;
  app.use(express.static(frontend));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(frontend, "index.html")));
} else {
  app.use((_req, res) => res.status(404).json({ error: "Route not found." }));
}
app.listen(config.port, process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1", () => console.log(`Axio-CRED API running at http://localhost:${config.port} (${config.dataMode} mode)`));
