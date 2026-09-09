import { describe, expect, it } from "vitest";
import { competitorWorkspaceSchema } from "./competitor-workspace.js";
const target={id:"d0fd3d78-1e64-4d7c-a124-57d8bdc00be2",name:"Competitor",mapsUrl:"https://share.google/test",listingKey:null};
describe("watchlist validation",()=>{
  it("accepts a pending Maps link and rejects executable or non-Google URLs",()=>{
    expect(competitorWorkspaceSchema.safeParse({baselineKey:null,targets:[target]}).success).toBe(true);
    for(const mapsUrl of ["javascript:alert(1)","https://google.com.evil.example/maps","https://www.google.com/search"]){
      expect(competitorWorkspaceSchema.safeParse({baselineKey:null,targets:[{...target,mapsUrl}]}).success).toBe(false);
    }
  });
  it("rejects self-comparison and duplicate identities",()=>{
    expect(competitorWorkspaceSchema.safeParse({baselineKey:"self",targets:[{...target,listingKey:"self"}]}).success).toBe(false);
    expect(competitorWorkspaceSchema.safeParse({baselineKey:null,targets:[target,target]}).success).toBe(false);
  });
});
