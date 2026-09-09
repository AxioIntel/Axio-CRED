import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import CompetitorWorkspace, { comparisonRecords } from "./CompetitorWorkspace";
import { demoDataset, type Dataset } from "./intelligence-data";

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const dataset:Dataset={...demoDataset,id:"real-import",source:"scraper_import",listings:demoDataset.listings.slice(0,2).map((l,i)=>({...l,placeId:`place${i}`}))};
function setup() {
  let config={baselineKey:"place:place0",targets:[] as {id:string;name:string;mapsUrl:string|null;listingKey:string|null}[]};
  const fetchMock=vi.fn(async(path:string,init?:RequestInit)=>{
    if(path.includes("imports"))return {ok:true,json:async()=>[dataset]};
    if(init?.method==="PUT")config=JSON.parse(String(init.body));
    return {ok:true,json:async()=>config};
  });
  vi.stubGlobal("fetch",fetchMock);
  return fetchMock;
}
describe("Competitor workspace",()=>{
  it("keeps imported businesses outside the watchlist until explicitly added",async()=>{
    setup();render(<MemoryRouter><CompetitorWorkspace/></MemoryRouter>);
    await screen.findByText("Your competitors belong here");
    expect(screen.getByRole("heading",{name:"Competitor watchlist"})).toBeInTheDocument();
    expect(screen.queryByRole("heading",{name:"Geographic distribution"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Lakeview Family Dentistry"})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Advanced: save a Maps link or link existing evidence"}));
    fireEvent.click(screen.getByRole("button",{name:"Collected listing"}));
    fireEvent.change(screen.getByLabelText("Collected competitor"),{target:{value:"place:place1"}});
    fireEvent.click(screen.getByRole("button",{name:"Save competitor"}));
    expect(await screen.findByRole("button",{name:"Lakeview Family Dentistry"})).toBeInTheDocument();
    expect(screen.getByText("Partial review sample")).toBeInTheDocument();
    expect(screen.getAllByText("-0.2")).toHaveLength(2);
    expect(screen.getByRole("link",{name:"View collected reviews"})).toHaveAttribute("href","/evidence?scope=competitor&dataset=real-import&listing=1");
    fireEvent.click(screen.getByRole("button",{name:"Remove Lakeview Family Dentistry"}));
    await screen.findByText("Your competitors belong here");
  });
  it("saves a link without inventing collected data and retains it on reload",async()=>{
    const fetchMock=setup();render(<MemoryRouter><CompetitorWorkspace/></MemoryRouter>);
    await screen.findByText("Your competitors belong here");
    fireEvent.click(screen.getByRole("button",{name:"Advanced: save a Maps link or link existing evidence"}));
    fireEvent.change(screen.getByLabelText("Business name"),{target:{value:"Pending competitor"}});
    fireEvent.change(screen.getByLabelText("Google Maps or share link"),{target:{value:"https://share.google/test"}});
    fireEvent.click(screen.getByRole("button",{name:"Save competitor"}));
    expect(await screen.findByText("Awaiting collection")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Refresh competitor workspace"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Pending competitor"})).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/competitor-workspace",expect.objectContaining({method:"PUT"}));
    expect(screen.getByText("No collection job started")).toBeInTheDocument();
  });
  it("deduplicates listing identities using the newest available snapshot",()=>{
    const newer={...dataset,id:"new",collectedAt:"2026-09-06T12:00:00Z"};
    const older={...dataset,id:"old",collectedAt:"2026-09-01T12:00:00Z"};
    expect(comparisonRecords([older,newer,demoDataset])).toHaveLength(2);
    expect(comparisonRecords([older,newer])[0].dataset.id).toBe("new");
  });
});
