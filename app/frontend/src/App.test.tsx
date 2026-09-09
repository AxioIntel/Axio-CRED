import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { demoDataset } from "./intelligence-data";
afterEach(cleanup);
vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes("overview")?{plan:"Growth",locationsUsed:2,locationsLimit:5}:[]})));
describe("Scraper dashboard",()=>{
  it("imports a JSON file and displays the saved dataset",async()=>{
    const {container}=render(<MemoryRouter initialEntries={["/evidence"]}><App/></MemoryRouter>);
    await screen.findByText("Find your business to start collecting evidence");
    const file=new File(['[{"title":"Import test"}]'],"synthetic-test.json",{type:"application/json"});
    Object.defineProperty(file,"text",{value:async()=>'[{"title":"Import test"}]'});
    vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({...demoDataset,id:"saved",source:"scraper_import",label:file.name,importedAt:new Date().toISOString(),listings:[{...demoDataset.listings[0],name:"Import test"}]})} as Response);
    fireEvent.change(container.querySelector('input[type="file"]')!,{target:{files:[file]}});
    expect(await screen.findByText("Imported 1 listings. Collection time was not supplied by this export.")).toBeInTheDocument();
    expect(screen.getByRole("option",{name:file.name})).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/intelligence/imports",expect.objectContaining({method:"POST",body:JSON.stringify({label:file.name,entries:[{title:"Import test"}]})}));
  });
  it("starts empty and filters an explicitly selected sample",async()=>{
    render(<MemoryRouter initialEntries={["/evidence"]}><App/></MemoryRouter>);
    expect(await screen.findByText("Find your business to start collecting evidence")).toBeInTheDocument();
    expect(screen.getByText("On-demand business collection")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Explore illustrative sample"}));
    expect(screen.getByText("Fictional businesses and reviews for testing")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search listings"),{target:{value:"Eastgate"}});
    expect(screen.getByText("1 results")).toBeInTheDocument();
    expect(screen.getByText("I waited longer than expected and would have appreciated an update.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter reviews by rating"),{target:{value:"5"}});
    expect(screen.queryByText("I waited longer than expected and would have appreciated an update.")).not.toBeInTheDocument();
  });
  it("offers separate enrichment filters without claiming verified contacts",async()=>{
    render(<MemoryRouter initialEntries={["/enrichment"]}><App/></MemoryRouter>);
    await screen.findByText("Find your business to start collecting evidence");
    fireEvent.click(screen.getByRole("button",{name:"Explore illustrative sample"}));
    fireEvent.change(screen.getByLabelText("Contact availability"),{target:{value:"email"}});
    expect(screen.getByText("2 results")).toBeInTheDocument();
    expect(screen.getByText("hello@cedar-dental.example")).toBeInTheDocument();
    expect(screen.getAllByText("Not verified")).toHaveLength(2);
  });
});
