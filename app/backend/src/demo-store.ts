import {monitoredKeys,enforceMonitoredLimit} from "./entitlements.js";
import { randomUUID } from "node:crypto";
import type { AppStore, Business, Competitor, GoogleConnection, Incident, ProfileSnapshot } from "./types.js";
import { PlanLimitError } from "./errors.js";
import { diffSnapshots, evidenceHash, snapshotHash } from "./integrity.js";

const now = new Date();
const iso = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();

export class DemoStore implements AppStore {
  private platforms:import("./platform-profiles.js").PlatformState={profiles:[]};
  async getPlatformState(){return structuredClone(this.platforms);}
  async mutatePlatformState<T>(change:(state:import("./platform-profiles.js").PlatformState)=>T):Promise<T>{const state=structuredClone(this.platforms);const result=change(state);this.platforms=state;return result;}

  private reporting:import("./reporting.js").ReportingState={members:[],cases:[]};
  async getReportingState(){return structuredClone(this.reporting);}
  async mutateReportingState<T>(change:(state:import("./reporting.js").ReportingState)=>T):Promise<T>{const state=structuredClone(this.reporting);const result=change(state);this.reporting=state;return result;}
  private analyses=new Map<string,import("./review-analysis.js").AnalysisReport>();
  async getReviewAnalysis(hash:string){return this.analyses.get(hash)??null;}
  async saveReviewAnalysis(hash:string,report:import("./review-analysis.js").AnalysisReport){this.analyses.set(hash,report);}
  async selectBusinessListing(datasetId:string,listingId:string) {
    const dataset=this.imports.find(d=>d.id===datasetId);
    const listing=dataset?.listings.find(l=>l.id===listingId);
    if(!listing||(!listing.placeId&&!listing.cid))throw new Error("Select a collected listing with a Google identity.");
    const key=listing.placeId?`place:${listing.placeId}`:`cid:${listing.cid}`;
    let business=this.businesses.find(b=>b.publicListingKey===key);
    if(!business){const before=monitoredKeys(this.businesses,this.competitorWorkspace);const next=new Set(before);next.add(key);enforceMonitoredLimit("growth",before,next);business={id:randomUUID(),name:listing.name,address:listing.address??"Not collected",category:listing.category??"Not collected",rating:0,reviewCount:0,owned:true,health:100,status:"healthy",lastChecked:new Date().toISOString(),publicListingKey:key};this.businesses.push(business);}
    Object.assign(business,{name:listing.name,address:listing.address??"Not collected",category:listing.category??"Not collected",rating:listing.rating??0,reviewCount:listing.reviewCount??0,lastChecked:dataset!.collectedAt??dataset!.importedAt,publicListingKey:key,sourceDatasetId:datasetId});
    const index=this.businesses.findIndex(b=>b.id===business!.id);this.businesses[index]=business;
    return business;
  }
  private competitorWorkspace: import("./competitor-workspace.js").CompetitorWorkspace = { baselineKey: null, targets: [] };
  async getCompetitorWorkspace() { return this.competitorWorkspace; }
  async saveCompetitorWorkspace(value: import("./competitor-workspace.js").CompetitorWorkspace) { enforceMonitoredLimit("growth",monitoredKeys(this.businesses,this.competitorWorkspace),monitoredKeys(this.businesses,value));this.competitorWorkspace = value; }
  private imports: import("./intelligence.js").IntelligenceDataset[] = [];
  async getIntelligenceImport(id:string) { return this.imports.find(dataset=>dataset.id===id)??null; }
  async listIntelligenceImports() { return this.imports; }
  async saveIntelligenceImport(dataset: import("./intelligence.js").IntelligenceDataset) { this.imports.unshift(dataset); }
  private paypalEvents = new Set<string>();
  private googleConnection: GoogleConnection | null = null;
  private snapshots = new Map<string,ProfileSnapshot>();
  private reviewSnapshots = new Map<string,{rating:number;reviewCount:number}>();
  private performanceSnapshots = new Map<string,{impressions:number}>();
  private freeAuditFingerprints = new Set<string>();
  private publicAuditCache = new Map<string,{value:unknown;expiresAt:number}>();
  async healthCheck() { return true; }
  private businesses: Business[] = [
    { id: "biz-1", name: "Northstar Dental", address: "24 Market Street, Austin", category: "Emergency dental service", rating: 4.7, reviewCount: 386, owned: true, health: 82, status: "needs_review", lastChecked: iso(0.2) },
    { id: "biz-2", name: "Northstar Dental – Cedar Park", address: "801 Cypress Creek Road", category: "Dentist", rating: 4.8, reviewCount: 214, owned: true, health: 96, status: "healthy", lastChecked: iso(0.5) }
  ];

