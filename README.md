# Hallo Haseeno: A Halloween Party with Abhii — Ticketing (The Weekend Society)

Dark-themed landing page + invitation gate, Razorpay checkout, Express API, PostgreSQL, QR tickets.
Event: Friday, 30 October 2026, 7:00 PM onwards, The Grove Club & Cafe, Sevasi, Vadodara. Entry ₹299 (price lives in `server/lib.js`).


## Run locally
1. Install Node 20+ and PostgreSQL; create a database: `createdb halloween`
2. `cp .env.example .env` and fill in your Razorpay **Test Mode** keys (Dashboard → Settings → API Keys) and `DATABASE_URL`
3. `npm install`
4. `npm run migrate`
5. `npm start` → open http://localhost:3000
6. Tests (no DB or keys needed): `npm test`

Test card/UPI details: https://razorpay.com/docs/payments/payments/test-card-details/


## Webhook (required for reliability)
Razorpay Dashboard → Webhooks → add `https://YOUR_DOMAIN/api/payments/webhook`, events `payment.captured`, `order.paid`, `payment.failed`, and set the secret as `RAZORPAY_WEBHOOK_SECRET`. For local testing, expose port 3000 with a tunnel (e.g. ngrok).


## Go live
Generate Live keys, replace `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`, create a Live webhook with its own secret, set `FRONTEND_URL` to your https domain, and set env vars on your host (never commit `.env`).
Deploy to any Node host (Render, Railway, Fly.io) with managed Postgres; run `npm run migrate` once.


## Email
Set `RESEND_API_KEY` and `EMAIL_FROM` (a verified sender domain). Without them, tickets still work on the confirmation page; email is skipped.

## How tickets stay safe
- Price is computed on the server (paise); the browser total is display-only.
- A booking becomes `paid` only after HMAC-SHA256 signature check **and** a server-side fetch of the payment (order, amount, currency, status), or via a signed webhook.
- `paid` is terminal and updates run in a row-locked transaction, so duplicate webhooks issue one ticket and a late failure can't undo a success.
- `/ticket/:reference` only renders for paid bookings. Webhook signature is checked on the raw body. Sensitive endpoints are rate-limited.

## Test checklist
- [ ] Bad name/email/phone/quantity → rejected by API (400)
- [ ] Tamper `razorpay_signature` in `/api/payments/verify` → 400, no ticket
- [ ] Close the Razorpay window → booking stays `pending`, no ticket
- [ ] Failed test payment → retry works
- [ ] Successful test payment → ticket page + QR; email if configured
- [ ] Re-send the same webhook twice → still one ticket, one email
- [ ] Open `/ticket/<ref>` of an unpaid booking → 404

## To fill in before launch
Instagram URLs, contact details, Terms, Privacy and Refund policy (placeholders in `public/index.html`). Confirm the event date: the original poster says 31 Oct (a Saturday) but also "Friday".
