import { createHash, randomUUID } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import type { AppStore } from "./types.js";
import { config } from "./config.js";

export type Platform = "facebook" | "trustpilot";
export interface PlatformReview { id:string; author:string|null; text:string; rating:number|null; postedAt:string|null }
export interface PlatformSnapshot { id:string; collectedAt:string; sourceUrl:string; name:string|null; rating:number|null; reviewCount:number|null; reviews:PlatformReview[]; digest:string; coverage:"partial"; method:"public_structured_data" }
export interface PlatformProfile { id:string; entityKey:string; platform:Platform; url:string; linkedAt:string; lastAttemptAt:string|null; error:string|null; snapshots:PlatformSnapshot[] }
export interface PlatformState { profiles:PlatformProfile[] }

// Accept business-profile URLs only. Canonical fixed hosts prevent arbitrary server-side requests.
export function profileUrl(platform:Platform, raw:string):string {
  const url=new URL(raw);
  if(url.protocol!=="https:"||url.username||url.password||url.port)throw new Error("Use an HTTPS business profile URL without credentials or a custom port.");
  if(platform==="trustpilot"){
    if(!["trustpilot.com","www.trustpilot.com"].includes(url.hostname)||!/^\/review\/([a-z0-9-]+\.)+[a-z]{2,}\/??$/i.test(url.pathname))throw new Error("Use a Trustpilot business URL such as https://www.trustpilot.com/review/example.com.");
    return `https://www.trustpilot.com${url.pathname.replace(/\/$/,"").toLowerCase()}`;
  }
  if(!["facebook.com","www.facebook.com","m.facebook.com"].includes(url.hostname))throw new Error("Use a Facebook business Page URL.");
  if(url.pathname==="/profile.php"&&/^\d+$/.test(url.searchParams.get("id")??""))return `https://www.facebook.com/profile.php?id=${url.searchParams.get("id")}`;
  const parts=url.pathname.split("/").filter(Boolean);
  if(!parts.length||parts.length>2||!parts.every(p=>/^[a-z0-9._-]+$/i.test(p))||(parts.length===2&&parts[1]!=="reviews")||["login","login.php","groups","watch","reel","share","sharer.php","search","marketplace","photo","photos","permalink.php"].includes(parts[0].toLowerCase()))throw new Error("Use the business Page URL, not a post, group or login link.");
  return `https://www.facebook.com/${parts[0].toLowerCase()}/reviews`;
}
const numeric=(v:unknown)=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const text=(v:unknown,max=10000)=>typeof v==="string"?v.slice(0,max):null;
const rating=(v:unknown)=>{const n=numeric(v);return n!==null&&n>=0&&n<=5?n:null;};

export function parsePublicProfile(html:string,sourceUrl:string):PlatformSnapshot {
  const nodes:Record<string,any>[]=[];
  const visit=(value:any,depth=0)=>{if(depth>8||!value)return;if(Array.isArray(value)){for(const v of value.slice(0,200))visit(v,depth+1);}else if(typeof value==="object"){nodes.push(value);if(value["@graph"])visit(value["@graph"],depth+1);}};
  for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{visit(JSON.parse(match[1]));}catch{/* Malformed or unrelated structured data is not review evidence. */}}
  const profile=nodes.find(n=>n.aggregateRating||n.review);
  if(!profile)throw new Error("The public page exposed no readable review data. A platform connector or approved collection provider is required.");
  const aggregate=profile.aggregateRating??{};
  const reviews:PlatformReview[]=[];const seen=new Set<string>();
  const rawReviews=Array.isArray(profile.review)?profile.review:profile.review?[profile.review]:[];
  for(const r of rawReviews.slice(0,100)){
    if(!r||typeof r!=="object")continue;
    const body=text(r.reviewBody??r.description);if(!body)continue;
    const author=text(typeof r.author==="string"?r.author:r.author?.name,255);
    const date=text(r.datePublished,100);const postedAt=date&&Number.isFinite(Date.parse(date))?new Date(date).toISOString():null;
    const id=createHash("sha256").update(JSON.stringify([author,body,postedAt])).digest("hex");
    if(seen.has(id))continue;seen.add(id);reviews.push({id,author,text:body,rating:rating(r.reviewRating?.ratingValue),postedAt});
  }
  const value={sourceUrl,name:text(profile.name,255),rating:rating(aggregate.ratingValue),reviewCount:numeric(aggregate.reviewCount??aggregate.ratingCount),reviews};
  if(value.reviewCount!==null&&(!Number.isInteger(value.reviewCount)||value.reviewCount<0))value.reviewCount=null;
  if(value.rating===null&&value.reviewCount===null&&!reviews.length)throw new Error("No usable public review metrics were found. Nothing was marked as collected.");
  return {...value,id:randomUUID(),collectedAt:new Date().toISOString(),digest:createHash("sha256").update(JSON.stringify(value)).digest("hex"),coverage:"partial",method:"public_structured_data"};
}

