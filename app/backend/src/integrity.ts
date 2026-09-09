import { createHmac } from "node:crypto";
import { config } from "./config.js";
import type { ProfileSnapshot } from "./types.js";

export const snapshotHash=(snapshot:ProfileSnapshot)=>createHmac("sha256",config.sessionSecret).update(JSON.stringify(snapshot)).digest("hex");
export const evidenceHash=(businessId:string,externalReference:string,occurredAt:string)=>createHmac("sha256",config.sessionSecret).update(`${businessId}\u0000${externalReference}\u0000${occurredAt}`).digest("hex");
export function diffSnapshots(before:ProfileSnapshot,after:ProfileSnapshot){return (Object.keys(after) as Array<keyof ProfileSnapshot>).filter(field=>before[field]!==after[field]).map(field=>({field,before:before[field],after:after[field]}))}
