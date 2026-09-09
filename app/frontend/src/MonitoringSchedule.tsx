import {useEffect,useRef,useState} from "react";

interface Schedule {placeId:string;enabled:boolean;intervalHours:number;nextDueAt:string|null;lastStartedAt:string|null;lastFinishedAt:string|null;lastDatasetId:string|null;status:string;lastError:string|null}
interface Status {available:boolean;intervalHours:number|null;schedules:Schedule[];message:string}
const date=(value:string|null)=>value?new Date(value).toLocaleString():"Not checked yet";
export default function MonitoringSchedule({placeId}:{placeId:string|null}){
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  const revision=useRef(0);
  useEffect(()=>{
    let stopped=false;setStatus(null);setError("");
    async function load(){const requestedRevision=revision.current;try{const response=await fetch("/api/monitoring/schedules");const data=await response.json();if(!response.ok||!Array.isArray(data.schedules))throw new Error("Monitoring status is unavailable. Retry by refreshing this page.");if(!stopped&&requestedRevision===revision.current){setStatus(data);setError("");}}catch(e){if(!stopped&&requestedRevision===revision.current)setError((e as Error).message);}}
    void load();const timer=setInterval(()=>void load(),30000);return()=>{stopped=true;clearInterval(timer);};
  },[placeId]);
  const schedule=status?.schedules.find(row=>row.placeId===placeId);
  async function toggle(){revision.current++;setSaving(true);setError("");try{
    const response=await fetch(`/api/monitoring/schedules/${encodeURIComponent(placeId!)}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!schedule?.enabled})});const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not save monitoring settings.");setStatus(data);window.dispatchEvent(new Event("axiocred:refresh"));
  }catch(e){setError((e as Error).message);}finally{revision.current++;setSaving(false);}}
  return <section aria-label="Scheduled monitoring" style={{marginTop:"1.25rem",borderTop:"1px solid #ccdcd5",paddingTop:"1rem"}}>
    <h3>Automatic review and business checks</h3>
    <p>{status?.intervalHours?`Your plan checks every ${status.intervalHours} hours. Business: every 12 hours. Growth: every 6 hours.`:"Business checks every 12 hours; Growth checks every 6 hours."}</p>
    <p>Collect fresh review history and business details, then compare newly observed reviews, reviews not seen again, and profile changes. Partial collections cannot confirm review removals.</p>
    <div className="reporting-buttons"><button className="button secondary" disabled={saving||!placeId||!status||(!schedule?.enabled&&(!status.available||!status.intervalHours))} onClick={()=>void toggle()}>{saving?"Saving…":schedule?.enabled?"Pause automatic checks":`Enable ${status?.intervalHours??"scheduled"}${status?.intervalHours?"-hour":""} checks`}</button><a className="button secondary" href="/alerts">Review changes</a></div>
    {schedule&&<div aria-live="polite"><p><strong>{schedule.enabled?"Monitoring enabled":"Monitoring paused"}</strong>{schedule.status==="running"?" · A check is running. Pausing stops future checks; the current collection may finish.":""}</p><p>Next check: {schedule.enabled&&schedule.nextDueAt?date(schedule.nextDueAt):"Paused"}{schedule.enabled&&schedule.nextDueAt&&Date.parse(schedule.nextDueAt)<Date.now()&&schedule.status!=="running"?" · Due; waiting for the local worker":""}</p><p>Last attempt: {date(schedule.status==="running"?schedule.lastStartedAt:schedule.lastFinishedAt??schedule.lastStartedAt)}{schedule.lastFinishedAt?` · ${schedule.status}`:""}</p>{schedule.lastError&&<p role="alert">{schedule.lastError}</p>}{schedule.lastDatasetId&&<a href={`/evidence?dataset=${encodeURIComponent(schedule.lastDatasetId)}`}>Open last scheduled evidence</a>}</div>}
    <small>{status?.message??"Schedules are saved in MySQL. This PC and the local API must stay running; missed checks resume after restart."} Scheduled checks use only the built-in collector and do not call paid fallback or AI.</small>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
