// Deterministic observations over collected records. None establishes authenticity.
export interface PatternReview { id:string; author:string; authorUrl:string|null; text:string|null; rating:number|null; when:string|null; reply:string|null }
export interface PatternListing { reviews:PatternReview[]; reviewCount:number|null }
export interface PatternSignal { id:string; kind:"duplicate_text"|"posting_cluster"|"volume_burst"|"owner_response_pressure"; title:string; reviewIds:string[]; detail:string; alternative:string; policy:string; evidence:{reviewId:string;field:"text"|"reply";quote:string}[] }
const dayMs=86400000;
const normalize=(s:string)=>s.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();
const tokens=(s:string)=>{const words=s.split(" ");return new Set(words.slice(0,-2).map((_,i)=>words.slice(i,i+3).join(" ")));};
const similarity=(a:Set<string>,b:Set<string>)=>{let n=0;for(const t of a)if(b.has(t))n++;return n/(a.size+b.size-n||1);};
export function reviewPatterns(listing:PatternListing, collectedAt:string|null=null) {
  const reviews=[...new Map(listing.reviews.map(r=>[r.id,r])).values()];
  const cutoff=collectedAt?Date.parse(collectedAt):Date.now();
  const dated=reviews.flatMap(r=>{const at=r.when&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r.when)?Date.parse(r.when):NaN;return Number.isFinite(at)&&at<=cutoff?[{...r,at,day:new Date(at).toISOString().slice(0,10)}]:[];}).sort((a,b)=>a.at-b.at);
  const ratio=listing.reviewCount&&listing.reviewCount>0?Math.min(1,reviews.length/listing.reviewCount):null;
  const months:Record<string,{count:number;textless:number;low:number}>= {};
  const days=new Map<string,typeof dated>();
  for(const r of dated){const m=r.day.slice(0,7);const bucket=months[m]??={count:0,textless:0,low:0};bucket.count++;if(!r.text?.trim())bucket.textless++;if(r.rating!=null&&r.rating<=3)bucket.low++;days.set(r.day,[...(days.get(r.day)??[]),r]);}
  const signals:PatternSignal[]=[];
  const add=(signal:Omit<PatternSignal,"id">)=>signals.push({...signal,id:`pattern-${signals.length+1}`});
  const eligible=reviews.map(r=>({...r,normalized:normalize(r.text??"")})).filter(r=>r.normalized.length>=80&&r.normalized.split(" ").length>=12).map(r=>({...r,grams:tokens(r.normalized)}));
  let comparisons=0;const pairLimit=200000;let comparisonLimited=false;
  outer:for(let i=0;i<eligible.length;i++)for(let j=i+1;j<eligible.length;j++){
    if(++comparisons>pairLimit||signals.length>=1000){comparisonLimited=true;break outer;}
    const a=eligible[i],b=eligible[j];
    // Same public profile, or same named author without profile IDs, is not independent evidence.
    if(a.authorUrl&&a.authorUrl===b.authorUrl||!a.authorUrl&&!b.authorUrl&&a.author===b.author)continue;
    const score=similarity(a.grams,b.grams);if(score<.82)continue;
    add({kind:"duplicate_text",title:"Substantial repeated review wording",reviewIds:[a.id,b.id],detail:`Word-trigram Jaccard similarity ${score.toFixed(2)} between two collected records (threshold 0.82; minimum 80 characters and 12 words). This is textual similarity, not a fraud probability.`,alternative:"Shared phrasing, copied legitimate feedback or collection duplication are possible; verify distinct contributors and the full originals.",policy:"Potential fake engagement / rating manipulation; corroboration required",evidence:[{reviewId:a.id,field:"text",quote:a.text!.slice(0,500)},{reviewId:b.id,field:"text",quote:b.text!.slice(0,500)}]});
  }
  for(const [day,rows] of days){if(rows.length<5)continue;add({kind:"posting_cluster",title:`${rows.length} collected reviews on ${day} (UTC)`,reviewIds:rows.map(r=>r.id),detail:`${rows.filter(r=>r.rating===5).length} five-star; ${rows.filter(r=>!r.text?.trim()).length} textless. A same-day cluster is an observation, not proof of an abnormal business-wide rate.`,alternative:"A legitimate request campaign, busy period or biased collection order can create clustering.",policy:"Rating manipulation only if corroborating evidence supports manipulation",evidence:[]});}
  const baselineEligible=ratio!=null&&ratio>=.9&&dated.length>=50&&dated.length/reviews.length>=.9&&dated.at(-1)!.at-dated[0].at>=63*dayMs;
  if(baselineEligible){let previousEnd=-Infinity;for(const r of dated){const end=r.at+7*dayMs;if(r.at<=previousEnd||r.at-dated[0].at<56*dayMs)continue;const baseline=dated.filter(x=>x.at>=r.at-56*dayMs&&x.at<r.at);const window=dated.filter(x=>x.at>=r.at&&x.at<end);const expected=baseline.length/8;if(baseline.length<5||window.length<8||window.length<4*expected)continue;add({kind:"volume_burst",title:"Seven-day volume exceeds the preceding baseline",reviewIds:window.map(x=>x.id),detail:`${window.length} reviews from ${r.day}, versus ${expected.toFixed(2)} expected from the preceding 56 days (${(window.length/expected).toFixed(1)}×). Descriptive heuristic; no significance test or authenticity conclusion.`,alternative:"Seasonality, business growth, a legitimate solicitation campaign or missing historical records may explain the change.",policy:"Potential rating manipulation; assess alongside independent evidence",evidence:[]});previousEnd=end;}}
  const critical=reviews.filter(r=>r.rating!=null&&r.rating<=3);
  for(const r of critical){if(!r.reply)continue;const pressure=/\b(delete|remove|withdraw|take down)\b/i.test(r.reply)&&/\b(legal|police|lawsuit|sue|defamation)\b/i.test(r.reply);if(!pressure)continue;add({kind:"owner_response_pressure",title:"Owner reply combines deletion demand and legal language",reviewIds:[r.id],detail:"Detected both removal-request wording and legal/police language in the collected owner reply. Review the full context; a legal reference alone is not harassment.",alternative:"The owner may be disputing a review in good faith. We cannot verify the experience or whether pressure resulted in deletion.",policy:"Potential discouragement of negative reviews; human policy review required",evidence:[{reviewId:r.id,field:"reply",quote:r.reply.slice(0,1000)}]});}
  const replyGroups=new Map<string,number>();for(const r of reviews){const n=normalize(r.reply??"");if(n.length>=40)replyGroups.set(n,(replyGroups.get(n)??0)+1);}
  return {version:"patterns-v1",collected:reviews.length,reported:listing.reviewCount,coverageRatio:ratio,missing:listing.reviewCount==null?null:Math.max(0,listing.reviewCount-reviews.length),dated:dated.length,unknownDates:reviews.length-dated.length,baselineEligible,comparisonLimited,comparisons:Math.min(comparisons,pairLimit),monthly:Object.entries(months).map(([month,v])=>({month,...v})),signals,investigationReviewIds:[...new Set(signals.flatMap(s=>s.reviewIds))],criticalReviews:critical.length,ownerReplies:reviews.filter(r=>r.reply?.trim()).length,largestReplyTemplate:Math.max(0,...replyGroups.values()),reviewerHistory:"not_collected" as const,removals:"not_established" as const};
}
export type PatternReport=ReturnType<typeof reviewPatterns>;
