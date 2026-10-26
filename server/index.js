import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit from 'express-rate-limit';
import Razorpay from 'razorpay';
import QRCode from 'qrcode';
import { pool, applyPaymentEvent } from './db.js';
import { EVENT, validateBooking, priceFor, checkoutSignatureValid, webhookSignatureValid, newReference } from './lib.js';
import { sendTicketEmail, esc } from './mail.js';

const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } = process.env;
const BASE = process.env.FRONTEND_URL || 'http://localhost:3000';
const rzp = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
const app = express();
app.set('trust proxy', 1);
const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

async function issue(result) {            // runs only when a booking JUST became paid
  if (result?.issued) await sendTicketEmail(result.booking, `${BASE}/ticket/${result.booking.reference}`).catch(console.error);
}

// 3) Webhook — needs the RAW body, so it is registered before express.json()
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const raw = req.body.toString('utf8');
  if (!webhookSignatureValid(raw, req.get('x-razorpay-signature'), RAZORPAY_WEBHOOK_SECRET)) return res.status(400).send('bad signature');
  try {
    const ev = JSON.parse(raw), pay = ev.payload?.payment?.entity;
    if (pay?.order_id) {
      if (ev.event === 'payment.captured' || ev.event === 'order.paid') {
        const { rows } = await pool.query('SELECT amount_paise FROM bookings WHERE razorpay_order_id=$1', [pay.order_id]);
        if (rows[0] && pay.amount === rows[0].amount_paise && pay.currency === 'INR') await issue(await applyPaymentEvent(pay.order_id, 'paid', pay.id));
      } else if (ev.event === 'payment.failed') await applyPaymentEvent(pay.order_id, 'failed');
    }
    res.json({ ok: true });                // 200 for any validly-signed event so duplicates aren't retried forever
  } catch (e) { console.error(e); res.status(500).send('error'); }
});

app.use(express.json({ limit: '10kb' }));
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
app.use(express.static(publicDir));
app.get('/', (req, res, next) => res.sendFile(path.join(publicDir, 'index.html'), (err) => err && next(err)));

// 1) Create order
app.post('/api/bookings/create-order', limiter, async (req, res) => {
  const v = validateBooking(req.body);
  if (!v.ok) return res.status(400).json({ errors: v.errors });
  const { name, email, phone, quantity } = v.value, amount = priceFor(quantity), reference = newReference();
  try {
    const { rows } = await pool.query(
      'INSERT INTO bookings(reference,name,email,phone,quantity,amount_paise) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [reference, name, email, phone, quantity, amount]);
    const order = await rzp.orders.create({ amount, currency: 'INR', receipt: reference, notes: { bookingId: rows[0].id } });
    await pool.query('UPDATE bookings SET razorpay_order_id=$1 WHERE id=$2', [order.id, rows[0].id]);
    res.json({ bookingId: rows[0].id, orderId: order.id, amount, currency: 'INR', keyId: RAZORPAY_KEY_ID, event: EVENT.name });
  } catch (e) { console.error(e); res.status(502).json({ error: 'Could not start payment. Please try again.' }); }
});

// 2) Verify (never trusts the browser callback alone)
app.post('/api/payments/verify', limiter, async (req, res) => {
  const { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: s } = req.body ?? {};
  if (!o || !p || !s || !checkoutSignatureValid(o, p, s, RAZORPAY_KEY_SECRET)) return res.status(400).json({ error: 'Invalid payment signature.' });
  try {
    const { rows } = await pool.query('SELECT * FROM bookings WHERE razorpay_order_id=$1', [o]);
    if (!rows[0]) return res.status(404).json({ error: 'Booking not found.' });
    const pay = await rzp.payments.fetch(p);       // server-to-server check
    if (pay.order_id !== o || pay.amount !== rows[0].amount_paise || pay.currency !== 'INR' || !['captured', 'authorized'].includes(pay.status))
      return res.status(400).json({ error: 'Payment does not match booking.' });
    const result = await applyPaymentEvent(o, 'paid', p);
    await issue(result);
    res.json({ status: 'paid', reference: result.booking.reference, ticketUrl: `/ticket/${result.booking.reference}` });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Verification failed. If you were charged, contact the organizer with your payment ID.' }); }
});

// 4) Safe booking status
app.get('/api/bookings/:id', limiter, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query('SELECT reference,name,quantity,amount_paise,status,created_at FROM bookings WHERE id=$1', [req.params.id]);
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'Not found' });
});

// Printable ticket with QR — only for PAID bookings
app.get('/ticket/:ref', limiter, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM bookings WHERE reference=$1 AND status='paid'", [req.params.ref]);
  const b = rows[0]; if (!b) return res.status(404).send('Ticket not found or payment not confirmed.');
  const qr = await QRCode.toDataURL(`${BASE}/ticket/${b.reference}`, { margin: 1, width: 240 });
  res.send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Ticket ${b.reference} — ${EVENT.name}</title>
<style>body{margin:0;background:#060204;color:#efe6d4;font:17px/1.6 system-ui;display:grid;place-items:center;min-height:100vh;padding:20px}
.t{max-width:400px;width:100%;border:1px solid #b3121b;padding:28px;text-align:center;box-shadow:0 0 50px rgba(179,18,27,0.45);background:#0d0507;border-radius:6px}
h1{font:700 36px/1.1 Georgia,serif;margin:0 0 4px;color:#efe6d4}em{color:#e2262f;font-style:italic;display:block;font-size:19px;margin:4px 0 6px}.tagline{color:#e5c378;font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin:6px 0 12px;font-weight:600}
img{background:#fff;padding:8px;margin:14px 0;border-radius:4px}.r{font:700 22px monospace;letter-spacing:.12em;color:#e5c378}
.ok{font-size:44px;animation:pop .6s cubic-bezier(.2,1.6,.4,1)}@keyframes pop{from{transform:scale(0)}}
.dress{color:#c9b896;font-size:14px;margin:6px 0;font-style:italic}
button{background:#b3121b;color:#fff;border:0;padding:12px 24px;font-size:15px;cursor:pointer;border-radius:3px;margin-top:10px}@media print{button{display:none}}</style>
<div class=t><div class=ok>✅</div><p>You’re in, ${esc(b.name)}.</p><h1>Hallo Haseeno</h1><em>A Halloween Party with Abhii</em>
<div class=tagline>${EVENT.tagline}</div>
<p style="margin:8px 0">${EVENT.date} · ${EVENT.time}<br>${EVENT.venue}</p>
<div class=dress>Dress code: ${EVENT.dress}</div>
<img src="${qr}" alt="Ticket QR code" width=200 height=200>
<div class=r>${b.reference}</div><p>${b.quantity} ticket${b.quantity > 1 ? 's' : ''} · The Weekend Society</p><button onclick="print()">Download / print ticket</button></div>`);
});

export default app;

if (process.env.NODE_ENV !== 'production') {
  app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log(`Server running on port ${process.env.PORT || 3000}`);
  });
}