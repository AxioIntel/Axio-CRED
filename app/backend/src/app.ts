import {registerPlatformProfiles} from "./platform-profiles.js";
import {redressalCsv} from "./redressal.js";
import express from "express";
import {registerReporting,acceptReportingGoogleUser,reportingCookie} from "./reporting.js";
import cors from "cors";
import { z } from "zod";
import { config } from "./config.js";
import type { AppStore } from "./types.js";
import { createSubscription, verifyWebhook } from "./paypal.js";
import { paypalConfiguration } from "./paypal-config.js";
import { PlanLimitError } from "./errors.js";
import { exchangeCode, googleUser, listGoogleLocations, seal, secureEqual, unseal } from "./google.js";
import { randomUUID } from "node:crypto";
import { normalizeImport } from "./intelligence.js";
import { competitorWorkspaceSchema } from "./competitor-workspace.js";
import { AnalysisError, ReviewAnalysisService, type AnalysisOptions } from "./review-analysis.js";
import { BusinessDiscovery, validDiscoveryQuery, validPlaceId, type DiscoveryRunner } from "./business-discovery.js";

const businessInput = z.object({ name: z.string().min(2), address: z.string().min(3), category: z.string().min(2) });
const statusInput = z.object({ status: z.enum(["open", "investigating", "resolved"]) });
const snapshotInput=z.object({businessId:z.string().min(1),snapshot:z.object({address:z.string(),phone:z.string(),category:z.string(),businessStatus:z.string(),latitude:z.number(),longitude:z.number(),serviceAreaOnly:z.boolean(),photoCount:z.number().int().nonnegative()})});
const transactionInput=z.object({businessId:z.string().min(1),externalReference:z.string().min(3).max(255),occurredAt:z.string().datetime()});
const reviewSnapshotInput=z.object({subjectType:z.enum(["business","competitor"]),subjectId:z.string().min(1),rating:z.number().min(0).max(5),reviewCount:z.number().int().nonnegative()});
const performanceInput=z.object({businessId:z.string().min(1),impressions:z.number().int().nonnegative(),calls:z.number().int().nonnegative(),websiteClicks:z.number().int().nonnegative(),directionRequests:z.number().int().nonnegative()});
const cookieValue=(header:string|undefined,name:string)=>header?.split(";").map(x=>x.trim()).find(x=>x.startsWith(`${name}=`))?.slice(name.length+1);
const cookieOptions=()=>`HttpOnly; SameSite=Lax; Path=/; ${config.appUrl.startsWith("https://")?"Secure; ":""}`;

