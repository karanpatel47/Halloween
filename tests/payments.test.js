import test from 'node:test'; import assert from 'node:assert/strict'; import crypto from 'node:crypto';
import { validateBooking, priceFor, checkoutSignatureValid, webhookSignatureValid, nextStatus, PRICE_PAISE } from '../server/lib.js';
const good = { name: 'Asha Patel', email: 'a@b.co', phone: '9876543210', quantity: 2 };
const sign = (d, k) => crypto.createHmac('sha256', k).update(d).digest('hex');

test('server-side pricing in paise', () => { assert.equal(PRICE_PAISE, 19900); assert.equal(priceFor(1), 19900); assert.equal(priceFor(3), 59700); });
test('order validation accepts good input, rejects bad', () => {
  assert.ok(validateBooking(good).ok);
  for (const bad of [{ ...good, quantity: 0 }, { ...good, quantity: 11 }, { ...good, quantity: 1.5 }, { ...good, email: 'x' }, { ...good, phone: '123' }, { ...good, name: '' }])
    assert.equal(validateBooking(bad).ok, false);
});
test('checkout signature: valid passes, tampered fails', () => {
  const s = sign('order_1|pay_1', 'sec');
  assert.ok(checkoutSignatureValid('order_1', 'pay_1', s, 'sec'));
  assert.equal(checkoutSignatureValid('order_1', 'pay_2', s, 'sec'), false);
  assert.equal(checkoutSignatureValid('order_1', 'pay_1', 'deadbeef', 'sec'), false);
  assert.equal(checkoutSignatureValid('order_1', 'pay_1', undefined, 'sec'), false);
});
test('webhook signature uses the raw body', () => {
  const raw = '{"event":"payment.captured"}', s = sign(raw, 'whsec');
  assert.ok(webhookSignatureValid(raw, s, 'whsec'));
  assert.equal(webhookSignatureValid(raw + ' ', s, 'whsec'), false);
});
test('ticket is issued once: duplicate webhooks are harmless', () => {
  let status = 'pending', issued = 0;
  for (let i = 0; i < 3; i++) { const n = nextStatus(status, 'paid'); if (status !== 'paid' && n === 'paid') issued++; status = n; }
  assert.equal(issued, 1); assert.equal(status, 'paid');
});
test('late failure never overwrites a success; failure then success recovers', () => {
  assert.equal(nextStatus('paid', 'failed'), 'paid');
  assert.equal(nextStatus('failed', 'paid'), 'paid');
  assert.equal(nextStatus('pending', 'failed'), 'failed');
});
