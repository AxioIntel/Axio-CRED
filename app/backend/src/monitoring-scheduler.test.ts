import {describe,it,expect,vi} from "vitest";
import {DemoStore} from "./demo-store.js";
import type {BusinessDiscovery} from "./business-discovery.js";
import {MonitoringScheduler,type ScheduleRepository} from "./monitoring-scheduler.js";

function fixture(plan="growth",monitored=true){
  const store=new DemoStore();
  vi.spyOn(store,"getOverview").mockResolvedValue({plan} as never);
  vi.spyOn(store,"listBusinesses").mockResolvedValue([]);
  vi.spyOn(store,"getCompetitorWorkspace").mockResolvedValue({baselineKey:null,targets:monitored?[{id:"one",name:"Fixture",listingKey:"place:ChIJmonitorFixture",mapsUrl:null}]:[]});
  const repository:ScheduleRepository={list:vi.fn(async()=>[]),set:vi.fn(async()=>{}),claim:vi.fn(async()=>({placeId:"ChIJmonitorFixture",token:"lease"})),finish:vi.fn(async()=>{})};
  const discovery={available:vi.fn(()=>true),isBusy:vi.fn(()=>false),startPlaceId:vi.fn(async()=>({id:"job"})),get:vi.fn(async()=>({status:"completed",dataset:{id:"dataset"}}))};
  const now=()=>new Date("2026-09-09T00:00:00Z");
  const scheduler=new MonitoringScheduler(store,discovery as unknown as BusinessDiscovery,repository,now);
  return {store,repository,discovery,scheduler,now};
}
describe("local recurring collection",()=>{
  it("uses the approved 6/12-hour plan cadence and rejects unmonitored/free listings",async()=>{
    for(const [plan,hours] of [["growth",6],["business",12]] as const){const f=fixture(plan);await f.scheduler.set("ChIJmonitorFixture",true);expect(f.repository.set).toHaveBeenCalledWith("ChIJmonitorFixture",true,hours,f.now());}
    for(const f of [fixture("free"),fixture("growth",false)]){await expect(f.scheduler.set("ChIJmonitorFixture",true)).rejects.toThrow("Add this business");expect(f.repository.set).not.toHaveBeenCalled();}
  });
  it("forces fresh extended evidence, disables paid fallback, and records completion",async()=>{
    const f=fixture();await f.scheduler.tick();expect(f.discovery.startPlaceId).toHaveBeenCalledWith("ChIJmonitorFixture",true,true,false);expect(f.repository.finish).toHaveBeenCalledWith({placeId:"ChIJmonitorFixture",token:"lease"},"completed",null,"dataset",6,f.now());
  });
  it("records failed checks without claiming successful evidence",async()=>{
    const f=fixture();f.discovery.startPlaceId.mockRejectedValue(new Error("Collector blocked"));await f.scheduler.tick();expect(f.repository.finish).toHaveBeenCalledWith(expect.anything(),"failed","Collector blocked",null,6,f.now());
  });
  it("pauses ineligible schedules before invoking the collector",async()=>{
    const f=fixture("free");await f.scheduler.tick();expect(f.repository.set).toHaveBeenCalledWith("ChIJmonitorFixture",false,12,f.now());expect(f.discovery.startPlaceId).not.toHaveBeenCalled();
  });
  it("does not claim work while manual collection is running",async()=>{
    const f=fixture();f.discovery.isBusy.mockReturnValue(true);await f.scheduler.tick();expect(f.repository.claim).not.toHaveBeenCalled();
  });
  it("reschedules at the slower cadence when the workspace plan changes",async()=>{
    const f=fixture("business");vi.mocked(f.repository.list).mockResolvedValue([{placeId:"ChIJmonitorFixture",enabled:true,intervalHours:6,nextDueAt:null,lastStartedAt:null,lastFinishedAt:null,lastDatasetId:null,status:"scheduled",lastError:null}]);
    vi.mocked(f.repository.claim).mockResolvedValue(null);await f.scheduler.tick();expect(f.repository.set).toHaveBeenCalledWith("ChIJmonitorFixture",true,12,f.now());expect(f.discovery.startPlaceId).not.toHaveBeenCalled();
  });
  it("prevents overlapping ticks and can recover after a repository error",async()=>{
    const f=fixture();let release!:()=>void;
    vi.mocked(f.repository.claim).mockImplementationOnce(async()=>{await new Promise<void>(resolve=>{release=resolve;});throw new Error("Database unavailable");});
    const first=f.scheduler.tick();await expect.poll(()=>vi.mocked(f.repository.claim).mock.calls.length).toBe(1);await f.scheduler.tick();expect(f.repository.claim).toHaveBeenCalledTimes(1);release();await expect(first).rejects.toThrow("Database unavailable");await f.scheduler.tick();expect(f.discovery.startPlaceId).toHaveBeenCalledTimes(1);
  });
});
