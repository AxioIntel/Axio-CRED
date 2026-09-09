import { useId, useState } from "react";
import { ChevronDown, Copy, Download, ExternalLink, Flag, Info } from "lucide-react";
import type { CollectedListing, CollectedReview } from "./intelligence-data";
import "./review-report-kit.css";

export interface ReviewFinding {
  reviewRef: string; priority: string; policy: string; reasoning: string;
  alternativeExplanation: string; evidence: {reviewRef: string; quote: string}[]; nextStep: string;
}
const policyUrl = "https://support.google.com/contributionpolicy/answer/7400114?hl=en";
const instructionsUrl = "https://support.google.com/contributionpolicy/answer/7445749";
const label = (value: string) => value.replaceAll("_", " ");
export function mapsListingUrl(listing: CollectedListing): string | null {
  try {
    const url = new URL(listing.mapsUrl ?? "");
    if (url.protocol === "https:" && (url.hostname === "google.com" || url.hostname.endsWith(".google.com"))) return url.href;
  } catch { /* Use a collected identifier when a Maps URL is unavailable. */ }
  if (listing.placeId) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(listing.name)}&query_place_id=${encodeURIComponent(listing.placeId)}`;
  if (listing.cid && /^\d+$/.test(listing.cid)) return `https://www.google.com/maps?cid=${listing.cid}`;
  return null;
}

