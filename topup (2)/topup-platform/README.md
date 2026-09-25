# TopUpStore — Custom Game Top-Up Platform

Custom-built (no WordPress/WooCommerce/open-source storefront scripts).
Next.js 14 (App Router) frontend + NestJS backend + PostgreSQL + Redis/BullMQ.

## Architecture

```
frontend/   Next.js — storefront, checkout, admin UI
backend/    NestJS — API, auth, payments, delivery worker
  prisma/schema.prisma   Full DB schema
  src/auth/              Staff login (password + TOTP MFA), Google/Telegram customer login
  src/games/              Game listing, ON/OFF toggle, nickname validation adapters
  src/orders/              Guest checkout, order lifecycle
  src/payments/            ABA KHQR + PayWay integration, signed webhook handling
  src/queue/               BullMQ delivery producer + standalone worker process
  src/common/              RBAC guard, rate limiter, HMAC/encryption, XSS sanitizer
```

## Request flow (top-up)

1. Customer opens a game page → enters Player ID → `POST /games/:slug/validate-player-id`
   calls the publisher's nickname API (`NicknameValidationService`) and returns the
   in-game display name. Rate-limited per IP.
2. Customer picks a package → `POST /orders` — the backend **re-verifies** the
   nickname server-side (never trusts the client's copy) and creates a
   `PENDING_PAYMENT` order with a 15-minute expiry.
3. `POST /payments/aba-khqr/:orderId` (or `/payments/payway/:orderId`) creates
   the payment intent and returns a KHQR image/string or hosted checkout URL.
4. The bank/PayWay confirms payment asynchronously via a **signed webhook**.
   `PaymentsWebhookController`:
   - Verifies `HMAC-SHA256` over the **raw** request body (constant-time compare).
   - Logs every call (valid or not) to `WebhookLog` before any business logic.
   - Writes a DB-unique `idempotencyKey` — a replayed/duplicate webhook hits a
     unique-constraint violation and is a guaranteed no-op, so an order can
     never be credited twice.
   - Flips the order to `PAID` inside the same transaction as the idempotency
     write, then enqueues fulfillment.
5. `DeliveryQueueService` pushes an `orderId` onto a BullMQ Redis queue
   (`jobId = orderId`, so it's also de-duplicated at the queue layer).
6. `delivery.processor.ts` — a **separate worker process** — consumes the
   queue, calls the fulfillment provider, retries with exponential backoff
   (5 attempts), and logs every attempt to `DeliveryAttempt`. Permanent
   failure after all retries flags the order `FAILED` for manual admin review
   rather than leaving the customer stuck silently.

## Admin (`/admin`)

- RBAC via `@Roles(Role.ADMIN, Role.SUPER_ADMIN)` + `RolesGuard`.
- Staff login requires **password + mandatory TOTP MFA** (authenticator app —
  no 6-digit email/SMS OTP anywhere in the system). First login forces MFA
  enrollment before any session token is issued.
- **Game ON/OFF toggle**: `PATCH /games/admin/:id/toggle` — flips `Game.isActive`.
  The public `GET /games/:slug` treats an inactive game as `404 Not Found`,
  so it's not just hidden from the grid, it's fully unpurchasable.
- Every toggle, refund, and MFA change is written to `AuditLog` with the
  acting admin, IP, and timestamp.

## Security checklist implemented

- Parameterized queries only (Prisma) — no raw SQL string concatenation anywhere.
- Global `SanitizePipe` strips HTML/script from every string input (defense
  in depth against stored XSS in admin views/receipts).
- `RateLimitGuard` (Redis sliding window) on nickname lookup and order creation.
- `helmet()` + strict CORS allow-list + `express.json({ limit: '1mb' })`.
- Webhook signatures verified against the **raw** body via `express.raw()`,
  mounted only on the two webhook routes, before the JSON parser.
- MFA secrets and provider API keys encrypted at rest with AES-256-GCM
  (`CryptoService`), never stored in plaintext.
- Idempotency at three layers: DB unique constraint → BullMQ `jobId` →
  business-level check in the worker (`already delivered` short-circuit).
- Cloudflare-ready: `trust proxy` + `cf-connecting-ip` header read by the
  rate limiter for correct client IPs behind a CDN/WAF.

## Local development

```bash
cp backend/.env.example backend/.env   # fill in real secrets
docker compose up --build
# frontend → http://localhost:3000
# api      → http://localhost:4000/api/v1
```

## Deployment

- **Frontend**: deploy `frontend/` to Vercel directly (App Router, zero config).
- **Backend API**: deploy `backend/` to any Node host (Render/Fly.io/VPS) —
  Vercel serverless is not suitable for the BullMQ worker (needs a long-lived
  process), so run `api` and `worker` as two separate services from the same
  image (`npm run start` vs `npm run worker`).
- **Database/Redis**: managed Postgres (Neon/RDS) + managed Redis (Upstash) or
  self-hosted on the VPS behind a private network with Postgres and Redis not
  publicly exposed.
- Put Cloudflare (proxy + WAF + rate limiting) in front of the API for
  DDoS mitigation; the app already trusts `cf-connecting-ip`.

## What you still need to fill in before going live

- Real ABA KHQR / PayWay merchant credentials + their production webhook
  signing secrets (sandbox URLs are in `.env.example`).
- Real publisher nickname-lookup and fulfillment API credentials per game
  (Mobile Legends/Free Fire/PUBG Mobile third-party resellers or official
  publisher B2B APIs) — the adapters in `nickname-validation.service.ts` and
  `delivery.processor.ts` are wired for exactly this shape of API.
- Google OAuth client ID and a registered Telegram bot for the login widget.
- Replace the placeholder game icons — the reference screenshots' artwork is
  the publishers' own IP, so source licensed/official icons per your reseller
  agreement rather than scraping SabayStore's assets directly.