  private competitors: Competitor[] = [
    { id: "cmp-1", businessId: "biz-1", name: "Austin Smile Hub 24/7", placeId: "demo-austin-smile-hub", rating: 4.9, reviewCount: 721, velocity: 48, risk: "high", sharedSignals: 7, lastChecked: iso(2) },
    { id: "cmp-2", businessId: "biz-1", name: "Downtown Emergency Dentistry", rating: 4.6, reviewCount: 302, velocity: 9, risk: "medium", sharedSignals: 2, lastChecked: iso(2.2) },
    { id: "cmp-3", businessId: "biz-1", name: "Central Texas Family Dental", rating: 4.7, reviewCount: 519, velocity: 3, risk: "low", sharedSignals: 0, lastChecked: iso(1.8) }
  ];

  private incidents: Incident[] = [
    { id: "inc-1", businessId: "biz-1", title: "Primary category changed", detail: "Emergency dental service changed to Dentist. Confirm whether this was authorized.", severity: "critical", status: "open", evidenceCount: 3, detectedAt: iso(3) },
    { id: "inc-2", businessId: "biz-1", title: "Review burst observed", detail: "Austin Smile Hub received 31 reviews within 18 hours. Six use substantially similar phrases.", severity: "warning", status: "investigating", evidenceCount: 38, detectedAt: iso(18) },
    { id: "inc-3", businessId: "biz-2", title: "Holiday hours confirmed", detail: "Google and your approved baseline now match.", severity: "info", status: "resolved", evidenceCount: 2, detectedAt: iso(48) }
  ];

  async getOverview() {
    return {
      plan: "Growth",
      profileIntegrity: 89,
      locationsUsed: monitoredKeys(this.businesses,this.competitorWorkspace).size,
      locationsLimit: 5,
      competitorsUsed: this.competitors.length,
      openIncidents: this.incidents.filter((i) => i.status !== "resolved").length,
      criticalIncidents: this.incidents.filter((i) => i.severity === "critical" && i.status !== "resolved").length,
      lastCollectionAt: iso(0.2),
      collectionCoverage: 94,
      reviewTrend: [
        { label: "Mon", owned: 5, competitors: 12 }, { label: "Tue", owned: 2, competitors: 9 },
        { label: "Wed", owned: 8, competitors: 14 }, { label: "Thu", owned: 3, competitors: 23 },
        { label: "Fri", owned: 4, competitors: 36 }, { label: "Sat", owned: 1, competitors: 18 },
        { label: "Sun", owned: 3, competitors: 11 }
      ]
    };
  }

