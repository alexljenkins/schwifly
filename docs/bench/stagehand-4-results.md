# Benchmark: Stagehand 4.1 external tester agent, Playwright replay

Generated 2026-09-13T03:21:07.889Z. Every scenario ran 3 times, one at a time.

## Setup

| Field | Value |
| --- | --- |
| Engine | stagehand-4 |
| @browserbasehq/stagehand | 4.1.0 |
| @playwright/test | 1.63.0 |
| Model | google/gemini-3.8-flash |
| Price | $0.750 in / $3.750 out per million tokens |
| Host | linux x64, 6 CPUs, Node v22.22.1 |
| Started | 2026-09-13T03:10:54.339Z |

## Results

| Scenario | Met | Median | Slowest | Median model calls | Total in tokens | Total out tokens | Total cost | Actions | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| discover | 3/3 | 19.4s | 22.6s | 4 | 5022 | 1500 | $0.00939 | 3 | certified |
| replay-unchanged | 3/3 | 5.7s | 5.7s | 0 | 0 | 0 | $0.00000 | 3 | certified |
| repair-moved-control | 3/3 | 93.7s | 105.6s | 7 | 8095 | 5088 | $0.02515 | 3 | repaired:route, repaired:element |
| defect-persistence | 3/3 | 13.6s | 13.9s | 0 | 0 | 0 | $0.00000 | 3 | failed:unmet_outcome |
| defect-duplicate | 3/3 | 13.6s | 13.7s | 0 | 0 | 0 | $0.00000 | 3 | failed:unmet_outcome |
| async-update | 3/3 | 7.6s | 7.7s | 0 | 0 | 0 | $0.00000 | 3 | certified |
| infra-model-offline | 3/3 | 56.7s | 58.4s | 3 | 0 | 0 | $0.00000 | 3 | failed:provider_failure |

Total model cost for this run: $0.03454.

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
