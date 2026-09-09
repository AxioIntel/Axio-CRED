// Uses only synthetic temporary workspaces in a local/disposable MySQL database.
import "../backend/src/config.ts";
import mysql from "mysql2/promise";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mysqlConnectionOptions} from "../backend/src/mysql-config.ts";
import {MySQLScheduleRepository,MonitoringScheduler} from "../backend/src/monitoring-scheduler.ts";
import {MySQLStore} from "../backend/src/mysql-store.ts";
import {BusinessDiscovery} from "../backend/src/business-discovery.ts";
const pool=mysql.createPool(mysqlConnectionOptions(process.env.MYSQL_URL));
const workspace=randomUUID(),other=randomUUID(),place="ChIJmonitorSqlFixture";
const start=new Date("2026-09-09T00:00:00Z"),due=new Date("2026-09-09T06:00:00Z");
try{
  for(const id of [workspace,other])await pool.execute("INSERT INTO workspaces(id,name,plan) VALUES(?,?,'growth')",[id,"Synthetic schedule verification"]);
  const repo=new MySQLScheduleRepository(pool,workspace);
  await repo.set(place,true,6,start);
  await repo.set(place,true,6,new Date("2026-09-09T01:00:00Z"));
  assert.equal((await repo.list())[0].nextDueAt,due.toISOString());
  assert.equal(await repo.claim(start),null);
  assert.deepEqual(await new MySQLScheduleRepository(pool,other).list(),[]);
  const claims=await Promise.all([repo.claim(due),new MySQLScheduleRepository(pool,workspace).claim(due)]);
  assert.equal(claims.filter(Boolean).length,1);
  const first=claims.find(Boolean);
  assert.equal(await new MySQLScheduleRepository(pool,workspace).claim(new Date(due.getTime()+24*60000)),null);
  const recovered=await new MySQLScheduleRepository(pool,workspace).claim(new Date(due.getTime()+26*60000));assert(recovered);
  await repo.finish(first,"completed",null,null,6,due);
  assert.equal((await repo.list())[0].status,"running"); // Stale lease owner cannot overwrite recovery.
  await repo.finish(recovered,"failed","Synthetic failure",null,6,due);
  assert.equal((await repo.list())[0].nextDueAt,new Date(due.getTime()+30*60000).toISOString());
  const retried=await repo.claim(new Date(due.getTime()+30*60000));assert(retried);
  await repo.set(place,false,6,due);
  await repo.finish(retried,"completed",null,null,6,due);
  assert.equal((await repo.list())[0].nextDueAt,null);
  assert.equal(await repo.claim(new Date("2026-09-11T00:00:00Z")),null);
  await repo.set(place,true,12,start);
  assert.equal((await repo.list())[0].nextDueAt,"2026-09-09T12:00:00.000Z");
  const changing=await repo.claim(new Date("2026-09-09T12:00:00Z"));assert(changing);
  await repo.set(place,false,12,new Date("2026-09-09T12:01:00Z"));
  await repo.set(place,true,6,new Date("2026-09-09T12:02:00Z"));
  await repo.finish(changing,"completed",null,null,12,new Date("2026-09-09T12:03:00Z"));
  assert.equal((await repo.list())[0].intervalHours,6);
  assert.equal((await repo.list())[0].nextDueAt,"2026-09-09T18:02:00.000Z");
  const store=new MySQLStore(pool,workspace);
  await store.saveCompetitorWorkspace({baselineKey:null,targets:[{id:randomUUID(),name:"Synthetic scheduled business",listingKey:`place:${place}`,mapsUrl:null}]});
  await repo.set(place,false,6,start);await repo.set(place,true,6,start);
  const discovery=new BusinessDiscovery(store,async()=>[{title:"Synthetic scheduled business",place_id:place,review_count:1,user_reviews:[{review_id:"fixture-review",Description:"Synthetic scheduled review",Rating:5}]}]);
  await new MonitoringScheduler(store,discovery,repo,()=>due).tick();
  const completed=(await repo.list())[0];assert.equal(completed.status,"completed");assert(completed.lastDatasetId);
  const saved=await store.getIntelligenceImport(completed.lastDatasetId);assert.equal(saved.listings[0].placeId,place);assert.equal(saved.listings[0].reviews.length,1);
  console.log("PASS: due scheduler invokes injected native collector, saves indexed evidence and persists next check without provider calls.");
  console.log("PASS: 6/12-hour scheduling, idempotent enable, workspace isolation, concurrent claim, restart lease recovery, stale completion rejection, failure retry and pause.");
}finally{
  for(const id of [workspace,other])await pool.execute("DELETE FROM workspaces WHERE id=?",[id]);
  await pool.end();
}
