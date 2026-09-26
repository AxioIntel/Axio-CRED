# Research workspace

The Go dashboard has a shared sidebar with Collection, Research and Workspace groups.

## AI Research (`/research`)

The current release is a brief editor, not a live AI collector. Operators can choose business websites, Reddit discussions or Practo profiles; enter their question, source links and desired fields; save one brief in their browser; and download it as JSON. Examples cover clinic research, community feedback and competitor changes. Replacing an edited brief with an example asks for confirmation.

Drafts are browser-local and do not sync between devices. Saving or downloading does not visit URLs, spend tokens or create a collection job. Automated extraction, entity matching, evidence validation and the proposed monthly spending control are not implemented by this change.

Reddit is a research source option, not an active connector. Use cases include recurring complaints, product comparisons and brand mentions. API access requires Reddit approval, and commercial use requires the applicable agreement. See [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) and [Data API terms](https://redditinc.com/policies/data-api-terms).

## Practo (`/practo`)

Operators can download a CSV header template and import up to 1,000 profile rows in an upload under 2 MiB (including multipart overhead). Required columns are `name` and `profile_url`. Optional columns are `specialty`, `phone`, `emails`, `website`, `address`, `city`, `state` and `country`. Unknown or duplicate columns, duplicate profile URLs within a file, malformed CSV, overlong fields and invalid links reject the entire import.

Profile URLs must use HTTPS and the exact `practo.com` or `www.practo.com` hostname, with a doctor, clinic or hospital profile path. Credentials and custom ports are rejected. Tracking query strings, fragments and trailing slashes are removed from the stored profile identity. Optional website URLs must be HTTP(S) without credentials. URLs are never fetched by this import.

Rows enter the existing lead store with source `practo`, keyed by canonical profile URL. Reimport refreshes observed details without clearing missing contact fields or changing notes, suppression, consent or outreach state. It does not merge doctors across profiles or preserve multiple affiliations as separate entities. It does not import ratings or review counts that could be mistaken for Google outreach eligibility.

The multipart import route has cross-origin protection and a bounded request body. Validation happens before the database transaction. Database failures return a generic error without exposing internals. The browser disables duplicate clicks while an upload runs and links successful imports to the source-filtered lead list. An interrupted connection tells the operator to check results before retrying; reimport is safe for lead identity.

Practo live search/collection is not connected. Importing requires data the operator has permission to use; it does not verify its accuracy. Nothing sends outreach or bypasses bot protection. [Practo partner API terms](https://help.practo.com/partner-api/practo-api-program-terms-and-conditions/) describe a separate access arrangement, not an unrestricted database export license.

## Verification

Run `go test ./web/...`, `go vet ./web/...` and build the binary. Import tests cover normalization, reimport, preserved operator state, whole-file rejection, URL boundaries, row/field limits, request bounds and cross-site rejection. Browser checks cover shared navigation, source guidance and saved-brief persistence. The feature uses the current lead database schema; no migration or Azure configuration is required.
