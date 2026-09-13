# Axio-CRED Azure OpenAI

This document records historical provider setup from 7–8 September 2026. Account state, quota and model availability were not revalidated on 9 September. The later GPT-5.4 section supersedes the initial deployment selection below. This connects local analysis to Azure; it does not deploy the web app. Production customer API access remains blocked pending tenant authorization.

## Deployed resource

- Subscription: `4d60d30a-c689-46f4-ad41-cafc92dec5fb`
- Resource group: `epik1`
- Foundry resource: `axiocred-resource`, South India
- Project: `axiocred`
- Deployment: `axiocred-review-analysis`
- Model: `gpt-4.1-mini`, version `2025-04-14`
- Deployment type: Global Standard (usage based; inference may be processed globally)
- Allocated throughput: 50,000 tokens/minute, increased from the initial 20,000 to leave headroom for the app's 30-review batch and output allowance. Large requests can still be rate limited. This is not a budget cap.
- Guardrails: DefaultV2; version upgrade policy: OnceNewDefaultVersionAvailable
- Resource endpoint: `https://axiocred-resource.services.ai.azure.com/`
- Foundry displayed retirement date: 14 April 2027. Recheck availability and evaluate a replacement before production and before retirement.

The original `epikdocvoice` Central India resource was not modified. Foundry rejected both Standard and Global Standard for this model in Central India, so a dedicated resource was created in South India.

## Backend configuration

The local `.env` is configured with these names; the real key belongs only in that ignored file:

```dotenv
AI_PROVIDER=azure
AZURE_OPENAI_API_KEY=<resource key stored locally>
AZURE_OPENAI_ENDPOINT=https://axiocred-resource.services.ai.azure.com/
AZURE_OPENAI_DEPLOYMENT=axiocred-review-analysis-gpt54
```

No direct OpenAI key, API version parameter, embedding deployment, AI Search index, or agent is required for this flow. The adapter uses `/openai/v1/responses`, `api-key` authentication and the deployment name in `model`. Root endpoints and `/openai/v1` bases are accepted; project-specific Foundry URLs are not accepted. Keys never enter frontend status responses. Unexpected hosts, paths, credentials in URLs and redirects are rejected. Direct OpenAI remains an explicit `AI_PROVIDER=openai` option; credentials never silently fall back between providers.

After an environment edit restart the backend. From this directory:

```powershell
npm.cmd run build
node scripts/check-ai.mjs
```

The check makes a small billable synthetic request and prints only status and token usage. `configured: true` means settings are present, not a verified successful request. HTTP 401 indicates a key/resource mismatch, 404 a missing deployment or wrong endpoint, and 429 quota/rate limits. Azure quota is a throughput limit, not a spending cap.

## Verified locally

- Synthetic Responses API test: HTTP 200, completed, 11 input and 3 output tokens.
- DENTAL KRAFT dataset `88e52c69-0262-40a4-8f95-1e7989d0149f`, listing `0`: all 10 collected reviews analyzed out of 1,162 reported.
- Report `f8ddcba5-846e-4849-8f5d-5d1b7e14109c` saved in MySQL; 2,277 input + 1,334 output tokens.
- Result: 7 low, 1 medium investigation priority, 2 insufficient evidence; no supported policy category to flag for reporting.
- The browser shows the saved Azure assessment, individual explanations and report-kit controls.

Analysis validates every review reference and cited quote against collected input, caps batches at 30 reviews, bounds text and output, prevents simultaneous duplicate calls and caches reports by input, provider, endpoint and model. These checks do not establish review authenticity or independently verify every model explanation. Human corroboration is required. No external complaint or message was submitted.

## Still separate work

Azure web hosting, production authentication/tenant isolation, secret management via managed identity/Key Vault, cost alerts, durable scheduled collection and email/Meta WhatsApp workers are not completed by this integration. Google collection remains scraper based and partial. Facebook/Trustpilot collection and platform-specific AI analysis retain their previously documented limitations. No SMS channel is planned.


## GPT-5.4 and PayPal setup verified — 2026-09-08

User approved GPT-5.4 Global Standard deployment at 50,000 TPM. Deployed axiocred-review-analysis-gpt54 in axiocred-resource, selected it in .env, and successfully ran the real 10-review DENTAL KRAFT sample. Report 4b985f53-7c7e-49ee-ac33-93b2a4510e7e is saved in MySQL (2,423 input + 1,471 output tokens). No supported fake-engagement finding in this batch; 1,152 reported reviews remain uncollected. This supersedes the earlier pending-approval note. Initial local request failed under restricted network execution; restarted the local API with provider network access and verified success.

Created and verified live PayPal Business USD49/month and Growth USD149/month plans; IDs saved in local .env. No subscription or payment created. Webhook awaits a public HTTPS backend URL. Missing webhook now blocks checkout with HTTP503 and a disabled Settings button, verified through the local API and browser. Both TypeScript checks and all 78 tests passed (42 backend,36 frontend). See PAYPAL-SETUP.md for IDs and remaining billing lifecycle/tenant isolation blockers.
