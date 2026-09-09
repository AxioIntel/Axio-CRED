import { createApp } from "./app.js";
import { config } from "./config.js";
import { DemoStore } from "./demo-store.js";
import { MySQLStore } from "./mysql-store.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { mysqlConnectionOptions } from "./mysql-config.js";
import { BusinessDiscovery } from "./business-discovery.js";
import { MonitoringScheduler, MySQLScheduleRepository } from "./monitoring-scheduler.js";

const store = config.dataMode === "mysql" && config.mysqlUrl ? MySQLStore.create(config.mysqlUrl) : new DemoStore();
const schedulePool=config.dataMode==="mysql"&&config.mysqlUrl&&process.env.NODE_ENV!=="production"?mysql.createPool(mysqlConnectionOptions(config.mysqlUrl)):null;
const discovery=new BusinessDiscovery(store);
const scheduler=schedulePool?new MonitoringScheduler(store,discovery,new MySQLScheduleRepository(schedulePool,"00000000-0000-0000-0000-000000000001")):null;
const app = createApp(store,undefined,undefined,scheduler?{discovery,scheduler}:undefined);
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");
if (existsSync(frontend)) {
  const express = (await import("express")).default;
  app.use(express.static(frontend));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(frontend, "index.html")));
} else {
  app.use((_req, res) => res.status(404).json({ error: "Route not found." }));
}
const server=app.listen(config.port, process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
server.on("listening",()=>{scheduler?.start();console.log(`Axio-CRED API running at http://localhost:${config.port} (${config.dataMode} mode)`);});
server.on("error",error=>{scheduler?.stop();console.error(error);process.exitCode=1;void schedulePool?.end();});
