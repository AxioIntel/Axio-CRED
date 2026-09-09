import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import WorkspaceSummary from "./WorkspaceSummary";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("Monitoring summary",()=>{
  it("shows actual usage and selected-business links without claiming scheduled activity",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(path:string)=>({ok:true,json:async()=>path.includes("overview")?{plan:"Growth",locationsUsed:4,locationsLimit:5}:{profiles:[{entityKey:"place:example",platform:"facebook",error:"blocked",snapshots:[]}]}})));
    render(<MemoryRouter><WorkspaceSummary entityKey="place:example" businessName="Example" collectedAt="2026-09-06T12:00:00Z"/></MemoryRouter>);
    expect(await screen.findByText(/Checked four times a day/)).toBeInTheDocument();expect(screen.getByRole("progressbar",{name:"Monitored business allowance"})).toHaveAttribute("value","4");expect(await screen.findByText(/1 of 2 additional profiles linked/)).toHaveTextContent("collection needs attention");expect(screen.getByText(/Automatic checks are not running/)).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Manage linked profiles"})).toHaveAttribute("href","/platforms?business=place%3Aexample");
  });
  it("keeps missing timestamps and failed usage reads unknown",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:false})));
    render(<MemoryRouter><WorkspaceSummary/></MemoryRouter>);expect(await screen.findByText("Plan usage unavailable")).toBeInTheDocument();expect(screen.getByText("Not collected")).toBeInTheDocument();expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
