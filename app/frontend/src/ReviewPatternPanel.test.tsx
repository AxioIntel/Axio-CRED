import {describe,it,expect} from "vitest";
import {investigationHtml} from "./ReviewPatternPanel";
import {demoDataset} from "./intelligence-data";
describe("downloadable evidence report",()=>{
  it("escapes untrusted review content and explicitly declares uncollected evidence",()=>{
    const listing={...demoDataset.listings[0],name:"<script>alert(1)</script>",reviewCount:1162};
    const html=investigationHtml(listing,null,null);
    expect(html).not.toContain("<script>");expect(html).toContain("&lt;script&gt;");expect(html).toContain("1160 not collected");expect(html).toContain("Reviewer activity history: not collected");expect(html).toContain("AI assessment not run");
  });
});
