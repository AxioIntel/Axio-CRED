import type { Express, Request } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppStore } from "./types.js";
import { config } from "./config.js";
import { seal, unseal } from "./google.js";
import { AnalysisError } from "./review-analysis.js";

export interface ReportingMember {id:string;email:string;name:string;subject?:string;active:boolean}
export interface ReportingCase {
  id:string;key:string;datasetId:string;listingId:string;business:string;mapsUrl:string|null;review:import("./intelligence.js").IntelligenceDataset["listings"][number]["reviews"][number];collectedAt:string|null;
  status:"draft"|"approved"|"submitted"|"closed";assigneeId:string|null;notes:string;policy:string;reference:string;outcome:string;version:number;
  events:{at:string;actor:string;action:string}[];
}
export interface ReportingState {members:ReportingMember[];cases:ReportingCase[]}
interface Actor {id:string;name:string;owner:boolean;preview:boolean}
export const reportingCookie=(value:string,maxAge=28800)=>`axiocred_reporting_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}; ${config.appUrl.startsWith("https://")?"Secure;":""}`;
const cookie=(req:Request)=>req.headers.cookie?.split(";").map(s=>s.trim()).find(s=>s.startsWith("axiocred_reporting_session="))?.split("=")[1];
function fail(message:string,status=400):never{throw new AnalysisError(message,status);}
export function localReportingPreview(req:Request){return process.env.NODE_ENV!=="production"&&!config.googleConfigured&&["127.0.0.1","::1","::ffff:127.0.0.1"].includes(req.socket.remoteAddress??"");}
function ownerEmail(){return (process.env.REPORTING_OWNER_EMAIL??"").trim().toLowerCase();}
export async function reportingActor(req:Request,store:AppStore):Promise<Actor>{
  if(localReportingPreview(req))return {id:"local-operator",name:"Local preview operator",owner:true,preview:true};
  if(!config.sessionSecretConfigured)fail("Reporting sign-in is not configured.",503);
  try{const value=JSON.parse(unseal(cookie(req)??""));if(value.exp<=Date.now())throw new Error();
    const member=(await store.getReportingState()).members.find(m=>m.id===value.id&&m.subject===value.sub&&m.active);
    if(member)return {id:member.id,name:member.email,owner:member.email===ownerEmail(),preview:false};
  }catch{}
  return fail("Sign in with an authorized reporting team Google account.",401);
}
export async function acceptReportingGoogleUser(store:AppStore,user:{sub:string;email:string;name?:string;email_verified?:boolean}){
  if(!user.email_verified||!user.sub||!z.email().safeParse(user.email).success)fail("Google did not return a verified email.",403);
  const email=user.email.toLowerCase();
  return store.mutateReportingState(state=>{
    const bound=state.members.find(m=>m.subject===user.sub);
    if(bound&&!bound.active)fail("This Google identity has been revoked.",403);
    let member=bound??state.members.find(m=>m.email===email&&m.active);
    if(!member&&email===ownerEmail()){
      if(state.members.filter(m=>m.active).length>=20)fail("The reporting team is full.",409);
      member={id:randomUUID(),email,name:user.name??email,active:true};state.members.push(member);
    }
    if(!member)fail("This email has not been authorized for the reporting team.",403);
    if(member.subject&&member.subject!==user.sub)fail("This team member is linked to a different Google identity.",403);
    member.subject=user.sub;member.name=user.name??email;
    return seal(JSON.stringify({id:member.id,sub:user.sub,exp:Date.now()+8*60*60*1000}));
  });
}
const caseInput=z.object({datasetId:z.string().uuid(),listingId:z.string().min(1).max(255),reviewId:z.string().min(1).max(512),notes:z.string().max(10000).default("")});
const updateInput=z.object({version:z.number().int().positive(),action:z.enum(["save","approve","submit","close"]),assigneeId:z.string().nullable(),notes:z.string().trim().max(10000),policy:z.string().trim().max(255),reference:z.string().trim().max(1000),outcome:z.string().trim().max(4000),confirmed:z.boolean().optional()});

