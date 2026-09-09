import {describe,expect,it} from "vitest";
import {demoDataset} from "./intelligence-data";
import {observedReviewers,publicProfileChanges,snapshotHistory} from "./evidence-insights";
describe("observed evidence insights",()=>{
  const listing={...demoDataset.listings[0],placeId:"ChIJone"};
  it("excludes unknown collection dates and unrelated listing identities from history",()=>{
    const row={...demoDataset,source:"scraper_import" as const,listings:[listing]};
    const history=snapshotHistory(listing,[{...row,id:"new",collectedAt:"2026-09-06T10:00:00Z"},{...row,id:"unknown"},{...row,id:"old",collectedAt:"2026-09-04T10:00:00Z"},{...row,id:"other",collectedAt:"2026-09-03T10:00:00Z",listings:[{...listing,placeId:"ChIJtwo"}]}]);
    expect(history.map(r=>r.datasetId)).toEqual(["old","new"]);
    expect(publicProfileChanges({...listing,phone:null},listing)).toEqual([]);
  });
  it("matches contributors by identity rather than names and deduplicates repeated snapshots",()=>{
    const target={...listing,reviews:[{...listing.reviews[0],authorUrl:"https://www.google.com/maps/contrib/123/reviews"}]};
    const other={...listing,placeId:"ChIJother",reviews:[{...target.reviews[0],id:"other-review",author:"Different display name"}]};
    const wrong={...listing,placeId:"ChIJwrong",reviews:[{...target.reviews[0],authorUrl:"https://www.google.com/maps/contrib/456/reviews"}]};
    const row={...demoDataset,source:"scraper_import" as const,listings:[target,other,wrong]};
    const result=observedReviewers(target,[row,row]);expect(result).toHaveLength(1);expect(result[0].businesses).toHaveLength(1);expect(result[0].businesses[0].reviews).toBe(1);
  });
});
