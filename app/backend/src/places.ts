import { config } from "./config.js";

export interface PublicAuditResult {
  source: "google_places" | "demo";
  collectedAt: string;
  business: { placeId: string; name: string; address: string; category: string; rating: number; reviewCount: number; businessStatus: string; phone?: string; website?: string };
  findings: { level: "info" | "warning"; title: string; detail: string }[];
}

export interface PlaceReview {
  authorName: string;
  authorUri?: string;
  rating: number;
  text: string;
  publishTime?: string;
  relativePublishTimeDescription?: string;
}

export interface PlaceLookupResult {
  source: "google_places" | "demo";
  placeId: string;
  name: string;
  address: string;
  category: string;
  rating: number;
  reviewCount: number;
  businessStatus: string;
  mapsUrl: string;
  reviews: PlaceReview[];
}

const cache = new Map<string, { expires: number; value: PublicAuditResult }>();

function searchQueryFromInput(input: string) {
  const value = input.trim();
  try {
    const url = new URL(value);
    const fromQuery = url.searchParams.get("query_place_id") ?? url.searchParams.get("place_id");
    if (fromQuery) return undefined;
    const match = url.pathname.match(/\/maps\/search\/([^/]+)/);
    if (match) return decodeURIComponent(match[1].replace(/\+/g, " ")).trim();
  } catch {
    // Raw Place IDs do not need URL parsing.
  }
  return undefined;
}

export function normalizePlaceId(input: string) {
  const value = input.trim();
  try {
    const url = new URL(value);
    const fromQuery = url.searchParams.get("query_place_id") ?? url.searchParams.get("place_id");
    if (fromQuery) return fromQuery.trim();
  } catch {
    // Raw Place IDs do not need URL parsing.
  }
  return value;
}

export async function lookupPlace(input: string): Promise<PlaceLookupResult> {
  const searchQuery = searchQueryFromInput(input);
  let placeId = normalizePlaceId(input);
  if (searchQuery && config.placesConfigured) {
    const searchResponse = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY ?? "", "X-Goog-FieldMask": "places.id" },
      body: JSON.stringify({ textQuery: searchQuery, pageSize: 1 })
    });
    if (!searchResponse.ok) throw new Error(`Google Places search failed (${searchResponse.status}). Check the Maps URL or API key.`);
    const body = await searchResponse.json() as { places?: Array<{ id?: string }> };
    placeId = body.places?.[0]?.id ?? "";
  } else if (searchQuery) {
    placeId = "demo-place";
  }
  if (!placeId) throw new Error("Enter a Google Place ID or a Google Maps URL.");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${encodeURIComponent(placeId)}`;
  if (!config.placesConfigured) {
    return {
      source: "demo",
      placeId,
      name: searchQuery || "Google Place preview",
      address: "Preview address returned after a real Places API connection",
      category: "Business",
      rating: 4.6,
      reviewCount: 127,
      businessStatus: "OPERATIONAL",
      mapsUrl,
      reviews: [{ authorName: "Preview reviewer", rating: 5, text: "Demo review shown in local preview only.", relativePublishTimeDescription: "preview" }]
    };
  }

  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY ?? "",
      "X-Goog-FieldMask": "id,displayName,formattedAddress,primaryType,rating,userRatingCount,businessStatus,googleMapsUri,reviews"
    }
  });
  if (!response.ok) throw new Error(`Google Places lookup failed (${response.status}). Check the Place ID and API key.`);
  const body = await response.json() as Record<string, unknown>;
  const reviews = Array.isArray(body.reviews) ? body.reviews.map((review) => {
    const item = review as Record<string, unknown>;
    const author = item.authorAttribution as Record<string, unknown> | undefined;
    const text = (item.text ?? item.originalText) as Record<string, unknown> | undefined;
    return {
      authorName: String(author?.displayName ?? "Google reviewer"),
      authorUri: author?.uri ? String(author.uri) : undefined,
      rating: Number(item.rating ?? 0),
      text: String(text?.text ?? ""),
      publishTime: item.publishTime ? String(item.publishTime) : undefined,
      relativePublishTimeDescription: item.relativePublishTimeDescription ? String(item.relativePublishTimeDescription) : undefined
    } satisfies PlaceReview;
  }) : [];
  return {
    source: "google_places",
    placeId: String(body.id ?? placeId),
    name: String((body.displayName as Record<string, unknown> | undefined)?.text ?? "Google Place"),
    address: String(body.formattedAddress ?? ""),
    category: String(body.primaryType ?? "Business"),
    rating: Number(body.rating ?? 0),
    reviewCount: Number(body.userRatingCount ?? 0),
    businessStatus: String(body.businessStatus ?? "UNKNOWN"),
    mapsUrl: String(body.googleMapsUri ?? mapsUrl),
    reviews
  };
}

export async function runPublicAudit(query: string): Promise<PublicAuditResult> {
  const key = query.trim().toLocaleLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value: PublicAuditResult;
  if (!config.placesConfigured) {
    value = {
      source: "demo",
      collectedAt: new Date().toISOString(),
      business: { placeId: "demo-place", name: query.trim(), address: "Public address returned by Google Places", category: "Business", rating: 4.6, reviewCount: 127, businessStatus: "OPERATIONAL" },
      findings: [
        { level: "info", title: "Public profile discovered", detail: "Name, category, address, status, rating, and review count are available for a baseline." },
        { level: "warning", title: "Review velocity needs a second sample", detail: "Axio-CRED needs another observation before it can calculate a defensible change rate." }
      ]
    };
  } else {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY ?? "",
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.primaryType,places.rating,places.userRatingCount,places.businessStatus,places.websiteUri,places.nationalPhoneNumber"
      },
      body: JSON.stringify({ textQuery: query, pageSize: 1 })
    });
    if (!response.ok) throw new Error(`Google Places audit failed (${response.status}).`);
    const body = await response.json() as { places?: Array<Record<string, unknown>> };
    const place = body.places?.[0];
    if (!place) throw new Error("No matching business was found.");
    value = {
      source: "google_places",
      collectedAt: new Date().toISOString(),
      business: {
        placeId: String(place.id ?? ""),
        name: String((place.displayName as { text?: string } | undefined)?.text ?? query),
        address: String(place.formattedAddress ?? ""),
        category: String(place.primaryType ?? "Unknown"),
        rating: Number(place.rating ?? 0),
        reviewCount: Number(place.userRatingCount ?? 0),
        businessStatus: String(place.businessStatus ?? "UNKNOWN"),
        phone: place.nationalPhoneNumber ? String(place.nationalPhoneNumber) : undefined,
        website: place.websiteUri ? String(place.websiteUri) : undefined
      },
      findings: [{ level: "info", title: "Public baseline captured", detail: "Save this audit and compare a later sample to measure rating and review-count changes." }]
    };
  }
  cache.set(key, { expires: Date.now() + 24 * 60 * 60 * 1000, value });
  return value;
}
