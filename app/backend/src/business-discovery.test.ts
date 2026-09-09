import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { DemoStore } from "./demo-store.js";
import { BusinessDiscovery, placeIdMapsUrl, validDiscoveryQuery, validPlaceId } from "./business-discovery.js";
import type { AddressInfo } from "node:net";

describe("built-in business search",()=>{
  it("targets an exact Place ID, rejects mismatches, and reuses a saved listing",async()=>{
    const placeId="ChIJexampleBusinessFixture";const store=new DemoStore();const queries:string[]=[];
    const discovery=new BusinessDiscovery(store,async query=>{queries.push(query);return [{title:"Example Business",place_id:placeId}];});
    expect(validPlaceId(placeId)).toBe(true);expect(validPlaceId("https://example.com")).toBe(false);expect(validPlaceId("bad id")).toBe(false);
    const first=await discovery.startPlaceId(placeId);
    await expect.poll(async()=>(await discovery.get(first.id))?.status).toBe("completed");
    expect(queries).toEqual([placeIdMapsUrl(placeId)]);
    const cached=await discovery.startPlaceId(placeId);expect(cached.cached).toBe(true);expect(cached.dataset?.listings[0].placeId).toBe(placeId);expect(queries).toHaveLength(1);
    const full=await discovery.startPlaceId(placeId,false,true);
    expect(full.cached).not.toBe(true);
    await expect.poll(async()=>(await discovery.get(full.id))?.status).toBe("completed");
    expect(queries).toHaveLength(2);
    const mismatch=await discovery.startPlaceId("ChIJanotherPlaceId");
    await expect.poll(async()=>(await discovery.get(mismatch.id))?.status).toBe("failed");
    expect((await store.listIntelligenceImports())).toHaveLength(2);
  });
  it("accepts public business searches and rejects unsafe URL or multiline inputs",()=>{
    expect(validDiscoveryQuery("Example Business Example City")).toBe(true);
    expect(validDiscoveryQuery("https://share.google/example")).toBe(true);
    for(const input of ["ab","hello\nsecond query","https://localhost:8080/","https://google.com.evil.example/maps","file:///etc/passwd","http://www.google.com/maps"]){expect(validDiscoveryQuery(input)).toBe(false);}
  });
  it("runs search, persists results, and selects a business once by identity",async()=>{
    const store=new DemoStore();let calls=0;
    const app=createApp(store,async()=>{calls++;return [{title:"Actual selection",place_id:"ChIJselection",address:"123 Test Road",category:"Dentist",review_rating:4.8,review_count:42}];});
    const server=app.listen(0);await new Promise<void>(resolve=>server.once("listening",resolve));
    const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
    try{
      const started=await fetch(base+"/api/business-search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:"Actual selection Test City"})});
      expect(started.status).toBe(202);const job=await started.json() as {id:string};
      await expect.poll(async()=>((await (await fetch(base+"/api/business-search/"+job.id)).json()) as {status:string}).status).toBe("completed");
      const imports=await store.listIntelligenceImports();expect(imports).toHaveLength(1);expect(calls).toBe(1);
      const before=(await store.listBusinesses()).length;
      const select=()=>fetch(base+"/api/businesses/select",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({datasetId:imports[0].id,listingId:"0"})});
      const first=await (await select()).json() as {id:string;rating:number;publicListingKey:string};
      const second=await (await select()).json() as {id:string};
      expect(first.id).toBe(second.id);expect(first.rating).toBe(4.8);expect(first.publicListingKey).toBe("place:ChIJselection");
      expect((await store.listBusinesses()).length).toBe(before+1);
      const competitorSelect=()=>fetch(base+"/api/competitor-workspace/select",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({datasetId:imports[0].id,listingId:"0"})});
      expect((await competitorSelect()).status).toBe(400);
      await store.saveCompetitorWorkspace({baselineKey:"place:another-owned-business",targets:[]});
      const competitor=await competitorSelect();expect(competitor.status).toBe(201);
      const competitorAgain=await competitorSelect();expect(competitorAgain.status).toBe(200);
      expect((await store.getCompetitorWorkspace()).targets).toHaveLength(1);
      expect((await store.listBusinesses()).length).toBe(before+1);
      const bad=await fetch(base+"/api/businesses/select",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({datasetId:imports[0].id,listingId:"unavailable"})});expect(bad.status).toBe(400);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
