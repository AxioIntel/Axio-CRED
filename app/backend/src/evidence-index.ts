import {createHash} from "node:crypto";
import type {Connection, PoolConnection} from "mysql2/promise";
import type {IntelligenceDataset} from "./intelligence.js";

export const evidenceKey=(value:string)=>createHash("sha256").update(value).digest("hex");
const date=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?new Date(value):null;

export function projectEvidence(dataset:IntelligenceDataset){
  return dataset.listings.map(listing=>({
    identity:listing.placeId?`place:${listing.placeId}`:listing.cid?`cid:${listing.cid}`:`unresolved:${dataset.id}:${listing.id}`,
    id:evidenceKey(JSON.stringify([dataset.id,listing.id])),listing,
    // A relative date, import time, or report total must never fill a missing observation.
    collectedAt:date(dataset.collectedAt),importedAt:date(dataset.importedAt)!,
    provider:dataset.collection?.provider??"scraper_import",
    usable:listing.reviews.filter(r=>r.text?.trim()&&!r.captureIssue).length,
    withheld:listing.reviews.filter(r=>r.captureIssue).length
  }));
}

/** Caller owns the transaction; payload and projection must commit together. */
export async function indexEvidence(db:Connection|PoolConnection,workspaceId:string,dataset:IntelligenceDataset){
  for(const row of projectEvidence(dataset)){
    const subject=evidenceKey(row.identity);
    await db.execute("INSERT IGNORE INTO evidence_subjects(workspace_id,id,identity_key) VALUES(?,?,?)",[workspaceId,subject,row.identity]);
    await db.execute(`INSERT INTO evidence_snapshots(workspace_id,id,subject_id,dataset_id,listing_id,collected_at,imported_at,provider,reported_count,collected_count,usable_text_count,withheld_count)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE reported_count=VALUES(reported_count),collected_count=VALUES(collected_count),usable_text_count=VALUES(usable_text_count),withheld_count=VALUES(withheld_count)`,
      [workspaceId,row.id,subject,dataset.id,row.listing.id,row.collectedAt,row.importedAt,row.provider,row.listing.reviewCount,row.listing.reviews.length,row.usable,row.withheld]);
    // Rebuild this projection on backfill, preserving the source payload and review identities.
    await db.execute("DELETE FROM review_observations WHERE workspace_id=? AND snapshot_id=?",[workspaceId,row.id]);
    for(let start=0;start<row.listing.reviews.length;start+=250){
      const values=row.listing.reviews.slice(start,start+250).map(r=>[workspaceId,row.id,evidenceKey(r.id),r.id,r.rating,date(r.publishedAt),Boolean(r.text?.trim()&&!r.captureIssue),Boolean(r.reply),Boolean(r.captureIssue)]);
      await db.query("INSERT INTO review_observations(workspace_id,snapshot_id,review_key,source_review_id,rating,published_at,has_text,has_reply,has_capture_issue) VALUES ?",[values]);
    }
  }
}
