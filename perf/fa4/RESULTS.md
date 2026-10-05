# FA4 load results (local, observed — not an SLA)

Machine: one 10-core / 16 GB laptop running the Node server (1 process, `pg` pool max 10), PostgreSQL 16 and the load driver together; API connected as the least-privilege runtime role; email captured in memory.
Flows = create → autosave ×3 → resolution ×2 → result ×2 → read → save-for-later → mail → single-use resume link → replay refused (≈14 requests/flow, 150 ms think time).

| Users | req/s | success | p50 / p95 / p99 (ms) | autosave p50/p95/p99 | result p50/p95/p99 | peak DB conns | RSS peak (MB) | integrity |
|---|---|---|---|---|---|---|---|---|
| 25 | 942 | 100 % | 1.7 / 6 / 8 | 1.3 / 2.8 / 3.7 | 4.8 / 7.8 / 9.6 | 14 | 371 | 0 violations |
| 100 | 2,053 | 100 % | 19 / 41 / 79 | 21 / 32 / 44 | 29 / 41 / 53 | 15 | 397 | 0 |
| 250 | 2,121 | 100 % | 86 / 130 / 281 | 94 / 113 / 120 | 102 / 123 / 130 | 15 | 422 | 0 |
| 500 | 1,978 | 100 % | 221 / 317 / 664 | 235 / 265 / 281 | 244 / 276 / 291 | 15 | 441 | 0 |
| 1,000 | 1,884 | 100 % | 499 / 716 / 1,494 | 536 / 587 / 608 | 548 / 598 / 616 | 15 | 444 | 0 |
| soak 150 × 30 min | 2,002 | 100 % | 49 / 86 / 179 | 52 / 68 / 88 | 60 / 77 / 96 | 16 | 426 (end 374) | 0 (261,766 projects, 523,532 results) |

Burst (simultaneous `POST /session/result`, distinct projects, fresh sockets): 50 → 1,000 → 2,000 all 100 % ok, ≈790 results/s, p99 2.5 s at 2,000, 0 lost / 0 cross-project / 0 wrong catalog version / 0 deadlocks; 10 simultaneous deliveries for one project → 10 distinct `result_seq`, one stable set of Demand Signals.

Throughput saturates at ≈2,000 req/s from ~100 users: the single Node process is at ≈100–115 % of one core (event-loop p99 lag stays ≤ 50 ms), PostgreSQL has ≤ 8 active queries and 0 deadlocks; beyond that, load queues in the pg pool (bounded at 10 connections) and latency grows linearly (Little's law) with no errors.
