# Azure Deployment Plan

> **Status:** Local prototype only; cloud deployment not started. See [full audit](../app/CONVERSATION-AUDIT.md).

Generated: 2026-09-06

## 1. Project Overview

**Goal:** Run the Axio-CRED customer app and a separate repository-scraper worker on Azure, with MySQL data, private evidence storage, collection progress and PayPal billing. Product decisions and field mapping: [DASHBOARD-PLAN.md](../app/DASHBOARD-PLAN.md).

**Path:** Add Components to Existing Repository

## 2. Requirements

| Attribute | Value |
|---|---|
| Classification | MVP / Development |
| Scale | Small, scale out to 3 replicas |
| Budget | Cost optimized |
| Subscription | Not selected; no cloud deployment requested in this build phase |
| Location | Inherit the target resource group's Azure region |

## 3. Components Detected

| Component | Type | Technology | Path |
|---|---|---|---|
| Customer web | Frontend | React 19, TypeScript, Vite | `app/frontend` |
| Customer API | API | Node.js 22, Express, TypeScript | `app/backend` |
| Primary data | Database | MySQL 8 | `app/backend/sql` |
| Existing collector | Worker source | Go | repository root |
| Reputation / enrichment dashboards | Frontend + JSON import API | React, Zod, MySQL JSON | `app/frontend/src/IntelligenceDashboard.tsx`, `app/backend/src/intelligence.ts` |

## 4. Recipe Selection

**Selected:** Bicep

**Rationale:** The repository already uses a Dockerfile and direct CI. A standalone Bicep template keeps Azure provisioning reviewable without adding an azd wrapper before the subscription and registry are chosen.

## 5. Architecture

| Component | Azure Service | SKU |
|---|---|---|
| Web and API container | Azure Container Apps | 0.5 vCPU, 1 GiB, 1-3 replicas |
| Relational data | Azure Database for MySQL Flexible Server | Burstable Standard_B1ms |
| Evidence objects | Azure Blob Storage | Standard LRS, private container |
| Runtime logs | Log Analytics | 30 day retention |
| Repository scraper worker | Separate Container Apps worker/job (planned, not in current Bicep) | Size after browser memory/load testing |

The existing Bicep covers web/API, database, storage and logs only. It does not provision the collector worker. Its standalone web API and SaaS API are different contracts; SaaS mode requires PostgreSQL/River. The product remains MySQL-based: plan a MySQL job coordinator and standalone worker rather than pretending River supports MySQL. Official Places collection is disabled in the customer app. Importing scraper JSON into MySQL and exploring it in both dashboards is testable now; live crawling, progress polling and webhooks remain pending.

The Container App uses a system assigned managed identity. Blob access is granted at the storage account scope with Storage Blob Data Contributor. HTTPS is required. MySQL credentials are passed through a Container Apps secret. Google and PayPal remain disabled until real credentials are injected.

## 6. Provisioning Limit Checklist

| Resource Type | Number to Deploy | Capacity Status | Notes |
|---|---:|---|---|
| Microsoft.App/managedEnvironments | 1 | Cloud check pending | Requires selected subscription and region |
| Microsoft.App/containerApps | 1 | Cloud check pending | Maximum 3 replicas in template |
| Microsoft.DBforMySQL/flexibleServers | 1 | Cloud check pending | Burstable B1ms availability is region dependent |
| Microsoft.Storage/storageAccounts | 1 | Cloud check pending | One private evidence container |
| Microsoft.OperationalInsights/workspaces | 1 | Cloud check pending | 30 day retention |

Quota validation cannot run until an Azure subscription and region are selected. This does not block local MVP testing and does block marking this plan Validated or deploying it.

## 7. Execution Checklist

- [x] Analyze workspace and requirements
- [x] Scan codebase
- [x] Select Bicep recipe
- [x] Plan architecture
- [x] User approved Azure, MySQL, PayPal, and one-repository architecture in the product planning conversation
- [x] Generate Dockerfile and infrastructure template
- [x] Add health and readiness probes
- [x] Add CI verification workflow
- [x] Verify demo backend and UI locally
- [ ] Confirm Azure subscription and region when deployment is requested
- [ ] Query quotas for each resource type
- [ ] Run Azure validation workflow
- [ ] Deploy through the Azure deployment workflow

## 8. Functional Verification

- Status: Verified locally in MySQL mode, with provider integrations using explicit preview behavior until credentials are supplied
- Backend: original preview routes were exercised previously. Places lookup and public audit collection are now disabled by product decision. New import/list routes normalize Go scraper exports into MySQL with import timestamps and digest. Collection jobs, webhooks and automatic import from the worker are not connected.
- UI: Public audit, login, pricing, overview, Google location preview import, competitor monitoring, investigations, reports, evidence vault, and PayPal preview exercised in browser
- MySQL: Server 8.0 schema migration, persistent CRUD, incident creation, plan limits, and 64-character evidence hashes verified against `axiocred_dev`
- Infrastructure: `infra/main.bicep` compiles cleanly with Bicep 0.46.1; Azure subscription, quota, and regional validation remain pending

## 9. Files

| File | Purpose | Status |
|---|---|---|
| `.azure/deployment-plan.md` | Deployment source of truth | Complete for local build phase |
| `app/infra/main.bicep` | Azure resources | Generated; cloud validation pending |
| `app/Dockerfile` | Application image | Build definition complete |
| `.github/workflows/customer-app.yml` | CI checks | Complete |

## 10. Next Cloud Step

Select the Azure subscription, resource group region, and container registry. Then run quota checks and the `azure-validate` workflow before any deployment.
