import {describe,it,expect} from "vitest";
import {paypalConfiguration} from "./paypal-config.js";
describe("PayPal setup readiness",()=>{
  const complete={PAYPAL_ENV:"live",PAYPAL_CLIENT_ID:"id",PAYPAL_CLIENT_SECRET:"secret",PAYPAL_BUSINESS_PLAN_ID:"P-business",PAYPAL_GROWTH_PLAN_ID:"P-growth",PAYPAL_WEBHOOK_ID:"WH-id"};
  it("does not advertise readiness from a client ID alone",()=>expect(paypalConfiguration({PAYPAL_CLIENT_ID:"id"}).configured).toBe(false));
  it("blocks checkout without webhook verification",()=>{const status=paypalConfiguration({...complete,PAYPAL_WEBHOOK_ID:"placeholder"});expect(status.configured).toBe(false);expect(status.missing).toContain("PAYPAL_WEBHOOK_ID");expect(JSON.stringify(status)).not.toContain("secret");});
  it("accepts complete settings and rejects an invalid environment",()=>{expect(paypalConfiguration(complete).configured).toBe(true);expect(paypalConfiguration({...complete,PAYPAL_ENV:"production"}).configured).toBe(false);});
});
