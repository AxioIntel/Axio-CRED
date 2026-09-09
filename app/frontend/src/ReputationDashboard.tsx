import { useState, useMemo } from "react";
import { NavLink } from "react-router-dom";
import { ArrowUpRight, Check, Flag, MessageSquare, ShieldCheck } from "lucide-react";
import type { CollectedListing, CollectedReview, Dataset } from "./intelligence-data";
import { snapshotHistory, publicProfileChanges } from "./evidence-insights";
import ReviewAnalysisPanel, { type Report } from "./ReviewAnalysisPanel";
import ReviewReportKit, { mapsListingUrl } from "./ReviewReportKit";
import CollectionRefresh from "./CollectionRefresh";
import "./reputation-dashboard.css";
import ReviewPatternPanel from "./ReviewPatternPanel";
import {reviewPatterns} from "../../backend/src/review-patterns";
import {CollectionQuality,ReviewMetadata} from "./CollectionQuality";

const number = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString();
const date = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const label = (value: string) => value.replaceAll("_", " ");
export function reviewStats(listing: CollectedListing) {
  return {
    low: listing.reviews.filter(r => r.rating != null && r.rating <= 2).length,
    noReply: listing.reviews.filter(r => !r.reply?.trim()).length,
    distribution: [5,4,3,2,1].map(stars => ({ stars, count: listing.reviews.filter(r => r.rating === stars).length }))
  };
}

function ReplyDraft({ review, url }: { review: CollectedReview; url: string | null }) {
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  return <details className="rep-reply"><summary><MessageSquare size={14}/>Draft a response</summary><label>Response draft for {review.author}<textarea rows={4} value={draft} onChange={e => {setDraft(e.target.value);setStatus("");}} placeholder="Acknowledge the feedback and offer a specific next step. Keep customer details private."/></label><div className="rep-inline"><button className="button secondary" disabled={!draft.trim()} onClick={async () => {try {await navigator.clipboard.writeText(draft);setStatus("Copied. Review and publish it in Google Maps using an account that manages this business.");}catch {setStatus("Clipboard unavailable. Select and copy the draft text.");}}}>Copy response</button>{url && <a href={url} target="_blank" rel="noreferrer">Open Google Maps <ArrowUpRight size={13}/></a>}</div><small>Draft stays in this panel until you leave. Copy to keep it. Nothing is published automatically.</small>{status && <p role="status">{status}</p>}</details>;
}

