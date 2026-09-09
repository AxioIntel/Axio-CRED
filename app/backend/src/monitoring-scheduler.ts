import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { AppStore } from "./types.js";
import { productPlan } from "./product-plan.js";
import type { BusinessDiscovery } from "./business-discovery.js";

const HOUR_MS = 60 * 60 * 1000;
const LEASE_MS = 25 * 60 * 1000; // Exceeds the collector's enforced 20-minute timeout.
const RETRY_MS = 30 * 60 * 1000;
export interface MonitoringSchedule {
  placeId: string; enabled: boolean; intervalHours: number; nextDueAt: string|null;
  lastStartedAt: string|null; lastFinishedAt: string|null; lastDatasetId: string|null;
  status: string; lastError: string|null;
}
export interface ScheduleClaim { placeId:string; token:string }
export interface ScheduleRepository {
  list():Promise<MonitoringSchedule[]>;
  set(placeId:string,enabled:boolean,hours:number,now:Date):Promise<void>;
  claim(now:Date):Promise<ScheduleClaim|null>;
  finish(claim:ScheduleClaim,status:string,error:string|null,datasetId:string|null,hours:number,now:Date):Promise<void>;
}
const iso=(value:unknown)=>value?new Date(value as string).toISOString():null;
/** Persistent local schedules, scoped to the same workspace as the application store. */
export class MySQLScheduleRepository implements ScheduleRepository {
  constructor(private pool:Pool,private workspaceId:string){}
  async list(){
    const [rows]=await this.pool.query<RowDataPacket[]>("SELECT * FROM monitoring_schedules WHERE workspace_id=? ORDER BY place_id",[this.workspaceId]);
    return rows.map(row=>({placeId:String(row.place_id),enabled:Boolean(row.enabled),intervalHours:Number(row.interval_hours),nextDueAt:iso(row.next_due_at),lastStartedAt:iso(row.last_started_at),lastFinishedAt:iso(row.last_finished_at),lastDatasetId:row.last_dataset_id as string|null,status:String(row.status),lastError:row.last_error as string|null}));
  }
  async set(placeId:string,enabled:boolean,hours:number,now:Date){
    // Repeated enable requests preserve the existing due time. Pausing never clears an active lease.
    await this.pool.execute("INSERT INTO monitoring_schedules(workspace_id,place_id,enabled,interval_hours,next_due_at) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE next_due_at=IF(VALUES(enabled)=0,NULL,IF(enabled=0 OR interval_hours<>VALUES(interval_hours),VALUES(next_due_at),next_due_at)),enabled=VALUES(enabled),interval_hours=VALUES(interval_hours)",
      [this.workspaceId,placeId,enabled,hours,enabled?new Date(now.getTime()+hours*HOUR_MS):null]);
  }
  async claim(now:Date){
    const connection=await this.pool.getConnection();
    try{
      await connection.beginTransaction();
      const [rows]=await connection.query<RowDataPacket[]>("SELECT place_id FROM monitoring_schedules WHERE workspace_id=? AND enabled=1 AND ((lease_until IS NULL AND next_due_at<=?) OR lease_until<=?) ORDER BY next_due_at LIMIT 1 FOR UPDATE SKIP LOCKED",[this.workspaceId,now,now]);
      if(!rows.length){await connection.commit();return null;}
      const claim={placeId:String(rows[0].place_id),token:randomUUID()};
      await connection.execute("UPDATE monitoring_schedules SET lease_token=?,lease_until=?,status='running',last_started_at=?,last_error=NULL WHERE workspace_id=? AND place_id=?",[claim.token,new Date(now.getTime()+LEASE_MS),now,this.workspaceId,claim.placeId]);
      await connection.commit();return claim;
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }
  async finish(claim:ScheduleClaim,status:string,error:string|null,datasetId:string|null,_hours:number,now:Date){
    // A future due time was set after this run began: preserve that user's change.
    // Compute the next interval from the stored cadence, never the stale claim's plan.
    await this.pool.execute("UPDATE monitoring_schedules SET status=?,last_error=?,last_dataset_id=COALESCE(?,last_dataset_id),last_finished_at=?,next_due_at=IF(enabled=0,NULL,IF(next_due_at>last_started_at,next_due_at,TIMESTAMPADD(SECOND,IF(?='failed',?,interval_hours*3600),?))),lease_token=NULL,lease_until=NULL WHERE workspace_id=? AND place_id=? AND lease_token=?",[status,error?.slice(0,1000)??null,datasetId,now,status,RETRY_MS/1000,now,this.workspaceId,claim.placeId,claim.token]);
  }
}

export class MonitoringSettingsError extends Error {}

export class MonitoringScheduler {
  private busy=false;
  private timer:ReturnType<typeof setInterval>|undefined;
  constructor(private store:AppStore,private discovery:BusinessDiscovery,private repository:ScheduleRepository,private now=()=>new Date(),private wait=()=>new Promise<void>(resolve=>setTimeout(resolve,1000))){}
  async intervalHours(){
    const overview=await this.store.getOverview() as {plan?:string};
    const plan=productPlan(overview.plan??"free");
    return plan.checksPerDay===4?6:plan.checksPerDay===2?12:null;
  }
  private async monitored(placeId:string){
    const key=`place:${placeId}`;
    const [businesses,watch]=await Promise.all([this.store.listBusinesses(),this.store.getCompetitorWorkspace()]);
    return businesses.some(b=>b.publicListingKey===key)||watch.targets.some(t=>t.listingKey===key);
  }
  async status(){return {available:this.discovery.available(),intervalHours:await this.intervalHours(),schedules:await this.repository.list(),mode:"local",message:"Scheduled checks require this PC and the local API to stay running. Missed checks resume after restart. Email and WhatsApp delivery are not connected."};}
  async set(placeId:string,enabled:boolean){
    const hours=await this.intervalHours();
    if(enabled&&(!hours||!await this.monitored(placeId)))throw new MonitoringSettingsError("Add this business to a Business or Growth workspace before enabling monitoring.");
    if(enabled&&!this.discovery.available())throw new MonitoringSettingsError("Set up the local collector before enabling monitoring.");
    await this.repository.set(placeId,enabled,hours??12,this.now());
    return this.status();
  }
  start(){if(!this.timer){this.timer=setInterval(()=>{void this.tick().catch(()=>console.error("Scheduled monitoring could not update its database state; it will retry."));},15000);this.timer.unref();}}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=undefined;}
  async tick(){
    if(this.busy||this.discovery.isBusy()||!this.discovery.available())return;
    this.busy=true;
    try{
      const currentHours=await this.intervalHours();
      for(const schedule of await this.repository.list()){
        if(schedule.enabled&&(!currentHours||schedule.intervalHours!==currentHours))await this.repository.set(schedule.placeId,Boolean(currentHours),currentHours??12,this.now());
      }
      const claim=await this.repository.claim(this.now());if(!claim)return;
      const hours=await this.intervalHours();
      if(!hours||!await this.monitored(claim.placeId)){
        await this.repository.set(claim.placeId,false,hours??12,this.now());
        await this.repository.finish(claim,"paused","Monitoring paused because this listing or plan is no longer eligible.",null,hours??12,this.now());return;
      }
      try{
        // Fresh extended evidence is needed for review comparisons. Scheduled runs never spend on fallback.
        const job=await this.discovery.startPlaceId(claim.placeId,true,true,false);
        const deadline=Date.now()+21*60*1000;
        while(Date.now()<deadline){
          const result=await this.discovery.get(job.id);
          if(result?.status==="failed")throw new Error(result.error??"Scheduled collection failed.");
          if(result?.status==="completed"){
            await this.repository.finish(claim,"completed",null,result.dataset?.id??null,hours,this.now());return;
          }
          await this.wait();
        }
        throw new Error("Scheduled collection exceeded its time limit.");
      }catch(error){await this.repository.finish(claim,"failed",error instanceof Error?error.message:"Scheduled collection failed.",null,hours,this.now());}
    }finally{this.busy=false;}
  }
}
