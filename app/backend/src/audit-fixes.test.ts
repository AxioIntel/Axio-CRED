import {describe,expect,it,vi} from "vitest";
import {DemoStore} from "./demo-store.js";
import {normalizeImport} from "./intelligence.js";
import {redressalCsv} from "./redressal.js";
import {listGoogleLocations,seal} from "./google.js";
import {BusinessDiscovery} from "./business-discovery.js";
describe("conversation audit fixes",()=>{
  it("exports actual watchlist evidence with formula protection instead of synthetic competitors",async()=>{
    const store=new DemoStore();const d=normalizeImport({label:"fixture",collectedAt:"2026-09-06T10:00:00Z",entries:[{title:"=HYPERLINK()",place_id:"ChIJtest",address:"Collected address",link:"https://www.google.com/maps/place/Test"}]});await store.saveIntelligenceImport(d);await store.saveCompetitorWorkspace({baselineKey:null,targets:[{id:crypto.randomUUID(),name:"Target",listingKey:"place:ChIJtest",mapsUrl:null}]});
    const csv=await redressalCsv(store);expect(csv).toContain("'=HYPERLINK()");expect(csv).toContain("Collected address");expect(csv).toContain("Google Maps URL");expect(csv).not.toContain("Northstar");expect(csv).not.toContain("30 Day Velocity");
  });
  it("bypasses cached Place IDs for explicitly requested extended collection",async()=>{
    const store=new DemoStore();const d=normalizeImport({label:"saved",entries:[{title:"Saved",place_id:"ChIJtestplace"}]});await store.saveIntelligenceImport(d);
    const runner=vi.fn(async()=>[{title:"Fresh",place_id:"ChIJtestplace"}]);const discovery=new BusinessDiscovery(store,runner);
    expect((await discovery.startPlaceId("ChIJtestplace")).cached).toBe(true);expect(runner).not.toHaveBeenCalled();
    const job=await discovery.startPlaceId("ChIJtestplace",true,true);await expect.poll(async()=>(await discovery.get(job.id))?.status).toBe("completed");
    expect((runner.mock.calls[0] as unknown[])[2]).toBe(true);expect((await store.listIntelligenceImports())).toHaveLength(2);
  });
  it("paginates Google accounts and locations and reads the correct category and SAB fields",async()=>{
    const store=new DemoStore();await store.saveGoogleConnection({subject:"test",email:"fixture@example.com",displayName:"Fixture",accessToken:seal("fixture-token"),refreshToken:"",expiresAt:new Date(Date.now()+3600000).toISOString()});
    const responses=[{accounts:[{name:"accounts/1"}],nextPageToken:"accounts-next"},{accounts:[{name:"accounts/2"}]},{locations:[{name:"locations/1",categories:{primaryCategory:{displayName:"Dental clinic"}}}],nextPageToken:"locations-next"},{locations:[{name:"locations/2",serviceArea:{businessType:"CUSTOMER_LOCATION_ONLY"}}]},{locations:[{name:"locations/1",categories:{primaryCategory:{displayName:"Dental clinic"}}}]}];
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(responses.shift())));const rows=await listGoogleLocations(store,fetcher);
    expect(rows).toHaveLength(2);expect(rows[0].category).toBe("Dental clinic");expect(rows[1].serviceAreaOnly).toBe(true);expect(fetcher).toHaveBeenCalledTimes(5);
    const calls=fetcher.mock.calls as unknown as [string,RequestInit][];expect(calls[1][0]).toContain("pageToken=accounts-next");expect(new URL(calls[2][0]).searchParams.get("readMask")).toContain("categories");expect(calls[2][0]).not.toContain("accounts/-");
  });
});
