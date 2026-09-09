import ReputationDashboard from "./ReputationDashboard";
import EvidenceInsights from "./EvidenceInsights";
import { useEffect, useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";
import { ArrowDownUp, ArrowUpRight, Building2, Link2, Plus, Radar, RefreshCw, Trash2, X } from "lucide-react";
import type { CollectedListing, Dataset } from "./intelligence-data";
import "./competitors.css";

import { BusinessPicker } from "./BusinessesWorkspace";

interface Target { id: string; name: string; mapsUrl: string|null; listingKey: string|null }
interface Watchlist { baselineKey: string|null; targets: Target[] }
interface RecordEntry { key: string; listing: CollectedListing; dataset: Dataset }
const count = (value: number|null|undefined) => value == null ? "—" : value.toLocaleString();
const timestamp = (value: string|null) => value ? new Date(value).toLocaleString() : "Collection time unknown";
const difference = (value: number|undefined|null, base: number|undefined|null) => value == null || base == null ? "—" : `${value-base>0?"+":""}${Number((value-base).toFixed(1))}`;
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load competitor workspace.");
  return result;
}
export function comparisonRecords(datasets: Dataset[]): RecordEntry[] {
  const records = new Map<string, RecordEntry>();
  for (const dataset of [...datasets].sort((a,b)=>Date.parse(b.collectedAt??b.importedAt)-Date.parse(a.collectedAt??a.importedAt))) {
    if (dataset.source === "illustrative") continue;
    for (const listing of dataset.listings) {
      const key = listing.placeId ? `place:${listing.placeId}` : listing.cid ? `cid:${listing.cid}` : `import:${dataset.id}:${listing.id}`;
      if (!records.has(key)) records.set(key, { key, listing, dataset });
    }
  }
  return [...records.values()];
}