export default function ReputationDashboard({ listing, dataset, datasets, owned = false, onCollected }: {
  listing: CollectedListing; dataset: Dataset; datasets: Dataset[]; owned?: boolean; onCollected: () => void;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const analysis = report?.datasetId === dataset.id && report.listingId === listing.id ? report : null;
  const finding = (id: string) => analysis?.reviews.find(r => analysis.reviewIds[r.reviewRef] === id);
  const flagged = analysis?.reviews.filter(r => r.policy !== "none_identified") ?? [];
  const patterns=useMemo(()=>reviewPatterns(listing,dataset.collectedAt),[listing,dataset.collectedAt]);
  const investigate=new Set([...patterns.investigationReviewIds,...(analysis?.reviews.filter(r=>r.priority==="medium"||r.priority==="high"||r.policy!=="none_identified").map(r=>analysis.reviewIds[r.reviewRef])??[])]);
  const stats = reviewStats(listing);
  // Restrict history to the selected snapshot, so an older selection never displays future changes.
  const history = snapshotHistory(listing, datasets).filter(h => dataset.collectedAt && Date.parse(h.at) <= Date.parse(dataset.collectedAt));
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const changes = previous ? publicProfileChanges(previous.listing, listing) : [];
  const netChange = previous?.listing.reviewCount != null && listing.reviewCount != null ? listing.reviewCount - previous.listing.reviewCount : null;
  const points = history.filter(h => h.listing.rating != null);
  const start = points.length ? Date.parse(points[0].at) : 0;
  const span = points.length ? Date.parse(points[points.length-1].at) - start : 0;
  const coordinates = points.map(h => ({x: span ? 40 + (Date.parse(h.at)-start)/span*520 : 300, y: 220 - (h.listing.rating!-1)/4*184, ...h}));
  const line = coordinates.map(p => `${p.x},${p.y}`).join(" ");
  const url = mapsListingUrl(listing);
  const priorities: Record<string, number> = { high: 3, medium: 2, low: 1, insufficient_evidence: 0 };
  const reviews = listing.reviews.filter(r => (filter !== "low" || (r.rating != null && r.rating <= 2)) && (filter !== "flagged" || investigate.has(r.id)) && (filter !== "unanswered" || !r.reply?.trim()) && `${r.author} ${r.text ?? ""}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => (priorities[finding(b.id)?.priority ?? ""] ?? -1) - (priorities[finding(a.id)?.priority ?? ""] ?? -1));
  const policies = Object.entries(flagged.reduce<Record<string,number>>((out,r) => {out[r.policy]=(out[r.policy]??0)+1;return out;}, {}));
  return <section className={`rep-dashboard ${owned ? "rep-owned" : ""}`} aria-label={owned ? "Your business review dashboard" : "Competitor review dashboard"}>
    <header className="rep-profile"><div><span className="rep-eyebrow">{owned ? "PROTECT YOUR BUSINESS" : "COMPETITOR INTELLIGENCE"} · GOOGLE</span><h2>{listing.name}</h2><p>{listing.address ?? "Address not collected"}</p></div><div className="rep-sync"><span className="rep-dot"/>Last collected <strong>{dataset.collectedAt ? date(dataset.collectedAt) : "Time unknown"}</strong><small>On-demand collection · scheduling not active</small></div></header>
    <div className="rep-coverage"><span><strong>{listing.reviews.length}</strong> reviews collected of {number(listing.reviewCount)} reported</span><span>{listing.reviewCount!=null ? `${Math.max(0,listing.reviewCount-listing.reviews.length).toLocaleString()} reviews not collected — not assessed or cleared.` : "Full review coverage unknown."} AI findings require verification.</span></div>
    {dataset.collection&&<p className="mine-caption">Collection source: {dataset.collection.provider==="outscraper"?"Outscraper fallback":"Built-in scraper"}{dataset.collection.reason?` · ${dataset.collection.reason}`:""}</p>}
    <CollectionQuality listing={listing}/>
    {owned && <div className="rep-next"><ShieldCheck size={22}/><div><strong>Your next step</strong><p>{stats.low ? `Read the ${stats.low} low-rated reviews in your sample and prepare a response.` : stats.noReply ? `Check ${stats.noReply} reviews with no collected owner reply.` : "Review your latest feedback and compare the profile with its previous snapshot."}</p></div><button className="button" onClick={() => {setFilter(stats.low ? "low" : stats.noReply ? "unanswered" : "all");setLimit(20);document.getElementById("rep-triage")?.scrollIntoView({behavior:"smooth",block:"start"});}}>Review feedback <ArrowUpRight size={15}/></button></div>}
    <div className="rep-metrics">
      <article><span>TOTAL REVIEWS</span><strong>{number(listing.reviewCount)}</strong><small>Reported by Google · {listing.reviews.length} collected</small></article>
      <article><span>AVERAGE RATING</span><strong>{number(listing.rating)}</strong><small><b className="rep-stars">★</b> Latest collected listing rating / 5</small></article>
      <article><span>REVIEW COUNT CHANGE</span><strong>{netChange == null ? "—" : `${netChange > 0 ? "+" : ""}${number(netChange)}`}</strong><small>{previous ? `Net change since ${date(previous.at)}` : "Requires a second dated snapshot"}</small></article>
      <article className="rep-metric-alert"><span>NEEDS INVESTIGATION</span><strong>{analysis||patterns.signals.length ? investigate.size : "—"}</strong><small>{analysis ? `${analysis.analyzedCount} AI-assessed · ${flagged.length} potential review-policy concerns` : "AI not analyzed · pattern signals shown separately"}</small></article>
    </div>
    <div className="rep-chart-grid">
      <article className="rep-panel"><div className="rep-panel-title"><div><h3>Average rating over time</h3><p>Listing ratings from saved snapshots</p></div><strong>{number(listing.rating)} <small>latest</small></strong></div>
        {points.length >= 2 ? <><svg className="rep-chart" viewBox="0 0 600 260" role="img" aria-label={`Rating history across ${points.length} snapshots, from ${date(points[0].at)} to ${date(points[points.length-1].at)}. Exact values in the table below.`}>{[1,2,3,4,5].map(n=><g key={n}><line x1="40" x2="560" y1={220-(n-1)*46} y2={220-(n-1)*46} stroke="#303c42"/><text x="10" y={224-(n-1)*46}>{n}.0</text></g>)}<polygon points={`40,220 ${line} 560,220`} fill="#48b5d2" opacity=".09"/><polyline points={line} fill="none" stroke="#50bdd7" strokeWidth="2.5"/>{coordinates.map(p=><circle key={p.at} cx={p.x} cy={p.y} r="3.5" fill="#1d2529" stroke="#50bdd7" strokeWidth="2"><title>{date(p.at)}: {p.listing.rating}</title></circle>)}<text x="40" y="250">{date(points[0].at)}</text><text x="560" y="250" textAnchor="end">{date(points[points.length-1].at)}</text></svg><details className="rep-chart-data"><summary>View snapshot values</summary><table><thead><tr><th>Collected</th><th>Rating</th><th>Reviews</th></tr></thead><tbody>{history.map(h=><tr key={h.at}><td>{date(h.at)}</td><td>{number(h.listing.rating)}</td><td>{number(h.listing.reviewCount)}</td></tr>)}</tbody></table></details></> : <div className="rep-empty-chart"><span>01 → 02</span><h4>Your history starts here</h4><p>Collect a second dated snapshot to see a rating trend. No historical curve has been estimated.</p></div>}
      </article>
      <article className="rep-panel"><h3>Rating distribution</h3><p>Collected sample · {listing.reviews.filter(r=>r.rating!=null).length} rated reviews</p><div className="rep-distribution">{stats.distribution.map(row=><div key={row.stars}><span>{row.stars} <b className="rep-stars">★</b></span><div><i style={{width:`${row.count/Math.max(1,...stats.distribution.map(r=>r.count))*100}%`,background:row.stars>=4?"#56be91":row.stars===3?"#dfa938":"#ed7865"}}/></div><strong>{row.count}</strong></div>)}</div><small>This sample may differ from the full Google rating distribution.</small></article>
    </div>
    <ReviewPatternPanel listing={listing} collectedAt={dataset.collectedAt} report={analysis}/>
    <details className="rep-analysis-options"><summary><Flag size={16}/>AI assessment &amp; collection tools <span>{analysis ? "Assessment saved" : "Analysis not available yet"}</span></summary><ReviewAnalysisPanel datasetId={dataset.id} listing={listing} collectedAt={dataset.collectedAt} onReport={setReport} showReviewKits={false}/><CollectionRefresh listing={listing} onComplete={onCollected}/></details>
    {owned && <section className="rep-panel rep-protection"><div className="rep-panel-title"><div><h3>Profile protection</h3><p>{previous ? `${changes.length} observed field changes since ${date(previous.at)}` : "Collect another snapshot to compare address, category, phone, website, hours and coordinates."}</p></div><NavLink to="/alerts?scope=owned">Open alert inbox <ArrowUpRight size={14}/></NavLink></div>{changes.map(c=><div className="rep-change" key={c.field}><strong>{label(c.field)}</strong><span>{c.before} → {c.after}</span></div>)}<div className="rep-inline">{url&&<a href={url} target="_blank" rel="noreferrer">Check public profile <ArrowUpRight size={13}/></a>}<NavLink to="/settings">Connect Google management access</NavLink></div><small>Verify unexpected changes before editing. An unchanged collected field does not establish that the full profile is secure.</small></section>}
    <section className="rep-triage" id="rep-triage"><div className="rep-panel-title"><div><span className="rep-eyebrow">HUMAN REVIEW</span><h3>{owned ? "Feedback & response queue" : "Review triage queue"} <span>· {reviews.length}</span></h3></div><p>{analysis ? "Sorted by investigation priority" : "Original collected order · no AI scores assigned"}</p></div>
      <div className="rep-toolbar"><div role="group" aria-label="Filter reviews">{[["all","All reviews"],["low",`Low rated · ${stats.low}`],["flagged",`Flagged · ${analysis||patterns.signals.length ? investigate.size : "—"}`],...(owned ? [["unanswered",`No reply collected · ${stats.noReply}`]] : [])].map(([value,text])=><button key={value} aria-pressed={filter===value} onClick={()=>{setFilter(value);setLimit(20);}}>{text}</button>)}</div><input aria-label="Search review text or author" placeholder="Search reviews…" value={search} onChange={e=>{setSearch(e.target.value);setLimit(20);}}/></div>
      {!reviews.length && <div className="rep-panel"><p>{filter==="flagged"&&!analysis ? "Run an AI assessment to populate this filter. Unassessed reviews are not classified as clean or fake." : "No collected reviews match these filters."}</p></div>}
      {reviews.slice(0,limit).map(review=>{const row=finding(review.id);const concern=row&&row.policy!=="none_identified";const patternFlags=patterns.signals.filter(s=>s.reviewIds.includes(review.id));return <article className={`rep-review ${concern ? row.priority : "unassessed"}`} key={review.id}><div className="rep-review-top"><span className="rep-avatar">{review.author.trim().split(/\s+/).slice(0,2).map(s=>s[0]).join("")||"?"}</span><div className="rep-review-main"><strong>{review.author || "Name not collected"}</strong><div className="rep-stars" aria-label={`${review.rating??"Unknown"} out of 5 stars`}>{review.rating==null?"Rating not collected":"★".repeat(Math.max(0,Math.min(5,Math.round(review.rating))))}<span>{review.rating!=null?"★".repeat(5-Math.max(0,Math.min(5,Math.round(review.rating)))):""}</span></div><blockquote>{review.text || "No review text collected."}</blockquote><small>{review.when ?? "Posted date not collected"} · ref {review.id}</small><div className="rep-tags">{patternFlags.map(s=><span key={s.id}><Flag size={12}/>{s.title}</span>)}{concern&&<span><Flag size={12}/>{label(row.policy)}</span>}{review.rating!=null&&review.rating<=2&&<span>Low rating · not evidence of spam</span>}{owned&&<span>{review.reply ? <><Check size={12}/>Owner reply collected</> : "No owner reply in sample"}</span>}</div>{row&&<p className="rep-observation">{row.reasoning}</p>}</div><div className="rep-review-status"><span className={`rep-priority ${concern?row.priority:""}`}>{row ? concern ? `${label(row.priority)} priority` : row.priority==="medium"||row.priority==="high" ? `${label(row.priority)} investigation priority · no policy finding` : "No policy concern identified" : "Not assessed"}</span><small>{row ? "AI observation · verify evidence" : "No fake-review score inferred"}</small></div></div>
        {owned&&review.reply&&<details className="rep-reply"><summary>View collected owner reply</summary><p>{review.reply}</p></details>}{owned&&<ReplyDraft review={review} url={url}/>}
        <ReviewMetadata review={review}/><ReviewReportKit listing={listing} review={review} datasetId={dataset.id} collectedAt={dataset.collectedAt} finding={row} inputHash={analysis?.inputHash}/>
      </article>;})}
      {reviews.length>limit&&<button className="button secondary" onClick={()=>setLimit(n=>n+20)}>Show 20 more reviews</button>}
    </section>
    <div className="rep-chart-grid rep-bottom"><article className="rep-panel"><h3>Flags by policy category</h3><p>Potential concerns in assessed review text</p>{policies.length ? policies.map(([policy,total])=><div className="rep-policy" key={policy}><span>{label(policy)}</span><meter min="0" max={flagged.length} value={total}/><b>{total}</b></div>) : <div className="rep-empty-copy">{analysis ? "No supported policy concerns identified in this assessment." : "Awaiting AI assessment. No policy flags have been inferred from ratings alone."}</div>}<small>{analysis ? `${flagged.length} flagged of ${analysis.analyzedCount} assessed; ${listing.reviews.length} collected.` : "Open AI assessment above to check configuration and run analysis."}</small></article>
      <article className="rep-panel"><div className="rep-panel-title"><h3>Recent evidence activity</h3><NavLink to={`/alerts?scope=${owned?"owned":"competitor"}`}>Alerts <ArrowUpRight size={13}/></NavLink></div>{history.slice(-4).reverse().map(h=><div className="rep-activity" key={h.at}><span className="rep-activity-icon"><Check size={16}/></span><div><strong>Snapshot collected</strong><p>{h.listing.reviews.length} reviews saved · {number(h.listing.reviewCount)} reported</p></div><time>{date(h.at)}</time></div>)}{!history.length&&<p>No dated collection history is available.</p>}<small>Collection events only. Report status is tracked in the <NavLink to="/reports">report queue</NavLink>. Email and Meta WhatsApp delivery are planned.</small></article></div>
  </section>;
}
