import {afterEach,describe,expect,it} from "vitest";
import type {AddressInfo} from "node:net";
import {monitoredKeys,enforceMonitoredLimit} from "./entitlements.js";
import {validatePayPalPlan} from "./paypal.js";
import {DemoStore} from "./demo-store.js";
import {createApp} from "./app.js";
import {normalizeImport} from "./intelligence.js";
import {config} from "./config.js";
const oldGoogle=config.googleConfigured,oldSecret=config.sessionSecretConfigured;
afterEach(()=>{config.googleConfigured=oldGoogle;config.sessionSecretConfigured=oldSecret;});
describe("monitored-business pricing",()=>{
  it("shares one allowance across owned, competitor and reference identities",()=>{
    const own=[{id:"one",publicListingKey:"place:same"}];
    const watched={baselineKey:"place:same",targets:[{id:"same",name:"Same business",listingKey:"place:same",mapsUrl:null},{id:"two",name:"Competitor",listingKey:"place:second",mapsUrl:null}]};
    expect(monitoredKeys(own,watched).size).toBe(2);
    expect(()=>enforceMonitoredLimit("business",new Set(["place:same"]),monitoredKeys(own,watched))).toThrow("1 monitored businesses");
    expect(()=>enforceMonitoredLimit("growth",new Set(),new Set(["1","2","3","4","5"]))).not.toThrow();
    expect(()=>enforceMonitoredLimit("growth",new Set(["1","2","3","4","5"]),new Set(["1","2","3","4","5","6"]))).toThrow();
  });
  it("rejects stale PayPal amounts and accepts the approved monthly USD prices",()=>{
    const plan=(value:string)=>({status:"ACTIVE",billing_cycles:[{tenure_type:"REGULAR",frequency:{interval_unit:"MONTH",interval_count:1},pricing_scheme:{fixed_price:{value,currency_code:"USD"}}}]});
    expect(()=>validatePayPalPlan("business",plan("49.00"))).not.toThrow();expect(()=>validatePayPalPlan("growth",plan("149.00"))).not.toThrow();
    expect(()=>validatePayPalPlan("business",plan("50.00"))).toThrow("USD 49");expect(()=>validatePayPalPlan("growth",plan("150.00"))).toThrow("USD 149");
  });
  it("adds a collected competitor without any owned business comparison baseline",async()=>{
    const store=new DemoStore();const dataset=normalizeImport({label:"fixture",entries:[{title:"Independent monitored business",place_id:"ChIJindependent"}]});await store.saveIntelligenceImport(dataset);
    const server=createApp(store).listen(0);await new Promise<void>(r=>server.once("listening",r));
    try{const retired=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/competitors`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({businessId:"legacy",name:"Bypass"})});expect(retired.status).toBe(410);const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/competitor-workspace/select`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({datasetId:dataset.id,listingId:"0"})});expect(response.status).toBe(201);expect((await store.getCompetitorWorkspace()).baselineKey).toBeNull();expect((await store.getOverview()).locationsUsed).toBe(3);}finally{server.close();}
  });
  it("ordinary login omits business.manage; only explicit Business Profile connection requests it",async()=>{
    config.googleConfigured=true;config.sessionSecretConfigured=true;
    const server=createApp(new DemoStore()).listen(0);await new Promise<void>(r=>server.once("listening",r));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try{const basic=await (await fetch(base+"/api/auth/google/start")).json() as {redirectUrl:string};const own=await (await fetch(base+"/api/auth/google/start?purpose=business")).json() as {redirectUrl:string};
      expect(new URL(basic.redirectUrl).searchParams.get("scope")).toBe("openid email profile");expect(new URL(basic.redirectUrl).searchParams.get("access_type")).toBe("online");expect(new URL(own.redirectUrl).searchParams.get("scope")).toContain("business.manage");
    }finally{server.close();}
  });
});
