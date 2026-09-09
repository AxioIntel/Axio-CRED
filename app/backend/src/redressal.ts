import type {AppStore} from "./types.js";
export async function redressalCsv(store:AppStore){
  const [watch,datasets]=await Promise.all([store.getCompetitorWorkspace(),store.listIntelligenceImports()]);
  const rows:unknown[][]=[["Business Name","Full Street Address","Google Maps URL","Place ID","Collected At","Observed Rating","Reported Reviews","Collected Reviews","Dataset ID","Observed Connections","Verified Policy Reason (fill in)","Supporting Evidence References (fill in)"]];
  for(const target of watch.targets){
    let record:{dataset:typeof datasets[number];listing:typeof datasets[number]["listings"][number]}|undefined;
    for(const dataset of [...datasets].sort((a,b)=>Date.parse(b.collectedAt??b.importedAt)-Date.parse(a.collectedAt??a.importedAt))){const listing=dataset.listings.find(l=>(l.placeId?`place:${l.placeId}`:l.cid?`cid:${l.cid}`:`import:${dataset.id}:${l.id}`)===target.listingKey);if(listing){record={dataset,listing};break;}}
    const listing=record?.listing;
    rows.push([listing?.name??target.name,listing?.address??"Not collected",listing?.mapsUrl??target.mapsUrl??"",listing?.placeId??"",record?.dataset.collectedAt??"Unknown",listing?.rating??"Unknown",listing?.reviewCount??"Unknown",listing?.reviews.length??"Unknown",record?.dataset.id??"", "No verified policy violation inferred from contact or location matches", "", ""]);
  }
  const cell=(value:unknown)=>{const text=String(value??"");return '"'+(/^[\s]*[=+@-]|^[\t\r\n]/.test(text)?"'":"")+text.replaceAll('"','""')+'"';};
  return rows.map(row=>row.map(cell).join(",")).join("\r\n");
}
