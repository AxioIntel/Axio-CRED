import {productPlan} from "./product-plan.js";
import { config } from "./config.js";
import { randomUUID } from "node:crypto";

const baseUrl = config.paypalEnv === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
export function validatePayPalPlan(plan:"business"|"growth",value:unknown){
  const data=value as {status?:string;billing_cycles?:Array<{tenure_type?:string;frequency?:{interval_unit?:string;interval_count?:number};pricing_scheme?:{fixed_price?:{currency_code?:string;value?:string}}}>};
  const cycles=data?.billing_cycles??[],cycle=cycles[0],price=cycle?.pricing_scheme?.fixed_price;
  const expected=productPlan(plan).price;
  if(data?.status!=="ACTIVE"||cycles.length!==1||cycle?.tenure_type!=="REGULAR"||cycle.frequency?.interval_unit!=="MONTH"||cycle.frequency.interval_count!==1||price?.currency_code!=="USD"||!price.value||Number(price.value)!==expected)throw new Error(`Configure an active PayPal plan charging USD ${expected} per month before starting checkout.`);
}
async function accessToken(){
  const id=process.env.PAYPAL_CLIENT_ID??"";const secret=process.env.PAYPAL_CLIENT_SECRET??"";
  const response=await fetch(`${baseUrl}/v1/oauth2/token`,{method:"POST",headers:{Authorization:`Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
  if(!response.ok)throw new Error("PayPal authentication failed");return (await response.json() as {access_token:string}).access_token;
}
export async function createSubscription(plan:"business"|"growth"){
  const planId=plan==="business"?process.env.PAYPAL_BUSINESS_PLAN_ID:process.env.PAYPAL_GROWTH_PLAN_ID;if(!planId)throw new Error("PayPal plan is not configured");const token=await accessToken();
  const details=await fetch(`${baseUrl}/v1/billing/plans/${encodeURIComponent(planId)}`,{headers:{Authorization:`Bearer ${token}`}});if(!details.ok)throw new Error("PayPal plan details could not be verified");validatePayPalPlan(plan,await details.json());
  const response=await fetch(`${baseUrl}/v1/billing/subscriptions`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","PayPal-Request-Id":randomUUID()},body:JSON.stringify({plan_id:planId,custom_id:"00000000-0000-0000-0000-000000000001",application_context:{brand_name:"Axio-CRED",user_action:"SUBSCRIBE_NOW",return_url:`${config.appUrl}/settings?billing=approved`,cancel_url:`${config.appUrl}/settings?billing=cancelled`}})});
  if(!response.ok)throw new Error("PayPal could not create the subscription");const body=await response.json() as {id:string;links:{rel:string;href:string}[]};return {subscriptionId:body.id,approvalUrl:body.links.find(l=>l.rel==="approve")?.href};
}

export async function verifyWebhook(headers: Record<string, string | string[] | undefined>, event: unknown) {
  const webhookId=process.env.PAYPAL_WEBHOOK_ID??"";if(!webhookId||webhookId.startsWith("placeholder"))throw new Error("PayPal webhook verification is not configured");const token=await accessToken();
  const value=(name:string)=>{const raw=headers[name];return Array.isArray(raw)?raw[0]:raw??""};
  const response=await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({auth_algo:value("paypal-auth-algo"),cert_url:value("paypal-cert-url"),transmission_id:value("paypal-transmission-id"),transmission_sig:value("paypal-transmission-sig"),transmission_time:value("paypal-transmission-time"),webhook_id:webhookId,webhook_event:event})});
  if(!response.ok)throw new Error("PayPal webhook verification failed");const body=await response.json() as {verification_status?:string};return body.verification_status==="SUCCESS";
}
