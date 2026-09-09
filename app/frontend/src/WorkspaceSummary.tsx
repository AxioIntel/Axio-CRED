import {useEffect,useState} from "react";
import {NavLink} from "react-router-dom";
import {ArrowUpRight,Clock3,Layers3,Radar} from "lucide-react";
import {planFrequency} from "./plan-catalog";
import type {Overview} from "./api";
import "./workspace-summary.css";

export default function WorkspaceSummary({entityKey,collectedAt,businessName}:{entityKey?:string;collectedAt?:string|null;businessName?:string}){
  const [usage,setUsage]=useState<Overview|null>(null),[profiles,setProfiles]=useState<{entityKey:string;platform:string;error:string|null;snapshots:unknown[]}[]|null>(null);
  useEffect(()=>{let active=true;const refresh=()=>{
    fetch("/api/overview").then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{if(active)setUsage(data);}).catch(()=>{if(active)setUsage(null);});
    fetch("/api/platform-profiles").then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{if(active)setProfiles(Array.isArray(data.profiles)?data.profiles:null);}).catch(()=>{if(active)setProfiles(null);});
  };refresh();window.addEventListener("axiocred:refresh",refresh);return()=>{active=false;window.removeEventListener("axiocred:refresh",refresh);};},[]);
  const linked=profiles?.filter(p=>p.entityKey===entityKey)??[];
  const timestamp=collectedAt&&Number.isFinite(Date.parse(collectedAt))?new Date(collectedAt):null;
  return <section className="workspace-summary" aria-label="Monitoring summary"><div className="workspace-summary-top"><span><Radar size={17}/> YOUR MONITORING WORKSPACE</span><NavLink to="/">Explore Axio-CRED <ArrowUpRight size={14}/></NavLink></div><div className="workspace-summary-grid"><article><div className="workspace-summary-label"><Radar size={17}/><span>{usage?`${usage.plan} plan`:"Plan usage unavailable"}</span></div><strong>{usage?`${usage.locationsUsed} / ${usage.locationsLimit??"unlimited"}`:"—"}<small> monitored businesses</small></strong>{usage&&<progress aria-label="Monitored business allowance" max={usage.locationsLimit??Math.max(1,usage.locationsUsed)} value={usage.locationsUsed}/>}<p>{usage?planFrequency(usage.plan):"Open Settings to check plan access."}{usage&&<> for changes <span className="workspace-planned">Per-business opt-in</span></>}</p></article><article><div className="workspace-summary-label"><Clock3 size={17}/><span>Latest selected snapshot</span></div><strong className="workspace-summary-date">{timestamp?timestamp.toLocaleDateString(undefined,{day:"numeric",month:"short"}):"Not collected"}{timestamp&&<small> {timestamp.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</small>}</strong><p>{businessName??"Select a collected business below."}</p><small>Enable automatic checks beside the collection controls.</small></article><article><div className="workspace-summary-label"><Layers3 size={17}/><span>Business platforms</span></div><strong className="workspace-summary-date">Google <small>+ Facebook + Trustpilot</small></strong><p>{!entityKey?"Select a Google business to connect its profiles.":profiles===null?"Linked profile status unavailable.":`${linked.length} of 2 additional profiles linked${linked.some(p=>p.error)?" · collection needs attention":""}.`}</p><NavLink to={entityKey?`/platforms?business=${encodeURIComponent(entityKey)}`:"/platforms"}>Manage linked profiles <ArrowUpRight size={14}/></NavLink></article></div></section>;
}
