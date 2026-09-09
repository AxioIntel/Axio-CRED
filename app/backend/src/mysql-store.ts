import {evidenceKey,indexEvidence} from "./evidence-index.js";
import {monitoredKeys,monitoredLimit,enforceMonitoredLimit} from "./entitlements.js";
import { createHash, randomUUID } from "node:crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import type { AppStore, Business, Competitor, GoogleConnection, Incident, ProfileSnapshot } from "./types.js";
import { diffSnapshots, evidenceHash, snapshotHash } from "./integrity.js";

const defaultWorkspaceId = "00000000-0000-0000-0000-000000000001";
type BusinessRow = RowDataPacket & { id:string; name:string; address:string; category:string; rating:string; review_count:number; owned:number; health:number; status:Business["status"]; last_checked_at:Date|null };
type CompetitorRow = RowDataPacket & { id:string; business_id:string; name:string; google_place_id:string|null; rating:string; review_count:number; velocity:number; risk:Competitor["risk"]; shared_signals:number; last_checked_at:Date|null };
type IncidentRow = RowDataPacket & { id:string; business_id:string; title:string; detail:string; severity:Incident["severity"]; status:Incident["status"]; evidence_count:number; detected_at:Date };

export class MySQLStore implements AppStore {
  private async monitoredState(connection:Pool|mysql.PoolConnection=this.pool){
    const [rows]=await connection.query<RowDataPacket[]>("SELECT b.id,s.source_key FROM businesses b LEFT JOIN business_sources s ON s.business_id=b.id WHERE b.workspace_id=?",[this.workspaceId]);
    const [configs]=await connection.query<RowDataPacket[]>("SELECT config FROM competitor_workspaces WHERE workspace_id=?",[this.workspaceId]);
    const watch:import("./competitor-workspace.js").CompetitorWorkspace=configs[0]?(typeof configs[0].config==="string"?JSON.parse(configs[0].config):configs[0].config):{baselineKey:null,targets:[]};
    const businesses=rows.map(r=>({id:String(r.id),publicListingKey:r.source_key??undefined}));return {watch,businesses,keys:monitoredKeys(businesses,watch)};
  }
  async getPlatformState():Promise<import("./platform-profiles.js").PlatformState>{const [rows]=await this.pool.query<RowDataPacket[]>("SELECT state FROM platform_workspaces WHERE workspace_id=?",[this.workspaceId]);return rows[0]?(typeof rows[0].state==="string"?JSON.parse(rows[0].state):rows[0].state):{profiles:[]};}
  async mutatePlatformState<T>(change:(state:import("./platform-profiles.js").PlatformState)=>T):Promise<T>{
    await this.ensureWorkspace();const connection=await this.pool.getConnection();
    try{await connection.beginTransaction();await connection.execute("INSERT IGNORE INTO platform_workspaces(workspace_id,state) VALUES(?,?)",[this.workspaceId,JSON.stringify({profiles:[]})]);
      const [rows]=await connection.query<RowDataPacket[]>("SELECT state FROM platform_workspaces WHERE workspace_id=? FOR UPDATE",[this.workspaceId]);
      const state:import("./platform-profiles.js").PlatformState=typeof rows[0].state==="string"?JSON.parse(rows[0].state):rows[0].state;
      const result=change(state);await connection.execute("UPDATE platform_workspaces SET state=? WHERE workspace_id=?",[JSON.stringify(state),this.workspaceId]);await connection.commit();return result;
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }
  async getReportingState():Promise<import("./reporting.js").ReportingState>{const [rows]=await this.pool.query<RowDataPacket[]>("SELECT state FROM reporting_workspaces WHERE workspace_id=?",[this.workspaceId]);return rows[0]?(typeof rows[0].state==="string"?JSON.parse(rows[0].state):rows[0].state):{members:[],cases:[]};}
  async mutateReportingState<T>(change:(state:import("./reporting.js").ReportingState)=>T):Promise<T>{
    await this.ensureWorkspace();const connection=await this.pool.getConnection();
    try{await connection.beginTransaction();await connection.execute("INSERT IGNORE INTO reporting_workspaces(workspace_id,state) VALUES(?,?)",[this.workspaceId,JSON.stringify({members:[],cases:[]})]);
      const [rows]=await connection.query<RowDataPacket[]>("SELECT state FROM reporting_workspaces WHERE workspace_id=? FOR UPDATE",[this.workspaceId]);
      const state:import("./reporting.js").ReportingState=typeof rows[0].state==="string"?JSON.parse(rows[0].state):rows[0].state;
      const result=change(state);await connection.execute("UPDATE reporting_workspaces SET state=? WHERE workspace_id=?",[JSON.stringify(state),this.workspaceId]);await connection.commit();return result;
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }
  async getReviewAnalysis(hash:string){const [rows]=await this.pool.query<RowDataPacket[]>("SELECT report FROM review_analyses WHERE workspace_id=? AND input_hash=?",[this.workspaceId,hash]);return rows[0]?(typeof rows[0].report==="string"?JSON.parse(rows[0].report):rows[0].report) as import("./review-analysis.js").AnalysisReport:null;}
  async saveReviewAnalysis(hash:string,report:import("./review-analysis.js").AnalysisReport){await this.ensureWorkspace();await this.pool.execute("INSERT INTO review_analyses(workspace_id,input_hash,report) VALUES(?,?,?) ON DUPLICATE KEY UPDATE report=VALUES(report)",[this.workspaceId,hash,JSON.stringify(report)]);}
  async selectBusinessListing(datasetId:string,listingId:string):Promise<Business> {
    const [imports]=await this.pool.query<RowDataPacket[]>("SELECT dataset FROM intelligence_imports WHERE id=? AND workspace_id=?",[datasetId,this.workspaceId]);
    const dataset:import("./intelligence.js").IntelligenceDataset|undefined=typeof imports[0]?.dataset==="string"?JSON.parse(imports[0].dataset):imports[0]?.dataset;
    const listing=dataset?.listings.find(l=>l.id===listingId);
    if(!listing||(!listing.placeId&&!listing.cid))throw new Error("Select a collected listing with a Google identity.");
    const key=listing.placeId?`place:${listing.placeId}`:`cid:${listing.cid}`;
    await this.ensureWorkspace();const connection=await this.pool.getConnection();
    let id:string;
    try {
      await connection.beginTransaction();
      const [workspaces]=await connection.query<RowDataPacket[]>("SELECT plan FROM workspaces WHERE id=? FOR UPDATE",[this.workspaceId]);
      const [existing]=await connection.query<RowDataPacket[]>("SELECT business_id FROM business_sources WHERE workspace_id=? AND source_key=?",[this.workspaceId,key]);
      id=existing[0]?.business_id??randomUUID();
      if(!existing.length){
        const current=await this.monitoredState(connection);const next=new Set(current.keys);next.add(key);enforceMonitoredLimit(String(workspaces[0]?.plan??"free"),current.keys,next);
        await connection.execute("INSERT INTO businesses(id,workspace_id,name,address,category,owned) VALUES(?,?,?,?,?,TRUE)",[id,this.workspaceId,listing.name,listing.address??"Not collected",listing.category??"Not collected"]);
      }
      await connection.execute("UPDATE businesses SET name=?,address=?,category=?,rating=?,review_count=?,last_checked_at=? WHERE id=? AND workspace_id=?",[listing.name,listing.address??"Not collected",listing.category??"Not collected",listing.rating??0,listing.reviewCount??0,new Date(dataset!.collectedAt??dataset!.importedAt),id,this.workspaceId]);
      await connection.execute("INSERT INTO business_sources(business_id,workspace_id,source_key,dataset_id,listing_id) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE dataset_id=VALUES(dataset_id),listing_id=VALUES(listing_id)",[id,this.workspaceId,key,datasetId,listingId]);
      await connection.commit();
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
    return (await this.listBusinesses()).find(b=>b.id===id)!;
  }
  async getCompetitorWorkspace(): Promise<import("./competitor-workspace.js").CompetitorWorkspace> {
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT config FROM competitor_workspaces WHERE workspace_id=?", [this.workspaceId]);
    return rows[0] ? (typeof rows[0].config === "string" ? JSON.parse(rows[0].config) : rows[0].config) : { baselineKey: null, targets: [] };
  }
  async saveCompetitorWorkspace(value: import("./competitor-workspace.js").CompetitorWorkspace) {
    await this.ensureWorkspace();const connection=await this.pool.getConnection();
    try{await connection.beginTransaction();const [rows]=await connection.query<RowDataPacket[]>("SELECT plan FROM workspaces WHERE id=? FOR UPDATE",[this.workspaceId]);const before=await this.monitoredState(connection);enforceMonitoredLimit(String(rows[0].plan),before.keys,monitoredKeys(before.businesses,value));
      await connection.execute("INSERT INTO competitor_workspaces(workspace_id,config) VALUES(?,?) ON DUPLICATE KEY UPDATE config=VALUES(config)",[this.workspaceId,JSON.stringify(value)]);await connection.commit();
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }
  async getIntelligenceImport(id:string){
    const [rows]=await this.pool.query<RowDataPacket[]>("SELECT dataset FROM intelligence_imports WHERE workspace_id=? AND id=?",[this.workspaceId,id]);
    return rows[0]?(typeof rows[0].dataset==="string"?JSON.parse(rows[0].dataset):rows[0].dataset) as import("./intelligence.js").IntelligenceDataset:null;
  }
  async listIntelligenceImports() {
    const {keys}=await this.monitoredState();
    const pinned:string[]=[];
    if(keys.size){
      const hashes=[...keys].map(evidenceKey);
      const [history]=await this.pool.query<RowDataPacket[]>(`SELECT DISTINCT dataset_id FROM (
        SELECT dataset_id,ROW_NUMBER() OVER(PARTITION BY subject_id ORDER BY COALESCE(collected_at,imported_at) DESC,imported_at DESC,id DESC) position
        FROM evidence_snapshots WHERE workspace_id=? AND subject_id IN (${hashes.map(()=>"?").join(",")})
      ) history WHERE position<=2`,[this.workspaceId,...hashes]);
      pinned.push(...history.map(row=>String(row.dataset_id)));
    }
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT dataset FROM intelligence_imports WHERE workspace_id=? AND
      (id IN (SELECT id FROM (SELECT id FROM intelligence_imports WHERE workspace_id=? ORDER BY imported_at DESC,id DESC LIMIT 20) recent)
      ${pinned.length?`OR id IN (${pinned.map(()=>"?").join(",")})`:""}) ORDER BY imported_at DESC,id DESC`, [this.workspaceId,this.workspaceId,...pinned]);
    return rows.map(row => (typeof row.dataset === "string" ? JSON.parse(row.dataset) : row.dataset) as import("./intelligence.js").IntelligenceDataset);
  }
  async saveIntelligenceImport(dataset: import("./intelligence.js").IntelligenceDataset) {
    await this.ensureWorkspace();const connection=await this.pool.getConnection();
    try{
      await connection.beginTransaction();
      await connection.execute("INSERT INTO intelligence_imports(id,workspace_id,dataset) VALUES(?,?,?)", [dataset.id, this.workspaceId, JSON.stringify(dataset)]);
      await indexEvidence(connection,this.workspaceId,dataset);
      await connection.commit();
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }
  constructor(private readonly pool: Pool, private readonly workspaceId=defaultWorkspaceId) {}
  static create(url:string){return new MySQLStore(mysql.createPool({uri:url,connectionLimit:10,timezone:"Z"}))}
  async healthCheck(){try{await this.pool.query("SELECT 1");return true}catch{return false}}
  async getOverview(){
    const [[businesses],[_competitors],[incidents]] = await Promise.all([
      this.pool.query<RowDataPacket[]>("SELECT COUNT(*) total, MAX(last_checked_at) last_checked, COALESCE(ROUND(AVG(health)),100) profile_integrity FROM businesses WHERE workspace_id=?",[this.workspaceId]),
      this.pool.query<RowDataPacket[]>("SELECT COUNT(*) total FROM competitors WHERE workspace_id=?",[this.workspaceId]),
      this.pool.query<RowDataPacket[]>("SELECT SUM(status<>'resolved') open_total, SUM(status<>'resolved' AND severity='critical') critical_total FROM incidents WHERE workspace_id=?",[this.workspaceId])
    ]);
    const usage=await this.monitoredState();const [plans]=await this.pool.query<RowDataPacket[]>("SELECT plan FROM workspaces WHERE id=?",[this.workspaceId]);const plan=String(plans[0]?.plan??"free");
    return {plan:plan[0].toUpperCase()+plan.slice(1),profileIntegrity:null,locationsUsed:usage.keys.size,locationsLimit:Number.isFinite(monitoredLimit(plan))?monitoredLimit(plan):null,competitorsUsed:usage.watch.targets.length,openIncidents:Number(incidents[0]?.open_total??0),criticalIncidents:Number(incidents[0]?.critical_total??0),lastCollectionAt:businesses[0]?.last_checked??null,collectionCoverage:null,reviewTrend:[]};
  }
  async listBusinesses(){const [rows]=await this.pool.query<BusinessRow[]>("SELECT b.*,s.source_key,s.dataset_id FROM businesses b LEFT JOIN business_sources s ON s.business_id=b.id WHERE b.workspace_id=? ORDER BY b.created_at",[this.workspaceId]);return rows.map(r=>({id:r.id,publicListingKey:r.source_key??undefined,sourceDatasetId:r.dataset_id??undefined,name:r.name,address:r.address,category:r.category,rating:Number(r.rating),reviewCount:r.review_count,owned:Boolean(r.owned),health:r.health,status:r.status,lastChecked:r.last_checked_at?.toISOString()??new Date().toISOString()}))}
  async addBusiness(input:Pick<Business,"name"|"address"|"category">):Promise<Business>{
    const id=randomUUID();await this.ensureWorkspace();const connection=await this.pool.getConnection();
    try{await connection.beginTransaction();const [rows]=await connection.query<RowDataPacket[]>("SELECT plan FROM workspaces WHERE id=? FOR UPDATE",[this.workspaceId]);const current=await this.monitoredState(connection);const next=new Set(current.keys);next.add("business:"+id);enforceMonitoredLimit(String(rows[0].plan),current.keys,next);
      await connection.execute("INSERT INTO businesses(id,workspace_id,name,address,category,owned,last_checked_at) VALUES(?,?,?,?,?,TRUE,NOW(6))",[id,this.workspaceId,input.name,input.address,input.category]);await connection.commit();
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
    return {id,...input,rating:0,reviewCount:0,owned:true,health:100,status:"healthy",lastChecked:new Date().toISOString()};
  }
  async listCompetitors(){const [rows]=await this.pool.query<CompetitorRow[]>("SELECT * FROM competitors WHERE workspace_id=? ORDER BY created_at",[this.workspaceId]);return rows.map(r=>({id:r.id,businessId:r.business_id,name:r.name,placeId:r.google_place_id??undefined,rating:Number(r.rating),reviewCount:r.review_count,velocity:r.velocity,risk:r.risk,sharedSignals:r.shared_signals,lastChecked:r.last_checked_at?.toISOString()??new Date().toISOString()}))}
  async addCompetitor(input:{businessId:string;name:string;placeId?:string}):Promise<Competitor>{const id=randomUUID();await this.pool.execute("INSERT INTO competitors(id,workspace_id,business_id,google_place_id,name,last_checked_at) VALUES(?,?,?,?,?,NOW(6))",[id,this.workspaceId,input.businessId,input.placeId??null,input.name]);return {id,...input,rating:0,reviewCount:0,velocity:0,risk:"low",sharedSignals:0,lastChecked:new Date().toISOString()}}
  async listIncidents(){const [rows]=await this.pool.query<IncidentRow[]>("SELECT * FROM incidents WHERE workspace_id=? ORDER BY detected_at DESC",[this.workspaceId]);return rows.map(r=>({id:r.id,businessId:r.business_id,title:r.title,detail:r.detail,severity:r.severity,status:r.status,evidenceCount:r.evidence_count,detectedAt:r.detected_at.toISOString()}))}
  async updateIncident(id:string,status:Incident["status"]){await this.pool.execute("UPDATE incidents SET status=? WHERE id=? AND workspace_id=?",[status,id,this.workspaceId]);return (await this.listIncidents()).find(i=>i.id===id)??null}
  async createAudit(businessId:string){
    const id=randomUUID();const incidentId=randomUUID();const evidenceId=randomUUID();const capturedAt=new Date().toISOString();const payload=JSON.stringify({businessId,capturedAt,mode:"baseline"});const sha256=createHash("sha256").update(payload).digest("hex");
    const connection=await this.pool.getConnection();
    try{await connection.beginTransaction();await connection.execute("INSERT INTO collection_jobs(id,workspace_id,kind,payload,status) VALUES(?,?,?,?,?)",[id,this.workspaceId,"business_audit",payload,"completed"]);await connection.execute("INSERT INTO incidents(id,workspace_id,business_id,title,detail,severity,status,evidence_count,detected_at) VALUES(?,?,?,?,?,?,?,?,NOW(6))",[incidentId,this.workspaceId,businessId,"Audit baseline captured","Profile fields and public competitor signals were sampled for future comparison.","info","resolved",1]);await connection.execute("INSERT INTO evidence_objects(id,workspace_id,incident_id,blob_key,sha256,content_type) VALUES(?,?,?,?,?,?)",[evidenceId,this.workspaceId,incidentId,`local/${evidenceId}.json`,sha256,"application/json"]);await connection.commit()}catch(error){await connection.rollback();throw error}finally{connection.release()}
    return {jobId:id,status:"completed"};
  }
  async recordPayPalEvent(eventId:string,eventType:string,payload:unknown,subscription?:{id:string;plan:"business"|"growth";status:string}){const [result]=await this.pool.execute<mysql.ResultSetHeader>("INSERT IGNORE INTO webhook_events(provider,event_id,event_type,payload,processed_at) VALUES('paypal',?,?,?,NOW(6))",[eventId,eventType,JSON.stringify(payload)]);if(result.affectedRows===0)return {duplicate:true};if(subscription){await this.pool.execute("INSERT INTO subscriptions(id,workspace_id,paypal_subscription_id,plan,status) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE plan=VALUES(plan),status=VALUES(status)",[randomUUID(),this.workspaceId,subscription.id,subscription.plan,subscription.status]);if(subscription.status.toUpperCase()==="ACTIVE")await this.pool.execute("UPDATE workspaces SET plan=? WHERE id=?",[subscription.plan,this.workspaceId])}return {duplicate:false}}
  async saveGoogleConnection(connection:GoogleConnection){await this.ensureWorkspace();await this.pool.execute("INSERT INTO google_connections(id,workspace_id,google_subject,email,display_name,access_token_cipher,refresh_token_cipher,token_expires_at) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE email=VALUES(email),display_name=VALUES(display_name),access_token_cipher=VALUES(access_token_cipher),refresh_token_cipher=IF(VALUES(refresh_token_cipher)='',refresh_token_cipher,VALUES(refresh_token_cipher)),token_expires_at=VALUES(token_expires_at)",[randomUUID(),this.workspaceId,connection.subject,connection.email,connection.displayName,connection.accessToken,connection.refreshToken,new Date(connection.expiresAt)])}
  async getGoogleConnection(){const [rows]=await this.pool.query<RowDataPacket[]>("SELECT google_subject,email,display_name,access_token_cipher,refresh_token_cipher,token_expires_at FROM google_connections WHERE workspace_id=? LIMIT 1",[this.workspaceId]);const row=rows[0];return row?{subject:String(row.google_subject),email:String(row.email),displayName:String(row.display_name),accessToken:String(row.access_token_cipher),refreshToken:String(row.refresh_token_cipher??""),expiresAt:new Date(row.token_expires_at).toISOString()}:null}
  async captureProfileSnapshot(businessId:string,snapshot:ProfileSnapshot){const [rows]=await this.pool.query<RowDataPacket[]>("SELECT snapshot FROM profile_snapshots WHERE business_id=? ORDER BY captured_at DESC LIMIT 1",[businessId]);const before=rows[0]?.snapshot as ProfileSnapshot|undefined;const changes=before?diffSnapshots(before,snapshot):[];const id=randomUUID();const sha256=snapshotHash(snapshot);const connection=await this.pool.getConnection();let incidentId:string|undefined;try{await connection.beginTransaction();await connection.execute("INSERT INTO profile_snapshots(id,workspace_id,business_id,snapshot,sha256) VALUES(?,?,?,?,?)",[id,this.workspaceId,businessId,JSON.stringify(snapshot),sha256]);if(changes.length){incidentId=randomUUID();const critical=changes.some(change=>["address","phone","category","serviceAreaOnly"].includes(change.field));await connection.execute("INSERT INTO incidents(id,workspace_id,business_id,title,detail,severity,status,evidence_count,detected_at) VALUES(?,?,?,?,?,?,?,?,NOW(6))",[incidentId,this.workspaceId,businessId,"Business profile integrity change",changes.map(change=>`${change.field}: ${String(change.before)} → ${String(change.after)}`).join("; "),critical?"critical":"warning","open",2]);await connection.execute("UPDATE businesses SET health=?,status=?,last_checked_at=NOW(6) WHERE id=?",[critical?70:85,critical?"critical":"needs_review",businessId])}else{await connection.execute("UPDATE businesses SET last_checked_at=NOW(6) WHERE id=?",[businessId])}await connection.commit()}catch(error){await connection.rollback();throw error}finally{connection.release()}return {baseline:!before,changes,incidentId,sha256}}
  async addTransactionEvidence(input:{businessId:string;externalReference:string;occurredAt:string}){const id=randomUUID();const sha256=evidenceHash(input.businessId,input.externalReference,input.occurredAt);await this.pool.execute("INSERT INTO transaction_evidence(id,workspace_id,business_id,external_reference_hash,occurred_at) VALUES(?,?,?,?,?)",[id,this.workspaceId,input.businessId,sha256,new Date(input.occurredAt)]);return {id,sha256,occurredAt:input.occurredAt}}
  async captureReviewSnapshot(input:{subjectType:"business"|"competitor";subjectId:string;rating:number;reviewCount:number}){const [rows]=await this.pool.query<RowDataPacket[]>("SELECT rating,review_count FROM review_snapshots WHERE subject_type=? AND subject_id=? ORDER BY captured_at DESC LIMIT 1",[input.subjectType,input.subjectId]);const before=rows[0];await this.pool.execute("INSERT INTO review_snapshots(id,workspace_id,subject_type,subject_id,rating,review_count) VALUES(?,?,?,?,?,?)",[randomUUID(),this.workspaceId,input.subjectType,input.subjectId,input.rating,input.reviewCount]);const table=input.subjectType==="business"?"businesses":"competitors";await this.pool.execute(`UPDATE ${table} SET rating=?,review_count=?,last_checked_at=NOW(6) WHERE id=? AND workspace_id=?`,[input.rating,input.reviewCount,input.subjectId,this.workspaceId]);return {baseline:!before,ratingDelta:before?Number((input.rating-Number(before.rating)).toFixed(1)):0,reviewCountDelta:before?input.reviewCount-Number(before.review_count):0}}
  async capturePerformanceSnapshot(input:{businessId:string;impressions:number;calls:number;websiteClicks:number;directionRequests:number}){const [rows]=await this.pool.query<RowDataPacket[]>("SELECT impressions FROM performance_snapshots WHERE business_id=? ORDER BY captured_at DESC LIMIT 1",[input.businessId]);const before=rows[0];await this.pool.execute("INSERT INTO performance_snapshots(id,workspace_id,business_id,impressions,calls,website_clicks,direction_requests) VALUES(?,?,?,?,?,?,?)",[randomUUID(),this.workspaceId,input.businessId,input.impressions,input.calls,input.websiteClicks,input.directionRequests]);const impressionDeltaPercent=before&&Number(before.impressions)?Number((((input.impressions-Number(before.impressions))/Number(before.impressions))*100).toFixed(1)):null;if(impressionDeltaPercent!==null&&impressionDeltaPercent<=-30){const incidentId=randomUUID();await this.pool.execute("INSERT INTO incidents(id,workspace_id,business_id,title,detail,severity,status,evidence_count,detected_at) VALUES(?,?,?,?,?,?,?,?,NOW(6))",[incidentId,this.workspaceId,input.businessId,"Visibility collapse observed",`Business Profile impressions fell ${Math.abs(impressionDeltaPercent)}% between samples.`,"warning","open",2]);return {baseline:false,impressionDeltaPercent,incidentId}}return {baseline:!before,impressionDeltaPercent}}
  async claimFreeAudit(fingerprint:string){const [result]=await this.pool.execute<mysql.ResultSetHeader>("INSERT IGNORE INTO free_audit_usage(fingerprint) VALUES(?)",[fingerprint]);return result.affectedRows===1}
  async getPublicAuditCache(queryHash:string){const [rows]=await this.pool.query<RowDataPacket[]>("SELECT result FROM public_audit_cache WHERE query_hash=? AND expires_at>NOW(6)",[queryHash]);return rows[0]?.result??null}
  async setPublicAuditCache(queryHash:string,value:unknown,expiresAt:string){await this.pool.execute("INSERT INTO public_audit_cache(query_hash,result,expires_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE result=VALUES(result),expires_at=VALUES(expires_at)",[queryHash,JSON.stringify(value),new Date(expiresAt)])}
  private async ensureWorkspace(){await this.pool.execute("INSERT IGNORE INTO workspaces(id,name,plan) VALUES(?,?,?)",[this.workspaceId,"Local preview","growth"])}
}
