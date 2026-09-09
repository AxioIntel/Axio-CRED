import {describe,it,expect} from "vitest";
import {businessNextStep} from "./BusinessNextSteps";
import {demoDataset} from "./intelligence-data";
import type {MonitoredEntity} from "./monitoring-activity";
const entity:MonitoredEntity={key:"place:fixture",name:"Fixture",owned:true,competitor:false,snapshots:0};
describe("business next action",()=>{
  it("sends an owned business with no collection to the owned flow",()=>{expect(businessNextStep(entity)).toMatchObject({url:"/businesses",label:"Collect a first snapshot"});});
  it("prioritizes capture issues over an assessment and retains evidence scope",()=>{
    const listing={...demoDataset.listings[0],reviews:[{...demoDataset.listings[0].reviews[0],captureIssue:"Withheld",text:null}]};
    const step=businessNextStep({...entity,latest:{dataset:demoDataset,listing}});expect(step.label).toBe("Resolve collection issues");expect(step.detail).toContain("0 usable texts");expect(step.url).toContain("scope=owned");
  });
  it("does not call missing review text clean or fraud-free",()=>{
    const listing={...demoDataset.listings[0],reviews:[{...demoDataset.listings[0].reviews[0],text:null}]};
    expect(businessNextStep({...entity,latest:{dataset:demoDataset,listing}}).label).toBe("Check missing review text");
  });
});
