-- Euron Open LMS: what the mobile learner app needs.
--
--   push_devices        one row per installed app that may receive push notifications
--   users.push_preferences   per-category push switches, next to email_preferences
--   notifications.pushed_at  a notification is claimed once before it is pushed
--   courses.allow_downloads  whether a course's videos may be saved for offline viewing
--   offline_downloads   the videos a learner saved on a device, with a sliding expiry
--
-- Same conventions as 0001_init.sql: ULID text keys, timestamptz(3), keyset-friendly
-- indexes.

-- ─── Push notifications ────────────────────────────────────────────────────

-- A token belongs to exactly one account at a time: signing in on a device that someone
-- else used re-assigns the row to the new account (services/push-device.service.ts).
CREATE TABLE push_devices (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('IOS', 'ANDROID')),
  token        text NOT NULL UNIQUE CHECK (length(token) BETWEEN 1 AND 4096),
  app_version  text CHECK (length(app_version) <= 40),
  locale       text CHECK (length(locale) <= 35),
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  last_seen_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user_idx ON push_devices (user_id);

-- Missing keys fall back to the defaults in presenters/user.presenter.ts pushPreferences.
ALTER TABLE users ADD COLUMN push_preferences jsonb NOT NULL DEFAULT '{}';

ALTER TABLE notifications ADD COLUMN pushed_at timestamptz(3);

-- ─── Offline downloads ─────────────────────────────────────────────────────

ALTER TABLE courses ADD COLUMN allow_downloads boolean NOT NULL DEFAULT true;

-- A download is a licence, not a file: the app keeps the encrypted video, the server keeps
-- the right to play it. The app revalidates while online (POST /api/my/downloads/validate);
-- each successful check slides expires_at forward, a lost entitlement revokes the row.
CREATE TABLE offline_downloads (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id    text NOT NULL REFERENCES course_items (id) ON DELETE CASCADE,
  course_id  text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  device_id  text NOT NULL CHECK (length(device_id) BETWEEN 8 AND 128),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL,
  revoked_at timestamptz(3),
  UNIQUE (user_id, item_id, device_id)
);
CREATE INDEX offline_downloads_user_idx ON offline_downloads (user_id, created_at DESC, id DESC);
CREATE INDEX offline_downloads_item_idx ON offline_downloads (item_id);
