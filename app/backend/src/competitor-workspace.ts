import { z } from "zod";

const mapsLink = z.string().trim().max(3000).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      ["share.google", "maps.app.goo.gl", "maps.google.com"].includes(url.hostname) ||
      (["google.com", "www.google.com"].includes(url.hostname) && url.pathname.startsWith("/maps"))
    );
  } catch { return false; }
}, "Enter a Google Maps or Google share link.");

export const competitorWorkspaceSchema = z.object({
  baselineKey: z.string().max(600).nullable(),
  targets: z.array(z.object({
    id: z.string().uuid(), name: z.string().trim().min(2).max(255),
    mapsUrl: mapsLink.nullable(), listingKey: z.string().max(600).nullable()
  }).refine(target => target.mapsUrl || target.listingKey, "A Maps link or collected listing is required.")).max(500)
}).superRefine((value, context) => {
  const ids = new Set<string>();
  const listings = new Set<string>();
  const urls = new Set<string>();
  for (const target of value.targets) {
    if (ids.has(target.id) || (target.listingKey && (target.listingKey === value.baselineKey || listings.has(target.listingKey))) || (target.mapsUrl && urls.has(target.mapsUrl))) {
      context.addIssue({ code: "custom", message: "A competitor cannot duplicate your baseline or another watchlist entry." });
    }
    ids.add(target.id);
    if (target.listingKey) listings.add(target.listingKey);
    if (target.mapsUrl) urls.add(target.mapsUrl);
  }
});
export type CompetitorWorkspace = z.infer<typeof competitorWorkspaceSchema>;
