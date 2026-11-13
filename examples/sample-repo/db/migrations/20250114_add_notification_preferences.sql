-- Adds per-user notification preferences.
-- One row per user; created lazily on first update.

BEGIN;

CREATE TABLE notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id),
  email BOOLEAN NOT NULL DEFAULT TRUE,
  push BOOLEAN NOT NULL DEFAULT TRUE,
  in_app BOOLEAN NOT NULL DEFAULT TRUE
);

COMMIT;
