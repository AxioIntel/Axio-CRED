import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fallbackReason, normalizeOutscraper, outscraperConfig, OutscraperFallback } from "./outscraper.js";
const placeId="ChIJtestListing123";
const place={place_id:placeId,name:"Fixture business",reviews:100,reviews_data:[
  {author_id:"a",author_title:"A",reviews_id:"same-place-id",review_text:"Review A",review_rating:1,review_timestamp:1700000000,owner_answer:"Owner reply"},
  {author_id:"b",author_title:"B",reviews_id:"same-place-id",review_text:"Review B",review_rating:5,review_timestamp:1700000001}
]};
const success=()=>new Response(JSON.stringify({status:"Success",data:[[place]]}));
const pending=()=>new Response(JSON.stringify({status:"Pending",id:"request-123",results_location:"https://attacker.example/steal"}),{status:202});
async function setup(fetcher:typeof fetch, overrides:Partial<ReturnType<typeof outscraperConfig>>={},options:Record<string,unknown>={}) {
  const directory=await mkdtemp(join(tmpdir(),"axiocred-outscraper-"));
  const config={key:"test-secret",enabled:true,perJob:2000,monthly:5000,...overrides};
  const dependencies={directory,fetch:fetcher,sleep:async()=>{},pollAttempts:1,...options};
  return {provider:new OutscraperFallback(config,dependencies),directory,config,dependencies};
}
afterEach(()=>vi.restoreAllMocks());
describe("Outscraper mapping and fallback policy",()=>{
  it("does not collapse reviews using the provider's place-level reviews_id and preserves evidence",()=>{
    const result=normalizeOutscraper([[{...place,reviews_data:[...place.reviews_data,place.reviews_data[0]]}]],placeId,"2026-09-09T00:00:00.000Z");
    expect(result.listings[0].reviews).toHaveLength(2);
    expect(result.listings[0].reviews[0]).toMatchObject({text:"Review A",rating:1,reply:"Owner reply",when:"2023-11-14T22:13:20.000Z",source:"Outscraper · Google Maps"});
    expect(result.listings[0].reviewCount).toBe(100);
    expect(()=>normalizeOutscraper([place],"ChIJdifferent",new Date().toISOString())).toThrow(/exactly/);
  });
  it("only falls back for exact-ID failures or material full-history gaps",()=>{
    const partial={reviews:Array(1000).fill({}),reviewCount:1169};
    expect(fallbackReason(placeId,true,partial)).toContain("169");
    expect(fallbackReason(placeId,false,partial)).toBeNull();
    expect(fallbackReason(undefined,true,partial,true)).toBeNull();
    expect(fallbackReason(placeId,true,{reviews:Array(1165),reviewCount:1169})).toBeNull();
    expect(fallbackReason(placeId,true,{reviews:[],reviewCount:0})).toBeNull();
    expect(fallbackReason(placeId,true,{reviews:[],reviewCount:null})).toBeTruthy();
    expect(fallbackReason(placeId,false,undefined,true)).toBeTruthy();
  });
  it("a key alone never enables paid requests and invalid limits fail closed",async()=>{
    expect(outscraperConfig({OUTSCRAPER_API_KEY:"present"})).toMatchObject({enabled:false,monthly:0});
    expect(outscraperConfig({OUTSCRAPER_MONTHLY_REVIEW_LIMIT:"NaN",OUTSCRAPER_MAX_REVIEWS_PER_JOB:"0"})).toMatchObject({monthly:0,perJob:0});
    const fetcher=vi.fn();const {provider}=await setup(fetcher,{enabled:false});
    await expect(provider.collect(placeId,true,100,"test")).rejects.toThrow(/disabled/);
    expect((await provider.status()).ready).toBe(false);expect(fetcher).not.toHaveBeenCalled();
  });
});
describe("bounded durable provider execution",()=>{
  it("does not buy a sample smaller than the evidence already collected",async()=>{
    const fetcher=vi.fn();const {provider}=await setup(fetcher,{monthly:25});
    await expect(provider.collect(placeId,true,1169,"gap",undefined,1000)).rejects.toThrow(/cannot improve/);
    expect(fetcher).not.toHaveBeenCalled();expect((await provider.status()).reserved).toBe(0);
  });
  it("fails closed if persisted budget data is corrupt",async()=>{
    const fetcher=vi.fn();const {provider,directory}=await setup(fetcher);
    await writeFile(join(directory,"ledger.json"),JSON.stringify({records:[{limit:-1000}]}));
    await expect(provider.collect(placeId,true,100,"gap")).rejects.toThrow(/ledger cannot be read/);expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses fixed-host async requests, polls once and reuses results across restart",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(pending()).mockResolvedValueOnce(success());
    const {provider,directory,config,dependencies}=await setup(fetcher);
    const result=await provider.collect(placeId,true,100,"missing reviews");
    const request=new URL(String(fetcher.mock.calls[0][0]));
    expect(request.origin).toBe("https://api.outscraper.cloud");expect(request.searchParams.get("reviewsLimit")).toBe("110");
    expect(request.searchParams.get("limit")).toBe("1");expect(request.searchParams.get("sort")).toBe("newest");
    expect(request.searchParams.get("ignoreEmpty")).toBe("false");expect(request.searchParams.get("async")).toBe("true");
    expect(fetcher.mock.calls[0][1]).toMatchObject({redirect:"error",headers:{"X-API-KEY":"test-secret"}});
    expect(fetcher.mock.calls[1][0]).toBe("https://api.outscraper.cloud/requests/request-123");
    const restarted=new OutscraperFallback(config,dependencies);
    expect((await restarted.collect(placeId,true,100,"retry")).id).toBe(result.id);expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await readFile(join(directory,"ledger.json"),"utf8")).not.toContain("test-secret");
    expect(result.collection).toMatchObject({provider:"outscraper",requestId:"request-123",requestedLimit:110});
  });
  it("reserves against the monthly cap before sending and blocks overspend across restart",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(success());
    const {provider,config,dependencies}=await setup(fetcher,{monthly:25});
    await provider.collect(placeId,true,100,"gap");
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("reviewsLimit")).toBe("25");
    await expect(new OutscraperFallback(config,dependencies).collect("ChIJsecondListing",true,100,"gap")).rejects.toThrow(/allowance/);
    expect(fetcher).toHaveBeenCalledTimes(1);expect((await provider.status()).reserved).toBe(25);
  });
  it("does not retry an uncertain submission or release its budget",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockRejectedValue(new Error("network failed test-secret"));
    const {provider}=await setup(fetcher);
    await expect(provider.collect(placeId,true,100,"gap")).rejects.toThrow(/saved request/);
    await expect(provider.collect(placeId,true,100,"retry")).rejects.toThrow(/already reserved/);
    expect(fetcher).toHaveBeenCalledTimes(1);expect((await provider.status()).reserved).toBe(110);
  });
  it("resumes a pending request after timeout without a new submission",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(pending()).mockResolvedValueOnce(pending()).mockResolvedValueOnce(success());
    const {provider,config,dependencies}=await setup(fetcher);
    await expect(provider.collect(placeId,true,100,"gap")).rejects.toThrow(/still pending/);
    await new OutscraperFallback(config,dependencies).collect(placeId,true,100,"resume");
    expect(fetcher.mock.calls.filter(([url])=>String(url).includes("google-maps-reviews"))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url])=>String(url).includes("/requests/"))).toHaveLength(2);
  });
  it("opens an account circuit on billing failures without exposing provider error bodies",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response("private provider message test-secret",{status:402}));
    const {provider}=await setup(fetcher);
    await expect(provider.collect(placeId,true,100,"gap")).rejects.toThrow(/HTTP 402/);
    await expect(provider.collect("ChIJsecondListing",true,100,"gap")).rejects.toThrow(/HTTP 402/);
    expect(fetcher).toHaveBeenCalledTimes(1);expect((await provider.status()).message).not.toContain("test-secret");
  });
  it("rejects provider identity mismatches without treating them as success",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({status:"Success",data:[{...place,place_id:"wrong"}]})));
    const {provider}=await setup(fetcher);
    await expect(provider.collect(placeId,true,100,"gap")).rejects.toThrow(/validate/);
  });
});
