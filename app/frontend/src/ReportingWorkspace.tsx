import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { downloadData } from "./intelligence-data";
import "./reporting-workspace.css";

interface Member {id:string;email:string;name:string;subject?:string;active:boolean}
interface ReportCase {id:string;business:string;mapsUrl:string|null;datasetId:string;review:{id:string;author:string;text:string|null;when:string|null;rating:number|null};collectedAt:string|null;status:string;assigneeId:string|null;notes:string;policy:string;reference:string;outcome:string;version:number;events:{at:string;actor:string;action:string}[]}
interface Workspace {members:Member[];cases:ReportCase[];actor:{id:string;name:string;owner:boolean;preview:boolean};googleConfigured:boolean;limit:number}
async function request<T>(path:string,method="GET",body?:unknown):Promise<T>{
  const response=await fetch(path,{method,headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw new Error(value.error??"Could not complete the reporting request.");return value;
}
export async function startReportingSignIn(){const result=await request<{redirectUrl:string}>("/api/auth/google/start?purpose=reporting");window.location.assign(result.redirectUrl);}
export default function ReportingWorkspace({settings=false}:{settings?:boolean}){
  const [data,setData]=useState<Workspace|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[email,setEmail]=useState("");
  async function reload(){try{setData(await request<Workspace>("/api/reporting"));setError("");}catch(e){setError((e as Error).message);}}
  useEffect(()=>{void reload();},[]);
  async function act(fn:()=>Promise<unknown>){setBusy(true);setError("");try{await fn();await reload();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="reporting-workspace panel"><header><div><h2>{settings?"Reporting team":"Review reporting queue"}</h2><p>{settings?"Up to 20 authorized people. Each signs in using their own Google identity.":"Prepare evidence, assign a case, approve it, then record your manual submission."}</p></div>{!settings&&<NavLink to="/settings">Manage team</NavLink>}</header>
    {error&&<p className="error-box" role="alert">{error}</p>}
    {!data&&<button className="button secondary" onClick={()=>void startReportingSignIn().catch(e=>setError(e.message))}>Sign in to reporting with Google</button>}
    {data&&<><p className="reporting-mode">{data.actor.preview?"Local preview operator · team identities are not Google-verified until they sign in.":`Signed in as ${data.actor.name}`}</p>
    {settings?<><div className="reporting-team-actions"><strong>{data.members.filter(m=>m.active).length} / {data.limit} seats authorized</strong><button className="button secondary" onClick={()=>void startReportingSignIn().catch(e=>setError(e.message))}>Connect my Google identity</button>{!data.actor.preview&&<button className="text-button" onClick={()=>void act(async()=>{await request("/api/reporting/signout","POST",{});setData(null);})}>Sign out</button>}</div>
      <p>Sign-in requests your name, email and Google account identifier. It does not request Gmail access or submit Maps complaints.</p>
      {!data.googleConfigured&&<p className="reporting-mode">Google OAuth credentials and the reporting owner email still need backend configuration. Local case management is available now.</p>}
      {data.actor.owner&&<form className="reporting-add-member" onSubmit={e=>{e.preventDefault();void act(async()=>{await request("/api/reporting/members","POST",{email});setEmail("");});}}><label>Authorize team email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="colleague@business.com"/></label><button className="button" disabled={busy||data.members.filter(m=>m.active).length>=20}>Authorize member</button></form>}
      <small>Authorizing an email reserves a seat; no invitation email is sent. Ask the person to open Settings and sign in.</small>
      <ul className="reporting-members">{data.members.filter(m=>m.active).map(member=><li key={member.id}><div><strong>{member.email}</strong><small>{member.subject?"Google identity verified":"Awaiting Google sign-in"}</small></div>{data.actor.owner&&<button className="text-button" disabled={busy} onClick={()=>void act(()=>request(`/api/reporting/members/${member.id}`,"DELETE",{}))}>Revoke access</button>}</li>)}</ul></>:
      <>{!data.cases.length&&<p>No review cases yet. Open a review’s Report kit and choose <b>Add to reporting queue</b>.</p>}
      {data.cases.map(item=><CaseEditor key={item.id+":"+item.version} item={item} members={data.members} actor={data.actor} saved={reload}/>)}</>}
    </>}
  </section>;
}
function CaseEditor({item,members,actor,saved}:{item:ReportCase;members:Member[];actor:Workspace["actor"];saved:()=>Promise<void>}){
  const [form,setForm]=useState({assigneeId:item.assigneeId,notes:item.notes,policy:item.policy,reference:item.reference,outcome:item.outcome}),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const editable=item.status!=="closed"&&(actor.owner||actor.id===item.assigneeId);
  async function save(action:string){setBusy(true);setError("");try{await request(`/api/reporting/cases/${item.id}`,"PATCH",{...form,version:item.version,action,confirmed});await saved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <details className="reporting-case"><summary><span><strong>{item.business}</strong> · {item.review.author}</span><b>{item.status}</b></summary><p>{item.review.rating??"Unknown"} / 5 · Posted: {item.review.when??"Not collected"}</p><blockquote>{item.review.text??"No text collected"}</blockquote><small>Collected: {item.collectedAt??"Unknown"} · Reference: {item.review.id}</small>
    <fieldset disabled={!editable||busy}><label>Assigned team member<select value={form.assigneeId??""} disabled={!actor.owner||item.status==="submitted"} onChange={e=>setForm({...form,assigneeId:e.target.value||null})}><option value="">Unassigned</option>{members.filter(m=>m.active||m.id===item.assigneeId).map(m=><option value={m.id} key={m.id}>{m.email}{!m.active?" (revoked)":""}</option>)}</select></label>
      <label>Policy reason<input value={form.policy} readOnly={item.status==="submitted"} onChange={e=>setForm({...form,policy:e.target.value})} placeholder="Specific Google policy you have verified"/></label>
      <label>Verified evidence / report draft<textarea rows={4} value={form.notes} readOnly={item.status==="submitted"} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
      <label>Submission reference or dated confirmation<input value={form.reference} onChange={e=>setForm({...form,reference:e.target.value})} placeholder="Case reference, or date and details of your manual submission"/></label>
      <label>Outcome / closure reason<textarea rows={2} value={form.outcome} onChange={e=>setForm({...form,outcome:e.target.value})} placeholder="Pending, retained, removed, appeal outcome, or no supported violation"/></label>
      {item.status!=="submitted"&&<label className="reporting-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{item.status==="approved"?"I submitted this report myself through Google.":"I checked the original review and the evidence supports this policy reason."}</label>}
      <div className="reporting-buttons"><button className="button secondary" onClick={()=>void save("save")}>Save draft / outcome</button>{item.status==="draft"&&<button className="button" disabled={!confirmed} onClick={()=>void save("approve")}>Approve case</button>}{item.status==="approved"&&<button className="button" disabled={!confirmed} onClick={()=>void save("submit")}>Record manual submission</button>}<button className="text-button" onClick={()=>void save("close")}>Close case</button></div>
    </fieldset>
    {error&&<p className="error-box" role="alert">{error}</p>}
    <div className="reporting-buttons">{item.mapsUrl&&/^https:\/\/(www\.)?google\.com\//.test(item.mapsUrl)&&<a href={item.mapsUrl} target="_blank" rel="noreferrer">Open business in Google Maps</a>}<button className="text-button" onClick={()=>downloadData(`axiocred-case-${item.id}.json`,item)}>Download saved evidence and history</button></div>
    <ol>{item.events.map((event,i)=><li key={i}><small>{new Date(event.at).toLocaleString()} · {event.actor} · {event.action}</small></li>)}</ol>
    <small>Opening Maps does not mark this case submitted. Submission and outcome entries are user-recorded, not confirmed by Google.</small>
  </details>;
}
