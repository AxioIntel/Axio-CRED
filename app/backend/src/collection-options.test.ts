import {collectionCsv} from "./collection-export.js";
import {createApp} from "./app.js";
import type {AddressInfo} from "node:net";
import {describe,it,expect} from "vitest";
import {collectionOptionsSchema,nativeArguments,gridCells} from "./collection-options.js";
import {BusinessDiscovery,parseNativeOutput} from "./business-discovery.js";
import {DemoStore} from "./demo-store.js";
import {normalizeImport} from "./intelligence.js";

describe("native collection parity",()=>{
  it("exposes validated asynchronous jobs, retry and CSV export through the application API",async()=>{
    let calls=0;
    const server=createApp(new DemoStore(),async()=>{calls++;return [{title:"Collected clinic",place_id:"ChIJapifixture",credit_cards_accepted:["VISA"]}];}).listen(0,"127.0.0.1");
    await new Promise<void>(resolve=>server.once("listening",resolve));
    const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post=(path:string,body:unknown)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    try{
      expect((await post("/api/collections",{queries:["Clinic"],options:{mode:"fast"}})).status).toBe(400);expect(calls).toBe(0);
      const response=await post("/api/collections",{queries:["Collected clinic"],options:{}});expect(response.status).toBe(202);const job=await response.json() as {id:string};
      await expect.poll(async()=>((await (await fetch(base+`/api/business-search/${job.id}`)).json()) as {status:string}).status).toBe("completed");
      const history=await (await fetch(base+"/api/collections")).json() as {datasetId:string}[];expect(history).toHaveLength(1);
      const csv=await fetch(base+`/api/intelligence/imports/${history[0].datasetId}/export.csv`);expect(csv.status).toBe(200);expect(await csv.text()).toContain("VISA");
      expect((await post(`/api/collections/${job.id}/retry`,{})).status).toBe(202);await expect.poll(()=>calls).toBe(2);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it("passes richer collection options to the native CLI without accepting arbitrary flags",()=>{
    const options=collectionOptionsSchema.parse({language:"hi",depth:12,emails:true,extendedReviews:true,grid:{south:28.60,west:77.20,north:28.62,east:77.22,cellKm:1}});
    const args=nativeArguments("input","output",options,"C:/private/proxies.txt");
    for(const flag of ["-email","-extra-reviews","-grid-bbox","-grid-cell","-lang","-depth","-proxies-file"])expect(args).toContain(flag);
    expect(args).not.toContain("-fast-mode");expect(gridCells(options.grid!)).toBeGreaterThan(0);
    for(const value of [{language:"en -writer evil"},{concurrency:100},{grid:{south:-80,west:-170,north:80,east:170,cellKm:.1}},{grid:{south:1,west:1,north:1.00001,east:1.00001,cellKm:1}},{mode:"fast"},{mode:"fast",geo:{latitude:0,longitude:0},emails:true}])expect(collectionOptionsSchema.safeParse(value).success).toBe(false);
    const fast=collectionOptionsSchema.parse({mode:"fast",geo:{latitude:0,longitude:0,radius:1200}});expect(nativeArguments("in","out",fast)).toContain("-fast-mode");
  });
  it("retains complete JSONL records on timeout and deduplicates overlap with disclosed caps",()=>{
    const rows=Array.from({length:30},(_,i)=>({title:`Business ${i}`,place_id:`place-${i}`}));
    const raw=[...rows,rows[0]].map(row=>JSON.stringify(row)).join("\n")+'\n{"unfinished":';
    const partial=parseNativeOutput(raw,25,true,1);expect(partial.entries).toHaveLength(25);expect(partial.partial).toBe(true);expect(partial.warning).toContain("25 of 30");expect(partial.warning).toContain("1 incomplete");
    expect(parseNativeOutput(rows.map(r=>JSON.stringify(r)).join("\n"),200).entries).toHaveLength(30);
    expect(()=>parseNativeOutput("",200,true,1)).toThrow("without usable listings");
  });
  it("persists options and richer data, and never calls fallback for a broad discovery job",async()=>{
    const store=new DemoStore();let fallbackCalls=0;let seenQuery="";
    const discovery=new BusinessDiscovery(store,async(query,_directory,_extended,options)=>{seenQuery=query;expect(options?.emails).toBe(true);return {entries:[{title:"Test clinic",place_id:"ChIJtestclinic",credit_cards_accepted:["VISA"],popular_times:{Monday:{9:42}},reservations:[{link:"https://example.com/book",source:"Website"}],menu:{link:"javascript:bad",source:"Bad"},owner:{name:"Public label",link:"https://example.com/owner"}}],partial:true,warning:"Time budget reached"};},{status:async()=>({configured:true,enabled:true,ready:true,monthly:1000,perJob:100,message:"ready"}),collect:async()=>{fallbackCalls++;throw new Error("Must not call fallback");}});
    const job=await discovery.startCollection(["Dentists Delhi","Dentists Noida"],collectionOptionsSchema.parse({emails:true}));
    await expect.poll(async()=>(await discovery.get(job.id))?.status).toBe("completed");
    expect(seenQuery).toBe("Dentists Delhi\nDentists Noida");expect(fallbackCalls).toBe(0);
    const dataset=(await store.listIntelligenceImports())[0];expect(dataset.collection).toMatchObject({provider:"builtin",partial:true,options:{emails:true}});expect(dataset.listings[0]).toMatchObject({creditCards:["VISA"],popularTimes:{Monday:{9:42}},menu:null,reservations:[{url:"https://example.com/book"}]});
    const history=await discovery.list();expect(history.find(j=>j.id===job.id)).toMatchObject({datasetId:dataset.id,listingCount:1,partial:true});
  });
  it("cancels a running native job without saving a false completion or trying fallback",async()=>{
    const store=new DemoStore();let began=false;
    const discovery=new BusinessDiscovery(store,async(_query,_dir,_extra,_opts,signal)=>{began=true;await new Promise<void>(resolve=>signal!.addEventListener("abort",()=>resolve(),{once:true}));return [{title:"Cancelled"}];});
    const job=await discovery.startCollection(["Test clinic"],collectionOptionsSchema.parse({}));
    await expect.poll(()=>began).toBe(true);expect(discovery.cancel(job.id)).toBe(true);
    await expect.poll(async()=>(await discovery.get(job.id))?.status).toBe("cancelled");expect(await store.listIntelligenceImports()).toHaveLength(0);
  });
  it("exports collected fields and escapes spreadsheet formulas",()=>{
    const dataset=normalizeImport({label:"Export",entries:[{title:"=1+1",credit_cards_accepted:["VISA"],phone:"+123"}]});
    const csv=collectionCsv(dataset);expect(csv).toContain("creditCards");expect(csv).toContain("VISA");expect(csv).toContain("'=1+1");expect(csv).toContain("'+123");
  });
  it("normalizes absent rich fields without inventing facts",()=>{
    expect(normalizeImport({label:"Old snapshot",entries:[{title:"Clinic"}]}).listings[0]).toMatchObject({creditCards:[],popularTimes:{},reservations:[],owner:null});
  });
});
