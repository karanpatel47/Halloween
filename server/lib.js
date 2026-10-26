import crypto from 'node:crypto';
export const PRICE_PAISE = 29900, MAX_TICKETS = 10;
export const EVENT = { name: 'Hallo Haseeno', subtitle: 'A Halloween Party with Abhii', tagline: 'Vadodara’s First Bolly Tech Halloween Party', date: 'Friday, 30 October 2026', time: '7:00 PM onwards', venue: 'The Grove Club & Cafe, Sevasi, Vadodara', dress: 'Spooky and Gothic' };

export function validateBooking(b = {}) {
  const errors = {};
  const name = String(b.name ?? '').trim(), email = String(b.email ?? '').trim();
  const phone = String(b.phone ?? '').replace(/\D/g, '').slice(-10);
  const quantity = Number(b.quantity);
  if (name.length < 2 || name.length > 80) errors.name = 'Enter your full name.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) errors.email = 'Enter a valid email.';
  if (!/^[6-9]\d{9}$/.test(phone)) errors.phone = 'Enter a valid 10-digit mobile number.';
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS) errors.quantity = `Choose 1–${MAX_TICKETS} tickets.`;
  return { ok: !Object.keys(errors).length, errors, value: { name, email, phone, quantity } };
}
// Price is ALWAYS computed here, never taken from the client.
export const priceFor = (q) => PRICE_PAISE * q;

const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const hmac = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('hex');
export const checkoutSignatureValid = (orderId, paymentId, sig, secret) => !!sig && safeEq(hmac(`${orderId}|${paymentId}`, secret), sig);
export const webhookSignatureValid = (rawBody, sig, secret) => !!sig && safeEq(hmac(rawBody, secret), sig);

// 'paid' is terminal: a late/duplicate failure event can never overwrite a success.
export function nextStatus(current, event) {
  if (current === 'paid') return 'paid';
  if (event === 'paid') return 'paid';
  if (event === 'failed') return 'failed';
  return current;
}
export const newReference = () => 'WS-' + crypto.randomBytes(5).toString('hex').toUpperCase();
