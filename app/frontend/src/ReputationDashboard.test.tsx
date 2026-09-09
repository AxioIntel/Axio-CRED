import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {afterEach,describe,expect,it,vi} from "vitest";
import ReputationDashboard,{reviewStats} from "./ReputationDashboard";
import {demoDataset,type Dataset} from "./intelligence-data";
import type {Report} from "./ReviewAnalysisPanel";

const listing={...demoDataset.listings[0],placeId:"test-place",reviews:demoDataset.listings[0].reviews.map((r,i)=>({...r,rating:i?1:5}))};
const dataset:Dataset={...demoDataset,id:"test",source:"scraper_import",collectedAt:"2026-09-06T12:00:00Z",listings:[listing]};
const renderDashboard=(owned=false,datasets=[dataset])=>render(<MemoryRouter><ReputationDashboard listing={listing} dataset={dataset} datasets={datasets} owned={owned} onCollected={()=>{}}/></MemoryRouter>);
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(report:Report|null=null){vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({configured:false,model:"test",report})})));}
describe("evidence-backed reputation dashboards",()=>{
  it("does not turn a single snapshot or unassessed sample into a historical or fraud claim",async()=>{
    setup();renderDashboard();
    expect(screen.getByText("Your history starts here")).toBeInTheDocument();
    expect(screen.queryByRole("img",{name:/Rating history/})).not.toBeInTheDocument();
    expect(screen.getByText("Requires a second dated snapshot")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Flagged · —"}));
    expect(screen.getByText(/Unassessed reviews are not classified/)).toBeInTheDocument();
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith("/api/business-search/status"));
  });
  it("uses sample counts and excludes future snapshots from the selected history",async()=>{
    setup();const past={...dataset,id:"past",collectedAt:"2026-09-01T12:00:00Z",listings:[{...listing,reviewCount:380,rating:4.6}]};
    const future={...dataset,id:"future",collectedAt:"2026-09-09T12:00:00Z",listings:[{...listing,reviewCount:999}]};
    renderDashboard(false,[past,dataset,future]);
    expect(screen.getByRole("img",{name:/across 2 snapshots/})).toBeInTheDocument();
    expect(screen.getByText("+6")).toBeInTheDocument();
    expect(reviewStats(listing).distribution.map(r=>r.count)).toEqual([1,0,0,0,1]);
    expect(screen.queryByText("999")).not.toBeInTheDocument();
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith("/api/business-search/status"));
  });
  it("offers owner response drafts, filters low ratings and leaves publishing to the user",async()=>{
    setup();vi.stubGlobal("navigator",{clipboard:{writeText:vi.fn(async()=>{})}});
    renderDashboard(true);
    fireEvent.click(screen.getByRole("button",{name:"Low rated · 1"}));
    expect(screen.queryByText("Sample customer A")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Draft a response"));
    const copy=screen.getByRole("button",{name:"Copy response"});expect(copy).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Response draft for Sample customer B"),{target:{value:"Thank you. Please contact our team so we can discuss the wait."}});
    fireEvent.click(copy);await screen.findByText(/Copied. Review and publish/);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Thank you. Please contact our team so we can discuss the wait.");
    expect(vi.mocked(fetch).mock.calls.every(([,options])=>!options?.method||options.method==="GET")).toBe(true);
  });
  it("uses saved AI findings for flags and exposes the corresponding report kit",async()=>{
    const report:Report={id:"assessment",datasetId:"test",listingId:listing.id,summary:"One concern to investigate.",model:"test",createdAt:dataset.collectedAt!,collectedAt:dataset.collectedAt,analyzedCount:2,collectedCount:2,reportedCount:386,truncatedCount:0,inputHash:"test",usage:{inputTokens:10,outputTokens:10},reviewIds:{r1:listing.reviews[1].id},reviews:[{reviewRef:"r1",priority:"medium",policy:"off_topic",reasoning:"Synthetic policy observation.",alternativeExplanation:"Context may be missing.",evidence:[],nextStep:"Verify original context."}]};
    setup(report);renderDashboard();
    fireEvent.click(await screen.findByRole("button",{name:"Flagged · 1"}));
    expect(screen.getByText("medium priority")).toBeInTheDocument();expect(screen.queryByText("Sample customer A")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Report kit for Sample customer B"));
    expect(screen.getByRole("link",{name:"Open business in Google Maps"})).toHaveAttribute("href",expect.stringContaining("query_place_id=test-place"));
    expect(screen.getByRole("button",{name:"Auto add · Coming soon"})).toBeDisabled();
  });
  it("does not hide investigation priorities when there is no policy category",async()=>{
    const report:Report={id:"assessment",datasetId:"test",listingId:listing.id,summary:"Verify context.",model:"test",createdAt:dataset.collectedAt!,collectedAt:dataset.collectedAt,analyzedCount:2,collectedCount:2,reportedCount:386,truncatedCount:0,inputHash:"test",usage:{inputTokens:10,outputTokens:10},reviewIds:{r1:listing.reviews[1].id},reviews:[{reviewRef:"r1",priority:"medium",policy:"none_identified",reasoning:"Verify a contextual inconsistency.",alternativeExplanation:"May be benign.",evidence:[],nextStep:"Check context."}]};
    setup(report);renderDashboard();
    fireEvent.click(await screen.findByRole("button",{name:"Flagged · 1"}));
    expect(screen.getByText("medium investigation priority · no policy finding")).toBeInTheDocument();
    expect(screen.getByText(/0 potential review-policy concerns/)).toBeInTheDocument();
    expect(screen.getByText(/384 reviews not collected/)).toBeInTheDocument();
  });
});