export default function ReviewReportKit({listing, review, datasetId, collectedAt, finding, inputHash}: {
  listing: CollectedListing; review: CollectedReview; datasetId: string;
  collectedAt?: string | null; finding?: ReviewFinding; inputHash?: string;
}) {
  const id = useId();
  const [notes, setNotes] = useState("");
  const [infoOpen,setInfoOpen]=useState(false),[queueBusy,setQueueBusy]=useState(false),[queued,setQueued]=useState(false);
  const [feedback, setFeedback] = useState("");
  const mapsUrl = mapsListingUrl(listing);
  const concern = finding && finding.policy !== "none_identified";
  const assessment = finding
    ? `AI observation (verify before reporting): ${finding.reasoning}\nSuggested policy: ${label(finding.policy)}\nAlternative explanation: ${finding.alternativeExplanation}\nNext step: ${finding.nextStep}`
    : "No AI assessment is available for this review. Verify a specific policy violation before reporting.";
  const locator = [
    ["Business", listing.name], ["Address", listing.address], ["Place ID", listing.placeId],
    ["Collected review reference", review.id], ["Reviewer", review.author],
    ["Rating", review.rating == null ? null : `${review.rating} / 5`],
    ["Posted (source value)", review.when], ["Collected at", collectedAt],
    ["Source", review.source], ["Dataset", datasetId]
  ];
  function draft() {
    return ["Axio-CRED — review investigation draft", ...locator.map(([key, value]) => `${key}: ${value || "Not collected"}`),
      `Listing URL: ${mapsUrl ?? "Not collected"}`, `Reviewer profile: ${review.authorUrl ?? "Not collected"}`,
      "The collected reference may be a local fingerprint; match the author, date and text in Google Maps.",
      `Original collected review:\n${review.text ?? "No text collected."}`, review.reply ? `Owner reply:\n${review.reply}` : "",
      assessment, ...(finding?.evidence ?? []).map(e => `Supporting quote [${e.reviewRef}]: ${e.quote}`),
      `Your verified evidence / proposed report:\n${notes || "Not added"}`,
      inputHash ? `Analysis input digest: ${inputHash}` : "", `Google policy: ${policyUrl}`, `Reporting steps: ${instructionsUrl}`,
      "Draft only. AI observations are not proof of fake engagement. No report has been submitted by Axio-CRED."
    ].filter(Boolean).join("\n\n");
  }
  async function addToQueue() {
    setQueueBusy(true);setFeedback("");
    try{const response=await fetch("/api/reporting/cases",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({datasetId,listingId:listing.id,reviewId:review.id,notes:[notes,finding?assessment:""].filter(Boolean).join("\n\n")})});const result=await response.json();if(!response.ok)throw new Error(result.error??"Could not add this review to the queue.");setQueued(true);setFeedback(result.duplicate?"This review already has a case. Open Reports to continue; its existing evidence was preserved.":"Case added. Open Reports to assign and verify it.");}
    catch(e){setFeedback((e as Error).message);}finally{setQueueBusy(false);}
  }
  async function copy() {
    try { await navigator.clipboard.writeText(draft()); setFeedback("Report draft copied."); }
    catch { setFeedback("Clipboard unavailable. Download the draft instead."); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([draft()], {type: "text/plain;charset=utf-8"}));
    const a = document.createElement("a"); a.href = url; a.download = `axiocred-review-${review.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50) || "report"}.txt`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setFeedback("Report draft downloaded.");
  }
  return <details className="review-report-kit">
    <summary aria-label={`Report kit for ${review.author}`}><Flag size={14}/> Report kit <ChevronDown className="kit-chevron" size={14}/></summary>
    <div className="kit-body">
      <div className="kit-columns"><section><h4>Assisted report · you submit it</h4>
        <ol><li>Open this business in Google Maps and select Reviews.</li><li>Match the reviewer, date and original text using the locator.</li><li>Verify the evidence, then use the review’s menu → Report review and choose the applicable reason.</li></ol>
        <p>{concern ? `Suggested policy to check: ${label(finding.policy)}. Confirm that it applies to the original review.` : "No supported reporting reason has been established. A low rating or positive wording alone is not evidence of a violation."}</p>
        {mapsUrl ? <a className="button secondary" href={mapsUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/>Open business in Google Maps</a> : <p>The Maps link and listing identifiers were not collected. Locate the business manually using its name and address.</p>}
        <div className="kit-auto-row"><button className="button secondary" disabled>Auto add · Coming soon</button><button className="kit-info-button" aria-label="About Auto add" aria-expanded={infoOpen} aria-controls={id+"-auto-info"} onClick={()=>setInfoOpen(!infoOpen)}><Info size={17}/></button></div>
        {infoOpen&&<p id={id+"-auto-info"} className="kit-auto-info">Planned: automatically add reviews selected for investigation to your reporting queue, attach collected evidence and an AI draft when available, and route the case to an authorized team member. A person will verify the evidence and submit through Google. It will not switch Google accounts or submit complaints automatically. This feature is not active yet.</p>}
        <p className="kit-note">Use the public Maps route for a competitor. The Reviews Management Tool is for profiles you manage. Nothing is submitted from this panel.</p>
      </section><section><h4>Review locator</h4><dl>{locator.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value || "Not collected"}</dd></div>)}</dl><small>The reference may be a local fingerprint, not a Google review ID. Date text is preserved as collected.</small></section></div>
      <section><h4>Original collected review</h4><blockquote>{review.text ?? "No text collected."}</blockquote>
        {finding && <div className="kit-assessment"><p><b>AI observation:</b> {finding.reasoning}</p><p><b>Alternative explanation:</b> {finding.alternativeExplanation}</p>{finding.evidence.map((e,index) => <blockquote key={index}>{e.quote}<small>Analysis source: {e.reviewRef}</small></blockquote>)}<p><b>Next step:</b> {finding.nextStep}</p></div>}
        <label htmlFor={`${id}-notes`}>Your verified evidence / report draft</label>
        <textarea id={`${id}-notes`} value={notes} onChange={event => {setNotes(event.target.value);setFeedback("");}} rows={4} placeholder="Describe the specific policy concern and add corroborating facts or evidence references."/>
        <small>Copy or download to keep your edits before leaving this review.</small>
      </section>
      <div className="kit-actions"><button className="button" disabled={queueBusy||queued} onClick={()=>void addToQueue()}>{queueBusy?"Adding…":queued?"Case ready in Reports":"Add to reporting queue"}</button><a href="/reports">Open Reports</a><button className="button secondary" onClick={() => void copy()}><Copy size={14}/>Copy report draft</button><button className="button secondary" onClick={download}><Download size={14}/>Download report kit</button><a href={policyUrl} target="_blank" rel="noreferrer">Google policy</a><a href={instructionsUrl} target="_blank" rel="noreferrer">Reporting instructions</a></div>
      <details className="kit-escalation"><summary>Extortion or an appeal needs a different evidence packet</summary><p>For an extortion attempt against your own business, preserve the dated demand, sender details, review links, business identity and your relationship to the business. A low rating or refund request alone does not establish extortion. <a href="https://support.google.com/business/answer/16404809?hl=en" target="_blank" rel="noreferrer">Google’s merchant extortion reporting guidance</a></p><p>For an appeal, retain the original case ID, decision, review reference, chronological timeline and specific policy evidence. Add these to the case notes in Reports. Restoration and escalation are not guaranteed.</p></details>
      {feedback && <p role="status">{feedback}</p>}
    </div>
  </details>;
}
