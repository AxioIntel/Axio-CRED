import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

const text = z.string().max(20000).nullish();
const score = z.number().min(0).max(5).nullish();
const reviewSchema = z.object({
  Name: text, Description: text, Rating: score, When: text,
  review_id: text, author_url: text, source: text, text_original: text,
  rating_float: score, reply_text: text, reply_text_original: text, published_at: text,
  posted_at_unix_micros: z.number().nonnegative().nullish(), updated_at_unix_micros:z.number().nonnegative().nullish(),
  reply_posted_at_unix_micros:z.number().nonnegative().nullish(),language:text,translated_lang:text,text_translated:text,
  ProfilePicture:text, Images:z.array(z.string()).max(500).nullish()
});
const entrySchema = z.object({
  title: z.string().trim().min(1).max(500), place_id: text, cid: text, link: text,
  category: text, categories: z.array(z.string()).max(100).nullish(), address: text,
  latitude: z.number().min(-90).max(90).nullish(), longitude: z.number().min(-180).max(180).nullish(), longtitude: z.number().min(-180).max(180).nullish(),
  review_count: z.number().int().nonnegative().nullish(), review_rating: score,
  reviews_per_rating: z.record(z.string(), z.number().int().nonnegative()).nullish(),
  phone: text, web_site: text, emails: z.array(z.string().max(320)).max(500).nullish(),
  open_hours: z.record(z.string(), z.array(z.string())).nullish(), status: text,
  description: text, timezone: text, price_range: text,
  reviews_link:text,thumbnail:text,plus_code:text,
  complete_address:z.object({borough:text,street:text,city:text,postal_code:text,state:text,country:text}).nullish(),
  about:z.array(z.object({id:text,name:text,options:z.array(z.object({name:text,enabled:z.boolean(),values:z.array(z.string()).nullish()})).max(100)})).max(100).nullish(),
  images: z.array(z.object({ title: text, image: text })).max(5000).nullish(),
  user_reviews: z.array(reviewSchema).max(5000).nullish(), user_reviews_extended: z.array(reviewSchema).max(5000).nullish()
});
export function safeLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
const missing = (value: string | null | undefined) => value?.trim() || null;
export function reviewTimestamp(value:number|null|undefined):string|null {
  if(!value||!Number.isSafeInteger(value))return null;
  const millis=value/1000;
  if(millis<Date.UTC(2007,0,1)||millis>Date.now()+86_400_000)return null;
  return new Date(millis).toISOString();
}

export function normalizeImport(payload: unknown) {
  const parsed = z.object({ label: z.string().trim().min(1).max(120), collectedAt: z.string().datetime().optional(), entries: z.array(entrySchema).min(1).max(1000) }).parse(payload);
  const listings = parsed.entries.map((entry, index) => {
    const merged = new Map<string, z.infer<typeof reviewSchema>>();
    for (const review of [...(entry.user_reviews ?? []), ...(entry.user_reviews_extended ?? [])]) {
      const key = missing(review.review_id) ?? createHash("sha256").update(JSON.stringify([review.Name,review.text_original ?? review.Description,review.Rating,review.When,review.posted_at_unix_micros])).digest("hex");
      const old=merged.get(key);
      const next={ ...old, ...Object.fromEntries(Object.entries(review).filter(([, value]) => value != null && value !== "" && (!Array.isArray(value)||value.length))) };
      // A sparse DOM duplicate must not overwrite richer structured evidence.
      for(const field of ["Description","text_original","reply_text","reply_text_original"] as const)if((old?.[field]?.length??0)>(next[field]?.length??0))next[field]=old![field];
      if(next.Rating===0&&old?.Rating)next.Rating=old.Rating;
      merged.set(key,next);
    }
    const reviews = [...merged].map(([key, review]) => {
      const exactDate=missing(review.published_at);
      const exactMillis=exactDate?Date.parse(exactDate):NaN;
      const publishedAt=exactDate&&/^\d{4}-\d{2}-\d{2}T/.test(exactDate)&&exactMillis>=Date.UTC(2007,0,1)&&exactMillis<=Date.now()+86_400_000?exactDate:reviewTimestamp(review.posted_at_unix_micros);
      const reviewText=missing(review.text_original)??missing(review.Description);
      const replyText=missing(review.reply_text_original)??missing(review.reply_text);
      const overlapsReply=Boolean(reviewText&&reviewText===replyText&&review.source==="Google Maps public page");
      return { id: key, author: missing(review.Name) ?? "Unknown author", authorUrl: safeLink(review.author_url), rating: (review.Rating&&review.Rating>0?review.Rating:review.rating_float&&review.rating_float>0?review.rating_float:null),
        text: overlapsReply?null:reviewText, when: publishedAt ?? missing(review.When), source: missing(review.source), reply: replyText,
        captureIssue:overlapsReply?"Review text withheld because it duplicates the captured owner response. Recollect to verify.":null,
        publishedAt,datePrecision:publishedAt?"timestamp" as const:missing(review.When)?"relative_or_displayed" as const:"unknown" as const,
        updatedAt:reviewTimestamp(review.updated_at_unix_micros),replyPublishedAt:reviewTimestamp(review.reply_posted_at_unix_micros),
        language:missing(review.language),translatedLanguage:missing(review.translated_lang),translatedText:missing(review.text_translated),
        authorPhoto:safeLink(review.ProfilePicture),images:[...new Set((review.Images??[]).map(safeLink).filter((url):url is string=>Boolean(url)))] };
    });
    return { id: String(index), placeId: missing(entry.place_id), cid: missing(entry.cid), name: entry.title,
      mapsUrl: safeLink(entry.link), category: missing(entry.category) ?? entry.categories?.[0] ?? null, address: missing(entry.address),
      latitude: entry.latitude ?? null, longitude: entry.longitude ?? entry.longtitude ?? null,
      rating: entry.review_rating ?? null, reviewCount: entry.review_count ?? null, distribution: entry.reviews_per_rating ?? {},
      phone: missing(entry.phone), website: safeLink(entry.web_site), emails: [...new Set((entry.emails ?? []).map(email => email.trim()).filter(email => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)))],
      hours: entry.open_hours ?? {}, status: missing(entry.status), description: missing(entry.description), timezone: missing(entry.timezone), priceRange: missing(entry.price_range),
      categories:entry.categories??[],reviewsUrl:safeLink(entry.reviews_link),thumbnail:safeLink(entry.thumbnail),plusCode:missing(entry.plus_code),
      structuredAddress:entry.complete_address??null,attributes:entry.about??[],
      images: (entry.images ?? []).map(image => ({ title: missing(image.title), url: safeLink(image.image) })).filter(image => image.url), reviews };
  });
  return { id: randomUUID(), label: parsed.label, importedAt: new Date().toISOString(), collectedAt: parsed.collectedAt ?? null, source: "scraper_import" as const,
    sha256: createHash("sha256").update(JSON.stringify(parsed.entries)).digest("hex"), listings };
}
export type IntelligenceDataset = ReturnType<typeof normalizeImport> & { collection?: {
  provider:"builtin"|"outscraper"; requestId?:string; reason?:string; requestedLimit?:number;
} };
