import {afterEach,describe,it,expect,vi} from "vitest";
import {render,screen,cleanup} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import SettingsWorkspace from "./SettingsWorkspace";
vi.mock("./ReportingWorkspace",()=>({default:()=>null}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("workspace readiness",()=>{
  it("shows the actual Business allowance and keeps paid fallback and unavailable billing disabled",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(path:string)=>({ok:true,json:async()=>path.includes("overview")?{plan:"Business",locationsUsed:1,locationsLimit:1}:path.includes("integrations")?{analysis:{configured:true,model:"fixture-model"},paypal:{configured:false},outscraper:{configured:true,enabled:false,ready:false,message:"Paid calls are disabled."},google:{configured:false}}:{available:true}})));
    render(<MemoryRouter><SettingsWorkspace/></MemoryRouter>);
    expect(await screen.findByRole("heading",{name:"Business"})).toBeInTheDocument();expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByRole("combobox",{name:"PayPal checkout plan"})).toHaveValue("business");expect(screen.getByRole("button",{name:"Start PayPal checkout"})).toBeDisabled();expect(screen.getByText("Disabled")).toBeInTheDocument();expect(screen.getByText(/fixture-model/)).toBeInTheDocument();expect(screen.getByText(/not confirmation of a paid subscription/)).toBeInTheDocument();
  });
  it("shows an actionable load error rather than a fabricated Growth plan",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("Service unavailable")));render(<MemoryRouter><SettingsWorkspace/></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Service unavailable");expect(screen.getByRole("button",{name:"Retry settings"})).toBeInTheDocument();expect(screen.queryByRole("heading",{name:"Growth"})).not.toBeInTheDocument();
  });
});
