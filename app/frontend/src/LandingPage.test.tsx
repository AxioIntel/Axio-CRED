import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import LandingPage from "./LandingPage";
import {planFrequency} from "./plan-catalog";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("SaaS landing page",()=>{
  it("states approved monthly pricing and fixed checks per day without pretending the scheduler is active",()=>{
    render(<MemoryRouter><LandingPage/></MemoryRouter>);
    expect(screen.getByRole("heading",{name:/See the changes/})).toBeInTheDocument();
    expect(screen.getByText("$49")).toBeInTheDocument();expect(screen.getByText("$149")).toBeInTheDocument();
    expect(screen.getByText(/Checked twice a day for changes/)).toBeInTheDocument();expect(screen.getByText(/Checked four times a day for changes/)).toBeInTheDocument();
    expect(screen.getByText(/paid automatic checks and the free audit flow are not active/)).toBeInTheDocument();expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(planFrequency("Growth")).toBe("Checked four times a day");
    for(const link of screen.getAllByRole("link",{name:"Explore the preview"}))expect(link).toHaveAttribute("href","/overview");
  });
  it("offers keyboard feature tabs and a collapsible mobile menu",()=>{
    render(<MemoryRouter><LandingPage/></MemoryRouter>);
    const first=screen.getByRole("tab",{name:"Watch your market"});first.focus();fireEvent.keyDown(first,{key:"ArrowDown"});expect(screen.getByRole("tab",{name:"Inspect the evidence"})).toHaveAttribute("aria-selected","true");expect(screen.getByRole("tabpanel")).toHaveTextContent("Look beyond the star rating.");
    fireEvent.click(screen.getByRole("button",{name:"Open menu"}));expect(screen.getByRole("button",{name:"Close menu"})).toHaveAttribute("aria-expanded","true");fireEvent.keyDown(window,{key:"Escape"});expect(screen.getByRole("button",{name:"Open menu"})).toHaveAttribute("aria-expanded","false");
  });
});
