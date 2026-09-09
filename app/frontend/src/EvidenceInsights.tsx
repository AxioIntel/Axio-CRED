import type {CollectedListing,Dataset} from "./intelligence-data";
import {listingIdentity,observedReviewers,publicProfileChanges,snapshotHistory} from "./evidence-insights";
import "./evidence-insights.css";
export default function EvidenceInsights({listing,datasets}:{listing:CollectedListing;datasets:Dataset[]}){
  const history=snapshotHistory(listing,datasets),first=history[0],last=history.at(-1);
  const delta=first&&last&&history.length>1&&first.listing.reviewCount!==null&&last.listing.reviewCount!==null?last.listing.reviewCount-first.listing.reviewCount:null;
  const days=first&&last?(Date.parse(last.at)-Date.parse(first.at))/86400000:0;
  const overlaps=observedReviewers(listing,datasets);
  const changes=history.length>1?publicProfileChanges(history.at(-2)!.listing,last!.listing):[];
  const seen=new Set<string>();
  const nearby=datasets.filter(d=>d.source!=="illustrative").flatMap(d=>d.listings).filter(row=>{const id=listingIdentity(row);if(!id||id===listingIdentity(listing)||seen.has(id))return false;seen.add(id);return row.latitude!==null&&row.longitude!==null&&listing.latitude!==null&&listing.longitude!==null&&Math.abs(row.latitude-listing.latitude)<0.000001&&Math.abs(row.longitude-listing.longitude)<0.000001;});
  return <section className="evidence-insights" aria-label="Observed history and overlaps"><h3>Observed history & connections</h3><p>Uses the loaded saved datasets only. A repeated observation is not proof of manipulation.</p>
    <div className="evidence-insight-stats"><div><span>Timestamped snapshots</span><strong>{history.length}</strong></div><div><span>Net reported-count change</span><strong>{delta===null?"Need two snapshots":`${delta>0?"+":""}${delta}`}</strong></div><div><span>Net change per day</span><strong>{delta!==null&&days>=1?(delta/days).toFixed(2):"Need ≥24 hours"}</strong></div></div>
    <small>Net changes can include additions and removals. They are not a count of new reviews. Missing reviews in a partial scrape are not treated as deletions.</small>
    {history.length>0&&<div className="evidence-history-table"><table><thead><tr><th>Collected</th><th>Listing rating</th><th>Reported reviews</th><th>Collected reviews</th></tr></thead><tbody>{history.map(row=><tr key={row.datasetId}><td>{new Date(row.at).toLocaleString()}</td><td>{row.listing.rating??"Unknown"}</td><td>{row.listing.reviewCount??"Unknown"}</td><td>{row.listing.reviews.length}</td></tr>)}</tbody></table></div>}
    <details><summary>Public profile changes · {changes.length}</summary>{changes.length?<ul>{changes.map(c=><li key={c.field}><b>{c.field}</b>: {c.before} → {c.after}</li>)}</ul>:<p>{history.length<2?"Collect another snapshot to compare public fields.":"No comparable field changes between the last two snapshots."}</p>}<small>Missing fields are excluded. Public snapshots do not reveal edit authors, suspension state, hidden addresses or geocoding accuracy.</small></details>
    <details><summary>Reviewers also observed at other businesses · {overlaps.length}</summary><p>Matched by the public Google contributor identifier, never by display name. This is collected overlap, not the reviewer’s complete history.</p>{overlaps.length?<ul>{overlaps.map(author=><li key={author.id}><a href={author.url} target="_blank" rel="noreferrer">{author.name}</a>: {author.businesses.map(b=>`${b.name} (${b.reviews} collected)`).join("; ")}</li>)}</ul>:<p>No matching contributor IDs were found in the other loaded business samples.</p>}</details>
    <details><summary>Listings sharing approximately these coordinates · {nearby.length}</summary><p>Addresses can legitimately share a building. These are location matches within about 0.000001 degrees, not evidence of a virtual office or fake listing.</p><ul>{nearby.map(row=><li key={listingIdentity(row)}>{row.name} · {row.address??"Address not collected"}</li>)}</ul></details>
  </section>;
}
