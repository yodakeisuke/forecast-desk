// One atomic SQLite write admits all four counters or none, across Worker isolates and regions.
const reserve = `
  WITH requested(counter_key, expires_at, ceiling) AS (
    VALUES (?1, ?2, 3), (?3, ?4, 12), (?5, ?2, 10), (?6, ?4, 50)
  )
  INSERT INTO forecast_decide_quota (counter_key, expires_at, used)
  SELECT counter_key, expires_at, 1 FROM requested
  WHERE NOT EXISTS (
    SELECT 1 FROM forecast_decide_quota AS current
    JOIN requested AS incoming USING (counter_key)
    WHERE current.used >= incoming.ceiling
  )
  ON CONFLICT(counter_key) DO UPDATE SET used = used + 1
  RETURNING counter_key
`;
const prune = `
  DELETE FROM forecast_decide_quota WHERE counter_key IN (
    SELECT counter_key FROM forecast_decide_quota WHERE expires_at <= ?1 ORDER BY expires_at LIMIT 32
  )
`;

interface Statement {
  bind(...values: (number | string)[]): Statement;
}
export interface QuotaDB {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<{ success: boolean; results: unknown[] }[]>;
}

export async function reserveQuota(db: QuotaDB, ip: string, secret: string, now = Date.now()) {
  const minute = Math.floor(now / 60_000);
  const day = Math.floor(now / 86_400_000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`forecast-desk-quota:v1:${day}:${ip}`));
  const visitor = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const [admission, cleanup] = await db.batch([
    db.prepare(reserve).bind(`ip-minute:${minute}:${visitor}`, (minute + 1) * 60_000,
      `ip-day:${day}:${visitor}`, (day + 1) * 86_400_000, `global-minute:${minute}`, `global-day:${day}`),
    db.prepare(prune).bind(now),
  ]);
  if (!admission?.success || !cleanup?.success) throw new Error("Quota unavailable");
  if (admission.results.length === 4) return true;
  if (admission.results.length === 0) return false;
  throw new Error("Unexpected quota response");
}