  async listBusinesses() { return this.businesses; }
  async addBusiness(input: Pick<Business, "name" | "address" | "category">) {
    const before=monitoredKeys(this.businesses,this.competitorWorkspace);const next=new Set(before);next.add("new:"+randomUUID());enforceMonitoredLimit("growth",before,next);
    const item: Business = { id: randomUUID(), ...input, rating: 0, reviewCount: 0, owned: true, health: 100, status: "healthy", lastChecked: new Date().toISOString() };
    this.businesses.push(item); return item;
  }
  async listCompetitors() { return this.competitors; }
  async addCompetitor(input: { businessId: string; name: string; placeId?: string }) {
    const item: Competitor = { id: randomUUID(), ...input, rating: 0, reviewCount: 0, velocity: 0, risk: "low", sharedSignals: 0, lastChecked: new Date().toISOString() };
    this.competitors.push(item); return item;
  }
  async listIncidents() { return this.incidents; }
  async updateIncident(id: string, status: Incident["status"]) {
    const item = this.incidents.find((i) => i.id === id); if (!item) return null; item.status = status; return item;
  }
  async createAudit(businessId: string) {
    const jobId = `audit-${businessId}-${Date.now()}`;
    this.incidents.unshift({ id: randomUUID(), businessId, title: "Audit baseline captured", detail: "Public profile fields, rating count, category, and competitor signals were sampled for future comparison.", severity: "info", status: "resolved", evidenceCount: 1, detectedAt: new Date().toISOString() });
    return { jobId, status: "completed" };
  }
  async recordPayPalEvent(eventId: string) { const duplicate=this.paypalEvents.has(eventId);this.paypalEvents.add(eventId);return {duplicate}; }
  async saveGoogleConnection(connection:GoogleConnection){this.googleConnection=connection}
  async getGoogleConnection(){return this.googleConnection}
  async captureProfileSnapshot(businessId:string,snapshot:ProfileSnapshot){const before=this.snapshots.get(businessId);const changes=before?diffSnapshots(before,snapshot):[];this.snapshots.set(businessId,snapshot);const sha256=snapshotHash(snapshot);if(!before)return {baseline:true,changes,sha256};if(!changes.length)return {baseline:false,changes,sha256};const incidentId=randomUUID();this.incidents.unshift({id:incidentId,businessId,title:"Business profile integrity change",detail:changes.map(change=>`${change.field}: ${String(change.before)} → ${String(change.after)}`).join("; "),severity:changes.some(change=>["address","phone","category","serviceAreaOnly"].includes(change.field))?"critical":"warning",status:"open",evidenceCount:2,detectedAt:new Date().toISOString()});return {baseline:false,changes,incidentId,sha256}}
  async addTransactionEvidence(input:{businessId:string;externalReference:string;occurredAt:string}){return {id:randomUUID(),sha256:evidenceHash(input.businessId,input.externalReference,input.occurredAt),occurredAt:input.occurredAt}}
  async captureReviewSnapshot(input:{subjectType:"business"|"competitor";subjectId:string;rating:number;reviewCount:number}){const key=`${input.subjectType}:${input.subjectId}`;const before=this.reviewSnapshots.get(key);this.reviewSnapshots.set(key,{rating:input.rating,reviewCount:input.reviewCount});const collection=input.subjectType==="business"?this.businesses:this.competitors;const item=collection.find(entry=>entry.id===input.subjectId);if(item){item.rating=input.rating;item.reviewCount=input.reviewCount;item.lastChecked=new Date().toISOString()}return {baseline:!before,ratingDelta:before?Number((input.rating-before.rating).toFixed(1)):0,reviewCountDelta:before?input.reviewCount-before.reviewCount:0}}
  async capturePerformanceSnapshot(input:{businessId:string;impressions:number;calls:number;websiteClicks:number;directionRequests:number}){const before=this.performanceSnapshots.get(input.businessId);this.performanceSnapshots.set(input.businessId,{impressions:input.impressions});const impressionDeltaPercent=before&&before.impressions?Number((((input.impressions-before.impressions)/before.impressions)*100).toFixed(1)):null;if(impressionDeltaPercent!==null&&impressionDeltaPercent<=-30){const incidentId=randomUUID();this.incidents.unshift({id:incidentId,businessId:input.businessId,title:"Visibility collapse observed",detail:`Business Profile impressions fell ${Math.abs(impressionDeltaPercent)}% between samples.`,severity:"warning",status:"open",evidenceCount:2,detectedAt:new Date().toISOString()});return {baseline:false,impressionDeltaPercent,incidentId}}return {baseline:!before,impressionDeltaPercent}}
  async claimFreeAudit(fingerprint:string){if(this.freeAuditFingerprints.has(fingerprint))return false;this.freeAuditFingerprints.add(fingerprint);return true}
  async getPublicAuditCache(queryHash:string){const hit=this.publicAuditCache.get(queryHash);return hit&&hit.expiresAt>Date.now()?hit.value:null}
  async setPublicAuditCache(queryHash:string,value:unknown,expiresAt:string){this.publicAuditCache.set(queryHash,{value,expiresAt:new Date(expiresAt).getTime()})}
}
