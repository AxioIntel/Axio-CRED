export function collectionCoverage(listings:Array<{reviews:unknown[];reviewCount:number|null}>,log="") {
  const collected=listings.reduce((sum,row)=>sum+row.reviews.length,0);
  const reported=listings.every(row=>row.reviewCount!==null)?listings.reduce((sum,row)=>sum+row.reviewCount!,0):null;
  const matchedReportedCount=reported!==null&&collected>=reported;
  const reasons:string[]=[];
  if(/HTTP 403|status code: 403/.test(log))reasons.push("Google rejected the review endpoint; public-page fallback was used");
  if(/Review count stuck/.test(log))reasons.push("the public review panel stopped yielding new reviews");
  if(/time budget reached/i.test(log))reasons.push("the collection time budget was reached");
  if(/safety limit reached/i.test(log))reasons.push("the native 5,000-review safety limit was reached");
  return {collected,reported,status:matchedReportedCount?"reported_count_reached":"partial",message:matchedReportedCount?`${collected} records collected; the reported count was reached. This does not independently verify completeness.`:`Partial collection: ${collected} of ${reported??"unknown"} reported reviews. ${reasons.join("; ")||"Complete coverage has not been established"}.`};
}
