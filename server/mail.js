import { EVENT } from './lib.js';
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function sendTicketEmail(b, url) {
  if (!process.env.RESEND_API_KEY) return console.log('[mail] RESEND_API_KEY not set; skipping email for', b.reference);
  const r = await fetch('https://api.resend.com/emails', { method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: b.email, subject: `Your ticket — ${EVENT.name}`,
      html: `<p>Hi ${esc(b.name)}, you're in. Booking <b>${b.reference}</b> (${b.quantity} ticket/s).</p><p>${EVENT.date}, ${EVENT.time}<br>${EVENT.venue}</p><p><a href="${url}">Open your QR ticket</a></p>` }) });
  if (!r.ok) console.error('[mail] failed', r.status, await r.text());
}
