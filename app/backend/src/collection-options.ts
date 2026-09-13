import { z } from "zod";
type Grid={south:number;west:number;north:number;east:number;cellKm:number};

export const collectionOptionsSchema = z.object({
  mode: z.enum(["details", "fast"]).default("details"),
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/).default("en"),
  depth: z.number().int().min(1).max(50).default(10),
  maxListings: z.number().int().min(1).max(1000).default(200),
  emails: z.boolean().default(false),
  extendedReviews: z.boolean().default(false),
  geo: z.object({ latitude:z.number().min(-90).max(90), longitude:z.number().min(-180).max(180), radius:z.number().min(1).max(100000).default(10000) }).strict().optional(),
  zoom: z.number().int().min(1).max(21).default(15),
  grid: z.object({ south:z.number().min(-85).max(85), west:z.number().min(-180).max(180), north:z.number().min(-85).max(85), east:z.number().min(-180).max(180), cellKm:z.number().min(0.1).max(50).default(1) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  const issue=(message:string)=>ctx.addIssue({code:"custom",message});
  if(value.mode==="fast"&&(!value.geo||value.grid||value.emails||value.extendedReviews))issue("Fast discovery requires a center and cannot collect emails, extended reviews or a grid. Use detailed collection for those fields.");
  if(value.grid){
    if(value.geo)issue("Choose a center or a grid, not both.");
    if(value.grid.south>=value.grid.north||value.grid.west>=value.grid.east)issue("Grid north/east must exceed south/west; antimeridian grids are not supported.");
    const cells=gridCells(value.grid);
    if(cells<1||cells>100)issue("Choose a grid with 1–100 cells, or increase cell size.");
  }
});
export type CollectionOptions=z.infer<typeof collectionOptionsSchema>;
export function gridCells(grid:Grid){
  const latStep=grid.cellKm/111.32;
  const lonStep=grid.cellKm/(111.32*Math.cos((grid.south+grid.north)/2*Math.PI/180));
  return Math.max(0,Math.ceil((grid.north-grid.south)/latStep-0.5))*Math.max(0,Math.ceil((grid.east-grid.west)/lonStep-0.5));
}
export function nativeTuning(env:NodeJS.ProcessEnv=process.env){
  const bounded=(name:string)=>{const value=Number(env[name]??1);if(!Number.isInteger(value)||value<1||value>4)throw Object.assign(new Error(`${name} must be an integer from 1 to 4.`),{code:"NATIVE_SETUP"});return value;};
  return {concurrency:bounded("NATIVE_SCRAPER_CONCURRENCY"),browserPool:bounded("NATIVE_SCRAPER_BROWSER_POOL"),pagesPerBrowser:bounded("NATIVE_SCRAPER_PAGES_PER_BROWSER")};
}
export function nativeArguments(input:string, output:string, options:CollectionOptions, proxyFile?:string,tuning=nativeTuning({})) {
  const args=["-input",input,"-results",output,"-json","-lang",options.language,"-depth",String(options.depth),"-zoom",String(options.zoom),"-c",String(tuning.concurrency),"-browser-pool-size",String(tuning.browserPool),"-pages-per-browser",String(tuning.pagesPerBrowser)];
  if(options.emails)args.push("-email");
  if(options.extendedReviews)args.push("-extra-reviews");
  if(options.mode==="fast")args.push("-fast-mode");
  if(options.geo)args.push("-geo",`${options.geo.latitude},${options.geo.longitude}`,"-radius",String(options.geo.radius));
  if(options.grid)args.push("-grid-bbox",`${options.grid.south},${options.grid.west},${options.grid.north},${options.grid.east}`,"-grid-cell",String(options.grid.cellKm));
  if(proxyFile)args.push("-proxies-file",proxyFile);
  return args;
}
