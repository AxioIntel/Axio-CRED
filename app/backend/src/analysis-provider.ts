export type AnalysisProvider = "openai" | "azure";
export interface ProviderOptions {provider?:AnalysisProvider;key?:string;model?:string;endpoint?:string}
const filled=(value:string)=>Boolean(value.trim()&&!/^(placeholder|replace|paste|your[_-])/i.test(value.trim()));

// Accept only Azure's public resource endpoints; never send a key to an arbitrary URL or redirect.
export function azureResponsesUrl(endpoint:string):string|null {
  try {
    const url=new URL(endpoint.trim());
    if(url.protocol!=="https:"||url.username||url.password||url.port||url.search||url.hash)return null;
    if(!/^[a-z0-9][a-z0-9-]*\.(?:openai\.azure\.com|services\.ai\.azure\.com)$/i.test(url.hostname))return null;
    if(!["/","/openai/v1","/openai/v1/"].includes(url.pathname))return null;
    return `${url.origin}/openai/v1/responses`;
  }catch{return null;}
}

export function analysisConnection(options:ProviderOptions={},env:NodeJS.ProcessEnv=process.env) {
  const requested=options.provider??env.AI_PROVIDER??"openai";
  const provider:AnalysisProvider=requested==="azure"?"azure":"openai";
  const key=(options.key??(provider==="azure"?env.AZURE_OPENAI_API_KEY:env.OPENAI_API_KEY)??"").trim();
  const model=(options.model??(provider==="azure"?env.AZURE_OPENAI_DEPLOYMENT:env.OPENAI_MODEL)??(provider==="openai"?"gpt-4.1-mini-2025-04-14":"")).trim();
  const url=provider==="azure"?azureResponsesUrl(options.endpoint??env.AZURE_OPENAI_ENDPOINT??""):"https://api.openai.com/v1/responses";
  const missing:string[]=[];
  if(!["azure","openai"].includes(requested))missing.push("AI_PROVIDER must be azure or openai");
  if(!filled(key))missing.push(provider==="azure"?"AZURE_OPENAI_API_KEY":"OPENAI_API_KEY");
  if(!filled(model))missing.push(provider==="azure"?"AZURE_OPENAI_DEPLOYMENT":"OPENAI_MODEL");
  if(!url)missing.push("AZURE_OPENAI_ENDPOINT must be an HTTPS Azure resource endpoint");
  return {provider,key,model,url,configured:missing.length===0,configurationError:missing.length?`AI analysis is not configured. Check ${missing.join(", ")} in the backend environment and restart the API.`:null};
}
