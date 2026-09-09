# Collection and free-audit cost model

Status: not yet measured end to end. No cloud or proxy prices have been assumed. The earlier $0.20 audit figure is not substantiated, and the public free-audit endpoint is currently disabled.

For one successful uncached audit:

```
variable cost = worker CPU-seconds × CPU rate
              + memory GiB-seconds × memory rate
              + proxy GB × proxy rate
              + network egress GB × egress rate
              + model input/output token charges (if analysis is requested)
              + database + evidence storage + log operation charges
              + failed-attempt and retry costs allocated per success

blended cost per free audit = (1 - cache-hit fraction) × uncached cost
                          + cache-hit fraction × cached-read cost
                          + allocated monthly idle/fixed infrastructure cost / completed audits
```

Local elapsed times already observed range from tens of seconds for exact listings to over a minute for broad discovery. Elapsed time on the development PC is not Azure billed CPU-seconds. A small free audit should use one exact listing, a bounded review sample, short retention and no background monitoring; deeper review collection and AI require separately metered budgets. The intended paid/free entitlements still need implementation.

Measure: attempts/successes, elapsed and worker resources, result coverage, fetched bytes, proxy bandwidth, retry/backoff, cache-hit rate, database/storage/log use, model tokens and daily paid-versus-free demand. Set these against the selected Azure region/SKU and any actual provider contract before offering a numerical spending estimate.

Optimizations already present: reuse saved exact Place IDs, one bounded local collector, deduplicate imported review IDs, reuse analysis for unchanged model/input version, and collect only on request. Missing: durable job deduplication across replicas, schedules, change-priority refresh, budgets, rate enforcement, cost dashboards and paid/free queue isolation. No residential/mobile proxy pool is configured.
