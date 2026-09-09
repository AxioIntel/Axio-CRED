import {afterEach,describe,expect,it,vi} from "vitest";
import {createApp} from "./app.js";
import {DemoStore} from "./demo-store.js";
import type {AddressInfo} from "node:net";

afterEach(()=>vi.unstubAllEnvs());
describe("production preview boundary",()=>{
  it("blocks unauthenticated reads and writes before any workspace or provider work",async()=>{
    vi.stubEnv("NODE_ENV","production");
    const store=new DemoStore(),read=vi.spyOn(store,"listIntelligenceImports"),write=vi.spyOn(store,"saveIntelligenceImport");
    const runner=vi.fn(async()=>[]);
    const server=createApp(store,runner).listen(0,"127.0.0.1");
    await new Promise<void>(resolve=>server.once("listening",resolve));
    const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for(const path of ["/api/intelligence/imports","/api/google/locations","/api/session","/api/v1/overview"]){
        expect((await fetch(base+path)).status).toBe(503);
      }
      for(const path of ["/api/intelligence/imports","/api/review-analysis","/api/business-search","/api/billing/subscribe","/api/webhooks/paypal"]){
        expect((await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).status).toBe(503);
      }
      expect((await fetch(base+"/api/health")).status).toBe(200);
      expect((await fetch(base+"/api/ready")).status).toBe(200);
      expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(runner).not.toHaveBeenCalled();
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
