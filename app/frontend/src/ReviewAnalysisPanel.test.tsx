import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import ReviewAnalysisPanel from "./ReviewAnalysisPanel";
import {demoDataset} from "./intelligence-data";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("review analysis panel",()=>{
  it("identifies Azure configuration without claiming a successful connection",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({configured:true,provider:"azure",model:"axiocred-review-analysis",configurationError:null,report:null})})));
    render(<ReviewAnalysisPanel datasetId="test" listing={demoDataset.listings[0]}/>);
    expect(await screen.findByText(/Configuration present for Azure OpenAI/)).toBeInTheDocument();
    expect(screen.getByText("AZURE OPENAI REVIEW ANALYSIS")).toBeInTheDocument();
    expect(screen.queryByText(/connected successfully/i)).not.toBeInTheDocument();
  });
  it("explains configuration and keeps reporting instructions available",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({configured:false,model:"test",report:null})})));
    render(<ReviewAnalysisPanel datasetId="test" listing={demoDataset.listings[0]}/>);
    await screen.findByText(/OpenAI is not connected/);expect(screen.getByRole("button",{name:"Analyze collected reviews"})).toBeDisabled();expect(screen.getByText(/How to report a review/)).toBeInTheDocument();
  });
  it("runs on request and displays evidence without inventing percentages",async()=>{
    const report={id:"report",summary:"Evidence is insufficient.",reviews:[{reviewRef:"r1",priority:"low",policy:"none_identified",reasoning:"No specific violation.",alternativeExplanation:"Genuine experience.",evidence:[],nextStep:"No supported reporting basis."}],model:"test",createdAt:new Date().toISOString(),analyzedCount:1,collectedCount:1,reportedCount:100,truncatedCount:0,reviewIds:{r1:demoDataset.listings[0].reviews[0].id},usage:{inputTokens:100,outputTokens:100}};
    const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>({ok:true,json:async()=>init?.method==="POST"?report:{configured:true,model:"test",report:null}}));vi.stubGlobal("fetch",fetcher);render(<ReviewAnalysisPanel datasetId="test" listing={demoDataset.listings[0]}/>);
    await screen.findByText(/Runs on request/);fireEvent.click(screen.getByRole("button",{name:"Analyze collected reviews"}));expect(await screen.findByText("Evidence is insufficient.")).toBeInTheDocument();expect(screen.getByRole("button",{name:"Download investigation report"})).toBeInTheDocument();expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