export function registerReporting(app:Express,store:AppStore){
  // New reporting writes require JSON and a same-origin browser request.
  app.use("/api/reporting",(req,res,next)=>{
    if(!["GET","HEAD"].includes(req.method)&&(req.headers.origin&&req.headers.origin!==new URL(config.appUrl).origin||req.headers["sec-fetch-site"]==="cross-site"||!req.is("application/json")))return res.status(403).json({error:"Use the workspace reporting form."});
    next();
  });
  app.get("/api/reporting",async(req,res)=>{const actor=await reportingActor(req,store);const state=await store.getReportingState();res.json({...state,actor,googleConfigured:config.googleConfigured,limit:20});});
  app.post("/api/reporting/signout",(_req,res)=>{res.setHeader("Set-Cookie",reportingCookie("",0));res.json({ok:true});});
  app.post("/api/reporting/members",async(req,res)=>{
    const actor=await reportingActor(req,store);if(!actor.owner)fail("Only the reporting workspace owner can authorize team members.",403);
    const data=z.object({email:z.email().max(320)}).parse(req.body);const email=data.email.trim().toLowerCase();
    const result=await store.mutateReportingState(state=>{const existing=state.members.find(m=>m.email===email);if(existing?.active)return existing;
      if(state.members.filter(m=>m.active).length>=20)fail("Up to 20 active or pending team members are allowed.",409);
      const member=existing??{id:randomUUID(),email,name:email,active:true};member.active=true;if(!existing)state.members.push(member);return member;});
    res.status(201).json(result);
  });
  app.delete("/api/reporting/members/:id",async(req,res)=>{
    const actor=await reportingActor(req,store);if(!actor.owner)fail("Only the owner can revoke a team member.",403);
    await store.mutateReportingState(state=>{const member=state.members.find(m=>m.id===req.params.id);if(!member)fail("Member not found.",404);if(member.email===ownerEmail())fail("The configured owner cannot be revoked here.");member.active=false;});res.json({ok:true});
  });
  app.post("/api/reporting/cases",async(req,res)=>{
    const actor=await reportingActor(req,store);const input=caseInput.parse(req.body);
    const dataset=await store.getIntelligenceImport(input.datasetId);const listing=dataset?.listings.find(l=>l.id===input.listingId);const review=listing?.reviews.find(r=>r.id===input.reviewId);
    if(!dataset||!listing||!review||dataset.source!=="scraper_import")fail("Choose an actual collected review.",404);
    const identity=listing.placeId?`place:${listing.placeId}`:listing.cid?`cid:${listing.cid}`:null;
    if(!identity)fail("The listing needs a collected Google identity.");
    const key=createHash("sha256").update(JSON.stringify([identity,review.id])).digest("hex");
    const result=await store.mutateReportingState(state=>{const existing=state.cases.find(c=>c.key===key);if(existing)return {duplicate:true,case:existing};
      const item:ReportingCase={id:randomUUID(),key,datasetId:dataset.id,listingId:listing.id,business:listing.name,mapsUrl:listing.mapsUrl,review:structuredClone(review),collectedAt:dataset.collectedAt,status:"draft",assigneeId:actor.preview?null:actor.id,notes:input.notes,policy:"",reference:"",outcome:"",version:1,events:[{at:new Date().toISOString(),actor:actor.name,action:"Case created; source snapshot preserved"}]};state.cases.unshift(item);return {duplicate:false,case:item};});
    res.status(result.duplicate?200:201).json(result);
  });
  app.patch("/api/reporting/cases/:id",async(req,res)=>{
    const actor=await reportingActor(req,store);const input=updateInput.parse(req.body);
    const result=await store.mutateReportingState(state=>{
      const item=state.cases.find(c=>c.id===req.params.id);if(!item)fail("Case not found.",404);
      if(!actor.owner&&item.assigneeId!==actor.id)fail("Only the assignee or owner can update this case.",403);
      if(item.version!==input.version)fail("This case changed. Reload it before saving.",409);
      if(!actor.owner&&input.assigneeId!==item.assigneeId)fail("Only the owner can reassign a case.",403);
      if(input.assigneeId&&!state.members.some(m=>m.id===input.assigneeId&&m.active))fail("Choose an active team member.");
      if(item.status==="closed")fail("This case is closed.",409);
      if(input.action==="approve"&&(item.status!=="draft"||!input.assigneeId||input.notes.length<10||!input.policy||!input.confirmed))fail("Approval requires an assignee, a policy reason, verified evidence, and your confirmation.");
      if(input.action==="submit"&&(item.status!=="approved"||!input.confirmed||!input.reference))fail("Confirm manual submission and record a submission reference or dated note.");
      const materialChange=input.notes!==item.notes||input.policy!==item.policy||input.assigneeId!==item.assigneeId;
      if(input.action==="submit"&&materialChange)fail("Save and reapprove changed evidence or assignment before recording submission.");
      if(item.status==="submitted"&&materialChange)fail("Submitted evidence is locked. Record the outcome separately.");
      if(input.action==="close"&&!input.outcome)fail("Record an outcome or reason for closing.");
      Object.assign(item,{assigneeId:input.assigneeId,notes:input.notes,policy:input.policy,reference:input.reference,outcome:input.outcome});
      if(input.action==="approve")item.status="approved";
      else if(input.action==="submit")item.status="submitted";
      else if(input.action==="close")item.status="closed";
      else if(item.status==="approved"&&materialChange)item.status="draft";
      item.version++;item.events.push({at:new Date().toISOString(),actor:actor.name,action:input.action==="submit"?"Manual submission recorded by user (not verified by Google)":`${input.action}: ${item.status}`});return item;
    });res.json(result);
  });
}