export default function CompetitorWorkspace() {
  const [datasets,setDatasets]=useState<Dataset[]>([]);
  const [records,setRecords] = useState<RecordEntry[]>([]);
  const [watch,setWatch] = useState<Watchlist>({baselineKey:null,targets:[]});
  const [loaded,setLoaded] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [finding,setFinding]=useState(false);
  const [adding,setAdding] = useState(false), [mode,setMode] = useState("link"), [query,setQuery] = useState("");
  const [selected,setSelected] = useState<string|null>(null), [notice,setNotice] = useState("");
  async function load() {
    setBusy(true);
    try {
      const [datasets, config] = await Promise.all([request<Dataset[]>("/api/intelligence/imports"),request<Watchlist>("/api/competitor-workspace")]);
      setDatasets(datasets);setRecords(comparisonRecords(datasets)); setWatch(config);setSelected(current=>config.targets.some(t=>t.id===current)?current:config.targets[0]?.id??null);window.dispatchEvent(new Event("axiocred:refresh")); setError(""); setLoaded(true);
    } catch(e) { setError(e instanceof Error?e.message:"Unable to load workspace."); }
    finally { setBusy(false); }
  }
  useEffect(()=>{ void load(); },[]);
  async function save(next: Watchlist) {
    setBusy(true); setError(""); setNotice("");
    try { setWatch(await request<Watchlist>("/api/competitor-workspace",next));window.dispatchEvent(new Event("axiocred:refresh")); return true; }
    catch(e) { setError(e instanceof Error?e.message:"Could not save changes."); return false; }
    finally { setBusy(false); }
  }
  const baseline = records.find(r=>r.key===watch.baselineKey);
  const candidates = records.filter(r=>r.key!==watch.baselineKey && !watch.targets.some(t=>t.listingKey===r.key));
  const inspected = watch.targets.find(t=>t.id===selected);
  const evidence = records.find(r=>r.key===inspected?.listingKey);
  const visible = watch.targets.filter(t=>t.name.toLowerCase().includes(query.toLowerCase()));
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const record = candidates.find(r=>r.key===form.get("listing"));
    const target:Target = mode==="collected" && record ? {id:crypto.randomUUID(),name:record.listing.name,mapsUrl:record.listing.mapsUrl,listingKey:record.key} : {id:crypto.randomUUID(),name:String(form.get("name")??"").trim(),mapsUrl:String(form.get("url")??"").trim(),listingKey:null};
    if (await save({...watch,targets:[...watch.targets,target]})) {
      setAdding(false); setSelected(target.id); setNotice(target.listingKey?"Collected listing added to your comparison set.":"Competitor link saved. Collection has not started.");
    }
  }
  return <div className="rivals-page">
    <div className="rivals-heading"><div><span className="rivals-eyebrow">YOUR LOCAL MARKET</span><h1>Competitor watchlist</h1><p>Add a competitor, inspect its reviews, then check observed changes or prepare a report.</p></div><div className="rivals-actions"><button className="button secondary" disabled={busy} onClick={()=>void load()} aria-label="Refresh competitor workspace"><RefreshCw size={16}/></button><button className="button" disabled={!loaded||busy} onClick={()=>setFinding(true)}><Plus size={17}/>Add competitor</button></div></div>
    {error&&<div className="error-box" role="alert">{error}</div>}{notice&&<div className="notice" role="status">{notice}</div>}
    {watch.targets.length>0&&<label className="rep-dashboard-picker">View competitor<select aria-label="View competitor dashboard" value={selected??""} onChange={e=>setSelected(e.target.value)}><option value="" disabled>Select a competitor</option>{watch.targets.map(target=><option key={target.id} value={target.id}>{target.name}</option>)}</select></label>}
    {evidence&&<ReputationDashboard key={evidence.dataset.id+evidence.listing.id} listing={evidence.listing} dataset={evidence.dataset} datasets={datasets} onCollected={()=>void load()}/>}
    <details className="rep-managed-list" open={!watch.targets.length}><summary>Manage watchlist &amp; comparison reference</summary>
    <details className="rivals-baseline-disclosure"><summary>Optional: compare against another business</summary><section className="rivals-baseline" aria-label="Optional business comparison baseline">
      <div className="rivals-owner"><Building2 size={23}/><div><span>OPTIONAL COMPARISON REFERENCE</span><h2>{baseline?.listing.name??"Choose a reference business"}</h2><p>{baseline?.listing.address??"You can monitor competitors without owning a business. Select a reference only if you want comparisons."}</p><label>Compare against<select aria-label="Comparison baseline" disabled={!loaded||busy} value={watch.baselineKey??""} onChange={e=>void save({...watch,baselineKey:e.target.value||null})}><option value="">No comparison reference</option>{records.filter(r=>!watch.targets.some(t=>t.listingKey===r.key)).map(r=><option key={r.key} value={r.key}>{r.listing.name} · {r.dataset.label}</option>)}</select></label></div></div>
      <div className="rivals-baseline-numbers"><div><span>Google rating</span><strong>{count(baseline?.listing.rating)}</strong></div><div><span>Reported reviews</span><strong>{count(baseline?.listing.reviewCount)}</strong></div><div><span>Reviews collected</span><strong>{baseline?count(baseline.listing.reviews.length):"—"}</strong></div><p>{baseline?timestamp(baseline.dataset.collectedAt):"No baseline selected"}</p></div>
    </section>
    </details><button className="text-button" onClick={()=>setAdding(v=>!v)}>Advanced: save a Maps link or link existing evidence</button>
    {adding&&<section className="rivals-add" aria-label="Add competitor"><div className="rivals-section-head"><h2>Add to your watchlist</h2><button className="icon-button" aria-label="Close add competitor" onClick={()=>setAdding(false)}><X size={18}/></button></div><button className="button secondary" disabled={busy} onClick={()=>setFinding(true)}>Find by Place ID or name</button><div className="rivals-modes"><button type="button" aria-pressed={mode==="link"} onClick={()=>setMode("link")}>Google Maps link</button><button type="button" aria-pressed={mode==="collected"} onClick={()=>setMode("collected")}>Collected listing</button></div><form onSubmit={add}>
      {mode==="link"?<><label>Business name<input name="name" required minLength={2} maxLength={255} placeholder="Competitor business name"/></label><label>Google Maps or share link<input name="url" type="url" required maxLength={3000} placeholder="https://share.google/…"/></label><p>Save the listing for collection. Adding a link does not run a scrape or start scheduled monitoring.</p></>:<><label>Collected competitor<select name="listing" required defaultValue=""><option value="">Choose a listing</option>{candidates.map(r=><option key={r.key} value={r.key}>{r.listing.name} · {r.dataset.label}</option>)}</select></label><p>Select only a listing you want to compare. Other imported businesses stay outside your watchlist.</p></>}
      <button className="button" disabled={busy||(mode==="collected"&&!candidates.length)}>{busy?"Saving…":"Save competitor"}</button>
    </form></section>}
    <section className="rivals-list"><div className="rivals-section-head"><div><h2>Your comparison set <span>{watch.targets.length}</span></h2><p>Latest loaded snapshots. No fraud score or ranking is inferred.</p></div>{watch.targets.length>0&&<label className="rivals-search"><span className="sr-only">Search competitors</span><input aria-label="Search competitors" placeholder="Search competitors…" value={query} onChange={e=>setQuery(e.target.value)}/></label>}</div>
      {!loaded?<div className="rivals-empty"><p>{error?"The watchlist could not be loaded. Use refresh to retry.":"Loading your saved watchlist…"}</p></div>:!watch.targets.length?<div className="rivals-empty"><div className="rivals-empty-mark"><Radar size={38}/></div><h3>Your competitors belong here</h3><p>Add the Google Maps links you want to compare with {baseline?.listing.name??"your business"}. Your own profile and unrelated imports won’t appear as competitors.</p><button className="button secondary" disabled={busy} onClick={()=>setFinding(true)}><Plus size={16}/>Add your first competitor</button><div className="rivals-empty-steps"><span><b>01</b> Save a listing</span><span><b>02</b> Link collected evidence</span><span><b>03</b> Compare with your baseline</span></div></div>:<div className="rivals-table-wrap"><table><thead><tr><th>Competitor</th><th>Rating</th><th>Reported reviews</th><th>Collected</th><th>Rating gap</th><th>Evidence status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map(target=>{
        const record=records.find(r=>r.key===target.listingKey); const listing=record?.listing;
        return <tr key={target.id} className={selected===target.id?"rivals-selected":""}><td><button className="rivals-name" onClick={()=>setSelected(target.id)}>{target.name}</button><small>{listing?.address??"Google Maps link saved"}</small></td><td>{count(listing?.rating)}</td><td>{count(listing?.reviewCount)}</td><td>{listing?count(listing.reviews.length):"—"}</td><td>{difference(listing?.rating,baseline?.listing.rating)}</td><td><span className={`rivals-status ${listing?"collected":"pending"}`}>{!listing?"Awaiting collection":listing.reviewCount!=null&&listing.reviews.length<listing.reviewCount?"Partial review sample":"Snapshot available"}</span><small>{record?timestamp(record.dataset.collectedAt):"No collection job started"}</small></td><td><button className="text-button" onClick={()=>setSelected(target.id)}>Inspect <ArrowUpRight size={14}/></button><button className="icon-button" disabled={busy} aria-label={`Remove ${target.name}`} onClick={async()=>{if(await save({...watch,targets:watch.targets.filter(t=>t.id!==target.id)})){setSelected(null);setNotice("Competitor removed from watchlist. Imported evidence was retained.")}}}><Trash2 size={15}/></button></td></tr>;
      })}</tbody></table>{!visible.length&&<p className="rivals-no-results">No competitors match your search.</p>}</div>}
    </section>
    {inspected&&<section className="rivals-detail"><div className="rivals-section-head"><div><span className="rivals-eyebrow">COMPARISON DETAIL</span><h2>{inspected.name}</h2></div><button className="icon-button" aria-label="Close competitor details" onClick={()=>setSelected(null)}><X size={18}/></button></div>
      <div className="rivals-detail-links">{inspected.listingKey&&/^(place:|cid:)/.test(inspected.listingKey)&&<NavLink to={`/platforms?business=${encodeURIComponent(inspected.listingKey)}`}>Facebook &amp; Trustpilot profiles <ArrowUpRight size={15}/></NavLink>}{inspected.mapsUrl&&<a href={inspected.mapsUrl} target="_blank" rel="noreferrer"><Link2 size={15}/>Open Google listing</a>}{evidence&&<NavLink to={`/evidence?scope=competitor&dataset=${encodeURIComponent(evidence.dataset.id)}&listing=${encodeURIComponent(evidence.listing.id)}`}>View collected reviews <ArrowUpRight size={15}/></NavLink>}</div>
      {!evidence?<div className="rivals-pending"><h3>Ready for collection</h3><p>This link is saved. Once its scraper output is imported, link the matching listing below.</p><label>Link collected evidence<select aria-label="Link collected evidence" disabled={busy} value="" onChange={e=>{const record=candidates.find(r=>r.key===e.target.value);if(record)void save({...watch,targets:watch.targets.map(t=>t.id===inspected.id?{...t,listingKey:record.key}:t)})}}><option value="">Choose matching business</option>{candidates.map(r=><option key={r.key} value={r.key}>{r.listing.name} · {r.listing.address}</option>)}</select></label><small>Check the business identity and address before linking.</small></div>:<><div className="rivals-comparison"><ArrowDownUp size={21}/><div><span>Rating difference</span><strong>{difference(evidence.listing.rating,baseline?.listing.rating)}</strong></div><div><span>Reported review-count difference</span><strong>{difference(evidence.listing.reviewCount,baseline?.listing.reviewCount)}</strong></div><div><span>Review activity over time</span><strong className="rivals-unavailable">See saved history below</strong></div></div><p>Differences compare the selected snapshots, not review growth. Review velocity requires comparable collections over time.</p><div className="rivals-dates"><span>Your business: {baseline?timestamp(baseline.dataset.collectedAt):"Not selected"}</span><span>Competitor: {timestamp(evidence.dataset.collectedAt)}</span></div></>}
    </section>}
    </details>
    {evidence&&<details className="rep-managed-list"><summary>Explore profile history &amp; shared evidence</summary><EvidenceInsights listing={evidence.listing} datasets={datasets}/></details>}
    {finding&&<BusinessPicker purpose="competitor" close={()=>setFinding(false)} added={()=>{void load();setAdding(false);setNotice("Competitor saved to your watchlist.")}}/>}
    <footer className="rivals-footer"><span>Watchlist saved to the local workspace.</span><NavLink to="/evidence?scope=competitor">Open review library <ArrowUpRight size={14}/></NavLink></footer>
  </div>;
}
