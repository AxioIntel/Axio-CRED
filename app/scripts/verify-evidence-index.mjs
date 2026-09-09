// Run from app: node --import tsx scripts/verify-evidence-index.mjs
// Uses isolated, temporary workspaces; no collection or provider calls.
import fs from "node:fs";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import {MySQLStore} from "../backend/src/mysql-store.ts";
import {normalizeImport} from "../backend/src/intelligence.ts";
import {indexEvidence,projectEvidence} from "../backend/src/evidence-index.ts";
const env={...(fs.existsSync(new URL("../.env",import.meta.url))?dotenv.parse(fs.readFileSync(new URL("../.env",import.meta.url))):{}),...process.env};
if(!env.MYSQL_URL)throw new Error("MYSQL_URL is required for isolated database verification.");
const pool=mysql.createPool({uri:env.MYSQL_URL,timezone:"Z"});
const ids=[randomUUID(),randomUUID()];const store=new MySQLStore(pool,ids[0]);
const fixture=(place)=>normalizeImport({label:"Architecture verification fixture",entries:[{title:"Synthetic test business",place_id:place,user_reviews:[{review_id:"review-1",Description:"A fixture review",Rating:4,When:"a month ago"}]}]});
try{
  for(const id of ids)await pool.execute("INSERT INTO workspaces(id,name,plan) VALUES(?,?,'growth')",[id,"Temporary architecture verification"]);
  const first=fixture("ChIJtest-history"),second=fixture("ChIJtest-history");
  await store.saveIntelligenceImport(first);await store.saveIntelligenceImport(second);
  await store.saveCompetitorWorkspace({baselineKey:null,targets:[{id:randomUUID(),name:"Fixture",listingKey:"place:ChIJtest-history",mapsUrl:null}]});
  for(let i=0;i<21;i++)await store.saveIntelligenceImport(fixture(`ChIJunrelated-${i}`));
  const recent=await store.listIntelligenceImports();
  assert.equal(recent.length,22);assert(recent.some(d=>d.id===first.id));assert(recent.some(d=>d.id===second.id));
  assert.equal((await store.getIntelligenceImport(first.id)).id,first.id);
  assert.equal(await new MySQLStore(pool,ids[1]).getIntelligenceImport(first.id),null);
  const connection=await pool.getConnection();
  try{await connection.beginTransaction();await indexEvidence(connection,ids[0],first);await indexEvidence(connection,ids[0],first);await connection.commit();}finally{connection.release();}
  const snapshot=projectEvidence(first)[0].id;
  const [[counts]]=await pool.query("SELECT COUNT(*) count FROM review_observations WHERE workspace_id=? AND snapshot_id=?",[ids[0],snapshot]);assert.equal(counts.count,1);
  await assert.rejects(pool.execute("INSERT INTO review_observations(workspace_id,snapshot_id,review_key,source_review_id,has_text,has_reply,has_capture_issue) VALUES(?,?,?,?,1,0,0)",[ids[1],snapshot,"a".repeat(64),"bad-reference"]),e=>e.code==="ER_NO_REFERENCED_ROW_2");
  const bad=fixture("ChIJrollback");bad.listings[0].id="x".repeat(64);
  await assert.rejects(store.saveIntelligenceImport(bad));assert.equal(await store.getIntelligenceImport(bad.id),null);
  console.log("PASS: retained monitored history, direct lookup, cross-workspace read/FK rejection, idempotent indexing, atomic rollback.");
}finally{
  // These UUIDs were generated above for synthetic workspaces only.
  for(const id of ids)await pool.execute("DELETE FROM workspaces WHERE id=? AND name=?",[id,"Temporary architecture verification"]);
  await pool.end();
}
