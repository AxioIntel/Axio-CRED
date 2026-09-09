import {describe,it,expect,vi} from "vitest";
import {normalizeImport} from "./intelligence.js";
import {projectEvidence} from "./evidence-index.js";
import {DemoStore} from "./demo-store.js";
import {ReviewAnalysisService} from "./review-analysis.js";

describe("evidence identity and lookup",()=>{
  it("keeps uncertain dates and reported counts unknown, and excludes quarantined text",()=>{
    const dataset=normalizeImport({label:"Fixture",entries:[{title:"Fixture",place_id:"ChIJfixture",user_reviews:[{review_id:"a",Description:"Owner words",reply_text:"Owner words",source:"Google Maps public page",When:"a month ago"},{review_id:"b",Description:"Actual review",Rating:4}]}]});
    const [row]=projectEvidence(dataset);expect(row.identity).toBe("place:ChIJfixture");expect(row.usable).toBe(1);expect(row.withheld).toBe(1);expect(row.collectedAt).toBeNull();expect(row.listing.reviewCount).toBeNull();expect(row.listing.reviews[0].publishedAt).toBeNull();
  });
  it("does not merge unidentified listings by a shared business name",()=>{
    const dataset=normalizeImport({label:"Fixture",entries:[{title:"Branch"},{title:"Branch"}]});
    const rows=projectEvidence(dataset);expect(rows[0].identity).not.toBe(rows[1].identity);expect(rows[0].id).not.toBe(rows[1].id);
  });
  it("loads assessment context directly even when the recent collection window excludes it",async()=>{
    const store=new DemoStore();const dataset=normalizeImport({label:"Archived fixture",entries:[{title:"Fixture",place_id:"ChIJarchived",user_reviews:[{review_id:"r",Description:"A review",Rating:4}]}]});await store.saveIntelligenceImport(dataset);
    await store.saveCompetitorWorkspace({baselineKey:null,targets:[{id:crypto.randomUUID(),name:"Fixture",listingKey:"place:ChIJarchived",mapsUrl:null}]});
    vi.spyOn(store,"listIntelligenceImports").mockResolvedValue([]);
    const fetcher=vi.fn();const service=new ReviewAnalysisService(store,{key:"fixture",fetcher});
    const result=await service.get(dataset.id,"0");expect(result.report).toBeNull();expect(fetcher).not.toHaveBeenCalled();
  });
});
