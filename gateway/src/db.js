const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.on('error', (err) => console.error('[db] Pool error:', err));
  }
  return pool;
}

async function query(text, params) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function getRecentEvents(limit = 50) {
  const res = await query(
    `SELECT id, source_service, target_service, event_type, status,
            error_message, retry_count, pgp_signed, created_at, updated_at
     FROM integration_events
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

async function getEventById(id) {
  const res = await query(
    'SELECT * FROM integration_events WHERE id = $1',
    [id]
  );
  return res.rows[0] || null;
}

async function getDeadLetters(resolved = false) {
  const res = await query(
    `SELECT * FROM dead_letters WHERE resolved = $1 ORDER BY created_at DESC`,
    [resolved]
  );
  return res.rows;
}

async function resolveDeadLetter(id) {
  await query('UPDATE dead_letters SET resolved = TRUE WHERE id = $1', [id]);
}

async function getStats() {
  const res = await query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'success')    AS success_count,
      COUNT(*) FILTER (WHERE status = 'failed')     AS failed_count,
      COUNT(*) FILTER (WHERE status = 'pending')    AS pending_count,
      COUNT(*) FILTER (WHERE status = 'processing') AS processing_count,
      COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter_count,
      COUNT(*)                                       AS total_count,
      COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour') AS last_hour,
      COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') AS last_24h
    FROM integration_events
  `);
  return res.rows[0];
}

async function getEventTimeline(hours = 24) {
  const res = await query(`
    SELECT
      date_trunc('hour', created_at) AS hour,
      COUNT(*) FILTER (WHERE status = 'success') AS success,
      COUNT(*) FILTER (WHERE status = 'failed')  AS failed,
      COUNT(*)                                    AS total
    FROM integration_events
    WHERE created_at > now() - ($1 || ' hours')::interval
    GROUP BY 1
    ORDER BY 1
  `, [hours]);
  return res.rows;
}

module.exports = {
  query,
  getRecentEvents,
  getEventById,
  getDeadLetters,
  resolveDeadLetter,
  getStats,
  getEventTimeline,
};
