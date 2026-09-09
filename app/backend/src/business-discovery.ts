import {tmpdir} from "node:os";
import {config} from "./config.js";
import { spawn } from "node:child_process";
import { collectionCoverage } from "./collection-coverage.js";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppStore } from "./types.js";
import { normalizeImport, type IntelligenceDataset } from "./intelligence.js";
import { fallbackReason, OutscraperFallback, type FallbackProvider } from "./outscraper.js";

import { collectionOptionsSchema, nativeArguments, nativeTuning, gridCells, type CollectionOptions } from "./collection-options.js";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const jobsDir = resolve(appDir, ".dev/discovery");
const binary = process.env.NATIVE_SCRAPER_BINARY || resolve(appDir, process.platform === "win32" ? ".tools/axiocred-scraper.exe" : ".tools/axiocred-scraper");
export interface DiscoveryJob { id:string; query:string; status:"running"|"completed"|"failed"|"cancelled"; options?:CollectionOptions; queries?:string[]; partial?:boolean; warning?:string; startedAt:string; dataset?:IntelligenceDataset; error?:string; expectedPlaceId?:string; cached?:boolean; extendedReviews?:boolean; coverage?:ReturnType<typeof collectionCoverage>; progress?:string; fallback?:{reason:string;status:"disabled"|"running"|"completed"|"failed";message:string} }
export interface NativeResult {entries:unknown[];partial:boolean;warning?:string}
export type DiscoveryRunner = (query:string, directory:string, extendedReviews?:boolean, options?:CollectionOptions, signal?:AbortSignal)=>Promise<unknown[]|NativeResult>;
export const validPlaceId=(value:unknown):value is string=>typeof value==="string"&&/^[A-Za-z0-9_-]{10,300}$/.test(value);
export function placeIdMapsUrl(placeId:string){const url=new URL("https://www.google.com/maps/search/");url.searchParams.set("api","1");url.searchParams.set("query","Google");url.searchParams.set("query_place_id",placeId);return url.href;}
export function validDiscoveryQuery(value:unknown):value is string {
  // Reject embedded control characters in public search input.
  // eslint-disable-next-line no-control-regex
  if(typeof value!=="string"||value.trim().length<3||value.length>2000||/[\r\n\x00-\x1f]/.test(value))return false;
  if(!/^https?:/i.test(value))return !value.includes("://") && value.length<=200;
  try { const url=new URL(value);return url.protocol==="https:"&&(["maps.app.goo.gl","share.google","maps.google.com"].includes(url.hostname)||(["www.google.com","google.com"].includes(url.hostname)&&url.pathname.startsWith("/maps"))); } catch {return false;}
}
async function resolveQuery(query:string) {
  if(!/^https:\/\/(share\.google|maps\.app\.goo\.gl)\//.test(query))return query;
  let url=new URL(query);
  for(let i=0;i<6;i++) {
    if(url.protocol!=="https:"||!(url.hostname==="share.google"||url.hostname==="maps.app.goo.gl"||url.hostname==="google.com"||url.hostname.endsWith(".google.com")))throw new Error("This share link redirected outside Google. Use the full Maps listing link.");
    if((url.hostname==="google.com"||url.hostname==="www.google.com"||url.hostname==="maps.google.com")&&url.pathname.startsWith("/maps"))return url.href;
    const response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(15000)});
    const location=response.headers.get("location");
    if(response.status>=300&&response.status<400&&location){await response.body?.cancel();url=new URL(location,url);continue;}
    const html=await response.text();
    const match=html.match(/href=["']((?:https:\/\/(?:www\.)?google\.com)?\/maps\/place\/[^"']+)["']/);
    if(match)return new URL(match[1].replaceAll("&amp;","&"),"https://www.google.com").href;
    throw new Error("Could not resolve this share link. Search by business name and city, or paste its full Google Maps URL.");
  }
  throw new Error("Too many redirects. Use a full Google Maps link or a business name and city.");
}
export async function runLocalDiscovery(query:string, directory:string, extendedReviews=false, suppliedOptions?:CollectionOptions, signal?:AbortSignal):Promise<NativeResult> {
  const options=suppliedOptions??collectionOptionsSchema.parse({depth:1,maxListings:20,extendedReviews});
  if(process.env.NATIVE_SCRAPER_PROXIES_FILE&&!existsSync(process.env.NATIVE_SCRAPER_PROXIES_FILE))throw Object.assign(new Error("Configured native proxy file is unavailable."),{code:"NATIVE_SETUP"});
  const resolved=(await Promise.all(query.split("\n").map(resolveQuery))).join("\n");
  await writeFile(resolve(directory,"query.txt"),resolved+"\n");
  const output=resolve(directory,"results.jsonl");
  const childEnv:NodeJS.ProcessEnv={};
  for(const key of ["SystemRoot","SYSTEMROOT","WINDIR","PATH","TEMP","TMP","USERPROFILE","LOCALAPPDATA","APPDATA","COMSPEC"])if(process.env[key])childEnv[key]=process.env[key];
  Object.assign(childEnv,{DISABLE_TELEMETRY:"1",PLAYWRIGHT_INSTALL_ONLY:"0",PLAYWRIGHT_BROWSERS_PATH:resolve(appDir,".tools/browsers"),PLAYWRIGHT_DRIVER_PATH:resolve(appDir,".tools/playwright-driver")});
  // The dependency's inactivity clock starts at zero before the first result.
  // Bound the whole process below rather than canceling a valid first navigation.
  if(signal?.aborted)throw new Error("Collection cancelled.");
  const child=spawn(binary,nativeArguments(resolve(directory,"query.txt"),output,options,process.env.NATIVE_SCRAPER_PROXIES_FILE||undefined,nativeTuning()),{cwd:directory,windowsHide:true,detached:process.platform!=="win32",env:childEnv});
  const logs:Buffer[]=[];let logBytes=0;
  const log=(chunk:Buffer)=>{if(logBytes<2_000_000){logs.push(chunk);logBytes+=chunk.length;}};
  child.stdout.on("data",log);child.stderr.on("data",log);
  let timedOut=false;
  const stop=()=>{if(!child.pid)return;if(process.platform==="win32")spawn("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});else try{process.kill(-child.pid,"SIGKILL");}catch{/* already exited */}};
  signal?.addEventListener("abort",stop,{once:true});
  const timeout=setTimeout(()=>{timedOut=true;stop();},suppliedOptions||extendedReviews?1200000:180000);
  const code=await new Promise<number|null>((accept,reject)=>{child.on("error",reject);child.on("close",accept);}).finally(()=>{clearTimeout(timeout);signal?.removeEventListener("abort",stop);});
  // Never persist proxy credentials echoed by a subprocess.
  await writeFile(resolve(directory,"collector.log"),Buffer.concat(logs).toString().replace(/(https?|socks5):\/\/[^\s/@]+:[^\s/@]+@/gi,"$1://[redacted]@"));
  if(signal?.aborted)throw new Error("Collection cancelled.");
  if(Buffer.concat(logs).toString().includes("ERR_NETWORK_ACCESS_DENIED"))throw new Error("The local collector cannot access the network. Restart the local API with network access, then search again.");
  const raw=await readFile(output,"utf8").catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return "";throw error;});
  return parseNativeOutput(raw,options.maxListings,timedOut,code);
}
export function parseNativeOutput(raw:string,maxListings:number,timedOut=false,code:number|null=0):NativeResult{
  const unique=new Map<string,unknown>();let malformed=0;
  for(const line of raw.split(/\r?\n/).filter(line=>line.trim())){
    try{const row=JSON.parse(line);const key=row.place_id||row.cid||row.link||JSON.stringify(row);if(!unique.has(key))unique.set(key,row);}catch{malformed++;}
  }
  if(!unique.size)throw new Error(timedOut?"Search timed out without usable listings. Narrow the area or use an exact Maps link.":"The collector returned no usable listings. Try an exact name and city or a full Maps link.");
  const partial=timedOut||code!==0||malformed>0||unique.size>maxListings;
  return {entries:[...unique.values()].slice(0,maxListings),partial,warning:partial?`Partial run: ${timedOut?"time budget reached; ":""}${code!==0?"collector exited early; ":""}${malformed?`${malformed} incomplete lines skipped; `:""}${unique.size>maxListings?`saved first ${maxListings} of ${unique.size} unique listings; `:""}complete coverage is not established.`:undefined};
}
export class BusinessDiscovery {
  private directory=process.env.NODE_ENV==="test"?mkdtempSync(resolve(tmpdir(),"axiocred-discovery-")):resolve(jobsDir,config.dataMode==="mysql"?"mysql":"demo");
  private jobs=new Map<string,DiscoveryJob>();
  private active:DiscoveryJob|null=null;
  private controller:AbortController|null=null;
  // Injected local runners are used by tests; they never implicitly activate a real paid provider.
  constructor(private store:AppStore,private runner:DiscoveryRunner=runLocalDiscovery,
    private fallback:FallbackProvider|null=runner===runLocalDiscovery?new OutscraperFallback():null){}
  async fallbackStatus(){return this.fallback?.status()??{configured:false,enabled:false,ready:false,message:"Outscraper fallback is not configured.",perJob:0,monthly:0};}
  available(){return this.runner!==runLocalDiscovery||(process.env.NODE_ENV!=="production"&&existsSync(binary));}
  async startPlaceId(placeId:string,refresh=false,extendedReviews=false) {
    if(!validPlaceId(placeId))throw new Error("Paste only the Place ID from Google’s finder, without a link or spaces.");
    const datasets=(refresh||extendedReviews)?[]:await this.store.listIntelligenceImports();
    for(const dataset of datasets){const listing=dataset.listings.find(row=>row.placeId===placeId);if(listing){return {id:randomUUID(),query:placeId,status:"completed" as const,startedAt:new Date().toISOString(),cached:true,dataset:{...dataset,listings:[listing]}};}}
    return this.start(placeIdMapsUrl(placeId),placeId,extendedReviews);
  }
  async startCollection(queries:string[],options:CollectionOptions){
    if(queries.length<1||queries.length>10||queries.some(query=>!validDiscoveryQuery(query)))throw new Error("Enter 1–10 valid business queries, one per line.");
    options=collectionOptionsSchema.parse(options);
    if(options.grid&&gridCells(options.grid)*queries.length>100)throw new Error("Limit the run to 100 query/cell combinations.");
    return this.start(queries[0],undefined,options.extendedReviews,options,[...new Set(queries.map(q=>q.trim()))]);
  }
  async start(query:string,expectedPlaceId?:string,extendedReviews=false,options?:CollectionOptions,queries?:string[]) {
    if(!validDiscoveryQuery(query))throw new Error("Enter a business name and city, or a Google Maps/share link.");
    // `ready` describes NEW budget, not an already-reserved request. collect()
    // owns admission and can resume pending work even when the allowance is full.
    if(!this.available()){
      const status=expectedPlaceId?await this.fallbackStatus():null;
      if(!status?.enabled||!status.configured)throw new Error("The built-in collector is unavailable and paid fallback is not enabled. Set up the local runtime before searching.");
    }
    if(this.active?.status==="running"){if(this.active.query===query.trim()&&Boolean(this.active.extendedReviews)===extendedReviews&&JSON.stringify(this.active.options)===JSON.stringify(options)&&JSON.stringify(this.active.queries)===JSON.stringify(queries))return this.active;throw new Error("Another search is running. Wait for it to finish, then try again.");}
    const job:DiscoveryJob={id:randomUUID(),query:query.trim(),status:"running",startedAt:new Date().toISOString(),expectedPlaceId,extendedReviews,options,queries};
    this.controller=new AbortController();
    this.active=job;this.jobs.set(job.id,job);
    try {await mkdir(resolve(this.directory,job.id),{recursive:true});await this.persist(job);}
    catch(error){this.active=null;this.jobs.delete(job.id);throw error;}
    void this.run(job);
    return {...job};
  }
  async get(id:string) {
    if(this.jobs.has(id))return this.jobs.get(id)!;
    try {const job=JSON.parse(await readFile(resolve(this.directory,id,"job.json"),"utf8")) as DiscoveryJob;if(job.status==="running"){job.status="failed";job.error="The server restarted during this search. Please search again.";await this.persist(job);}return job;}catch{return null;}
  }
  async list(){
    const ids=await readdir(this.directory).catch(()=>[]);
    const jobs=await Promise.all(ids.filter(id=>/^[a-f0-9-]{36}$/.test(id)).map(id=>this.get(id)));
    return jobs.filter((job):job is DiscoveryJob=>Boolean(job)).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,50).map(({dataset,...job})=>({...job,datasetId:dataset?.id,listingCount:dataset?.listings.length??0}));
  }
  cancel(id:string){if(this.active?.id!==id||this.active.status!=="running"||this.active.fallback?.status==="running")return false;this.controller?.abort();return true;}
  private async persist(job:DiscoveryJob){const path=resolve(this.directory,job.id,"job.json");await writeFile(path+".tmp",JSON.stringify(job));await rename(path+".tmp",path);}

  private async run(job:DiscoveryJob) {
    try {
      let entries:unknown[]|undefined;let collectorError:unknown;
      try {if(!this.available())throw new Error("The built-in collector is unavailable.");const result=await this.runner(job.queries?.join("\n")??job.query,resolve(this.directory,job.id),job.extendedReviews,job.options,this.controller?.signal);if(Array.isArray(result))entries=result;else{entries=result.entries;job.partial=result.partial;job.warning=result.warning;}}
      catch(error){collectorError=error;}
      if(this.controller?.signal.aborted){job.status="cancelled";return;}
      if(entries?.length===0){entries=undefined;collectorError=new Error("The built-in collector returned no listings.");}
      if(collectorError&&["EACCES","EPERM","ENOSPC","ABORT_ERR","NATIVE_SETUP"].includes((collectorError as NodeJS.ErrnoException).code??""))throw collectorError;
      let dataset:IntelligenceDataset|undefined;
      if(entries){
        dataset=normalizeImport({label:`Business search: ${job.query}`.slice(0,120),collectedAt:new Date().toISOString(),entries});
        // Identity mismatches and malformed data are not a reason to spend money on another query.
        if(job.expectedPlaceId){dataset.listings=dataset.listings.filter(listing=>listing.placeId===job.expectedPlaceId);if(dataset.listings.length!==1)throw new Error("Google did not return this exact Place ID. Check it in the finder and try again.");dataset.label=`Business: ${dataset.listings[0].name}`.slice(0,120);}
        dataset.collection={provider:"builtin",options:job.options,queries:job.queries,partial:job.partial,warning:job.warning};
        // Persist usable local evidence BEFORE starting a paid fallback. A storage error stops here.
        await this.store.saveIntelligenceImport(dataset);job.dataset=dataset;
      }
      const log=await readFile(resolve(this.directory,job.id,"collector.log"),"utf8").catch(()=>"");
      if(dataset)job.coverage=collectionCoverage(dataset.listings,log);
      const reason=fallbackReason(job.expectedPlaceId,Boolean(job.extendedReviews),dataset?.listings[0],Boolean(collectorError));
      if(reason&&this.fallback){
        const status=await this.fallback.status();
        job.fallback={reason,status:status.enabled?"running":"disabled",message:status.message};
        // collect() can resume a paid request even if its reservation exhausted the allowance.
        if(status.enabled){
          await this.persist(job);
          try {
            const previous=dataset?.listings[0]??(await this.store.listIntelligenceImports()).flatMap(d=>d.listings).find(l=>l.placeId===job.expectedPlaceId);
            const replacement=await this.fallback.collect(job.expectedPlaceId!,Boolean(job.extendedReviews),previous?.reviewCount??null,reason,async message=>{job.progress=message;job.fallback!.message=message;await this.persist(job);},dataset?.listings[0].reviews.length??0);
            const candidate=replacement.listings[0];
            if(replacement.listings.length!==1||candidate.placeId!==job.expectedPlaceId)throw new Error("Fallback listing identity did not match.");
            // Keep snapshots separate: incompatible provider IDs must not inflate review counts.
            const useReplacement=!dataset||candidate.reviews.length>dataset.listings[0].reviews.length||
              (candidate.reviews.length===dataset.listings[0].reviews.length&&Date.parse(replacement.collectedAt??"")>=Date.parse(dataset.collectedAt??""));
            if(useReplacement){
              if(!(await this.store.listIntelligenceImports()).some(d=>d.id===replacement.id))await this.store.saveIntelligenceImport(replacement);
              dataset=replacement;job.dataset=dataset;job.coverage=collectionCoverage(dataset.listings);
            }
            job.fallback={reason,status:"completed",message:useReplacement?"Outscraper evidence saved; coverage shown below.":"Outscraper returned no larger sample. The built-in evidence remains selected; the provider response is retained locally."};
          }catch(error){job.fallback={reason,status:"failed",message:error instanceof Error?error.message:"Outscraper fallback failed."};}
        }
      }
      if(!job.dataset)throw new Error([collectorError instanceof Error?collectorError.message:"Collection returned no usable data.",job.fallback?.message].filter(Boolean).join(" "));
      job.status="completed";
    }catch(error){job.status="failed";job.error=error instanceof Error?error.message:"Search failed.";}
    finally {try{await this.persist(job);}catch{job.error="Could not persist search status. Please refresh your saved results.";}if(this.active?.id===job.id)this.active=null;if(this.jobs.size>50)this.jobs.delete(this.jobs.keys().next().value!);}
  }
}
