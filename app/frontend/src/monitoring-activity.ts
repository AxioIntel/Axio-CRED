import type {Business,Overview} from "./api";
import type {Dataset,CollectedListing} from "./intelligence-data";
import {listingIdentity,publicProfileChanges,snapshotHistory} from "./evidence-insights";
export interface Watch {baselineKey:string|null;targets:{id:string;name:string;listingKey:string|null;mapsUrl:string|null}[]}
export interface MonitoringData {businesses:Business[];watch:Watch;datasets:Dataset[];overview:Overview}
export interface MonitoredEntity {key:string;name:string;owned:boolean;competitor:boolean;latest?:{listing:CollectedListing;dataset:Dataset};snapshots:number}
export interface ChangeSignal {id:string;entity:MonitoredEntity;type:"low_review"|"burst"|"profile"|"rating";title:string;detail:string;at:string;from:string;datasetId:string;listingId:string;reviewId?:string}
export function monitoredEntities(data:MonitoringData):MonitoredEntity[]{
  const map=new Map<string,MonitoredEntity>();
  for(const b of data.businesses)if(b.publicListingKey)map.set(b.publicListingKey,{key:b.publicListingKey,name:b.name,owned:true,competitor:false,snapshots:0});
  for(const t of data.watch.targets){const key=t.listingKey??`pending:${t.id}`;const old=map.get(key);map.set(key,{key,name:t.name,owned:old?.owned??false,competitor:true,snapshots:0});}
  for(const item of map.values()){
    const rows=data.datasets.filter(d=>d.source!=="illustrative").flatMap(dataset=>dataset.listings.filter(l=>listingIdentity(l)===item.key).map(listing=>({dataset,listing}))).sort((a,b)=>Date.parse(b.dataset.collectedAt??b.dataset.importedAt)-Date.parse(a.dataset.collectedAt??a.dataset.importedAt));
    item.latest=rows[0];if(item.latest)item.snapshots=snapshotHistory(item.latest.listing,data.datasets).length;
  }return [...map.values()];
}
export function detectChanges(entities:MonitoredEntity[],datasets:Dataset[]):ChangeSignal[]{
  const signals:ChangeSignal[]=[];
  for(const entity of entities){if(!entity.latest)continue;const history=snapshotHistory(entity.latest.listing,datasets);if(history.length<2)continue;const after=history.at(-1)!,before=history.at(-2)!;const elapsed=Date.parse(after.at)-Date.parse(before.at);if(elapsed<=0)continue;
    const base={entity,at:after.at,from:before.at,datasetId:after.datasetId,listingId:after.listing.id};const prefix=`${entity.key}:${before.datasetId}:${after.datasetId}`;
    const seen=new Set(history.slice(0,-1).flatMap(h=>h.listing.reviews.map(r=>r.id)));
    // Switching collectors may change review IDs. Establish a same-provider baseline first.
    for(const r of after.listing.reviews)if(before.provider===after.provider&&r.rating!==null&&r.rating<=2&&!seen.has(r.id))signals.push({...base,id:`${prefix}:review:${r.id}`,reviewId:r.id,type:"low_review",title:`${r.rating}-star review newly observed`,detail:`${r.author}: ${r.text??"No review text collected."} This review was not in earlier loaded samples; its posting time is not established by this comparison.`});
    const countBefore=before.listing.reviewCount,countAfter=after.listing.reviewCount;
    if(countBefore!==null&&countAfter!==null&&countAfter-countBefore>=10&&elapsed<=24*60*60*1000)signals.push({...base,id:`${prefix}:burst`,type:"burst",title:`Review activity jump: +${countAfter-countBefore}`,detail:`Reported reviews changed from ${countBefore} to ${countAfter} across ${(elapsed/3600000).toFixed(1)} hours. Rule: at least 10 additional reviews within 24 hours. A jump alone does not establish manipulation.`});
    if(before.listing.rating!==null&&after.listing.rating!==null&&after.listing.rating<before.listing.rating)signals.push({...base,id:`${prefix}:rating`,type:"rating",title:`Rating decreased: ${before.listing.rating} → ${after.listing.rating}`,detail:"The platform's reported rating fell between these snapshots. Review the collected evidence to understand the context."});
    const changes=publicProfileChanges(before.listing,after.listing);if(changes.length)signals.push({...base,id:`${prefix}:profile`,type:"profile",title:`${changes.length} public profile ${changes.length===1?"field changed":"fields changed"}`,detail:changes.map(c=>`${c.field}: ${c.before} → ${c.after}`).join("; ")+". Confirm whether these changes were authorized."});
  }return signals.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
}
export const signalUrl=(signal:ChangeSignal)=>`/evidence?dataset=${encodeURIComponent(signal.datasetId)}&listing=${encodeURIComponent(signal.listingId)}&scope=${signal.entity.owned&&!signal.entity.competitor?"owned":"competitor"}${signal.reviewId?`&review=${encodeURIComponent(signal.reviewId)}`:""}`;
