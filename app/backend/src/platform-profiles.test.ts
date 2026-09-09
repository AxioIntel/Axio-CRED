import {describe,it,expect} from "vitest";
import express from "express";
import type {AddressInfo} from "node:net";
import {collectPublicProfile,parsePublicProfile,profileUrl,registerPlatformProfiles} from "./platform-profiles.js";
import {DemoStore} from "./demo-store.js";
import {normalizeImport} from "./intelligence.js";

const html=`<script type="application/ld+json">${JSON.stringify({"@type":"LocalBusiness",name:"Example",aggregateRating:{ratingValue:4.2,reviewCount:200},review:[{author:{name:"Public author"},reviewBody:"Original review",reviewRating:{ratingValue:2},datePublished:"2026-09-01"},{author:{name:"Public author"},reviewBody:"Original review",reviewRating:{ratingValue:2},datePublished:"2026-09-01"}]})}</script>`;
describe("cross-platform profiles",()=>{
  it("canonicalizes profile links and rejects wrong hosts, login links and arbitrary fetch targets",()=>{
    expect(profileUrl("facebook","https://m.facebook.com/Example/?tracking=1")).toBe("https://www.facebook.com/example/reviews");
    expect(profileUrl("trustpilot","https://trustpilot.com/review/Example.com/?x=1")).toBe("https://www.trustpilot.com/review/example.com");
    for(const url of ["http://www.facebook.com/example","https://facebook.com.evil.test/example","https://user:pass@facebook.com/example","https://facebook.com:444/example","https://facebook.com/login","https://facebook.com/groups/example"]){expect(()=>profileUrl("facebook",url)).toThrow();}
    expect(()=>profileUrl("trustpilot","https://www.trustpilot.com/review/127.0.0.1")).toThrow();
    expect(()=>profileUrl("trustpilot","https://www.trustpilot.com/users/example")).toThrow();
  });
  it("keeps partial reviews and provenance; does not turn missing content into success or recommendations into stars",()=>{
    const snap=parsePublicProfile(html,"https://www.trustpilot.com/review/example.com");expect(snap.reviewCount).toBe(200);expect(snap.reviews).toHaveLength(1);expect(snap.coverage).toBe("partial");expect(snap.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(()=>parsePublicProfile("<html>Log in to continue</html>","https://www.facebook.com/example/reviews")).toThrow("no readable review data");
    const rec=parsePublicProfile('<script type="application/ld+json">{"name":"Example","review":{"reviewBody":"Recommended","reviewRating":{"ratingValue":"recommends"}}}</script>',"https://www.facebook.com/example/reviews");expect(rec.reviews[0].rating).toBeNull();expect(rec.rating).toBeNull();
  });
  it("never follows a blocked page or redirect to another host",async()=>{
    const fake=(async(_url:unknown,opts:RequestInit)=>{expect(opts.redirect).toBe("manual");return new Response("redirect",{status:302,headers:{location:"http://127.0.0.1/private"}});}) as typeof fetch;
    await expect(collectPublicProfile({platform:"facebook",url:"https://facebook.com/example"},fake)).rejects.toThrow("HTTP 302");
    const ok=(async()=>new Response(html,{headers:{"content-type":"text/html"}})) as typeof fetch;
    expect((await collectPublicProfile({platform:"trustpilot",url:"https://trustpilot.com/review/example.com"},ok)).reviews).toHaveLength(1);
  });
  it("requires a saved Google anchor, shares its slot, blocks duplicate mapping, and preserves successful data after a failed attempt",async()=>{
    const store=new DemoStore();const dataset=normalizeImport({label:"fixture",entries:[{title:"Example",place_id:"ChIJexample"},{title:"Other",place_id:"ChIJother"}]});await store.saveIntelligenceImport(dataset);await store.selectBusinessListing(dataset.id,"0");await store.selectBusinessListing(dataset.id,"1");
    let fail=false;const app=express();app.use(express.json());registerPlatformProfiles(app,store,async profile=>{if(fail)throw new Error("HTTP 403 blocked");return parsePublicProfile(html,profile.url);});const server=app.listen(0);await new Promise<void>(r=>server.once("listening",r));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/platform-profiles`;
    const send=(path:string,method:string,body:unknown={})=>fetch(base+path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const input={entityKey:"place:ChIJexample",platform:"facebook",url:"https://facebook.com/example",confirmedSameBusiness:true};
    try{
      expect((await send("","PUT",{...input,entityKey:"place:unknown"})).status).toBe(400);
      expect((await send("","PUT",{...input,confirmedSameBusiness:false})).status).toBe(400);
      const before=(await store.getOverview()).locationsUsed;const p=await (await send("","PUT",input)).json();expect(p.id).toBeTruthy();
      expect((await send("","PUT",{...input,platform:"trustpilot",url:"https://trustpilot.com/review/example.com"})).status).toBe(200);expect((await store.getOverview()).locationsUsed).toBe(before);
      expect((await send("","PUT",{...input,entityKey:"place:ChIJother"})).status).toBe(409);
      const collected=await (await send(`/${p.id}/collect`,"POST")).json();expect(collected.snapshots).toHaveLength(1);
      expect((await send(`/${p.id}/collect`,"POST")).status).toBe(429);
      await store.mutatePlatformState(s=>{s.profiles.find(x=>x.id===p.id)!.lastAttemptAt="2020-01-01T00:00:00Z";});fail=true;
      const failed=await (await send(`/${p.id}/collect`,"POST")).json();expect(failed.error).toContain("403");expect(failed.snapshots).toHaveLength(1);
      const cross=await fetch(base,{method:"PUT",headers:{"Content-Type":"application/json",Origin:"https://other.test"},body:JSON.stringify(input)});expect(cross.status).toBe(403);
      expect((await send(`/${p.id}`,"DELETE")).status).toBe(200);expect((await store.getPlatformState()).profiles).toHaveLength(1);
    }finally{server.close();}
  });
});
