import {afterEach,describe,it,expect,vi} from "vitest";
import {cleanup,render,screen,fireEvent,waitFor} from "@testing-library/react";
import MonitoringSchedule from "./MonitoringSchedule";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const base={available:true,intervalHours:6,schedules:[],message:"Keep the local API running."};
describe("scheduled monitoring controls",()=>{
  it("saves an opt-in and displays the server's next check, then allows pausing",async()=>{
    const schedule={placeId:"ChIJfixture",enabled:true,intervalHours:6,nextDueAt:"2026-09-09T18:00:00Z",lastFinishedAt:null,status:"scheduled",lastError:null};
    const request=vi.fn(async(_url:string,options?:RequestInit)=>({ok:true,json:async()=>options?{...base,schedules:[{...schedule,enabled:JSON.parse(String(options.body)).enabled}]}:base}));vi.stubGlobal("fetch",request);
    render(<MonitoringSchedule placeId="ChIJfixture"/>);fireEvent.click(await screen.findByRole("button",{name:"Enable 6-hour checks"}));
    expect(await screen.findByText("Monitoring enabled")).toBeInTheDocument();expect(screen.getByText(/Next check:/)).toHaveTextContent(new Date(schedule.nextDueAt).toLocaleString());
    expect(request).toHaveBeenCalledWith("/api/monitoring/schedules/ChIJfixture",expect.objectContaining({method:"PUT",body:'{"enabled":true}'}));
    fireEvent.click(screen.getByRole("button",{name:"Pause automatic checks"}));expect(await screen.findByText("Monitoring paused")).toBeInTheDocument();
  });
  it("shows 12-hour cadence and does not claim enablement when saving fails",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(_url,options)=>({ok:!options,json:async()=>options?{error:"Save failed"}:{...base,intervalHours:12}})));
    render(<MonitoringSchedule placeId="ChIJfixture"/>);fireEvent.click(await screen.findByRole("button",{name:"Enable 12-hour checks"}));await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("Save failed"));expect(screen.queryByText("Monitoring enabled")).not.toBeInTheDocument();
  });
});
