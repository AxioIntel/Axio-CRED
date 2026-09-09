import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import type { AppStore, GoogleConnection } from "./types.js";

const key = createHash("sha256").update(config.sessionSecret).digest();

export function seal(value: string) {
  const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",key,iv);const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64url");
}
export function unseal(value: string) {
  const data=Buffer.from(value,"base64url");const iv=data.subarray(0,12);const tag=data.subarray(12,28);const decipher=createDecipheriv("aes-256-gcm",key,iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString("utf8");
}
export function secureEqual(left:string,right:string){const a=Buffer.from(left);const b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b)}

type GoogleTokens={access_token:string;refresh_token?:string;expires_in:number};
export async function exchangeCode(code:string){const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID??"",client_secret:process.env.GOOGLE_CLIENT_SECRET??"",redirect_uri:process.env.GOOGLE_REDIRECT_URI??"",grant_type:"authorization_code"})});if(!response.ok)throw new Error("Google authorization code exchange failed");return await response.json() as GoogleTokens}
async function refresh(refreshToken:string){const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({refresh_token:refreshToken,client_id:process.env.GOOGLE_CLIENT_ID??"",client_secret:process.env.GOOGLE_CLIENT_SECRET??"",grant_type:"refresh_token"})});if(!response.ok)throw new Error("Google access token refresh failed");return await response.json() as GoogleTokens}
export async function googleUser(accessToken:string){const response=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{Authorization:`Bearer ${accessToken}`}});if(!response.ok)throw new Error("Google user profile request failed");return await response.json() as {sub:string;email:string;name?:string;email_verified?:boolean}}

async function usableConnection(store:AppStore){const connection=await store.getGoogleConnection();if(!connection)throw new Error("Connect Google Business Profile first.");if(new Date(connection.expiresAt).getTime()>Date.now()+60_000)return {...connection,accessToken:unseal(connection.accessToken),refreshToken:connection.refreshToken?unseal(connection.refreshToken):""};if(!connection.refreshToken)throw new Error("Reconnect Google to renew access.");const refreshToken=unseal(connection.refreshToken);const tokens=await refresh(refreshToken);const updated:GoogleConnection={...connection,accessToken:seal(tokens.access_token),refreshToken:connection.refreshToken,expiresAt:new Date(Date.now()+tokens.expires_in*1000).toISOString()};await store.saveGoogleConnection(updated);return {...updated,accessToken:tokens.access_token,refreshToken}}

export async function listGoogleLocations(store:AppStore,fetcher:typeof fetch=fetch){
  const connection=await usableConnection(store);
  async function pages(url:string,field:"accounts"|"locations"){
    const rows:Array<Record<string,unknown>>=[];let token="";const seen=new Set<string>();
    do{const target=new URL(url);if(token)target.searchParams.set("pageToken",token);
      const response=await fetcher(target.href,{headers:{Authorization:`Bearer ${connection.accessToken}`},signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error(`Google Business Profile ${field} request failed (${response.status}).`);
      const body=await response.json() as {accounts?:Array<Record<string,unknown>>;locations?:Array<Record<string,unknown>>;nextPageToken?:string};
      rows.push(...(body[field]??[]));token=body.nextPageToken??"";
      if(token&&(seen.has(token)||seen.size>=100))throw new Error("Google pagination did not complete within the safety limit. Narrow the account scope.");if(token)seen.add(token);
    }while(token);return rows;
  }
  const accounts=await pages("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20","accounts");
  const readMask="name,title,storefrontAddress,categories,phoneNumbers,websiteUri,regularHours,openInfo,serviceArea";
  const locations=new Map<string,Record<string,unknown>>();
  for(const account of accounts){const name=String(account.name??"");if(!/^accounts\/[A-Za-z0-9_-]+$/.test(name))throw new Error("Google returned an invalid account identifier.");
    const rows=await pages(`https://mybusinessbusinessinformation.googleapis.com/v1/${name}/locations?readMask=${encodeURIComponent(readMask)}&pageSize=100`,"locations");
    for(const row of rows)if(row.name)locations.set(String(row.name),row);
  }
  return [...locations.values()].map(location=>({googleLocationId:String(location.name),name:String(location.title??"Untitled location"),address:formatAddress(location.storefrontAddress),category:String((location.categories as {primaryCategory?:{displayName?:string}}|undefined)?.primaryCategory?.displayName??"Business"),website:String(location.websiteUri??""),phone:String((location.phoneNumbers as {primaryPhone?:string}|undefined)?.primaryPhone??""),serviceAreaOnly:(location.serviceArea as {businessType?:string}|undefined)?.businessType==="CUSTOMER_LOCATION_ONLY"}));
}
function formatAddress(value:unknown){const address=value as {addressLines?:string[];locality?:string;administrativeArea?:string;postalCode?:string}|undefined;if(!address)return "Service area business";return [...(address.addressLines??[]),address.locality,address.administrativeArea,address.postalCode].filter(Boolean).join(", ")}
