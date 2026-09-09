import { spawn } from "node:child_process";
import { collectionCoverage } from "./collection-coverage.js";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppStore } from "./types.js";
import { normalizeImport, type IntelligenceDataset } from "./intelligence.js";
import { fallbackReason, OutscraperFallback, type FallbackProvider } from "./outscraper.js";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const jobsDir = resolve(appDir, ".dev/discovery");
const binary = resolve(appDir, ".tools/axiocred-scraper.exe");
export interface DiscoveryJob { id:string; query:string; status:"running"|"completed"|"failed"; startedAt:string; dataset?:IntelligenceDataset; error?:string; expectedPlaceId?:string; cached?:boolean; extendedReviews?:boolean; coverage?:ReturnType<typeof collectionCoverage>; progress?:string; fallback?:{reason:string;status:"disabled"|"running"|"completed"|"failed";message:string} }
export type DiscoveryRunner = (query:string, directory:string, extendedReviews?:boolean)=>Promise<unknown[]>;
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
export async function runLocalDiscovery(query:string, directory:string, extendedReviews=false):Promise<unknown[]> {
  const resolved=await resolveQuery(query);
  await writeFile(resolve(directory,"query.txt"),resolved+"\n");
  const output=resolve(directory,"results.jsonl");
  const childEnv:NodeJS.ProcessEnv={};
  for(const key of ["SystemRoot","SYSTEMROOT","WINDIR","PATH","TEMP","TMP","USERPROFILE","LOCALAPPDATA","APPDATA","COMSPEC"])if(process.env[key])childEnv[key]=process.env[key];
  Object.assign(childEnv,{DISABLE_TELEMETRY:"1",PLAYWRIGHT_INSTALL_ONLY:"0",PLAYWRIGHT_BROWSERS_PATH:resolve(appDir,".tools/browsers"),PLAYWRIGHT_DRIVER_PATH:resolve(appDir,".tools/playwright-driver")});
  // The dependency's inactivity clock starts at zero before the first result.
  // Bound the whole process below rather than canceling a valid first navigation.
  const child=spawn(binary,["-input",resolve(directory,"query.txt"),"-results",output,"-json",...(extendedReviews?["-extra-reviews"]:[]),"-c","1","-depth","1","-browser-pool-size","1","-pages-per-browser","1"],{cwd:directory,windowsHide:true,env:childEnv});
  const logs:Buffer[]=[];let logBytes=0;
  const log=(chunk:Buffer)=>{if(logBytes<2_000_000){logs.push(chunk);logBytes+=chunk.length;}};
  child.stdout.on("data",log);child.stderr.on("data",log);
  let timedOut=false;
  const timeout=setTimeout(()=>{timedOut=true;if(child.pid)spawn("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});},extendedReviews?1200000:180000);
  const code=await new Promise<number|null>((accept,reject)=>{child.on("error",reject);child.on("close",accept);}).finally(()=>clearTimeout(timeout));
  await writeFile(resolve(directory,"collector.log"),Buffer.concat(logs));
  if(Buffer.concat(logs).toString().includes("ERR_NETWORK_ACCESS_DENIED"))throw new Error("The local collector cannot access the network. Restart the local API with network access, then search again.");
  if(timedOut)throw new Error("Search timed out. Try the exact business name and city or its Maps link.");
  if(code!==0)throw new Error("The collector could not complete this search. Try again with the exact business name and city.");
  const raw=await readFile(output,"utf8");
  const entries=raw.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));
  if(!entries.length)throw new Error("No listings were returned. Google may have blocked this search; try an exact name and city or a full Maps link.");
  return entries.slice(0,20);
}
export class BusinessDiscovery {
  private jobs=new Map<string,DiscoveryJob>();
  private active:DiscoveryJob|null=null;
  // Injected local runners are used by tests; they never implicitly activate a real paid provider.
  constructor(private store:AppStore,private runner:DiscoveryRunner=runLocalDiscovery,
    private fallback:FallbackProvider|null=runner===runLocalDiscovery?new OutscraperFallback():null){}
  async fallbackStatus(){return this.fallback?.status()??{configured:false,enabled:false,ready:false,message:"Outscraper fallback is not configured.",perJob:0,monthly:0};}
  available(){return this.runner!==runLocalDiscovery||(process.env.NODE_ENV!=="production"&&process.platform==="win32"&&existsSync(binary));}
  async startPlaceId(placeId:string,refresh=false,extendedReviews=false) {
    if(!validPlaceId(placeId))throw new Error("Paste only the Place ID from Google’s finder, without a link or spaces.");
    const datasets=(refresh||extendedReviews)?[]:await this.store.listIntelligenceImports();
    for(const dataset of datasets){const listing=dataset.listings.find(row=>row.placeId===placeId);if(listing){return {id:randomUUID(),query:placeId,status:"completed" as const,startedAt:new Date().toISOString(),cached:true,dataset:{...dataset,listings:[listing]}};}}
    return this.start(placeIdMapsUrl(placeId),placeId,extendedReviews);
  }
  async start(query:string,expectedPlaceId?:string,extendedReviews=false) {
    if(!validDiscoveryQuery(query))throw new Error("Enter a business name and city, or a Google Maps/share link.");
    if(!this.available()&&!(expectedPlaceId&&(await this.fallbackStatus()).ready))throw new Error("The built-in collector is unavailable and paid fallback is not ready. Set up the local runtime before searching.");
    if(this.active?.status==="running"){if(this.active.query===query.trim()&&Boolean(this.active.extendedReviews)===extendedReviews)return this.active;throw new Error("Another search is running. Wait for it to finish, then try again.");}
    const job:DiscoveryJob={id:randomUUID(),query:query.trim(),status:"running",startedAt:new Date().toISOString(),expectedPlaceId,extendedReviews};
    this.active=job;this.jobs.set(job.id,job);
    try {await mkdir(resolve(jobsDir,job.id),{recursive:true});await this.persist(job);}
    catch(error){this.active=null;this.jobs.delete(job.id);throw error;}
    void this.run(job);
    return {...job};
  }
  async get(id:string) {
    if(this.jobs.has(id))return this.jobs.get(id)!;
    try {const job=JSON.parse(await readFile(resolve(jobsDir,id,"job.json"),"utf8")) as DiscoveryJob;if(job.status==="running"){job.status="failed";job.error="The server restarted during this search. Please search again.";}return job;}catch{return null;}
  }
  private persist(job:DiscoveryJob){return writeFile(resolve(jobsDir,job.id,"job.json"),JSON.stringify(job));}
  private async run(job:DiscoveryJob) {
    try {
      let entries:unknown[]|undefined;let collectorError:unknown;
      try {entries=await this.runner(job.query,resolve(jobsDir,job.id),job.extendedReviews);}
      catch(error){collectorError=error;}
      if(entries?.length===0){entries=undefined;collectorError=new Error("The built-in collector returned no listings.");}
      if(collectorError&&["EACCES","EPERM","ENOSPC","ABORT_ERR"].includes((collectorError as NodeJS.ErrnoException).code??""))throw collectorError;
      let dataset:IntelligenceDataset|undefined;
      if(entries){
        dataset=normalizeImport({label:`Business search: ${job.query}`.slice(0,120),collectedAt:new Date().toISOString(),entries});
        // Identity mismatches and malformed data are not a reason to spend money on another query.
        if(job.expectedPlaceId){dataset.listings=dataset.listings.filter(listing=>listing.placeId===job.expectedPlaceId);if(dataset.listings.length!==1)throw new Error("Google did not return this exact Place ID. Check it in the finder and try again.");dataset.label=`Business: ${dataset.listings[0].name}`.slice(0,120);}
        dataset.collection={provider:"builtin"};
        // Persist usable local evidence BEFORE starting a paid fallback. A storage error stops here.
        await this.store.saveIntelligenceImport(dataset);job.dataset=dataset;
      }
      const log=await readFile(resolve(jobsDir,job.id,"collector.log"),"utf8").catch(()=>"");
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
