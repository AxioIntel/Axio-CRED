import type {CollectedListing,Dataset} from "./intelligence-data";
export const listingIdentity=(listing:CollectedListing)=>listing.placeId?`place:${listing.placeId}`:listing.cid?`cid:${listing.cid}`:null;
export function contributorId(url:string|null){
  try{const parsed=new URL(url??"");if(parsed.protocol!=="https:"||!['google.com','www.google.com','maps.google.com'].includes(parsed.hostname))return null;return parsed.pathname.match(/^\/maps\/contrib\/(\d+)(?:\/|$)/)?.[1]??null;}catch{return null;}
}
export function snapshotHistory(listing:CollectedListing,datasets:Dataset[]){
  const identity=listingIdentity(listing);if(!identity)return [];
  const seen=new Set<string>();
  return datasets.filter(d=>d.source!=="illustrative"&&d.collectedAt&&Number.isFinite(Date.parse(d.collectedAt))).sort((a,b)=>Date.parse(a.collectedAt!)-Date.parse(b.collectedAt!)).flatMap(dataset=>{
    const row=dataset.listings.find(l=>listingIdentity(l)===identity);if(!row||seen.has(dataset.collectedAt!))return [];seen.add(dataset.collectedAt!);
    return [{datasetId:dataset.id,at:dataset.collectedAt!,listing:row,provider:dataset.collection?.provider??"builtin"}];
  });
}
export function observedReviewers(listing:CollectedListing,datasets:Dataset[]){
  const target=listingIdentity(listing);if(!target)return [];
  const authors=new Map(listing.reviews.flatMap(r=>{const id=contributorId(r.authorUrl);return id?[[id,{id,name:r.author,url:r.authorUrl!}] as const]:[];}));
  return [...authors.values()].map(author=>{
    const businesses=new Map<string,{name:string;reviewIds:Set<string>}>();
    for(const dataset of datasets.filter(d=>d.source!=="illustrative"))for(const row of dataset.listings){const identity=listingIdentity(row);if(!identity||identity===target)continue;
      for(const review of row.reviews)if(contributorId(review.authorUrl)===author.id){const entry=businesses.get(identity)??{name:row.name,reviewIds:new Set<string>()};entry.reviewIds.add(review.id);businesses.set(identity,entry);}}
    return {...author,businesses:[...businesses.values()].map(b=>({name:b.name,reviews:b.reviewIds.size}))};
  }).filter(a=>a.businesses.length);
}
export function publicProfileChanges(before:CollectedListing,after:CollectedListing){
  const fields=['address','category','phone','website','status','latitude','longitude','hours'] as const;
  return fields.flatMap(field=>{const a=before[field],b=after[field];if(a==null||b==null)return [];if(field==='hours'&&(!Object.keys(a).length||!Object.keys(b).length))return [];const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;const describe=(value:unknown)=>typeof value==='object'?JSON.stringify(canonical(value)):String(value);return describe(a)!==describe(b)?[{field,before:describe(a),after:describe(b)}]:[];});
}
