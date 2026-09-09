import {afterEach,describe,expect,it,vi} from "vitest";
import type {AddressInfo} from "node:net";
import type {Request} from "express";
import {createApp} from "./app.js";
import {DemoStore} from "./demo-store.js";
import {normalizeImport} from "./intelligence.js";
import {acceptReportingGoogleUser,reportingActor} from "./reporting.js";
import {config} from "./config.js";
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
async function fixture(){
  const store=new DemoStore();const dataset=normalizeImport({label:"Reporting fixture",entries:[{title:"Fixture business",place_id:"ChIJ-fixture",user_reviews:[{review_id:"r1",Name:"Reviewer",Description:"Collected source text",Rating:4}]}]});await store.saveIntelligenceImport(dataset);
  const server=createApp(store).listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call=async(path:string,method="GET",body?:unknown,headers={})=>{const r=await fetch(base+path,{method,headers:{"Content-Type":"application/json",...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
  return {store,dataset,call,close:()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))};
}
describe("reporting workflow",()=>{
  it("deduplicates source reviews and enforces approval, revisions and manual submission",async()=>{
    const f=await fixture();try{
      const input={datasetId:f.dataset.id,listingId:"0",reviewId:"r1",notes:"Original evidence note"};
      const first=await f.call("/api/reporting/cases","POST",input);expect(first.status).toBe(201);
      const second=await f.call("/api/reporting/cases","POST",{...input,notes:"Do not overwrite"});expect(second.body.duplicate).toBe(true);expect(second.body.case.notes).toBe(input.notes);
      const member=await f.call("/api/reporting/members","POST",{email:"reviewer@example.com"});
      const path="/api/reporting/cases/"+first.body.case.id;
      const edit={version:1,action:"submit",assigneeId:member.body.id,notes:input.notes,policy:"Off-topic",reference:"Submitted manually at 12:00",outcome:"",confirmed:true};
      expect((await f.call(path,"PATCH",edit)).status).toBe(400);
      expect((await f.call(path,"PATCH",{...edit,action:"approve",confirmed:false})).status).toBe(400);
      const approved=await f.call(path,"PATCH",{...edit,action:"approve"});expect(approved.body.status).toBe("approved");
      expect((await f.call(path,"PATCH",edit)).status).toBe(409);
      expect((await f.call(path,"PATCH",{...edit,version:2,notes:"Changed evidence"})).status).toBe(400);
      const changed=await f.call(path,"PATCH",{...edit,version:2,action:"save",notes:"Changed evidence"});expect(changed.body.status).toBe("draft");
      await f.call(path,"PATCH",{...edit,version:3,action:"approve"});
      const submitted=await f.call(path,"PATCH",{...edit,version:4});expect(submitted.body.status).toBe("submitted");expect(submitted.body.events.at(-1).action).toContain("not verified by Google");
      expect((await f.call(path,"PATCH",{...edit,version:5,action:"save",notes:"Rewrite submitted evidence"})).status).toBe(400);
      const closed=await f.call(path,"PATCH",{...edit,version:5,action:"close",outcome:"User observed no removal"});expect(closed.body.status).toBe("closed");
      expect(closed.body.review.text).toBe("Collected source text");
    }finally{await f.close();}
  });
  it("enforces twenty seats, rejects cross-origin writes and denies anonymous production access",async()=>{
    const f=await fixture();try{
      const results=await Promise.all(Array.from({length:21},(_,i)=>f.call("/api/reporting/members","POST",{email:`team${i}@example.com`})));
      expect(results.filter(r=>r.status===201)).toHaveLength(20);expect(results.filter(r=>r.status===409)).toHaveLength(1);
      expect((await f.call("/api/reporting/members","POST",{email:"x@example.com"},{Origin:"https://untrusted.example"})).status).toBe(403);
      vi.stubEnv("NODE_ENV","production");expect([401,503]).toContain((await f.call("/api/reporting")).status);
    }finally{await f.close();}
  });
  it("requires a verified authorized Google email and invalidates a revoked member's session",async()=>{
    const store=new DemoStore();await store.mutateReportingState(s=>{s.members.push({id:"member",name:"Member",email:"member@example.com",active:true});});
    await expect(acceptReportingGoogleUser(store,{sub:"google-sub",email:"member@example.com",email_verified:false})).rejects.toThrow("verified email");
    await expect(acceptReportingGoogleUser(store,{sub:"other",email:"other@example.com",email_verified:true})).rejects.toThrow("not been authorized");
    const token=await acceptReportingGoogleUser(store,{sub:"google-sub",email:"member@example.com",email_verified:true});
    const previous=config.sessionSecretConfigured;config.sessionSecretConfigured=true;vi.stubEnv("NODE_ENV","production");
    const req={headers:{cookie:`axiocred_reporting_session=${token}`},socket:{remoteAddress:"127.0.0.1"}} as Request;
    try{expect((await reportingActor(req,store)).id).toBe("member");await store.mutateReportingState(s=>{s.members[0].active=false;});await expect(reportingActor(req,store)).rejects.toThrow("Sign in");}finally{config.sessionSecretConfigured=previous;}
  });
});
