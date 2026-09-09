// Creates catalog plans only; never creates or approves a customer subscription.
import fs from 'node:fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
const envPath=fileURLToPath(new URL('../.env',import.meta.url));
const env=dotenv.parse(fs.readFileSync(envPath));
const mode=process.argv.includes('--live')?'live':'sandbox';
const base=mode==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
const save=(key,value)=>{let source=fs.readFileSync(envPath,'utf8');const pattern=new RegExp(`^${key}=.*$`,'m');source=pattern.test(source)?source.replace(pattern,`${key}=${value}`):source.trimEnd()+`\n${key}=${value}\n`;fs.writeFileSync(envPath,source);env[key]=value;};
async function json(path,options={}) {
  const response=await fetch(base+path,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});
  const body=await response.json();
  if(!response.ok)throw new Error(`PayPal ${response.status}: ${body.name??body.error??'request failed'}`);
  return body;
}
try {
  const auth=await json('/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.PAYPAL_CLIENT_ID+':'+env.PAYPAL_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  const request=(path,body,key)=>json(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth.access_token,'Content-Type':'application/json',...(key?{'PayPal-Request-Id':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  async function list(path,field){const rows=[];for(let page=1;page<=100;page++){const data=await request(`${path}?page_size=20&page=${page}`);rows.push(...(data[field]??[]));if(!data.links?.some(x=>x.rel==='next'))return rows;}throw new Error('Too many catalog pages; inspect manually.');}
  const products=await list('/v1/catalogs/products','products');
  let product=products.find(x=>x.name==='Axio-CRED Reputation Monitoring');
  if(!product)product=await request('/v1/catalogs/products',{name:'Axio-CRED Reputation Monitoring',description:'Business reputation monitoring subscription',type:'SERVICE',category:'SOFTWARE'},`axiocred-product-v1-${mode}`);
  save('PAYPAL_ENV',mode);save('PAYPAL_PRODUCT_ID',product.id);
  const plans=await list('/v1/billing/plans','plans');
  for(const [tier,amount,description] of [['Business','49.00','1 business; checked twice a day.'],['Growth','149.00','5 businesses; checked four times a day.']]){
    const name=`Axio-CRED ${tier} - USD ${amount}/month`;
    let plan;
    for(const candidate of plans.filter(x=>x.name===name)) {const detail=await request('/v1/billing/plans/'+candidate.id);if(detail.product_id===product.id&&detail.status==='ACTIVE'){plan=detail;break;}}
    if(!plan)plan=await request('/v1/billing/plans',{product_id:product.id,name,description,status:'ACTIVE',billing_cycles:[{frequency:{interval_unit:'MONTH',interval_count:1},tenure_type:'REGULAR',sequence:1,total_cycles:0,pricing_scheme:{fixed_price:{value:amount,currency_code:'USD'}}}],payment_preferences:{auto_bill_outstanding:false,payment_failure_threshold:1}},`axiocred-${tier.toLowerCase()}-v1-${mode}`);
    const verified=await request('/v1/billing/plans/'+plan.id),cycles=verified.billing_cycles,cycle=cycles?.[0];
    if(verified.status!=='ACTIVE'||cycles.length!==1||cycle.frequency.interval_unit!=='MONTH'||cycle.frequency.interval_count!==1||cycle.total_cycles!==0||cycle.pricing_scheme.fixed_price.currency_code!=='USD'||Number(cycle.pricing_scheme.fixed_price.value)!==Number(amount))throw new Error('Plan verification failed for '+tier);
    save(`PAYPAL_${tier.toUpperCase()}_PLAN_ID`,plan.id);
    console.log(JSON.stringify({environment:mode,tier,id:plan.id,status:verified.status,monthlyUSD:amount}));
  }
  console.log('Plan IDs saved. No subscriptions or payments created. Webhook requires a public HTTPS backend.');
}catch(error){console.error(error instanceof Error?error.message:'PayPal setup failed');process.exitCode=1;}
