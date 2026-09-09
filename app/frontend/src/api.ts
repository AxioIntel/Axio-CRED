export interface Business { id:string; name:string; address:string; category:string; rating:number; reviewCount:number; owned:boolean; health:number; status:"healthy"|"needs_review"|"critical"; lastChecked:string; publicListingKey?:string; sourceDatasetId?:string }
export interface Competitor { id:string; businessId:string; name:string; placeId?:string; rating:number; reviewCount:number; velocity:number; risk:"low"|"medium"|"high"; sharedSignals:number; lastChecked:string }
export interface Incident { id:string; businessId:string; title:string; detail:string; severity:"critical"|"warning"|"info"; status:"open"|"investigating"|"resolved"; evidenceCount:number; detectedAt:string }
export interface Overview { plan:string; profileIntegrity:number|null; locationsUsed:number; locationsLimit:number|null; competitorsUsed:number; openIncidents:number; criticalIncidents:number; lastCollectionAt:string|null; collectionCoverage:number|null; reviewTrend:{label:string;owned:number;competitors:number}[] }
export interface PublicAudit { source:"google_places"|"demo"; collectedAt:string; business:{placeId:string;name:string;address:string;category:string;rating:number;reviewCount:number;businessStatus:string;phone?:string;website?:string}; findings:{level:"info"|"warning";title:string;detail:string}[] }
export interface GoogleLocation { googleLocationId:string;name:string;address:string;category:string;website:string;phone:string;serviceAreaOnly:boolean }
export interface PlaceReview { authorName:string; authorUri?:string; rating:number; text:string; publishTime?:string; relativePublishTimeDescription?:string }
export interface PlaceLookup { source:"google_places"|"demo"; placeId:string; name:string; address:string; category:string; rating:number; reviewCount:number; businessStatus:string; mapsUrl:string; reviews:PlaceReview[] }

async function request<T>(path:string, init?:RequestInit):Promise<T> {
  const response=await fetch(path,{headers:{"Content-Type":"application/json",...init?.headers},...init});
  const body=await response.json(); if(!response.ok) throw new Error(body.error??"Request failed"); return body;
}
export const api={
  overview:()=>request<Overview>("/api/overview"), businesses:()=>request<Business[]>("/api/businesses"), competitors:()=>request<Competitor[]>("/api/competitors"), incidents:()=>request<Incident[]>("/api/incidents"), integrations:()=>request<Record<string,any>>("/api/integrations"),
  addBusiness:(data:{name:string;address:string;category:string})=>request<Business>("/api/businesses",{method:"POST",body:JSON.stringify(data)}),
  addCompetitor:(data:{businessId:string;name?:string;placeId?:string})=>request<Competitor>("/api/competitors",{method:"POST",body:JSON.stringify(data)}),
  updateIncident:(id:string,status:Incident["status"])=>request<Incident>(`/api/incidents/${id}`,{method:"PATCH",body:JSON.stringify({status})}),
  createAudit:(businessId:string)=>request<{jobId:string;status:string}>("/api/audits",{method:"POST",body:JSON.stringify({businessId})})
  ,authStart:()=>request<{mode:string;redirectUrl:string;message?:string}>("/api/auth/google/start")
  ,subscribe:(plan:"business"|"growth")=>request<{mode:string;status?:string;approvalUrl?:string}>("/api/billing/subscribe",{method:"POST",body:JSON.stringify({plan})})
  ,publicAudit:(query:string)=>request<PublicAudit>("/api/public-audits",{method:"POST",body:JSON.stringify({query})})
  ,googleLocations:()=>request<{mode:string;locations:GoogleLocation[]}>("/api/google/locations")
  ,lookupPlace:(placeId:string)=>request<PlaceLookup>(`/api/places/lookup?placeId=${encodeURIComponent(placeId)}`)
  ,competitorReviews:(id:string)=>request<PlaceLookup & {competitorId:string;competitorName:string}>(`/api/competitors/${id}/reviews`)
  ,transactionEvidence:(data:{businessId:string;externalReference:string;occurredAt:string})=>request<{id:string;sha256:string;occurredAt:string}>("/api/evidence/transactions",{method:"POST",body:JSON.stringify(data)})
};
