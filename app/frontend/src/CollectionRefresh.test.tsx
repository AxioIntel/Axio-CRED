import {afterEach,describe,it,expect,vi} from "vitest";
import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import CollectionRefresh from "./CollectionRefresh";
import {demoDataset} from "./intelligence-data";
afterEach(()=>vi.unstubAllGlobals());
describe("full history collection",()=>{
  it("requests extended collection without reusing a snapshot and surfaces partial coverage",async()=>{
    const onComplete=vi.fn();
    const request=vi.fn(async(url:string,options?:RequestInit)=>({ok:true,json:async()=>url.includes("monitoring/schedules")?{available:false,schedules:[],intervalHours:null}:url.endsWith("/status")?{fallback:{message:"Outscraper fallback is disabled. No paid calls will be made."}}:options?{id:"job-one"}:{status:"completed",dataset:{id:"fresh"},coverage:{message:"Partial collection: 10 of 1162 reported reviews."},fallback:{message:"Outscraper fallback is disabled. No paid calls were made."}}}));
    vi.stubGlobal("fetch",request);
    render(<CollectionRefresh listing={{...demoDataset.listings[0],placeId:"ChIJfixture"}} onComplete={onComplete}/>);
    fireEvent.click(screen.getByRole("button",{name:"Collect full review history"}));
    await waitFor(()=>expect(onComplete).toHaveBeenCalledWith("fresh"));
    expect(JSON.parse(String(request.mock.calls.find(([,options])=>options?.method==="POST")![1]!.body))).toEqual({placeId:"ChIJfixture",refresh:true,extendedReviews:true});
    expect(screen.getByRole("status").textContent).toContain("10 of 1162");
    expect(screen.getByRole("status").textContent).toContain("No paid calls were made");
  });
});
