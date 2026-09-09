import type {CollectedListing,CollectedReview} from "./intelligence-data";
export function CollectionQuality({listing}:{listing:CollectedListing}) {
  const rows=listing.reviews;
  const exact=rows.filter(r=>r.datePrecision==="timestamp"||r.publishedAt).length;
  return <details className="rep-analysis-options"><summary>Evidence coverage · {rows.length.toLocaleString()} collected reviews</summary>
    <p>Fields are shown only when collected. Missing dates, replies or photos do not indicate misconduct.</p>
    <dl className="mine-facts">{[
      ["Exact timestamps",`${exact} / ${rows.length}`],
      ["Displayed or relative dates",`${rows.filter(r=>r.when&&!r.publishedAt&&r.datePrecision!=="timestamp").length}`],
      ["Reviewer profile links",`${rows.filter(r=>r.authorUrl).length}`],
      ["Owner replies collected",`${rows.filter(r=>r.reply).length}`],
      ["Reviews with photo links",`${rows.filter(r=>r.images?.length).length}`],
      ["Ratings without collected text",`${rows.filter(r=>!r.text&&r.rating!==null).length}`],
      ["Review texts withheld for capture issues",`${rows.filter(r=>r.captureIssue).length}`],
      ["All collected categories",listing.categories?.join(", ")||listing.category||"Not collected"],
      ["Plus code",listing.plusCode||"Not collected"],
      ["Structured address",(listing.structuredAddress?Object.values(listing.structuredAddress).filter(Boolean).join(", "):"")||"Not collected"],
      ["Public attributes",listing.attributes?.flatMap(group=>group.options.map(option=>`${option.name??group.name}: ${option.enabled?"Yes":"No"}${option.values?.length?` (${option.values.join(", ")})`:""}`)).join("; ")||"Not collected"]
    ].map(([title,value])=><div key={title}><dt>{title}</dt><dd>{value}</dd></div>)}</dl>
    <small>Relative dates are preserved as displayed, never converted into invented exact timestamps. Older saved datasets may need recollection to populate these fields.</small>
  </details>;
}
export function ReviewMetadata({review}:{review:CollectedReview}) {
  if(!review.captureIssue&&!review.publishedAt&&!review.updatedAt&&!review.replyPublishedAt&&!review.language&&!review.images?.length)return null;
  return <details className="rep-reply"><summary>Collected review metadata</summary>
    {review.captureIssue&&<p>{review.captureIssue}</p>}
    {review.publishedAt&&<p>Published: {review.publishedAt}</p>}{review.updatedAt&&<p>Updated: {review.updatedAt}</p>}
    {review.replyPublishedAt&&<p>Owner reply posted: {review.replyPublishedAt}</p>}{review.language&&<p>Original language: {review.language}</p>}
    {!!review.images?.length&&<div className="rep-inline">{review.images.map((url,i)=><a key={url} href={url} target="_blank" rel="noreferrer">Review photo {i+1}</a>)}</div>}
  </details>;
}
