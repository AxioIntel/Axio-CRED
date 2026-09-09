import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import PlatformWorkspace from "./PlatformWorkspace";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("platform workspace",()=>{
  it("links to the selected Google business and shows collection failure without fabricated metrics",async()=>{
    let profile:any=null;
    const fetchMock=vi.fn(async(path:string,options?:RequestInit)=>{
      if(path==="/api/businesses")return {ok:true,json:async()=>[{name:"Example business",publicListingKey:"place:example"}]};
      if(path==="/api/competitor-workspace")return {ok:true,json:async()=>({baselineKey:null,targets:[]})};
      if(options?.method==="PUT"){const input=JSON.parse(String(options.body));expect(input.entityKey).toBe("place:example");expect(input.confirmedSameBusiness).toBe(true);profile={...input,id:"p1",snapshots:[],lastAttemptAt:null,error:null};return {ok:true,json:async()=>profile};}
      if(path.endsWith("/collect")){profile={...profile,error:"Public collection unavailable (HTTP 403).",lastAttemptAt:"2026-09-06T12:00:00Z"};return {ok:true,json:async()=>profile};}
      return {ok:true,json:async()=>({profiles:profile?[profile]:[]})};
    });vi.stubGlobal("fetch",fetchMock);
    render(<MemoryRouter initialEntries={["/platforms?business=place:example"]}><PlatformWorkspace/></MemoryRouter>);
    const url=await screen.findByLabelText("Facebook business profile URL");fireEvent.change(url,{target:{value:"https://facebook.com/example"}});
    fireEvent.click(screen.getAllByRole("checkbox")[0]);fireEvent.submit(url.closest("form")!);
    expect(await screen.findByText(/No extra business slot used/)).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Try public collection"}));
    expect(await screen.findByText("Public collection unavailable (HTTP 403).")).toBeInTheDocument();expect(screen.queryByText("Platform rating")).not.toBeInTheDocument();expect(screen.getByRole("link",{name:"Open Facebook"})).toHaveAttribute("href","https://facebook.com/example");
  });
  it("does not offer unattached Facebook or Trustpilot profiles without a saved Google business",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(path:string)=>({ok:true,json:async()=>path==="/api/businesses"?[]:path==="/api/competitor-workspace"?{targets:[],baselineKey:null}:{profiles:[]}})));
    render(<MemoryRouter><PlatformWorkspace/></MemoryRouter>);expect(await screen.findByText(/Pending Maps links must be collected/)).toBeInTheDocument();expect(screen.queryByLabelText("Facebook business profile URL")).not.toBeInTheDocument();
  });
});
