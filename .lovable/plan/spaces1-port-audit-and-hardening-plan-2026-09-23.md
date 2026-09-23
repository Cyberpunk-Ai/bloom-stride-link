# Spaces1 — port, audit and hardening plan

I cloned and read the repo (`happy-social-hub-36`, ~31k lines of app code: feed, stories, spaces, messages, calls, payments, admin, workspaces, developer API). Below is what I found and what I will do, in order.

## What the audit found

Verified by reading the code in the cloned repo:

- **Secrets in the repo.** A `.env` file with live project URL and publishable keys is committed and is not listed in `.gitignore`. Payment keys are read from the server environment (good) but there is no documented env template.
- **Landing page numbers and labels** are hardcoded and don't match what you want; the section is titled "Stories & Reels".
- **Stories preview  cannot be hidden** — it always renders and eats space on small screens it should be toggled. The feed tabs ("For you / Following / Latest") are static, not scroll-aware.
- **Payments are half-finished.** Plan prices are hardcoded in code in KES with a hardcoded USD rate; tips are clamped to **$1 minimum**; the webhook settles charges and transfers but does not handle refunds/chargebacks, subscription renewal/expiry, or per-transaction platform fee records; there is no idempotency table, so a replayed webhook can double-insert a tip; no currency/minor-unit helper; `confirmPaystackPayment` trusts `metadata.plan` from the transaction.
- **Withdrawals/payouts** exist but lack balance ledger integrity (available vs pending vs paid), minimum thresholds, KYC/recipient verification state, and reversal handling.
- **Vendor lock-in.** Supabase, Lovable Cloud auth, Lovable AI gateway, Paystack and Supabase Storage are imported directly all over the app (`ai.functions.ts` hardcodes the gateway URL and model). There is no provider abstraction.
- **Impressions/real-time are not production-grade.** Real-time is one shared broadcast channel used as a client-side event bus; impressions go through an RPC but with no batching, no dedupe window, no server-side rate limit, and view counts can be inflated by a client loop.
- **Recommendations** pull 300 recent rows into memory per request and score them in JS — no pagination cursor, no caching, no seen-post exclusion across sessions, no cold-start handling, no negative signals (mute/not-interested).
- **Workspaces are incomplete.** Invites are rows with `status: 'invited'` but there is no accept/decline flow, no notification, no role-based permission enforcement, no seat limit enforcement, and no way to open a workspace account profile after access is granted.
- **Developer API is unsafe.** API keys are generated client-side and stored with `key_hash: token.slice(-12)` — that is the plaintext tail, not a hash. There is no server-side key verification endpoint, no scopes, no rate limits, no webhook signing.
- **Messages/spaces/calls.** Messages are stored in plaintext with no encryption; no typing/read-receipt/delivery guarantees at scale; attachments unvalidated. Calls have a WebRTC peer connection and screen-share capture, but signalling rides the shared broadcast bus and the accept/decline screen is incomplete (no ringing timeout, no missed-call record, no reconnection, screen track not renegotiated to the peer).
- **Media proxy** serves any object in five folders publicly via the service-role key — private/DM attachments are readable by anyone who guesses a path.
- **Admin** has 8 tabs but several actions are read-only or local-only; no bulk actions, no suspension/appeal lifecycle, no revenue reporting, no feature-flag control from the UI.

## Plan of work

**Phase 1 — Port and baseline.** Bring the app into this project, remove the committed `.env`, add `.env.example`, get it building and running, and fix any build/type errors from the port.

**Phase 2 — Provider abstraction (foundation for everything else).** A single `src/providers/` layer with interfaces for database, auth, storage, AI, payments, real-time, email and search. Each has one or more adapters (Supabase/Postgres, Lovable Cloud auth, S3/Cloudflare R2, OpenAI-compatible/Lovable AI, Paystack/Stripe, Supabase Realtime) chosen at runtime by env vars, with no code change needed to swap. All existing call sites migrate to the abstraction, and all branding, URLs, models, limits and fees move into config/env.

**Phase 3 — Security and encryption.** Key hashing (SHA-256) and scoped, rate-limited API keys with a server-side verifier; signed, expiring media URLs with per-object ownership checks for DM attachments; encryption at rest for message bodies and sensitive settings using an env-held key, with a documented key-rotation path; input validation on every server function; webhook idempotency table; tightened RLS/grants for payments, payouts, workspaces and impressions; audit logging on every privileged action.

**Phase 4 — Payments, tips, payouts, monetization.** Prices and currency in env, minor-unit-safe money helper, **sub-dollar tips** (configurable minimum, e.g. $0.20), platform fee ledger, refunds/chargebacks/renewal/expiry webhook handling, an integrity-checked balance ledger (available/pending/paid/reversed), withdrawal thresholds, recipient verification and reversal handling, and receipts.

**Phase 5 — Impressions and real-time.** Persistent, batched, deduped impression writes with server-side rate limiting and unique constraints; Postgres-changes subscriptions for durable data (messages, notifications, calls) with the broadcast bus reserved for ephemeral signals; reconnect/backfill on wake.

**Phase 6 — Recommendations.** Move scoring into SQL with materialised affinity, cursor pagination, seen-post exclusion, negative signals (mute, not-interested, blocked), cold-start path for new users, per-author diversity, and a tunable weight config in env.

**Phase 7 — Workspaces, developer API and admin.** Full invite lifecycle (invite → notification → accept/decline → seat consumed) with role-based permissions, workspace profile access for granted members, seat limits; complete developer portal (scopes, usage, signed webhooks, revoke/rotate); admin completion — bulk moderation, suspension/appeal lifecycle, revenue and payout reporting, feature flags, and system settings that actually take effect.

**Phase 8 — Messages, spaces, calls.** Production messaging (pagination, delivery/read state, attachments with validation, search, block/mute), spaces roles and moderation, and a complete call experience: ringing with timeout, accept/decline screen, missed-call records, reconnection, device switching, and working screen share to the peer.

**Phase 9 — UX, responsiveness and the noted fixes.**

- Stories preview toggle on the story creation page, remembered per user, collapsed by default on small screens.
- Landing page stats → 10k paid, 2.5k users, 7.5k posts shared daily, 4k creators; "Stories & Reels" → "Posts & Stories".
- Home feed: smooth scrolling, and the "For you / Following / Latest" bar hides on scroll down and reappears on scroll up.
- Mobile pass across feed, messages, spaces, admin and profile; safe-area insets, tap targets, reduced-motion support, focus states, skeletons and empty states.

**Phase 10 — Verification.** Build clean, then drive the real app in a browser: sign in, post, tip (sub-dollar), message, call accept/decline, workspace invite accept, admin action, and confirm each result reads back through the UI.

## Technical notes

- Stack stays TanStack Start v1 + React 19 + Tailwind v4. Backend logic in `createServerFn`; webhooks under `src/routes/api/public/*`.
- Provider selection via env (e.g. `STORAGE_PROVIDER=r2`, `PAYMENTS_PROVIDER=paystack`, `AI_PROVIDER=openai`), with adapters resolved server-side only.
- Schema changes land as new numbered migrations with explicit `GRANT`s and RLS policies; no destructive edits to existing migrations.
- Third-party credentials (Paystack secret, R2 keys, AI keys, message encryption key) are requested through the secure secrets form — never written into code or `.env` in the repo.

## Assumptions I'm making

- Message encryption is **at rest with a server-held key** (searchable, recoverable), not end-to-end — E2E would break search, moderation and multi-device history.
- Paystack stays the default payment provider, with Stripe as a second adapter behind the abstraction.
- Phases land all shiped we shall review after everything is done all phases