export function createApp(store: AppStore, discoveryRunner?: DiscoveryRunner, analysisOptions?:AnalysisOptions) {
  const app = express();
  const discovery = new BusinessDiscovery(store, discoveryRunner);
  const analysis = new ReviewAnalysisService(store,analysisOptions);
  app.use(cors({ origin: config.appUrl, credentials: true }));
  // The customer workspace has no tenant authorization yet. A production image
  // must not expose preview data or provider actions merely because it can boot.
  app.use("/api", (req, res, next) => {
    if (process.env.NODE_ENV === "production" && !["/health", "/ready"].includes(req.path)) {
      return res.status(503).json({error:"Customer workspace access is disabled in production until tenant authorization is implemented."});
    }
    next();
  });
  app.use("/api/intelligence/imports", express.json({ limit: "10mb" }));
  app.use(express.json({ limit: "1mb" }));

  registerReporting(app,store);
  registerPlatformProfiles(app,store);
  app.get("/api/intelligence/imports/:id", async (req,res)=>{const dataset=await store.getIntelligenceImport(req.params.id);return dataset?res.json(dataset):res.status(404).json({error:"This collection was not found in this workspace."});});
  app.get("/api/intelligence/imports", async (_req, res) => res.json(await store.listIntelligenceImports()));
  const analysisInput=z.object({datasetId:z.string().uuid(),listingId:z.string().min(1).max(255)});
  app.get("/api/review-analysis",async(req,res)=>{const parsed=analysisInput.safeParse(req.query);if(!parsed.success)return res.status(400).json({error:"Select a collected competitor."});return res.json(await analysis.get(parsed.data.datasetId,parsed.data.listingId));});
  app.post("/api/review-analysis",async(req,res)=>{const parsed=analysisInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Select a collected competitor."});return res.json(await analysis.analyze(parsed.data.datasetId,parsed.data.listingId));});
  app.post("/api/intelligence/imports", async (req, res) => {
    const result = (() => { try { return { dataset: normalizeImport(req.body) }; } catch { return null; } })();
    if (!result) return res.status(400).json({ error: "Import needs 1–1,000 scraper entries with a title. Check field types and review ratings (0–5). Maximum file size is 10 MB." });
    await store.saveIntelligenceImport(result.dataset);
    return res.status(201).json(result.dataset);
  });
  app.get("/api/intelligence/collector", (_req, res) => res.json({ status: discovery.available() ? "local_on_demand" : "unavailable", available: discovery.available(), message: "On-demand business search uses the local repository scraper. Scheduled collection is not enabled." }));
  app.get("/api/competitor-workspace", async (_req, res) => res.json(await store.getCompetitorWorkspace()));
  app.put("/api/competitor-workspace", async (req, res) => {
    const parsed = competitorWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the competitor details." });
    await store.saveCompetitorWorkspace(parsed.data);
    return res.json(parsed.data);
  });
  app.use(["/api/places/lookup", "/api/public-audits"], (_req, res) => res.status(503).json({ error: "Official Places collection is disabled. Use the scraper dashboard to import your collector output." }));

  app.get("/api/health", (_req, res) => res.json({ status: "ok", dataMode: config.dataMode }));
  app.get("/api/ready", async (_req, res) => { const ready = await store.healthCheck(); return res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "unavailable", dataMode: config.dataMode }); });
  app.get("/api/session", (req, res) => {let user={id:"demo-user",name:"Alex Morgan",email:"alex@example.com",role:"owner"};const token=cookieValue(req.headers.cookie,"axiocred_session");if(token){try{const parsed=JSON.parse(unseal(token));if(parsed.exp>Date.now())user={id:parsed.sub,name:parsed.name,email:parsed.email,role:"owner"}}catch{res.setHeader("Set-Cookie",`axiocred_session=; ${cookieOptions()}Max-Age=0`)}}return res.json({user,workspace:{id:"00000000-0000-0000-0000-000000000001",name:"Northstar Dental Group",plan:"Growth"}})});
  app.get("/api/auth/google/start", (req, res) => {
    const reporting=req.query.purpose==="reporting",businessAccess=req.query.purpose==="business";
    if(reporting&&!config.googleConfigured)return res.status(503).json({error:"Google team sign-in needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, SESSION_SECRET and REPORTING_OWNER_EMAIL in the backend environment."});
    if (!config.googleConfigured) return res.json({ mode: "demo", redirectUrl: "/overview", message: "Google OAuth is using a local preview session." });
    if(reporting&&(!process.env.GOOGLE_CLIENT_SECRET||!process.env.GOOGLE_REDIRECT_URI||!z.email().safeParse(process.env.REPORTING_OWNER_EMAIL).success||config.sessionSecret.length<32))return res.status(503).json({error:"Configure the Google client secret, exact redirect URI, reporting owner email and a session secret of at least 32 characters."});
    if(!config.sessionSecretConfigured)return res.status(503).json({error:"Set a strong SESSION_SECRET before enabling Google OAuth."});const state=seal(JSON.stringify({nonce:randomUUID(),purpose:reporting?"reporting":businessAccess?"business":"login",exp:Date.now()+600_000}));res.setHeader("Set-Cookie",`axiocred_oauth_state=${state}; ${cookieOptions()}Max-Age=600`);
    const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? `${config.appUrl}/api/auth/google/callback`, response_type: "code", access_type: businessAccess?"offline":"online", prompt: businessAccess?"consent":"select_account", state, scope: businessAccess?"openid email profile https://www.googleapis.com/auth/business.manage":"openid email profile" });
    return res.json({ mode: "google", redirectUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  });
  app.get("/api/auth/google/callback",async(req,res)=>{const parsed=z.object({code:z.string().min(1),state:z.string().min(1)}).safeParse(req.query);const expected=cookieValue(req.headers.cookie,"axiocred_oauth_state");if(!parsed.success||!expected||!secureEqual(parsed.data.state,expected))return res.status(400).send("Invalid or expired Google OAuth state.");try{const state=JSON.parse(unseal(expected));if(state.exp<Date.now())return res.status(400).send("Google OAuth state expired.");const tokens=await exchangeCode(parsed.data.code);const user=await googleUser(tokens.access_token);if(user.email_verified!==true)return res.status(403).send("A verified Google email is required.");if(state.purpose==="reporting"){const session=await acceptReportingGoogleUser(store,user);res.setHeader("Set-Cookie",[`axiocred_oauth_state=; ${cookieOptions()}Max-Age=0`,reportingCookie(session)]);return res.redirect(`${config.appUrl}/settings?team=connected`);}if(state.purpose==="login"){const session=seal(JSON.stringify({sub:user.sub,email:user.email,name:user.name??user.email,exp:Date.now()+8*60*60*1000}));res.setHeader("Set-Cookie",[`axiocred_oauth_state=; ${cookieOptions()}Max-Age=0`,`axiocred_session=${session}; ${cookieOptions()}Max-Age=28800`]);return res.redirect(`${config.appUrl}/overview`);}await store.saveGoogleConnection({subject:user.sub,email:user.email,displayName:user.name??user.email,accessToken:seal(tokens.access_token),refreshToken:tokens.refresh_token?seal(tokens.refresh_token):"",expiresAt:new Date(Date.now()+tokens.expires_in*1000).toISOString()});const session=seal(JSON.stringify({sub:user.sub,email:user.email,name:user.name??user.email,exp:Date.now()+8*60*60*1000}));res.setHeader("Set-Cookie",[`axiocred_oauth_state=; ${cookieOptions()}Max-Age=0`,`axiocred_session=${session}; ${cookieOptions()}Max-Age=28800`]);return res.redirect(`${config.appUrl}/businesses?google=connected`)}catch(error){return res.status(502).send(error instanceof Error?error.message:"Google OAuth failed")}});
  app.get("/api/google/locations",async(_req,res)=>{if(!config.googleConfigured)return res.json({mode:"demo",locations:[{googleLocationId:"locations/demo",name:"Northstar Dental Preview",address:"24 Market Street, Austin",category:"Dentist",website:"",phone:"",serviceAreaOnly:false}]});try{return res.json({mode:"google",locations:await listGoogleLocations(store)})}catch(error){return res.status(502).json({error:error instanceof Error?error.message:"Google locations request failed"})}});
  app.get("/api/overview", async (_req, res) => res.json(await store.getOverview()));
  app.get("/api/businesses", async (_req, res) => res.json(await store.listBusinesses()));
  app.get("/api/business-search/status", async (_req,res)=>res.json({available:discovery.available(),fallback:await discovery.fallbackStatus()}));
  app.post("/api/business-search",async(req,res)=>{
    if(req.body?.placeId!==undefined){if(!validPlaceId(req.body.placeId))return res.status(400).json({error:"Paste only the Place ID from Google’s finder, without a link or spaces."});try{return res.status(202).json(await discovery.startPlaceId(req.body.placeId,req.body.refresh===true,req.body.extendedReviews===true));}catch(error){return res.status(409).json({error:error instanceof Error?error.message:"Could not load this Place ID."});}}
    if(!validDiscoveryQuery(req.body?.query))return res.status(400).json({error:"Enter a business name and city, or a Google Maps/share link."});
    try{return res.status(202).json(await discovery.start(req.body.query));}catch(error){return res.status(409).json({error:error instanceof Error?error.message:"Search could not start."});}
  });
  app.get("/api/business-search/:id",async(req,res)=>{
    if(!z.string().uuid().safeParse(req.params.id).success)return res.status(400).json({error:"Invalid search ID."});
    const job=await discovery.get(req.params.id);return job?res.json(job):res.status(404).json({error:"Search not found."});
  });
  app.post("/api/businesses/select",async(req,res)=>{
    const parsed=z.object({datasetId:z.string().uuid(),listingId:z.string().min(1).max(255)}).safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:"Select a business from the search results."});
    try{
      const business=await store.selectBusinessListing(parsed.data.datasetId,parsed.data.listingId);
      const workspace=await store.getCompetitorWorkspace();
      if(!workspace.baselineKey&&business.publicListingKey)await store.saveCompetitorWorkspace({...workspace,baselineKey:business.publicListingKey});
      return res.status(201).json(business);
    }catch(error){if(error instanceof PlanLimitError)throw error;return res.status(400).json({error:error instanceof Error?error.message:"Business could not be added."});}
  });
  app.post("/api/competitor-workspace/select",async(req,res)=>{
    const parsed=z.object({datasetId:z.string().uuid(),listingId:z.string().min(1).max(255)}).safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:"Select a competitor from the collected results."});
    const dataset=await store.getIntelligenceImport(parsed.data.datasetId);
    const listing=dataset?.listings.find(l=>l.id===parsed.data.listingId);
    if(!listing||(!listing.placeId&&!listing.cid))return res.status(400).json({error:"This result is no longer available. Load the competitor again."});
    const workspace=await store.getCompetitorWorkspace();
    const listingKey=listing.placeId?`place:${listing.placeId}`:`cid:${listing.cid}`;
    if(workspace.baselineKey===listingKey)return res.status(400).json({error:"This is your comparison baseline. Choose a different business as a competitor."});
    const existing=workspace.targets.find(t=>t.listingKey===listingKey||Boolean(listing.mapsUrl&&t.mapsUrl===listing.mapsUrl));
    const target={id:existing?.id??randomUUID(),name:listing.name,mapsUrl:listing.mapsUrl,listingKey};
    const next=competitorWorkspaceSchema.safeParse({...workspace,targets:existing?workspace.targets.map(t=>t.id===existing.id?target:t):[...workspace.targets,target]});
    if(!next.success)return res.status(400).json({error:next.error.issues[0]?.message??"Check the competitor details."});
    await store.saveCompetitorWorkspace(next.data);
    return res.status(existing?200:201).json(target);
  });
  app.post("/api/businesses", async (req, res) => { const parsed = businessInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Check the business details and try again." }); return res.status(201).json(await store.addBusiness(parsed.data)); });
  app.get("/api/competitors", async (_req, res) => res.json(await store.listCompetitors()));
  app.post("/api/competitors", async (req, res) => {
    return res.status(410).json({ error: "Use the competitor watchlist to add a monitored business. An owned business is not required.", replacement: "/api/competitor-workspace/select" });
  });
  app.get("/api/competitors/:id/reviews", (_req, res) => res.status(503).json({ error: "Review collection uses the repository scraper. Open Dashboard to inspect imported reviews; live collection is not connected." }));
  app.get("/api/incidents", async (_req, res) => res.json(await store.listIncidents()));
  app.patch("/api/incidents/:id", async (req, res) => { const parsed = statusInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid incident status." }); const result = await store.updateIncident(req.params.id, parsed.data.status); return result ? res.json(result) : res.status(404).json({ error: "Incident not found." }); });
  app.post("/api/audits", async (req, res) => { const parsed = z.object({ businessId: z.string().min(1) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Choose a business to audit." }); return res.status(202).json(await store.createAudit(parsed.data.businessId)); });
  app.post("/api/monitor/profile-snapshots",async(req,res)=>{const parsed=snapshotInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Provide a complete profile snapshot."});return res.status(201).json(await store.captureProfileSnapshot(parsed.data.businessId,parsed.data.snapshot))});
  app.post("/api/evidence/transactions",async(req,res)=>{const parsed=transactionInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Provide a business, transaction reference, and ISO service time."});return res.status(201).json(await store.addTransactionEvidence(parsed.data))});
  app.post("/api/monitor/review-snapshots",async(req,res)=>{const parsed=reviewSnapshotInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Provide a valid review snapshot."});return res.status(201).json(await store.captureReviewSnapshot(parsed.data))});
  app.post("/api/monitor/performance-snapshots",async(req,res)=>{const parsed=performanceInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Provide complete Business Profile performance metrics."});return res.status(201).json(await store.capturePerformanceSnapshot(parsed.data))});
  app.get("/api/integrations", async (_req, res) => {const googleConnection=await store.getGoogleConnection();return res.json({ google: { configured: config.googleConfigured, connected: Boolean(googleConnection), label: config.googleConfigured ? "Google Business Profile" : "Demo Google connection" }, analysis: {configured:analysis.configured,model:analysis.model}, paypal: paypalConfiguration(process.env), outscraper: await discovery.fallbackStatus(), storage: { provider: "Azure Blob Storage", status: process.env.AZURE_STORAGE_ACCOUNT?"configured":"local database evidence" } })});
  app.get("/api/v1/overview", async (req, res) => {
    if (!config.enterpriseApiKey || req.header("x-api-key") !== config.enterpriseApiKey) return res.status(config.enterpriseApiKey ? 401 : 503).json({ error: config.enterpriseApiKey ? "Invalid API key." : "Enterprise API is not configured." });
    return res.json(await store.getOverview());
  });
  app.get("/api/reports/redressal.csv", async (_req, res) => {
    res.type("text/csv").attachment("axiocred-redressal-draft.csv").send(await redressalCsv(store));
  });
  app.post("/api/billing/subscribe", async (req, res) => { const plan = z.enum(["business", "growth"]).safeParse(req.body?.plan); if (!plan.success) return res.status(400).json({ error: "Choose a valid plan." }); if (!config.paypalConfigured) return res.status(503).json({ error: "PayPal checkout is unavailable until credentials, both plans and webhook verification are configured." }); try{return res.json({mode:config.paypalEnv,...await createSubscription(plan.data)})}catch(error){return res.status(502).json({error:error instanceof Error?error.message:"PayPal request failed"})} });
  app.post("/api/webhooks/paypal", async (req, res) => {if(!config.paypalConfigured)return res.status(503).json({error:"PayPal is not configured."});try{if(!await verifyWebhook(req.headers,req.body))return res.status(400).json({error:"Invalid PayPal signature."});const event=req.body as {id?:string;event_type?:string;resource?:{id?:string;plan_id?:string;status?:string}};if(!event.id||!event.event_type)return res.status(400).json({error:"Invalid PayPal event."});const plan=event.resource?.plan_id===process.env.PAYPAL_BUSINESS_PLAN_ID?"business":event.resource?.plan_id===process.env.PAYPAL_GROWTH_PLAN_ID?"growth":undefined;const subscription=plan&&event.resource?.id?{id:event.resource.id,plan,status:event.resource.status??"UNKNOWN"}:undefined;return res.status(202).json(await store.recordPayPalEvent(event.id,event.event_type,req.body,subscription))}catch(error){return res.status(400).json({error:error instanceof Error?error.message:"PayPal webhook failed"})}});
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if(error instanceof z.ZodError)return res.status(400).json({error:"Check the supplied fields and try again."});
    if(error instanceof AnalysisError)return res.status(error.status).json({error:error.message});
    if (error instanceof PlanLimitError) return res.status(error.status).json({ error: error.message });
    if (error && typeof error === "object" && "type" in error) {
      if (error.type === "entity.too.large") return res.status(413).json({ error: "This import exceeds the 10 MB request limit." });
      if (error.type === "entity.parse.failed") return res.status(400).json({ error: "The request body must be valid JSON." });
    }
    const reference=randomUUID();
    console.error(JSON.stringify({reference,method:_req.method,path:_req.path,code:error&&typeof error==="object"&&"code" in error?String(error.code):"INTERNAL_ERROR"}));
    const action=_req.path.startsWith("/api/competitor-workspace")?"The competitor workspace could not be saved or loaded. Please retry.":"The request could not be completed. Please retry.";
    return res.status(500).json({error:`${action} Reference: ${reference}`,reference});
  });
  return app;
}
