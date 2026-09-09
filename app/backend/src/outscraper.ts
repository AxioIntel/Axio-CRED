import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { normalizeImport, type IntelligenceDataset } from "./intelligence.js";

const API = "https://api.outscraper.cloud";
const HOUR = 3_600_000;
export interface OutscraperConfig { key:string; enabled:boolean; perJob:number; monthly:number }
export function outscraperConfig(env:NodeJS.ProcessEnv=process.env):OutscraperConfig {
  const limit=(value:string|undefined, fallback:number, max:number)=>{
    const n=value===undefined?fallback:Number(value);return Number.isSafeInteger(n)&&n>=0&&n<=max?n:0;
  };
  return {key:env.OUTSCRAPER_API_KEY?.trim()??"",enabled:env.OUTSCRAPER_ENABLED==="true",
    perJob:limit(env.OUTSCRAPER_MAX_REVIEWS_PER_JOB,2000,5000),monthly:limit(env.OUTSCRAPER_MONTHLY_REVIEW_LIMIT,0,1_000_000)};
}
export function fallbackReason(exactPlaceId:string|undefined, extended:boolean, listing?:{reviewCount:number|null;reviews:unknown[]}, collectorFailed=false) {
  if(!exactPlaceId)return null;
  if(collectorFailed)return "The built-in collector failed for this exact Place ID.";
  if(!extended||!listing)return null;
  if(listing.reviews.length===0&&listing.reviewCount!==0)return "The full-history collector returned no reviews.";
  if(listing.reviewCount!==null&&listing.reviewCount-listing.reviews.length>=Math.max(5,Math.ceil(listing.reviewCount*.02)))
    return `The full-history collection is missing ${listing.reviewCount-listing.reviews.length} reported reviews.`;
  return null;
}

const str=z.string().max(20000).nullish();
const wireReview=z.object({review_id:str,reviews_id:z.unknown(),author_title:str,author_id:str,author_link:str,
  review_text:str,review_text_original:str,review_rating:z.number().min(0).max(5).nullish(),
  review_timestamp:z.number().nonnegative().max(253402300799).nullish(),review_link:str,owner_answer:str});
const wirePlace=z.object({name:z.string().min(1).max(500),place_id:z.string(),cid:z.union([z.string(),z.number()]).nullish(),
  full_address:str,category:str,type:str,rating:z.number().min(0).max(5).nullish(),reviews:z.number().int().nonnegative().nullish(),
  reviews_per_score:z.record(z.string(),z.number().int().nonnegative()).nullish(),location_link:str,site:str,phone:str,
  latitude:z.number().min(-90).max(90).nullish(),longitude:z.number().min(-180).max(180).nullish(),
  business_status:str,description:str,time_zone:str,working_hours:z.record(z.string(),z.union([z.string(),z.array(z.string())])).nullish(),
  reviews_data:z.array(wireReview).max(5000)});

export function normalizeOutscraper(data:unknown,placeId:string,collectedAt:string):IntelligenceDataset {
  // Async results may contain an additional array per query. Never accept a different listing.
  const rows=Array.isArray(data)?data.flat(2):[];
  const matches=rows.filter(row=>row&&typeof row==="object"&&row.place_id===placeId);
  if(matches.length!==1)throw new Error("Outscraper did not return exactly the requested Place ID.");
  const place=wirePlace.parse(matches[0]);
  const user_reviews=place.reviews_data.map(review=>({
    // `reviews_id` in the provider example is the PLACE's review collection ID, not a review ID.
    review_id:review.review_id || "outscraper:"+createHash("sha256").update(JSON.stringify([
      placeId,review.author_id??review.author_link??review.author_title,review.review_timestamp,review.review_text_original??review.review_text,review.review_rating
    ])).digest("hex"),
    Name:review.author_title,author_url:review.author_link,Description:review.review_text_original??review.review_text,
    Rating:review.review_rating,published_at:review.review_timestamp!=null?new Date(review.review_timestamp*1000).toISOString():null,
    reply_text:review.owner_answer,source:"Outscraper · Google Maps"
  }));
  return normalizeImport({label:`Business: ${place.name}`.slice(0,120),collectedAt,entries:[{
    title:place.name,place_id:placeId,cid:place.cid==null?null:String(place.cid),address:place.full_address,category:place.category??place.type,
    review_rating:place.rating,review_count:place.reviews,reviews_per_rating:place.reviews_per_score,
    link:place.location_link??`https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${encodeURIComponent(placeId)}`,
    web_site:place.site,phone:place.phone,latitude:place.latitude,longitude:place.longitude,status:place.business_status,
    description:place.description,timezone:place.time_zone,
    open_hours:Object.fromEntries(Object.entries(place.working_hours??{}).map(([day,hours])=>[day,Array.isArray(hours)?hours:[hours]])),user_reviews
  }]});
}

interface Reservation { id:string; placeId:string; createdAt:number; month:string; limit:number; full:boolean;
  state:"reserved"|"pending"|"success"|"failed"; requestId?:string; error?:string }
