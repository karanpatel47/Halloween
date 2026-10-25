
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextStatus } from './lib.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const caPath = path.join(projectRoot, 'certs', 'ca.pem');

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    ca: fs.readFileSync(caPath, 'utf8'),
    rejectUnauthorized: true,
  },
});

// Transactional + row-locked.
// issued=true only the first time a booking becomes paid.
export async function applyPaymentEvent(
  orderId,
  event,
  paymentId = null
) {
  const c = await pool.connect();

  try {
    await c.query('BEGIN');

    const { rows } = await c.query(
      'SELECT * FROM bookings WHERE razorpay_order_id=$1 FOR UPDATE',
      [orderId]
    );

    const b = rows[0];

    if (!b) {
      await c.query('ROLLBACK');
      return null;
    }

    const status = nextStatus(b.status, event);
    const issued = b.status !== 'paid' && status === 'paid';

    const { rows: out } = await c.query(
      `UPDATE bookings
       SET status = $2,
  razorpay_payment_id = COALESCE(razorpay_payment_id, $3),
  ticket_issued_at = CASE
             WHEN $4 THEN now()
             ELSE ticket_issued_at
END
       WHERE id = $1
RETURNING * `,
      [b.id, status, issued ? paymentId : null, issued]
    );

    await c.query('COMMIT');

    return { booking: out[0], issued };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}