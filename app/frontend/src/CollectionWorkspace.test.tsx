import {afterEach,describe,it,expect,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import CollectionWorkspace from "./CollectionWorkspace";
import ListingFacts from "./ListingFacts";
import {demoDataset} from "./intelligence-data";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("collection workspace",()=>{
  it("submits native batch collection options and shows saved partial evidence",async()=>{
    let submitted:unknown;let started=false;
    vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
      if(init?.method==="POST"){submitted=JSON.parse(String(init.body));started=true;return {ok:true,json:async()=>({id:"job"})};}
      return {ok:true,json:async()=>url.endsWith("runtime")?{available:true,proxyConfigured:false}:started?[{id:"job",query:"Dentists Delhi",status:"completed",startedAt:"2026-09-09T09:00:00Z",datasetId:"saved",listingCount:30,partial:true,warning:"Time budget reached"}]:[]};
    }));
    render(<MemoryRouter><CollectionWorkspace/></MemoryRouter>);
    await screen.findByText("Native collector ready");
    fireEvent.change(screen.getByLabelText("Searches, one per line"),{target:{value:"Dentists Delhi\nClinics Noida"}});
    fireEvent.click(screen.getByLabelText("Discover emails from business websites"));
    fireEvent.click(screen.getByRole("button",{name:"Start native collection"}));
    await waitFor(()=>expect(submitted).toMatchObject({queries:["Dentists Delhi","Clinics Noida"],options:{mode:"details",depth:10,maxListings:200,emails:true}}));
    expect(await screen.findByRole("link",{name:"Inspect collected evidence"})).toHaveAttribute("href","/evidence?dataset=saved");
    expect(screen.getByText("Time budget reached")).toBeInTheDocument();
  });
  it("fast mode requires a center and hides unsupported enrichment options",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:true,json:async()=>url.endsWith("runtime")?{available:true}:[]})));
    render(<MemoryRouter><CollectionWorkspace/></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Collection mode"),{target:{value:"fast"}});
    expect(screen.getByLabelText("Latitude")).toBeRequired();
    expect(screen.queryByLabelText("Discover emails from business websites")).not.toBeInTheDocument();
    expect(screen.getByRole("option",{name:"Grid across a bounding box"})).toBeDisabled();
  });
  it("shows source attributes and popular times with safe service links",()=>{
    render(<ListingFacts listing={{...demoDataset.listings[0],creditCards:["VISA"],popularTimes:{Monday:{9:42}},reservations:[{source:"Website",url:"https://example.com/book"}],menu:{source:"Unsafe",url:"javascript:alert(1)"},attributes:[{name:"Payments",options:[{name:"Credit cards",enabled:true,values:["VISA"]}]}]}}/>);
    expect(screen.getByText("Accepted card networks")).toBeInTheDocument();expect(screen.getByText("Monday")).toBeInTheDocument();expect(screen.getByRole("link",{name:"Reservations · Website"})).toHaveAttribute("href","https://example.com/book");expect(screen.queryByRole("link",{name:"Menu"})).not.toBeInTheDocument();
  });
});
