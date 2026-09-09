import {describe,it,expect} from "vitest";
import {collectionCoverage} from "./collection-coverage.js";
describe("collection coverage",()=>{
  it("reports a successful process with ten of 1162 reviews as partial",()=>{const result=collectionCoverage([{reviews:Array(10),reviewCount:1162}],"HTTP 403\nReview count stuck at 10");expect(result.status).toBe("partial");expect(result.message).toContain("Google rejected");expect(result.message).toContain("stopped yielding");});
  it("does not infer completeness from unknown totals",()=>expect(collectionCoverage([{reviews:[],reviewCount:null}]).status).toBe("partial"));
  it("distinguishes reaching a reported count from verified completeness",()=>expect(collectionCoverage([{reviews:[{}],reviewCount:1}]).status).toBe("reported_count_reached"));
});
