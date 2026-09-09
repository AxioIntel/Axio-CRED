import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {afterEach,describe,it,expect,vi} from "vitest";
const source=readFileSync(resolve(process.cwd(),"../../gmaps/review_dom.js"),"utf8");
const extract=()=>new Function(`return (${source})()`)() as Record<string,unknown>[];
afterEach(()=>{document.body.innerHTML="";delete (window as any).__axiocredReviewCards;vi.restoreAllMocks();});
describe("native review DOM collection",()=>{
  it("emits only changed cards and preserves expanded content on the next pass",()=>{
    document.body.innerHTML='<div data-review-id="one"><span class="d4r55">A</span><span class="kvMYJc" aria-label="5 stars"></span><span class="wiI7pd">Short</span></div>';
    expect(extract()).toHaveLength(1);expect(extract()).toEqual([]);
    document.querySelector('.wiI7pd')!.textContent='Full expanded review text';
    expect(extract()[0].text).toBe('Full expanded review text');expect(extract()).toEqual([]);
  });
  it("keeps anonymous star-only reviews, captures reply separately and excludes profile images",()=>{
    document.body.innerHTML='<div data-review-id="one"><span class="kvMYJc" aria-label="1 star"></span><a href="https://www.google.com/maps/contrib/123">Profile</a><img src="https://lh3.googleusercontent.com/avatar"><div class="CDe7pd"><span class="wiI7pd">Owner response</span></div><time datetime="2025-01-01T00:00:00Z"></time><div class="review-photos"><img src="https://example.com/photo.jpg"></div></div>';
    const [review]=extract();expect(review.text).toBe('');expect(review.reply_text).toBe('Owner response');expect(review.published_at).toBe('2025-01-01T00:00:00Z');
    expect(review.images).toEqual(['https://example.com/photo.jpg']);expect(review.author_url).toContain('/contrib/123');expect(review.review_id).toBe('one');
  });
  it("does not mistake a More actions menu for review text expansion",()=>{
    document.body.innerHTML='<div data-review-id="one"><span class="d4r55">A</span><span class="kvMYJc" aria-label="5 stars"></span><button aria-label="More actions">Menu</button></div>';
    const click=vi.fn();document.querySelector('button')!.addEventListener('click',click);extract();expect(click).not.toHaveBeenCalled();
  });
});
