import {useEffect,useRef,useState} from "react";
import type {CollectedListing} from "./intelligence-data";
import MonitoringSchedule from "./MonitoringSchedule";
export default function CollectionRefresh({listing,onComplete}:{listing:CollectedListing;onComplete:(datasetId:string)=>void}){
  const [job,setJob]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const callback=useRef(onComplete);callback.current=onComplete;
  const [fallback,setFallback]=useState<string|null>(null);
  useEffect(()=>{let active=true;void fetch("/api/business-search/status").then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{if(active)setFallback(data.fallback?.message??null);}).catch(()=>{});return()=>{active=false;};},[]);
  useEffect(()=>{if(!job)return;let stopped=false;let timer:ReturnType<typeof setTimeout>;let failures=0;
    async function poll(){try{const response=await fetch(`/api/business-search/${job}`);const result=await response.json();if(!response.ok)throw new Error(result.error??"Collection status unavailable");if(stopped)return;failures=0;
      if(result.status==="completed"){setJob(null);setBusy(false);setMessage([result.coverage?.message??"Fresh evidence saved. Coverage may still be partial.",result.fallback?.message].filter(Boolean).join(" "));callback.current(result.dataset.id);return;}
      if(result.status==="failed"){setJob(null);setBusy(false);setMessage(result.error??"Collection failed.");return;}
      if(result.progress)setMessage(result.progress);
    }catch(e){if(stopped)return;if(++failures>=5){setJob(null);setBusy(false);setMessage("Could not read collection status. The server job may still be running; refresh saved datasets later.");return;}}
    if(!stopped)timer=setTimeout(()=>void poll(),3000);}
    void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[job]);
  async function collect(extendedReviews:boolean){setBusy(true);setMessage(extendedReviews?"Collecting extended review evidence. Allow up to twenty minutes; complete coverage is not guaranteed.":"Collecting a fresh public snapshot. Allow up to three minutes.");
    try{const response=await fetch("/api/business-search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({placeId:listing.placeId,refresh:true,extendedReviews})});const result=await response.json();if(!response.ok)throw new Error(result.error??"Collection could not start.");setJob(result.id);}catch(e){setBusy(false);setMessage((e as Error).message);}}
  return <div className="evidence-insights"><div className="reporting-buttons"><button className="button secondary" disabled={busy||!listing.placeId} onClick={()=>void collect(false)}>Collect fresh snapshot</button><button className="button secondary" disabled={busy||!listing.placeId} onClick={()=>void collect(true)}>Collect full review history</button></div><small>Uses the built-in scraper first. Full-history gaps or collection failures can use Outscraper when paid fallback is enabled. A Place ID is required. Use automatic checks below to schedule repeat collections.</small>{fallback&&<p>{fallback}</p>}{message&&<p role="status">{message}</p>}<MonitoringSchedule key={listing.placeId} placeId={listing.placeId}/></div>;
}
