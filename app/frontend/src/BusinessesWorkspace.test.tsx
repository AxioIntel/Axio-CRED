import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessPicker } from "./BusinessesWorkspace";
import { demoDataset } from "./intelligence-data";
import { MemoryRouter } from "react-router-dom";
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("business picker",()=>{
  it("filters saved listings and submits the selected identity instead of manual fields",async()=>{
    HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
    const dataset={...demoDataset,id:"collected",source:"scraper_import",listings:[{...demoDataset.listings[0],name:"Example Business",placeId:"ChIJexampleFixture"}]};
    const fetchMock=vi.fn(async(path:string)=>({ok:true,json:async()=>path.includes("imports")?[dataset]:path.includes("status")?{available:true}:{id:"business"}}));vi.stubGlobal("fetch",fetchMock);
    const close=vi.fn(),added=vi.fn();render(<BusinessPicker close={close} added={added}/>);
    const result=await screen.findByRole("button",{name:/Example Business/});
    fireEvent.click(screen.getByRole("button",{name:"Search by name or link"}));
    fireEvent.change(screen.getByLabelText("Business name and city or Google Maps link"),{target:{value:"example"}});
    expect(result).toBeInTheDocument();expect(screen.getByRole("button",{name:"Add selected business"})).toBeDisabled();
    fireEvent.click(result);fireEvent.click(screen.getByRole("button",{name:"Add selected business"}));
    await waitFor(()=>expect(added).toHaveBeenCalledOnce());expect(close).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/businesses/select",expect.objectContaining({body:JSON.stringify({datasetId:"collected",listingId:"0"})}));
  });
  it("loads an exact Place ID using saved data and links to Google's finder",async()=>{
    HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
    const dataset={...demoDataset,id:"collected",source:"scraper_import",listings:[{...demoDataset.listings[0],name:"Example Business",placeId:"ChIJexampleBusinessFixture"}]};
    const fetchMock=vi.fn(async(path:string)=>({ok:true,json:async()=>path.includes("imports")?[]:path.includes("status")?{available:true}:{id:"cached",status:"completed",cached:true,dataset}}));vi.stubGlobal("fetch",fetchMock);
    render(<BusinessPicker close={vi.fn()} added={vi.fn()}/>);
    expect(screen.getByRole("link",{name:/Place ID finder/})).toHaveAttribute("href","https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder");
    fireEvent.change(screen.getByLabelText("Google Place ID"),{target:{value:"ChIJexampleBusinessFixture"}});
    fireEvent.click(screen.getByRole("button",{name:"Load business"}));
    expect(await screen.findByText(/Exact Place ID matched saved details/)).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/Example Business/})).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/business-search",expect.objectContaining({body:JSON.stringify({placeId:"ChIJexampleBusinessFixture"})}));
  });
  it("saves a competitor through the watchlist endpoint without adding an owned location",async()=>{
    HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
    const dataset={...demoDataset,id:"collected",source:"scraper_import",listings:[{...demoDataset.listings[0],name:"Example Competitor",placeId:"ChIJcompetitor"}]};
    const fetchMock=vi.fn(async(path:string)=>({ok:true,json:async()=>path.includes("imports")?[dataset]:path.includes("status")?{available:true}:{id:"competitor"}}));vi.stubGlobal("fetch",fetchMock);
    const added=vi.fn();render(<MemoryRouter><BusinessPicker purpose="competitor" close={vi.fn()} added={added}/></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button",{name:/Example Competitor/}));
    fireEvent.click(screen.getByRole("button",{name:"Add selected competitor"}));
    await waitFor(()=>expect(added).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/competitor-workspace/select",expect.objectContaining({body:JSON.stringify({datasetId:"collected",listingId:"0"})}));
    expect(fetchMock.mock.calls.some(([path])=>path==="/api/businesses/select")).toBe(false);
    expect(screen.getByRole("link",{name:"Open competitor watchlist"})).toBeInTheDocument();
  });
});
