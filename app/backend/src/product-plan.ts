/** Product contract shared by entitlements, checkout validation and presentation. */
export const productPlans = {
  free: {name:"Free",price:0,businesses:0,checksPerDay:0},
  business: {name:"Business",price:49,businesses:1,checksPerDay:2},
  growth: {name:"Growth",price:149,businesses:5,checksPerDay:4},
  enterprise: {name:"Enterprise",price:null,businesses:null,checksPerDay:null}
} as const;
export function productPlan(value:string){return productPlans[value.toLowerCase() as keyof typeof productPlans]??productPlans.free;}
