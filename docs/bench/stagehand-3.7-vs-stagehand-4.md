# Stagehand 3.7 DOM agent, Playwright replay versus Stagehand 4.1 external tester agent, Playwright replay

Baseline stagehand-3.7 finished 2026-09-08T04:15:24.153Z. Candidate stagehand-4 finished 2026-09-13T03:21:07.889Z.

## discover

Discover the add-task flow and save a route

| Engine | Run | Time | Model calls | Cost | Actions | Pass | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| v3.7 | 1 | 49.8s | 13 | $0.04150 | 3 | yes | certified |
| v3.7 | 2 | 49.0s | 13 | $0.04127 | 3 | yes | certified |
| v3.7 | 3 | 38.7s | 12 | $0.02340 | 3 | yes | certified |
| v3.7 | median | 49.0s | 13 | $0.04127 | 3 | 3/3 | certified |
| v4.1 | 1 | 18.6s | 4 | $0.00318 | 3 | yes | certified |
| v4.1 | 2 | 22.6s | 4 | $0.00298 | 3 | yes | certified |
| v4.1 | 3 | 19.4s | 4 | $0.00323 | 3 | yes | certified |
| v4.1 | median | 19.4s | 4 | $0.00318 | 3 | 3/3 | certified |

## replay-unchanged

Replay the saved route against the unchanged app

| Engine | Run | Time | Model calls | Cost | Actions | Pass | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| v3.7 | 1 | 5.6s | 0 | $0.00000 | 3 | yes | certified |
| v3.7 | 2 | 5.7s | 0 | $0.00000 | 3 | yes | certified |
| v3.7 | 3 | 5.8s | 0 | $0.00000 | 3 | yes | certified |
| v3.7 | median | 5.7s | 0 | $0.00000 | 3 | 3/3 | certified |
| v4.1 | 1 | 5.7s | 0 | $0.00000 | 3 | yes | certified |
| v4.1 | 2 | 5.5s | 0 | $0.00000 | 3 | yes | certified |
| v4.1 | 3 | 5.7s | 0 | $0.00000 | 3 | yes | certified |
| v4.1 | median | 5.7s | 0 | $0.00000 | 3 | 3/3 | certified |

## repair-moved-control

Repair a renamed control without changing behaviour

| Engine | Run | Time | Model calls | Cost | Actions | Pass | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| v3.7 | 1 | 123.5s | 16 | $0.05007 | 3 | yes | repaired:route |
| v3.7 | 2 | 118.3s | 16 | $0.04383 | 3 | yes | repaired:route |
| v3.7 | 3 | 51.6s | 1 | $0.00385 | 3 | yes | repaired:element |
| v3.7 | median | 118.3s | 16 | $0.04383 | 3 | 3/3 | repaired:route, repaired:element |
| v4.1 | 1 | 93.7s | 7 | $0.00852 | 3 | yes | repaired:route |
| v4.1 | 2 | 105.6s | 7 | $0.00983 | 3 | yes | repaired:route |
| v4.1 | 3 | 59.6s | 1 | $0.00680 | 3 | yes | repaired:element |
| v4.1 | median | 93.7s | 7 | $0.00852 | 3 | 3/3 | repaired:route, repaired:element |

## defect-persistence

Detect a save that reports success but stores nothing

| Engine | Run | Time | Model calls | Cost | Actions | Pass | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| v3.7 | 1 | 13.6s | 0 | $0.00000 | 3 | yes | failed:unmet_outcome |
| v3.7 | 2 | 13.8s | 0 | $0.00000 | 3 | yes | failed:unmet_outcome |
| v3.7 | 3 | 13.6s | 0 | $0.00000 | 3 | yes | failed:unmet_outcome |
| v3.7 | median | 13.6s | 0 | $0.00000 | 3 | 3/3 | failed:unmet_outcome |
| v4.1 | 1 | 13.6s | 0 | $0.00000 | 3 | yes | failed:unmet_outcome |
| v4.1 | 2 | 13.6s | 0 | $0.00000 | 3 | yes | failed:unmet_outcome |
| v4.1 | 3 | 13.9s | 0 | $0.00000 | 3 | yes | failed:unmet_outcome |
| v4.1 | median | 13.6s | 0 | $0.00000 | 3 | 3/3 | failed:unmet_outcome |

