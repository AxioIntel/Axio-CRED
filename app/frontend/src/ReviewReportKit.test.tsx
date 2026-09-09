import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReviewReportKit, { mapsListingUrl } from "./ReviewReportKit";
import { demoDataset } from "./intelligence-data";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("per-review report kits", () => {
  it("explains the inactive Auto add feature without submitting or queueing anything", () => {
    const fetcher=vi.spyOn(globalThis,"fetch");
    const listing=demoDataset.listings[0];
    render(<ReviewReportKit listing={listing} review={listing.reviews[0]} datasetId="test"/>);
    fireEvent.click(screen.getByLabelText(`Report kit for ${listing.reviews[0].author}`));
    expect(screen.getByRole("button",{name:"Auto add · Coming soon"})).toBeDisabled();
    const info=screen.getByRole("button",{name:"About Auto add"});
    fireEvent.click(info);expect(info).toHaveAttribute("aria-expanded","true");
    expect(screen.getByText(/automatically add reviews selected for investigation/)).toBeVisible();
    fireEvent.click(info);expect(info).toHaveAttribute("aria-expanded","false");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("copies only the selected review, its provenance, and that review's edited evidence", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText}});
    const listing = {...demoDataset.listings[0], placeId: "ChIJ-test"};
    render(<>{listing.reviews.map(review => <ReviewReportKit key={review.id} listing={listing} review={review} datasetId="dataset-one" collectedAt="2026-09-06T12:00:00Z"/>)}</>);
    const first = screen.getByLabelText(`Report kit for ${listing.reviews[0].author}`).closest("details")!;
    const second = screen.getByLabelText(`Report kit for ${listing.reviews[1].author}`).closest("details")!;
    fireEvent.click(within(first).getByText("Report kit"));
    expect(first.open).toBe(true); expect(second.open).toBe(false);
    fireEvent.change(within(first).getByLabelText("Your verified evidence / report draft"), {target: {value: "Source screenshot reference A."}});
    fireEvent.click(within(first).getByRole("button", {name: "Copy report draft"}));
    await within(first).findByRole("status");
    const draft = writeText.mock.calls[0][0] as string;
    expect(draft).toContain(listing.reviews[0].text);
    expect(draft).not.toContain(listing.reviews[1].text);
    expect(draft).toContain("Dataset: dataset-one");
    expect(draft).toContain("Source screenshot reference A.");
    expect(draft).toContain("No AI assessment is available");
    expect(draft).toContain("No report has been submitted");
    expect(within(second).getByLabelText("Your verified evidence / report draft")).toHaveValue("");
  });
  it("does not invent a report endpoint or open an unsafe source URL", () => {
    const listing = {...demoDataset.listings[0], mapsUrl: "javascript:alert(1)"};
    expect(mapsListingUrl(listing)).toBeNull();
    expect(mapsListingUrl({...listing, mapsUrl: "https://google.com.evil.example/maps"})).toBeNull();
    const url = mapsListingUrl({...listing, placeId: "ChIJ-test"})!;
    expect(new URL(url).hostname).toBe("www.google.com");
    expect(new URL(url).searchParams.get("query_place_id")).toBe("ChIJ-test");
  });
});
