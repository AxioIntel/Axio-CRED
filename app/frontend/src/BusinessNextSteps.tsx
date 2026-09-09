import {NavLink} from "react-router-dom";
import type {MonitoredEntity} from "./monitoring-activity";

export function businessNextStep(entity:MonitoredEntity){
  const section=entity.owned?"/businesses":"/competitors";
  if(!entity.latest)return {priority:0,label:"Collect a first snapshot",detail:"Link a Google listing and collect its reviews to start.",url:section};
  const {listing,dataset}=entity.latest;
  const url=`/evidence?dataset=${encodeURIComponent(dataset.id)}&listing=${encodeURIComponent(listing.id)}&scope=${entity.owned?"owned":"competitor"}`;
  const withheld=listing.reviews.filter(r=>r.captureIssue).length;
  const usable=listing.reviews.filter(r=>r.text?.trim()&&!r.captureIssue).length;
  if(withheld)return {priority:1,label:"Resolve collection issues",detail:`${withheld} review texts withheld; ${usable} usable texts remain. Inspect the source issue and recollect before relying on those records.`,url};
  if(!listing.reviews.length)return {priority:2,label:"Collect review evidence",detail:"Listing details are saved, but no reviews are available for assessment.",url};
  if(!usable)return {priority:3,label:"Check missing review text",detail:`${listing.reviews.length} review records are saved without usable text. Text-based policy assessment needs more evidence.`,url};
  return {priority:4,label:"Review evidence and assessment",detail:`${usable} usable texts / ${listing.reviews.length} collected records / ${listing.reviewCount??"unknown"} reported reviews. Open analysis to see assessed coverage and any supported concerns.`,url};
}
export default function BusinessNextSteps({entities}:{entities:MonitoredEntity[]}){
  const rows=entities.map(entity=>({entity,step:businessNextStep(entity)})).sort((a,b)=>a.step.priority-b.step.priority);
  return <section className="business-next-steps" aria-labelledby="next-step-title"><div className="mission-section-heading"><div><h2 id="next-step-title">Your next actions</h2><p>Collect → assess → verify → prepare a report when supported.</p></div><NavLink to="/reports">Open report queue</NavLink></div>
    <div className="next-step-grid">{rows.slice(0,4).map(({entity,step})=><article key={entity.key}><small>{entity.owned?"Your business":"Competitor"}</small><h3>{entity.name}</h3><strong>{step.label}</strong><p>{step.detail}</p><NavLink className="button secondary" to={step.url}>{step.label}<span aria-hidden="true"> →</span></NavLink></article>)}</div>
    {rows.length>4&&<p className="mission-footnote">Showing four priorities. All {rows.length} monitored businesses are listed below.</p>}
  </section>;
}
