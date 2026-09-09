import {productPlan} from "./product-plan.js";
import {PlanLimitError} from "./errors.js";
import type {CompetitorWorkspace} from "./competitor-workspace.js";
export const monitoredLimit=(plan:string)=>productPlan(plan).businesses??Infinity;
export function monitoredKeys(businesses:{id:string;publicListingKey?:string}[],watch:CompetitorWorkspace){
  const keys=new Set(businesses.map(b=>b.publicListingKey??`business:${b.id}`));
  if(watch.baselineKey)keys.add(watch.baselineKey);
  for(const target of watch.targets)keys.add(target.listingKey??`pending:${target.id}`);
  return keys;
}
export function enforceMonitoredLimit(plan:string,before:Set<string>,after:Set<string>){
  if(after.size>monitoredLimit(plan)&&after.size>before.size)throw new PlanLimitError(`The ${plan} plan allows ${monitoredLimit(plan)} monitored businesses in total. Owned businesses, competitors and comparison references share the same allowance.`);
}
