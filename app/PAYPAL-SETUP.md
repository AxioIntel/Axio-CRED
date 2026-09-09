# PayPal setup — 2026-09-08

Saved credentials authenticated successfully against **live** PayPal. Sandbox returned `401 invalid_client`. Local `.env` now uses `PAYPAL_ENV=live`; these are not sandbox test credentials.

Created and independently read back these active catalog plans:

| Environment | Plan | Price | Plan ID |
| --- | --- | --- | --- |
| Live | Business | USD 49/month | `P-4FC62835BA290934TNKPQIBA` |
| Live | Growth | USD 149/month | `P-2H78529473910920BNKPQIBA` |

Each has one indefinitely recurring monthly cycle, no trial or setup fee, no added tax, no automatic billing of outstanding balances, and suspension after one failed billing cycle. Business includes one monitored business checked twice a day; Growth includes five checked four times a day. Scheduled collection remains pending implementation. No customer subscription or payment was created.

The product and both plan IDs were saved in ignored `.env`. Merchant ID `XE8VPKMHZUYSA` is saved as the user-provided account reference; it has not been independently matched to the authenticated merchant. It is not a client ID, plan ID or webhook ID.

## Remaining webhook setup

There are no registered webhooks on this REST app. `PAYPAL_WEBHOOK_ID` remains a placeholder. Checkout now returns HTTP 503 and the Settings button is disabled until all required settings are present. Configuration presence is not proof of successful payment processing.

1. Deploy the backend with production authentication and tenant isolation before exposing it publicly. Do not tunnel the entire local development API.
2. In [PayPal Apps & Credentials](https://developer.paypal.com/dashboard/applications/live), select **Live**, then the REST app matching the saved client ID. An app named “NVP SOAP Webhooks” or its credentials section is not itself a webhook registration.
3. Under **Webhooks**, register `https://YOUR_PUBLIC_BACKEND/api/webhooks/paypal`. This must be the backend host, not the frontend or Azure OpenAI endpoint.
4. Subscribe to subscription activation/update/cancellation/suspension/expiration/payment-failure and payment sale completed/refunded/reversed events. Finish lifecycle reconciliation before launch: the present handler verifies signatures and deduplicates events, but payment events without a plan ID do not yet reconcile subscription access.
5. Save PayPal's returned webhook ID in `PAYPAL_WEBHOOK_ID`; restart the backend. IDs and credentials must belong to the same environment and app.
6. Test signature verification, replay deduplication, activation, cancellation, failure and refund handling with a separate sandbox REST app and sandbox buyer. Never treat a successful return URL as proof of payment.

Existing subscriptions use a single test workspace ID. Per-user billing ownership and entitlement reconciliation remain launch blockers. Neither the plan setup nor adding a webhook makes the MVP production ready.

## Reusable catalog setup

`node scripts/setup-paypal.mjs --live` authenticates using local credentials, reuses matching product/plans, verifies monthly prices, and saves IDs without printing secrets. Without `--live` it targets sandbox; supply matching sandbox credentials first. It never creates customer subscriptions. Do not run against the wrong merchant app.

References: [PayPal subscription integration](https://developer.paypal.com/subscriptions/integrate), [webhook integration](https://developer.paypal.com/api/rest/webhooks/rest/).
