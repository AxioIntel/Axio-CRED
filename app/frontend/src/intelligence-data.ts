export interface CollectedReview { id:string; author:string; authorUrl:string|null; rating:number|null; text:string|null; when:string|null; source:string|null; reply:string|null;
  publishedAt?:string|null;datePrecision?:"timestamp"|"relative_or_displayed"|"unknown";updatedAt?:string|null;replyPublishedAt?:string|null;captureIssue?:string|null;
  language?:string|null;translatedLanguage?:string|null;translatedText?:string|null;authorPhoto?:string|null;images?:string[];
}
export interface CollectedListing {
  inputId?:string|null;dataId?:string|null;streetViewUrl?:string|null;
  popularTimes?:Record<string,Record<string,number>>;creditCards?:string[];
  reservations?:{source:string|null;url:string|null}[];orderOnline?:{source:string|null;url:string|null}[];menu?:{source:string|null;url:string|null}|null;
  owner?:{id:string|null;name:string|null;url:string|null}|null;
  id:string; placeId:string|null; cid:string|null; name:string; mapsUrl:string|null; category:string|null; address:string|null;
  latitude:number|null; longitude:number|null; rating:number|null; reviewCount:number|null; distribution:Record<string,number>;
  phone:string|null; website:string|null; emails:string[]; hours:Record<string,string[]>; status:string|null; description:string|null;
  timezone:string|null; priceRange:string|null; images:{title:string|null;url:string|null}[]; reviews:CollectedReview[];
  categories?:string[];reviewsUrl?:string|null;thumbnail?:string|null;plusCode?:string|null;
  structuredAddress?:Record<string,string|null|undefined>|null;attributes?:{id?:string|null;name?:string|null;options:{name?:string|null;enabled:boolean;values?:string[]|null}[]}[];
}
export interface Dataset { id:string; label:string; importedAt:string; collectedAt:string|null; source:"scraper_import"|"illustrative"; sha256:string; listings:CollectedListing[]; collection?:{provider:"builtin"|"outscraper";partial?:boolean;warning?:string;requestId?:string;reason?:string;requestedLimit?:number} }
export const demoDataset:Dataset = {
  id:"illustrative", label:"Austin dental market · illustrative", importedAt:"2026-09-06T09:00:00Z", collectedAt:null, source:"illustrative", sha256:"",
  listings:[
    {name:"Cedar House Dental",address:"Illustrative location, Central Austin",category:"Dentist",latitude:30.286,longitude:-97.743,rating:4.7,reviewCount:386,phone:"+1 512 555 0101",website:"https://cedar-dental.example",emails:["hello@cedar-dental.example"],distribution:{"1":14,"2":8,"3":11,"4":24,"5":329}},
    {name:"Lakeview Family Dentistry",address:"Illustrative location, West Austin",category:"Dental clinic",latitude:30.3,longitude:-97.79,rating:4.5,reviewCount:214,phone:"+1 512 555 0102",website:"https://lakeview-dental.example",emails:[],distribution:{"1":12,"2":10,"3":14,"4":22,"5":156}},
    {name:"Cedar House Dental South",address:"Illustrative location, South Austin",category:"Dentist",latitude:30.237,longitude:-97.768,rating:4.8,reviewCount:98,phone:"+1 512 555 0101",website:"https://cedar-dental.example/south",emails:["south@cedar-dental.example"],distribution:{"1":2,"2":1,"3":3,"4":8,"5":84}},
    {name:"Eastgate Urgent Dental",address:"Illustrative location, East Austin",category:"Emergency dental service",latitude:30.27,longitude:-97.709,rating:4.2,reviewCount:167,phone:null,website:null,emails:[],distribution:{"1":14,"2":10,"3":18,"4":18,"5":107}},
    {name:"Juniper Orthodontics",address:"Illustrative location, North Austin",category:"Orthodontist",latitude:30.337,longitude:-97.722,rating:4.9,reviewCount:72,phone:"+1 512 555 0105",website:"https://juniper-ortho.example",emails:[],distribution:{"1":0,"2":0,"3":1,"4":5,"5":66}}
  ].map((item,index)=>({...item,id:String(index),placeId:null,cid:null,mapsUrl:null,status:"Open",description:null,timezone:"America/Chicago",priceRange:null,hours:{Monday:["09:00–17:00"],Tuesday:["09:00–17:00"]},images:[],reviews:[
    {id:index+"a",author:"Sample customer A",authorUrl:null,rating:5,text:"The team explained the treatment clearly and kept the appointment on time.",when:"Illustrative review",source:"example",reply:"Thank you for sharing your experience."},
    {id:index+"b",author:"Sample customer B",authorUrl:null,rating:index===3?1:4,text:index===3?"I waited longer than expected and would have appreciated an update.":"Easy to schedule. The visit was straightforward.",when:"Illustrative review",source:"example",reply:null}
  ]}))
};
export function websiteHost(website:string|null) { try { return website?new URL(website).hostname.replace(/^www\./,""):null; } catch { return null; } }
export function relatedListings(listing:CollectedListing,listings:CollectedListing[]) {
  const phone=listing.phone?.replace(/\D/g,""); const host=websiteHost(listing.website);
  return listings.filter(other=>other.id!==listing.id).flatMap(other=>{
    const reasons:string[]=[];
    if(phone && phone===other.phone?.replace(/\D/g,""))reasons.push("Shared phone");
    if(host && host===websiteHost(other.website))reasons.push("Shared website domain");
    return reasons.length?[{listing:other,reasons}]:[];
  });
}
export function downloadData(filename:string,value:unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function exportContacts(listings:CollectedListing[],source:string) {
  const cell=(value:string)=>'"'+(/^[=+\-@\t\r]/.test(value)?"'":"")+value.replaceAll('"','""')+'"';
  const rows=[["Business","Address","Website","Phone","Discovered emails","Contact verification","Dataset source"],...listings.map(l=>[l.name,l.address??"",l.website??"",l.phone??"",l.emails.join("; "),"Not verified",source])];
  const url=URL.createObjectURL(new Blob([rows.map(row=>row.map(cell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="axiocred-discovered-contacts.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
