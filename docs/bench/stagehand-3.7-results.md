# Benchmark: Stagehand 3.7 DOM agent, Playwright replay

Generated 2026-09-08T04:15:24.153Z. Every scenario ran 3 times, one at a time.

## Setup

| Field | Value |
| --- | --- |
| Engine | stagehand-3.7 |
| @browserbasehq/stagehand | 3.7.3 |
| @playwright/test | 1.63.0 |
| Model | google/gemini-3.8-flash |
| Price | $0.750 in / $3.750 out per million tokens |
| Host | linux x64, 6 CPUs, Node v22.22.1 |
| Started | 2026-09-08T04:03:19.363Z |

## Results

| Scenario | Met | Median | Slowest | Model calls | In tokens | Out tokens | Cost | Actions | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| discover | 3/3 | 49.0s | 49.8s | 13 | 119910 | 4330 | $0.10617 | 3 | certified |
| replay-unchanged | 3/3 | 5.7s | 5.8s | 0 | 0 | 0 | $0.00000 | 3 | certified |
| repair-moved-control | 3/3 | 118.3s | 123.5s | 16 | 100225 | 6023 | $0.09775 | 3 | repaired:route, repaired:element |
| defect-persistence | 3/3 | 13.6s | 13.8s | 0 | 0 | 0 | $0.00000 | 3 | failed:unmet_outcome |
| defect-duplicate | 3/3 | 13.7s | 13.7s | 0 | 0 | 0 | $0.00000 | 3 | failed:unmet_outcome |
| async-update | 3/3 | 7.7s | 7.8s | 0 | 0 | 0 | $0.00000 | 3 | certified |
| infra-model-offline | 3/3 | 56.9s | 57.5s | 3 | 0 | 0 | $0.00000 | 3 | failed:provider_failure |

Total model cost for this run: $0.20392.

## Required evidence

| Scenario | Required evidence | Verdict |
| --- | --- | --- |
| discover | Discover a product flow and save it. | met |
| replay-unchanged | A fresh replay passes with 0 model calls. | met |
| repair-moved-control | A bounded repair passes unchanged proofs and records its diff. | met |
| defect-persistence | Each seeded defect fails and remains failed after attempted route repair. | met |
| defect-duplicate | Each seeded defect fails and remains failed after attempted route repair. | met |
| async-update | Correct waiting prevents both premature failure and premature success. | met |
| infra-model-offline | The report identifies infrastructure failure without claiming an application defect. | met |

## Intermittent results

- repair-moved-control disagreed across runs: repaired:route, repaired:element
