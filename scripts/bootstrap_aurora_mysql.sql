-- Aurora MySQL one-shot bootstrap script for Lambda quota storage.

CREATE DATABASE IF NOT EXISTS mailer_security
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE mailer_security;

CREATE TABLE IF NOT EXISTS quota_counters (
  key_type        VARCHAR(32)  NOT NULL,
  key_value       VARCHAR(255) NOT NULL,
  window_start    DATETIME     NOT NULL,
  window_seconds  INT          NOT NULL,
  request_count   INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at      DATETIME     NOT NULL,
  PRIMARY KEY (key_type, key_value, window_start, window_seconds),
  INDEX idx_expires_at (expires_at)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(32)  NOT NULL,
  description VARCHAR(255) NOT NULL,
  applied_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
);

INSERT INTO schema_migrations (version, description)
VALUES ('001', 'Initial quota schema with quota_counters and schema_migrations tables')
ON DUPLICATE KEY UPDATE
  description = VALUES(description);
