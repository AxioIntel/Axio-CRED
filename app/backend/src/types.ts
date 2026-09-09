export type Severity = "critical" | "warning" | "info";

export interface Business {
  id: string;
  name: string;
  address: string;
  category: string;
  rating: number;
  reviewCount: number;
  owned: boolean;
  health: number;
  status: "healthy" | "needs_review" | "critical";
  lastChecked: string;
  publicListingKey?: string;
  sourceDatasetId?: string;
}

export interface Incident {
  id: string;
  businessId: string;
  title: string;
  detail: string;
  severity: Severity;
  status: "open" | "investigating" | "resolved";
  evidenceCount: number;
  detectedAt: string;
}

export interface Competitor {
  id: string;
  businessId: string;
  name: string;
  placeId?: string;
  rating: number;
  reviewCount: number;
  velocity: number;
  risk: "low" | "medium" | "high";
  sharedSignals: number;
  lastChecked: string;
}

export interface GoogleConnection {
  subject: string;
  email: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface ProfileSnapshot { address:string;phone:string;category:string;businessStatus:string;latitude:number;longitude:number;serviceAreaOnly:boolean;photoCount:number }
export interface SnapshotResult { baseline:boolean;changes:Array<{field:keyof ProfileSnapshot;before:unknown;after:unknown}>;incidentId?:string;sha256:string }

export interface AppStore {
  getPlatformState():Promise<import("./platform-profiles.js").PlatformState>;
  mutatePlatformState<T>(change:(state:import("./platform-profiles.js").PlatformState)=>T):Promise<T>;
  getReportingState():Promise<import("./reporting.js").ReportingState>;
  mutateReportingState<T>(change:(state:import("./reporting.js").ReportingState)=>T):Promise<T>;
  getReviewAnalysis(hash:string):Promise<import("./review-analysis.js").AnalysisReport|null>;
  saveReviewAnalysis(hash:string,report:import("./review-analysis.js").AnalysisReport):Promise<void>;
  getIntelligenceImport(id:string): Promise<import("./intelligence.js").IntelligenceDataset|null>;
  listIntelligenceImports(): Promise<import("./intelligence.js").IntelligenceDataset[]>;
  getCompetitorWorkspace(): Promise<import("./competitor-workspace.js").CompetitorWorkspace>;
  saveCompetitorWorkspace(value: import("./competitor-workspace.js").CompetitorWorkspace): Promise<void>;
  saveIntelligenceImport(dataset: import("./intelligence.js").IntelligenceDataset): Promise<void>;
  healthCheck(): Promise<boolean>;
  getOverview(): Promise<unknown>;
  listBusinesses(): Promise<Business[]>;
  selectBusinessListing(datasetId: string, listingId: string): Promise<Business>;
  addBusiness(input: Pick<Business, "name" | "address" | "category">): Promise<Business>;
  listCompetitors(): Promise<Competitor[]>;
  addCompetitor(input: { businessId: string; name: string; placeId?: string }): Promise<Competitor>;
  listIncidents(): Promise<Incident[]>;
  updateIncident(id: string, status: Incident["status"]): Promise<Incident | null>;
  createAudit(businessId: string): Promise<{ jobId: string; status: string }>;
  recordPayPalEvent(eventId: string, eventType: string, payload: unknown, subscription?: { id: string; plan: string; status: string }): Promise<{ duplicate: boolean }>;
  saveGoogleConnection(connection: GoogleConnection): Promise<void>;
  getGoogleConnection(): Promise<GoogleConnection | null>;
  captureProfileSnapshot(businessId:string,snapshot:ProfileSnapshot):Promise<SnapshotResult>;
  addTransactionEvidence(input:{businessId:string;externalReference:string;occurredAt:string}):Promise<{id:string;sha256:string;occurredAt:string}>;
  captureReviewSnapshot(input:{subjectType:"business"|"competitor";subjectId:string;rating:number;reviewCount:number}):Promise<{baseline:boolean;ratingDelta:number;reviewCountDelta:number}>;
  capturePerformanceSnapshot(input:{businessId:string;impressions:number;calls:number;websiteClicks:number;directionRequests:number}):Promise<{baseline:boolean;impressionDeltaPercent:number|null;incidentId?:string}>;
  claimFreeAudit(fingerprint:string):Promise<boolean>;
  getPublicAuditCache(queryHash:string):Promise<unknown|null>;
  setPublicAuditCache(queryHash:string,value:unknown,expiresAt:string):Promise<void>;
}
