import {describe,it,expect} from "vitest";
import {normalizeImport,reviewTimestamp} from "./intelligence.js";
describe("native evidence retention",()=>{
  it("quarantines native review text that is actually the captured owner response",()=>{
    const r=normalizeImport({label:"Fixture",entries:[{title:"Fixture",user_reviews:[{review_id:"one",Description:"Thank you for visiting",reply_text:"Thank you for visiting",source:"Google Maps public page",Rating:5}]}]}).listings[0].reviews[0];
    expect(r.text).toBeNull();expect(r.reply).toBe("Thank you for visiting");expect(r.captureIssue).toContain("withheld");
  });
  it("preserves structured dates, languages, media, categories, attributes and address",()=>{
    const result=normalizeImport({label:"Fixture",entries:[{title:"Fixture",categories:["Dentist","Dental clinic"],plus_code:"ABC+1",complete_address:{city:"Delhi"},about:[{name:"Accessibility",options:[{name:"Wheelchair entrance",enabled:true}]}],
      user_reviews:[{review_id:"one",Rating:5,Description:"Long original review text",posted_at_unix_micros:1700000000000000,updated_at_unix_micros:1700000001000000,reply_posted_at_unix_micros:1700000002000000,language:"en",Images:["https://example.com/photo","javascript:alert(1)"],reply_text:"Owner response"}],
      user_reviews_extended:[{review_id:"one",Description:"Short",Rating:0,Images:[]}]}]});
    const row=result.listings[0];expect(row.categories).toHaveLength(2);expect(row.structuredAddress?.city).toBe("Delhi");expect(row.attributes[0].options[0].enabled).toBe(true);
    expect(row.reviews).toHaveLength(1);expect(row.reviews[0]).toMatchObject({text:"Long original review text",rating:5,datePrecision:"timestamp",when:"2023-11-14T22:13:20.000Z",reply:"Owner response",language:"en",images:["https://example.com/photo"]});
  });
  it("does not invent timestamps from relative dates or turn missing ratings into zero stars",()=>{
    const row=normalizeImport({label:"Fixture",entries:[{title:"Fixture",user_reviews:[{Name:"A",When:"a month ago",Rating:0}]}]}).listings[0].reviews[0];
    expect(row).toMatchObject({when:"a month ago",publishedAt:null,datePrecision:"relative_or_displayed",rating:null});
    expect(reviewTimestamp(1700000000)).toBeNull();expect(reviewTimestamp(Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});
