import {useEffect,useState} from "react";
import {NavLink} from "react-router-dom";
import {api,type Overview} from "./api";
import {productPlan} from "../../backend/src/product-plan";
import {planFrequency} from "./plan-catalog";
import ReportingWorkspace from "./ReportingWorkspace";
import "./settings-workspace.css";

type Connections=Awaited<ReturnType<typeof api.integrations>>;
function Service({name,status,children}:{name:string;status:string;children:React.ReactNode}){
  return <article className="service-card"><div><h3>{name}</h3><span className="service-status">{status}</span></div><p>{children}</p></article>;
}
export default function SettingsWorkspace(){
  const [data,setData]=useState<Connections>(),[overview,setOverview]=useState<Overview>(),[collector,setCollector]=useState(false);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[billingPlan,setBillingPlan]=useState<"business"|"growth">("business"),[paying,setPaying]=useState(false);
  async function load(){try{
    const [connections,summary,status]=await Promise.all([api.integrations(),api.overview(),fetch("/api/business-search/status").then(async r=>{if(!r.ok)throw new Error("Collection status could not be loaded.");return r.json();})]);
    setData(connections);setOverview(summary);setCollector(status.available);setBillingPlan(summary.plan.toLowerCase()==="growth"?"growth":"business");setError("");
  }catch(e){setError((e as Error).message);}}
  useEffect(()=>{void load();},[]);
  async function billing(){setPaying(true);try{const result=await api.subscribe(billingPlan);if(result.approvalUrl)window.location.assign(result.approvalUrl);else setNotice("No payment was started. Checkout is in preview mode.");}catch(e){setNotice((e as Error).message);}finally{setPaying(false);}}
  async function google(){try{const r=await fetch("/api/auth/google/start?purpose=business");const result=await r.json();if(!r.ok||result.error)throw new Error(result.error??"Google connection could not start.");if(result.mode==="demo")setNotice("Google Business Profile connection needs provider credentials. You can still monitor public listings.");else window.location.assign(result.redirectUrl);}catch(e){setNotice((e as Error).message);}}
  const plan=overview?productPlan(overview.plan):null;
  return <div className="settings-workspace"><header><span className="mission-eyebrow">WORKSPACE & CONNECTIONS</span><h1>Settings</h1><p>See what powers your monitoring, what is ready, and what still needs setup.</p></header>
    {error&&<div className="error-box" role="alert">{error} <button className="text-button" onClick={()=>void load()}>Retry settings</button></div>}
    {notice&&<div className="notice" role="status">{notice}</div>}
    {!data&&!error&&<p role="status">Loading workspace settings…</p>}
    {data&&plan&&overview&&<><section className="panel settings-plan"><div><span className="mission-eyebrow">CURRENT WORKSPACE ALLOWANCE</span><h2>{plan.name}</h2><p><strong>{overview.locationsUsed} / {overview.locationsLimit??"unlimited"}</strong> business slots used</p><p>Any mix of your businesses and competitors. Google, Facebook and Trustpilot profiles for the same business share one slot.</p><small>This local allowance is not confirmation of a paid subscription.</small></div><div><h3>Plan and billing</h3><label>Choose a checkout plan<select aria-label="PayPal checkout plan" value={billingPlan} onChange={e=>setBillingPlan(e.target.value as "business"|"growth")}><option value="business">Business · $49/month · 1 business</option><option value="growth">Growth · $149/month · 5 businesses</option></select></label><p>{planFrequency(billingPlan)} is the plan cadence. Local automatic checks can be enabled per business.</p><button className="button secondary" disabled={!data.paypal?.configured||paying} onClick={()=>void billing()}>{paying?"Preparing checkout…":"Start PayPal checkout"}</button>{!data.paypal?.configured&&<p>Checkout unavailable. Complete PayPal setup before taking payments.</p>}</div></section>
    <section aria-labelledby="services-heading"><h2 id="services-heading">Collection and analysis</h2><div className="service-grid">
      <Service name="Native Google collection" status={collector?"Available on demand":"Unavailable"}>Collect public listing details and reviews from a Place ID. Check coverage and source issues before analysis. <NavLink to="/competitors">Open monitored competitors</NavLink></Service>
      <Service name="AI review analysis" status={data.analysis?.configured?"Configured":"Needs setup"}>{data.analysis?.configured?`Model: ${data.analysis.model}. Configuration is present; an assessment must finish before findings are available.`:"Configure the analysis provider to assess collected review evidence."} AI suggestions require human review.</Service>
      <Service name="Outscraper fallback" status={data.outscraper?.ready?"Available":data.outscraper?.enabled?"Blocked":"Disabled"}>{data.outscraper?.message??"Fallback status unavailable."} {data.outscraper?.configured?"A key is configured.":"No key is configured."}</Service>
      <Service name="Google Business Profile" status={data.google?.connected?"Connected":data.google?.configured?"Ready to connect":"Needs setup"}>Optional access for profiles you manage. Public competitor monitoring does not require ownership. <button className="text-button" onClick={()=>void google()}>Connect managed profiles</button></Service>
    </div></section>
    <section aria-labelledby="delivery-heading"><h2 id="delivery-heading">Monitoring and delivery</h2><div className="service-grid">
      <Service name="In-app changes" status="Available from saved evidence">Compare collected snapshots for low-rated reviews, rating changes and activity jumps. <NavLink to="/alerts">Review observed changes</NavLink></Service>
      <Service name="Scheduled checks" status="Local opt-in">{planFrequency(overview.plan)}. Enable checks beside the collection controls. This PC and API must stay running. Hosted monitoring is still planned; refreshing the page does not collect new reviews.</Service>
      <Service name="Email and Meta WhatsApp" status="Planned">Delivery workers, recipients, consent and Meta templates are not connected. No external alerts are being sent.</Service>
      <Service name="Facebook and Trustpilot" status="Limited public collection">Link profiles to an existing Google business. Available public structured data can be partial. <NavLink to="/platforms">Manage linked platforms</NavLink></Service>
    </div></section></>}
    <details className="report-advanced"><summary>Reporting team and case workflow</summary><p>Assign evidence for a person to verify and submit through the platform.</p><ReportingWorkspace settings/></details>
    <details className="report-advanced"><summary>Data storage and enterprise readiness</summary><p>Evidence is stored in the local MySQL application when MySQL mode is enabled. Azure deployment, tenant authentication and a durable collection worker remain release requirements.</p><p>Enterprise API access and signed outbound webhooks are planned. The local API prototype is not an enterprise service.</p><NavLink to="/evidence">Browse evidence library</NavLink></details>
  </div>;
}
