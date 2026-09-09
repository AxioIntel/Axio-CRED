import type {IntelligenceDataset} from "./intelligence.js";
export function collectionCsv(dataset:IntelligenceDataset){
  const cell=(value:unknown)=>{const text=typeof value==="string"?value:value==null?"":JSON.stringify(value);return '"'+(/^[\s]*[=+@-]|^[\t\r]/.test(text)?"'":"")+text.replaceAll('"','""')+'"';};
  const columns=["inputId","placeId","cid","name","category","categories","address","structuredAddress","latitude","longitude","rating","reviewCount","distribution","phone","website","emails","hours","popularTimes","creditCards","status","description","timezone","priceRange","mapsUrl","reviewsUrl","streetViewUrl","thumbnail","plusCode","dataId","owner","reservations","orderOnline","menu","attributes","images"] as const;
  return [["datasetId","collectedAt","provider",...columns,"collectedReviews","partialRun"].map(cell).join(","),...dataset.listings.map(row=>[dataset.id,dataset.collectedAt,dataset.collection?.provider??dataset.source,...columns.map(key=>row[key]),row.reviews.length,dataset.collection?.partial??false].map(cell).join(","))].join("\r\n");
}