export async function collectPublicProfile(profile:Pick<PlatformProfile,"platform"|"url">,request:typeof fetch=fetch):Promise<PlatformSnapshot>{
  const url=profileUrl(profile.platform,profile.url);
  const response=await request(url,{redirect:"manual",signal:AbortSignal.timeout(20000),headers:{Accept:"text/html","User-Agent":"Axio-CRED/0.1 public-profile-preview"}});
  if(!response.ok){await response.body?.cancel();throw new Error(`Public collection unavailable (HTTP ${response.status}). Open the profile directly; no login, redirect or access challenge was bypassed.`);}
  if(!response.headers.get("content-type")?.includes("text/html")){await response.body?.cancel();throw new Error("The platform did not return a public HTML page.");}
  const reader=response.body?.getReader();if(!reader)throw new Error("The platform returned no page.");
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>3_000_000)throw new Error("The public page exceeded the preview collection limit.");chunks.push(value);}}finally{await reader.cancel();}
  return parsePublicProfile(Buffer.concat(chunks).toString("utf8"),url);
}

export function registerPlatformProfiles(app:Express,store:AppStore,collector=collectPublicProfile){
  const input=z.object({entityKey:z.string().min(1).max(600),platform:z.enum(["facebook","trustpilot"]),url:z.string().max(3000),confirmedSameBusiness:z.literal(true)});
  const active=new Set<string>();
  app.use("/api/platform-profiles",(req,res,next)=>{
    if(process.env.NODE_ENV==="production")return res.status(503).json({error:"Cross-platform preview requires production tenant authorization before release."});
    if(!["GET","HEAD"].includes(req.method)&&(!req.is("application/json")||(req.headers.origin&&req.headers.origin!==new URL(config.appUrl).origin)||req.headers["sec-fetch-site"]==="cross-site"))return res.status(403).json({error:"Use the workspace profile form."});next();
  });
  const eligible=async()=>{const [businesses,watch]=await Promise.all([store.listBusinesses(),store.getCompetitorWorkspace()]);return new Set([...businesses.map(b=>b.publicListingKey),watch.baselineKey,...watch.targets.map(t=>t.listingKey)].filter((k):k is string=>!!k&&/^(place:|cid:)/.test(k)));};
  app.get("/api/platform-profiles",async(req,res)=>{const keys=await eligible();res.json({profiles:(await store.getPlatformState()).profiles.filter(p=>keys.has(p.entityKey)),collectionMode:"public_page_preview",automaticMonitoring:false});});
  app.put("/api/platform-profiles",async(req,res)=>{
    const parsed=input.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Choose a platform profile and confirm it is the same business."});
    const {entityKey,platform}=parsed.data;if(!(await eligible()).has(entityKey))return res.status(400).json({error:"First save this business from its Google listing. Platform profiles share its existing slot."});
    let url:string;try{url=profileUrl(platform,parsed.data.url);}catch(e){return res.status(400).json({error:(e as Error).message});}
    const result=await store.mutatePlatformState(state=>{
      if(state.profiles.some(p=>p.platform===platform&&p.url===url&&p.entityKey!==entityKey))return null;
      let profile=state.profiles.find(p=>p.entityKey===entityKey&&p.platform===platform);
      if(profile){if(profile.url!==url){profile.url=url;profile.snapshots=[];profile.lastAttemptAt=null;profile.error=null;profile.linkedAt=new Date().toISOString();}}
      else{profile={id:randomUUID(),entityKey,platform,url,linkedAt:new Date().toISOString(),lastAttemptAt:null,error:null,snapshots:[]};state.profiles.push(profile);}return profile;
    });
    return result?res.json(result):res.status(409).json({error:"That platform profile is already attached to another business. Confirm its location before changing the link."});
  });
  app.delete("/api/platform-profiles/:id",async(req,res)=>{const keys=await eligible();const removed=await store.mutatePlatformState(state=>{const found=state.profiles.find(p=>p.id===req.params.id&&keys.has(p.entityKey));if(!found)return false;state.profiles=state.profiles.filter(p=>p.id!==found.id);return true;});return res.status(removed?200:404).json(removed?{removed:true}:{error:"Profile not found."});});
  app.post("/api/platform-profiles/:id/collect",async(req,res)=>{
    const profile=(await store.getPlatformState()).profiles.find(p=>p.id===req.params.id);
    if(!profile||!(await eligible()).has(profile.entityKey))return res.status(404).json({error:"Saved Google business and platform profile required."});
    if(active.has(profile.id)||active.size>=2)return res.status(429).json({error:"A collection is already running. Wait for it to finish."});
    if(profile.lastAttemptAt&&Date.now()-Date.parse(profile.lastAttemptAt)<60000)return res.status(429).json({error:"Wait one minute between public collection attempts."});
    active.add(profile.id);const attemptedAt=new Date().toISOString();
    try{
      let snapshot:PlatformSnapshot|undefined,error:string|null=null;
      try{snapshot=await collector(profile);}catch(e){error=(e instanceof Error?e.message:"Public collection failed.").slice(0,500);}
      const updated=await store.mutatePlatformState(state=>{const current=state.profiles.find(p=>p.id===profile.id&&p.url===profile.url&&p.linkedAt===profile.linkedAt);if(!current)return null;current.lastAttemptAt=attemptedAt;current.error=error;if(snapshot)current.snapshots=[snapshot,...current.snapshots].slice(0,3);return current;});
      return updated?res.json(updated):res.status(409).json({error:"Profile changed during collection. Reload before retrying."});
    }finally{active.delete(profile.id);}
  });
}
