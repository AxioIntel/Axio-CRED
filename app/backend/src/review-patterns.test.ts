import {describe,it,expect} from "vitest";
import {reviewPatterns,type PatternReview} from "./review-patterns.js";
const row=(id:string,overrides:Partial<PatternReview>={}):PatternReview=>({id,author:id,authorUrl:null,text:null,rating:5,when:null,reply:null,...overrides});
describe("corpus pattern observations",()=>{
  it("keeps unknown metadata and sparse samples out of historical burst inference",()=>{
    const p=reviewPatterns({reviewCount:1162,reviews:Array.from({length:10},(_,i)=>row(String(i),{when:"4 months ago"}))},"2026-09-07T00:00:00Z");
    expect(p.missing).toBe(1152);expect(p.baselineEligible).toBe(false);expect(p.dated).toBe(0);expect(p.signals).toEqual([]);expect(p.reviewerHistory).toBe("not_collected");
  });
  it("detects substantive cross-record duplication while excluding short praise and same-author repeats",()=>{
    const text="The clinician explained each step of the procedure clearly and I felt comfortable throughout the visit in this clean modern clinic.";
    const p=reviewPatterns({reviewCount:4,reviews:[row("a",{text}),row("b",{text}),row("c",{text:"Great service"}),row("d",{text:"Great service"})]});
    expect(p.signals).toHaveLength(1);expect(p.signals[0].reviewIds).toEqual(["a","b"]);
    expect(reviewPatterns({reviewCount:2,reviews:[row("a",{text,authorUrl:"https://example.com/same"}),row("b",{text,authorUrl:"https://example.com/same"})]}).signals).toEqual([]);
  });
  it("separates owner pressure from reply templates and clusters from full-history bursts",()=>{
    const rows=Array.from({length:5},(_,i)=>row(String(i),{when:`2026-08-12T1${i}:00:00Z`}));
    rows.push(row("critical",{rating:1,reply:"Please delete this review or we will take legal and police action."}));
    const p=reviewPatterns({reviewCount:1162,reviews:rows},"2026-09-07T00:00:00Z");
    expect(p.signals.map(s=>s.kind)).toEqual(["posting_cluster","owner_response_pressure"]);expect(p.signals[1].evidence[0].field).toBe("reply");expect(p.baselineEligible).toBe(false);
  });
  it("compares a well-covered dated corpus with an explicit preceding baseline",()=>{
    const start=Date.parse("2026-01-01T00:00:00Z");
    const rows=Array.from({length:70},(_,i)=>row(String(i),{when:new Date(start+i*86400000).toISOString()}));
    rows.push(...Array.from({length:30},(_,i)=>row(`burst${i}`,{when:new Date(start+65*86400000+i*60000).toISOString()})));
    const p=reviewPatterns({reviewCount:100,reviews:rows},"2026-06-01T00:00:00Z");
    expect(p.baselineEligible).toBe(true);expect(p.signals.some(s=>s.kind==="volume_burst")).toBe(true);
  });
});
