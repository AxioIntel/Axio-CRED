import {describe,expect,it} from "vitest";
import {analysisConnection,azureResponsesUrl} from "./analysis-provider.js";
describe("AI provider configuration",()=>{
  it("accepts resource and v1 endpoint forms without duplicating the path",()=>{
    for(const ending of ["/","/openai/v1","/openai/v1/"])expect(azureResponsesUrl(`https://example.openai.azure.com${ending}`)).toBe("https://example.openai.azure.com/openai/v1/responses");
    expect(azureResponsesUrl("https://example.services.ai.azure.com/")).toContain("/openai/v1/responses");
  });
  it("rejects credential exfiltration destinations and unintended endpoint paths",()=>{
    for(const url of ["http://example.openai.azure.com","https://example.openai.azure.com.evil.test","https://evil.test","https://user:pass@example.openai.azure.com","https://example.openai.azure.com:444","https://example.openai.azure.com/?key=secret","https://example.openai.azure.com/#secret","https://example.services.ai.azure.com/api/projects/foo"])
      expect(azureResponsesUrl(url)).toBeNull();
  });
  it("does not fall back to a direct key when Azure settings are incomplete",()=>{
    const result=analysisConnection({}, {AI_PROVIDER:"azure",OPENAI_API_KEY:"direct-secret",AZURE_OPENAI_ENDPOINT:"https://example.openai.azure.com/"});
    expect(result.key).toBe("");expect(result.configured).toBe(false);expect(result.configurationError).toContain("AZURE_OPENAI_DEPLOYMENT");
    expect(analysisConnection({}, {AI_PROVIDER:"typo",OPENAI_API_KEY:"secret"}).configured).toBe(false);
  });
});
