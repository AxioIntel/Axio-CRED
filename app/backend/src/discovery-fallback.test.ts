import { describe, expect, it, vi } from "vitest";
import { BusinessDiscovery } from "./business-discovery.js";
import { DemoStore } from "./demo-store.js";
import { normalizeImport, type IntelligenceDataset } from "./intelligence.js";
import type { FallbackProvider } from "./outscraper.js";
const id="ChIJfallbackFixture";
const entries=(n=1,placeId=id)=>[{title:"Fixture",place_id:placeId,review_count:20,user_reviews:Array.from({length:n},(_,i)=>({review_id:`review-${i}`,Description:`text ${i}`}))}];
function provider(enabled=true,fail=false,count=20):FallbackProvider {
  return {status:async()=>({configured:true,enabled,ready:enabled,message:enabled?"Available":"Outscraper disabled. No paid calls.",perJob:2000,monthly:5000}),
    collect:vi.fn(async()=>{if(fail)throw new Error("Provider unavailable");const dataset:IntelligenceDataset=normalizeImport({label:"fallback",collectedAt:new Date().toISOString(),entries:entries(count)});dataset.collection={provider:"outscraper"};return dataset;})};
}
async function finish(discovery:BusinessDiscovery,full=true){const job=await discovery.startPlaceId(id,true,full);await expect.poll(async()=>(await discovery.get(job.id))?.status).not.toBe("running");return (await discovery.get(job.id))!;}
describe("discovery fallback integration",()=>{
  it("saves built-in partial evidence first, then uses a larger provider sample",async()=>{
    const store=new DemoStore(),fallback=provider();const discovery=new BusinessDiscovery(store,async()=>entries(),fallback);
    const job=await finish(discovery);expect(job.status).toBe("completed");expect(job.dataset?.listings[0].reviews).toHaveLength(20);
    expect(job.dataset?.collection?.provider).toBe("outscraper");expect(await store.listIntelligenceImports()).toHaveLength(2);
  });
  it("preserves local evidence when disabled or when provider execution fails",async()=>{
    for(const fallback of [provider(false),provider(true,true)]){
      const store=new DemoStore();const job=await finish(new BusinessDiscovery(store,async()=>entries(),fallback));
      expect(job.status).toBe("completed");expect(job.dataset?.listings[0].reviews).toHaveLength(1);expect(await store.listIntelligenceImports()).toHaveLength(1);
      if(!(await fallback.status()).enabled)expect(fallback.collect).not.toHaveBeenCalled();
    }
  });
  it("recovers from a failed collector for an exact ID",async()=>{
    const job=await finish(new BusinessDiscovery(new DemoStore(),async()=>{throw new Error("Collector timed out");},provider()));
    expect(job.status).toBe("completed");expect(job.fallback?.status).toBe("completed");
  });
  it("does not spend on routine partial snapshots, identity mismatches or persistence failure",async()=>{
    const fallback=provider();await finish(new BusinessDiscovery(new DemoStore(),async()=>entries(),fallback),false);
    expect(fallback.collect).not.toHaveBeenCalled();
    const mismatch=await finish(new BusinessDiscovery(new DemoStore(),async()=>entries(1,"wrong-id"),fallback));expect(mismatch.status).toBe("failed");
    const store=new DemoStore();vi.spyOn(store,"saveIntelligenceImport").mockRejectedValue(new Error("DB unavailable"));
    const broken=await finish(new BusinessDiscovery(store,async()=>entries(),fallback));expect(broken.error).toBe("DB unavailable");expect(fallback.collect).not.toHaveBeenCalled();
  });
  it("does not promote a smaller provider sample over the larger local sample",async()=>{
    const store=new DemoStore();const job=await finish(new BusinessDiscovery(store,async()=>entries(10),provider(true,false,5)));
    expect(job.dataset?.listings[0].reviews).toHaveLength(10);expect(await store.listIntelligenceImports()).toHaveLength(1);
  });
});
