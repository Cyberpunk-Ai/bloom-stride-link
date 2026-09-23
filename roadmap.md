# Port + hardening roadmap

Plan: `.lovable/plan/spaces1-port-audit-and-hardening-plan-2026-09-23.md`

- [x] Phase 1 — Port repo, enable Cloud, apply full schema + access rules + media bucket, remove committed secrets (`.env` git-ignored, `.env.example` added), build green, landing page renders
- [ ] Phase 2 — Backend provider abstraction (`src/providers/`: db, auth, storage, AI, payments, realtime, email, search) chosen by env
- [ ] Phase 3 — Security + encryption (API key hashing/scopes/rate limits, signed media URLs, message encryption at rest, input validation, webhook idempotency, audit logs)
- [ ] Phase 4 — Payments: env-driven pricing/currency, minor-unit money helper, sub-dollar tips, platform fee ledger, refunds/chargebacks/renewals, withdrawal thresholds, receipts
- [ ] Phase 5 — Impressions + realtime durability (batched, deduped, rate-limited)
- [ ] Phase 6 — Recommendation engine in SQL with affinity, cursor pagination, seen exclusion, cold start
- [ ] Phase 7 — Workspaces (invite lifecycle + notifications + seats + workspace profile access), developer API, admin completeness
- [ ] Phase 8 — Messages, spaces, calls/screen share, accept & decline screen
- [ ] Phase 9 — UX polish: stories toggle, landing stats, "Posts & Stories", hide-on-scroll feed tabs, mobile pass
- [ ] Phase 10 — End-to-end browser verification of every flow
