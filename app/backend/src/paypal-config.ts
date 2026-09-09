export function paypalConfiguration(env: Record<string,string|undefined>) {
  const present=(key:string)=>Boolean(env[key]?.trim()&&!/^(placeholder|replace-)/i.test(env[key]!.trim()));
  const environment=env.PAYPAL_ENV??"sandbox";
  const required=["PAYPAL_CLIENT_ID","PAYPAL_CLIENT_SECRET","PAYPAL_BUSINESS_PLAN_ID","PAYPAL_GROWTH_PLAN_ID","PAYPAL_WEBHOOK_ID"];
  const missing=required.filter(key=>!present(key));
  if(!["live","sandbox"].includes(environment))missing.push("PAYPAL_ENV");
  return {configured:missing.length===0,environment,status:missing.length?"setup incomplete":"configured; payment verification pending",missing:missing.join(", ")};
}
