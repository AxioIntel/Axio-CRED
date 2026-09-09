import {render,screen,cleanup} from "@testing-library/react";
import {afterEach,describe,it,expect} from "vitest";
import {CollectionQuality,ReviewMetadata} from "./CollectionQuality";
import {demoDataset} from "./intelligence-data";
afterEach(cleanup);
describe("evidence coverage",()=>{
  it("separates exact timestamps from relative dates and exposes additional listing fields",()=>{
    const listing={...demoDataset.listings[0],categories:["Dentist","Dental clinic"],plusCode:"AB+12",reviews:[{...demoDataset.listings[0].reviews[0],publishedAt:"2025-01-01T00:00:00Z",datePrecision:"timestamp" as const,images:["https://example.com/photo"]},{...demoDataset.listings[0].reviews[1],when:"a month ago",publishedAt:null,datePrecision:"relative_or_displayed" as const}]};
    render(<CollectionQuality listing={listing}/>);expect(screen.getByText("1 / 2")).toBeInTheDocument();expect(screen.getByText("Dentist, Dental clinic")).toBeInTheDocument();expect(screen.getByText("AB+12")).toBeInTheDocument();
  });
  it("exposes collected image links without inventing review metadata",()=>{
    render(<ReviewMetadata review={{...demoDataset.listings[0].reviews[0],images:["https://example.com/photo"]}}/>);
    expect(screen.getByRole("link",{name:"Review photo 1",hidden:true})).toHaveAttribute("href","https://example.com/photo");expect(screen.queryByText(/Published:/)).not.toBeInTheDocument();
  });
});