## defect-duplicate

Detect a save that stores the task twice

| Engine | Run | Time | Model calls | Cost | Actions | Pass | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| v3.7 | 1 | 13.7s | 0 | $0.00000 | 3 | yes | failed:unmet_outcome |
| v3.7 | 2 | 13.7s | 0 | $0.00000 | 3 | yes | failed:unmet_outcome |
| v3.7 | 3 | 13.7s | 0 | $0.00000 | 3 | yes | failed:unmet_outcome |
| v3.7 | median | 13.7s | 0 | $0.00000 | 3 | 3/3 | failed:unmet_outcome |
| v4.1 | 1 | 13.6s | 0 | $0.00000 | 3 | yes | failed:unmet_outcome |
| v4.1 | 2 | 13.6s | 0 | $0.00000 | 3 | yes | failed:unmet_outcome |
| v4.1 | 3 | 13.7s | 0 | $0.00000 | 3 | yes | failed:unmet_outcome |
| v4.1 | median | 13.6s | 0 | $0.00000 | 3 | 3/3 | failed:unmet_outcome |

## async-update

Wait correctly for a list that renders late

| Engine | Run | Time | Model calls | Cost | Actions | Pass | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| v3.7 | 1 | 7.6s | 0 | $0.00000 | 3 | yes | certified |
| v3.7 | 2 | 7.8s | 0 | $0.00000 | 3 | yes | certified |
| v3.7 | 3 | 7.7s | 0 | $0.00000 | 3 | yes | certified |
| v3.7 | median | 7.7s | 0 | $0.00000 | 3 | 3/3 | certified |
| v4.1 | 1 | 7.6s | 0 | $0.00000 | 3 | yes | certified |
| v4.1 | 2 | 7.6s | 0 | $0.00000 | 3 | yes | certified |
| v4.1 | 3 | 7.7s | 0 | $0.00000 | 3 | yes | certified |
| v4.1 | median | 7.6s | 0 | $0.00000 | 3 | 3/3 | certified |

## infra-model-offline

Report lost model access as infrastructure, not an app defect

| Engine | Run | Time | Model calls | Cost | Actions | Pass | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| v3.7 | 1 | 57.5s | 3 | $0.00000 | 3 | yes | failed:provider_failure |
| v3.7 | 2 | 56.9s | 3 | $0.00000 | 3 | yes | failed:provider_failure |
| v3.7 | 3 | 56.6s | 3 | $0.00000 | 3 | yes | failed:provider_failure |
| v3.7 | median | 56.9s | 3 | $0.00000 | 3 | 3/3 | failed:provider_failure |
| v4.1 | 1 | 56.6s | 3 | $0.00000 | 3 | yes | failed:provider_failure |
| v4.1 | 2 | 56.7s | 3 | $0.00000 | 3 | yes | failed:provider_failure |
| v4.1 | 3 | 58.4s | 3 | $0.00000 | 3 | yes | failed:provider_failure |
| v4.1 | median | 56.7s | 3 | $0.00000 | 3 | 3/3 | failed:provider_failure |

## Median summary

| Scenario | v3.7 time | v4.1 time | v3.7 model calls | v4.1 model calls | v3.7 cost | v4.1 cost | v3.7 pass | v4.1 pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| discover | 49.0s | 19.4s | 13 | 4 | $0.04127 | $0.00318 | 3/3 | 3/3 |
| replay-unchanged | 5.7s | 5.7s | 0 | 0 | $0.00000 | $0.00000 | 3/3 | 3/3 |
| repair-moved-control | 118.3s | 93.7s | 16 | 7 | $0.04383 | $0.00852 | 3/3 | 3/3 |
| defect-persistence | 13.6s | 13.6s | 0 | 0 | $0.00000 | $0.00000 | 3/3 | 3/3 |
| defect-duplicate | 13.7s | 13.6s | 0 | 0 | $0.00000 | $0.00000 | 3/3 | 3/3 |
| async-update | 7.7s | 7.6s | 0 | 0 | $0.00000 | $0.00000 | 3/3 | 3/3 |
| infra-model-offline | 56.9s | 56.7s | 3 | 3 | $0.00000 | $0.00000 | 3/3 | 3/3 |
