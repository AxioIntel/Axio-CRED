import "./config.js";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import {indexEvidence} from "./evidence-index.js";
import {mysqlConnectionOptions} from "./mysql-config.js";

const url = process.env.MYSQL_URL;
if (!url) throw new Error("MYSQL_URL is required. Copy app/.env.example to app/.env and set a scoped local user.");
const sql = await readFile(new URL("../sql/001_initial.sql", import.meta.url), "utf8");
const connection = await mysql.createConnection({ ...mysqlConnectionOptions(url), multipleStatements: true });
try {
const [locks]=await connection.query<mysql.RowDataPacket[]>("SELECT GET_LOCK('axiocred_schema',30) acquired");
if(locks[0]?.acquired!==1)throw new Error("Another schema migration is running. Retry after it completes.");
await connection.query(sql);
try {
  await connection.query("ALTER TABLE competitors ADD COLUMN google_place_id VARCHAR(255) NULL AFTER business_id");
} catch (error) {
  if ((error as { code?: string }).code !== "ER_DUP_FIELDNAME") throw error;
}
try {
  await connection.query("CREATE INDEX idx_competitor_place ON competitors(google_place_id)");
} catch (error) {
  if ((error as { code?: string }).code !== "ER_DUP_KEYNAME") throw error;
}
try {
  await connection.query("CREATE UNIQUE INDEX uq_import_workspace_id ON intelligence_imports(workspace_id,id)");
} catch(error) {if((error as {code?:string}).code!=="ER_DUP_KEYNAME")throw error;}
await connection.query(await readFile(new URL("../sql/002_evidence_index.sql",import.meta.url),"utf8"));
await connection.query(await readFile(new URL("../sql/003_monitoring_schedules.sql",import.meta.url),"utf8"));
// Restartable backfill: lock each source row and commit its projection independently.
const [imports]=await connection.query<mysql.RowDataPacket[]>("SELECT id,workspace_id FROM intelligence_imports ORDER BY id");
for(const item of imports){
  await connection.beginTransaction();
  try{
    const [rows]=await connection.query<mysql.RowDataPacket[]>("SELECT dataset FROM intelligence_imports WHERE workspace_id=? AND id=? FOR UPDATE",[item.workspace_id,item.id]);
    if(rows[0])await indexEvidence(connection,item.workspace_id,typeof rows[0].dataset==="string"?JSON.parse(rows[0].dataset):rows[0].dataset);
    await connection.commit();
  }catch(error){await connection.rollback();throw error;}
}
console.log(`Indexed ${imports.length} saved collections without changing source payloads.`);
} finally {
  await connection.query("SELECT RELEASE_LOCK('axiocred_schema')");
  await connection.end();
}
console.log("Axio-CRED MySQL schema is ready.");