interface Ledger { records:Reservation[]; blockedUntil?:number; blockReason?:string }
const ledgerSchema=z.object({records:z.array(z.object({id:z.string().uuid(),placeId:z.string().regex(/^[A-Za-z0-9_-]{10,300}$/),
  createdAt:z.number().nonnegative(),month:z.string().regex(/^\d{4}-\d{2}$/),limit:z.number().int().min(1).max(5000),full:z.boolean(),
  state:z.enum(["reserved","pending","success","failed"]),requestId:z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).optional(),error:z.string().optional()
})),blockedUntil:z.number().nonnegative().optional(),blockReason:z.string().optional()});
interface Dependencies { directory?:string; fetch?:typeof fetch; now?:()=>number; sleep?:(ms:number)=>Promise<void>; pollAttempts?:number }
export interface FallbackProvider {
  status():Promise<{configured:boolean;enabled:boolean;ready:boolean;message:string;perJob:number;monthly:number;reserved?:number}>;
  collect(placeId:string,full:boolean,reported:number|null,reason:string,onProgress?:(message:string)=>Promise<void>,alreadyCollected?:number):Promise<IntelligenceDataset>;
}
export class OutscraperFallback implements FallbackProvider {
  private directory:string;private request:typeof fetch;private now:()=>number;private sleep:(ms:number)=>Promise<void>;private attempts:number;
  constructor(private config=outscraperConfig(),dependencies:Dependencies={}) {
    this.directory=dependencies.directory??resolve(dirname(fileURLToPath(import.meta.url)),"../../.dev/outscraper");
    this.request=dependencies.fetch??fetch;this.now=dependencies.now??Date.now;
    this.sleep=dependencies.sleep??(ms=>new Promise(done=>setTimeout(done,ms)));this.attempts=dependencies.pollAttempts??40;
  }
  private async transaction<T>(action:(ledger:Ledger)=>Promise<T>|T):Promise<T> {
    await mkdir(this.directory,{recursive:true});
    const lock=await open(resolve(this.directory,"ledger.lock"),"wx").catch(()=>{throw new Error("Outscraper budget ledger is busy or locked. No new paid request was sent.");});
    try {
      let ledger:Ledger;
      try {ledger=ledgerSchema.parse(JSON.parse(await readFile(resolve(this.directory,"ledger.json"),"utf8")));}
      catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")ledger={records:[]};else throw new Error("Outscraper budget ledger cannot be read. Paid calls are blocked.");}
      const result=await action(ledger);
      const temporary=resolve(this.directory,"ledger.next.json");await writeFile(temporary,JSON.stringify(ledger));
      await rename(temporary,resolve(this.directory,"ledger.json"));return result;
    } finally {await lock.close();await unlink(resolve(this.directory,"ledger.lock"));}
  }
  async status():ReturnType<FallbackProvider["status"]> {
    const {key,enabled,perJob,monthly}=this.config;
    const base={configured:Boolean(key),enabled,perJob,monthly};
    if(!enabled)return {...base,ready:false,message:"Outscraper fallback is disabled. No paid calls will be made."};
    if(!key||!perJob||!monthly)return {...base,ready:false,message:"Outscraper needs a key and positive per-job and monthly review limits."};
    try {return await this.transaction(ledger=>{
      const reserved=ledger.records.filter(r=>r.month===new Date(this.now()).toISOString().slice(0,7)).reduce((sum,r)=>sum+r.limit,0);
      const blocked=(ledger.blockedUntil??0)>this.now();
      return {...base,reserved,ready:!blocked&&reserved<monthly,message:blocked?ledger.blockReason??"Outscraper is cooling down.":reserved>=monthly?"Outscraper monthly review allowance reached.":"Outscraper fallback is available within the configured review limits."};
    });}catch{return {...base,ready:false,message:"Outscraper budget ledger unavailable. Paid calls are blocked."};}
  }
  private async update(id:string,patch:Partial<Reservation>,block?:{until:number;reason:string}) {
    await this.transaction(ledger=>{const row=ledger.records.find(r=>r.id===id);if(!row)throw new Error("Outscraper reservation missing.");Object.assign(row,patch);if(block){ledger.blockedUntil=block.until;ledger.blockReason=block.reason;}});
  }
  private async readResponse(path:string) {
    // Fixed provider origin, no redirect following, no API key in URLs or exposed provider error bodies.
    const response=await this.request(API+path,{headers:{"X-API-KEY":this.config.key},redirect:"error",signal:AbortSignal.timeout(45000)});
    if(!response.ok||response.status===204){await response.body?.cancel();throw new ProviderError(response.status);}
    const reader=response.body?.getReader();if(!reader)throw new Error("Empty provider response");
    const chunks:Uint8Array[]=[];let bytes=0;
    for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>64*1024*1024){await reader.cancel();throw new Error("Provider response too large");}chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString()) as {id?:string;status?:string;data?:unknown};
  }
  async collect(placeId:string,full:boolean,reported:number|null,reason:string,onProgress?: (message:string)=>Promise<void>,alreadyCollected=0) {
    if(!/^[A-Za-z0-9_-]{10,300}$/.test(placeId))throw new Error("Outscraper requires an exact Place ID.");
    if(!this.config.enabled)throw new Error("Outscraper fallback is disabled. No paid calls were made.");
    if(!this.config.key||!this.config.perJob||!this.config.monthly)throw new Error("Outscraper requires a key and positive review limits before paid calls can run.");
    const now=this.now();let fresh=false;
    const row=await this.transaction(ledger=>{
      // Reuse pending work or a completed result; never resubmit an uncertain/failed charge within 24 hours.
      const prior=[...ledger.records].reverse().find(r=>r.placeId===placeId&&now-r.createdAt<24*HOUR);
      if(prior){
        if(prior.state==="success"&&(!full||prior.full))return {...prior};
        if(prior.state==="pending"&&prior.requestId&&now-prior.createdAt<3*HOUR)return {...prior};
        throw new Error("A paid request for this business was already reserved in the last 24 hours. Check its provider status before retrying; no duplicate request was sent.");
      }
      if((ledger.blockedUntil??0)>now)throw new Error(ledger.blockReason??"Outscraper is cooling down.");
      const month=new Date(now).toISOString().slice(0,7);
      const used=ledger.records.filter(r=>r.month===month).reduce((sum,r)=>sum+r.limit,0);
      // Full history cannot reuse a cursor from the built-in scraper. Fetch a bounded whole sample.
      const desired=full?(reported!=null&&reported>0?reported+10:this.config.perJob):10;
      const limit=Math.min(this.config.perJob,desired,this.config.monthly-used);
      if(limit<1)throw new Error("Outscraper monthly review allowance reached. No paid request was sent.");
      if(full&&limit<=alreadyCollected)throw new Error("Outscraper's remaining allowance cannot improve the current sample size. No paid request was sent.");
      const reserved:Reservation={id:randomUUID(),placeId,full,limit,month,createdAt:now,state:"reserved"};
      ledger.records.push(reserved);fresh=true;return {...reserved};
    });
    if(row.state==="success")return JSON.parse(await readFile(resolve(this.directory,row.id+".result.json"),"utf8")) as IntelligenceDataset;
    await onProgress?.(fresh?`Outscraper fallback: collecting up to ${row.limit} reviews.`:"Resuming the existing Outscraper request without a new collection charge.");
    try {
      let result:{id?:string;status?:string;data?:unknown};
      if(fresh){
        const params=new URLSearchParams({query:placeId,reviewsLimit:String(row.limit),limit:"1",sort:"newest",ignoreEmpty:"false",source:"google",language:"en",async:"true"});
        result=await this.readResponse("/google-maps-reviews?"+params);
        if(result.id&&/^[a-zA-Z0-9_-]{1,200}$/.test(result.id)){row.requestId=result.id;row.state="pending";await this.update(row.id,{requestId:result.id,state:"pending"});}
      }else result={status:"Pending"};
      for(let attempt=0;attempt<=this.attempts;attempt++) {
        if(result.status==="Success"){
          const dataset=normalizeOutscraper(result.data,placeId,new Date(this.now()).toISOString());
          dataset.collection={provider:"outscraper",requestId:row.requestId,reason,requestedLimit:row.limit};
          await writeFile(resolve(this.directory,row.id+".response.json"),JSON.stringify(result));
          await writeFile(resolve(this.directory,row.id+".result.json"),JSON.stringify(dataset));
          await this.update(row.id,{state:"success"});return dataset;
        }
        if(result.status!=="Pending"||!row.requestId)throw new Error("Provider did not return usable results or a pending request ID.");
        if(attempt===this.attempts||this.now()-row.createdAt>=3*HOUR)throw new PendingError();
        await this.sleep(Math.min(30000,15000+attempt*2000));
        try {result=await this.readResponse("/requests/"+encodeURIComponent(row.requestId));}
        catch(error){if(error instanceof ProviderError&&[401,402,403,404,422].includes(error.status))throw error;
          // GET result retrieval is safe to retry; collection submission above is never retried.
          result={status:"Pending"};}
      }
      throw new PendingError();
    }catch(error){
      if(error instanceof PendingError)throw new Error("Outscraper is still pending. Retry collection later to resume the saved request; no new paid job will be submitted within 24 hours.");
      const status=error instanceof ProviderError?error.status:null;
      const message=status?`Outscraper returned HTTP ${status}. Check provider credentials, credit and request status; automatic submission retry is blocked.`:"Outscraper could not complete or validate this collection. Check the saved request in the provider dashboard before retrying.";
      await this.update(row.id,{state:"failed",error:message},status&&[401,402,403,429].includes(status)?{until:this.now()+([401,402,403].includes(status)?HOUR:60000),reason:message}:undefined);
      throw new Error(message);
    }
  }
}
class ProviderError extends Error {constructor(readonly status:number){super("Provider HTTP error");}}
class PendingError extends Error {}
