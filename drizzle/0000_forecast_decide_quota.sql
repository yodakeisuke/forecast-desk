CREATE TABLE forecast_decide_quota (
  counter_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL CHECK (used > 0)
);
--> statement-breakpoint
CREATE INDEX forecast_decide_quota_expiration ON forecast_decide_quota (expires_at);
