import { describe, expect, it } from "vitest";
import { DemoStore } from "./demo-store.js";
import { createApp } from "./app.js";
import { normalizeImport } from "./intelligence.js";
import type { AddressInfo } from "node:net";

describe("scraper intelligence", () => {
  it("deduplicates reviews and preserves missing fields and zero coordinates", () => {
    const review={review_id:"review1",Name:"Author",Description:"Public review",Rating:4};
    const dataset=normalizeImport({label:"fixture",entries:[{title:"One",latitude:0,longtitude:0,user_reviews:[review],user_reviews_extended:[{...review,Description:null,reply_text:"Owner response"}],web_site:"javascript:alert(1)"}]});
    expect(dataset.listings[0].reviews).toHaveLength(1);
    expect(dataset.listings[0].reviews[0].reply).toBe("Owner response");
    expect(dataset.listings[0].reviews[0].text).toBe("Public review");
    expect(dataset.listings[0].reviewCount).toBeNull();
    expect(dataset.listings[0].longitude).toBe(0);
    expect(dataset.listings[0].website).toBeNull();
    expect(dataset.collectedAt).toBeNull();
    expect(dataset.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects invalid coordinates",()=>{
    expect(()=>normalizeImport({label:"bad",entries:[{title:"Bad location",latitude:200}]})).toThrow();
  });
  it("preserves original owner replies when the scraper has no translated reply",()=>{
    const dataset=normalizeImport({label:"reply regression",entries:[{title:"Business",user_reviews:[{review_id:"original",reply_text_original:"Thank you for your feedback."},{review_id:"both",reply_text_original:"Original reply",reply_text:"Translated reply"}]}]});
    expect(dataset.listings[0].reviews[0].reply).toBe("Thank you for your feedback.");
    expect(dataset.listings[0].reviews[1].reply).toBe("Original reply");
  });
  it("persists imports and disables official Places collection", async () => {
    const server=createApp(new DemoStore()).listen(0);
    await new Promise<void>(resolve=>server.once("listening",resolve));
    const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
    try {
      const created=await fetch(base+"/api/intelligence/imports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:"Test export",entries:[{title:"Test business",phone:"5550100",emails:["info@example.com"]}]})});
      expect(created.status).toBe(201);
      const datasets=await (await fetch(base+"/api/intelligence/imports")).json() as Array<{label:string;listings:unknown[]}>;
      expect(datasets[0].label).toBe("Test export");expect(datasets[0].listings).toHaveLength(1);
      expect((await fetch(base+"/api/places/lookup?placeId=ChIJtest")).status).toBe(503);
      expect((await fetch(base+"/api/public-audits",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:"test"})})).status).toBe(503);
      const collector=await (await fetch(base+"/api/intelligence/collector")).json() as {status:string};
      expect(["local_on_demand", "unavailable"]).toContain(collector.status);
    } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
  });
});
