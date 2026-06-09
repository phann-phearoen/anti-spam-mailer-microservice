# Nodemailer Lambda with Basic Anti-Spam Validation

This project is an AWS Lambda email sender built with `nodemailer` and designed for controlled dynamic sending.

It supports:
- Authorized sender accounts from environment variables
- SMTP provider switching (Gmail and Zoho)
- Retry-based send behavior
- Basic anti-spam validation for text and email inputs
- Request metadata extraction (requestId, source IP, user-agent)
- Aurora MySQL-backed IP + user-agent quota limitation

## Project Structure

- `index.js`: Lambda handler orchestration
- `lib/parsing.js`: payload parsing and normalization
- `lib/validation.js`: required checks + anti-spam validation pipeline
- `lib/denylist.js`: disposable-domain denylist loader and lookup
- `lib/auth.js`: sender authorization checks
- `lib/smtp.js`: SMTP transport configuration and verification
- `lib/send.js`: retry send logic
- `lib/response.js`: unified API response builder
- `lib/config.js`: runtime config and feature toggles
- `data/`: denylist source and local override files

## Environment Variables

Anti-spam and behavior toggles:
- `ANTISPAM_ENABLED` (default: `true`)
- `ANTISPAM_BLOCK_ON_HEURISTICS` (default: `false`)
- `DISPOSABLE_DOMAIN_CHECK_ENABLED` (default: `true`)
- `BLOCK_DISPOSABLE_DOMAINS` (default: `true`)
- `MAX_SUBJECT_LENGTH` (default: `200`)
- `MAX_BODY_LENGTH` (default: `20000`)
- `MAX_RECIPIENTS` (default: `20`)
- `MAX_URLS_WARN` (default: `3`)
- `MAX_URLS_BLOCK` (default: `10`)
- `MAX_SYMBOL_RATIO_PERCENT` (default: `45`)
- `RETRY_COUNT` (default: `2`)
- `RETRY_BACKOFF_MS` (default: `1000`)
- `INCLUDE_DEBUG_META_IN_RESPONSE` (default: `false`)

Quota controls:
- `QUOTA_ENABLED` (default: `false`)
- `QUOTA_FAIL_OPEN` (default: `true`)
- `QUOTA_LIMIT_PER_MINUTE` (default: `30`)
- `QUOTA_LIMIT_PER_HOUR` (default: `300`)
- `QUOTA_RECORD_TTL_DAYS` (default: `7`)

MySQL connection:
- `DB_HOST`
- `DB_PORT` (default: `3306`)
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_CONNECTION_LIMIT` (default: `2`)
- `DB_CONNECT_TIMEOUT_MS` (default: `5000`)

## Request Payload

Expected JSON body:

```json
{
  "authEmail": "info@kinkan.travel",
  "to": "user@example.com,user2@example.com",
  "subject": "Hello",
  "body": "<p>Message HTML body</p>",
  "smtpProvider": "gmail"
}
```

`to` can be a comma-separated string or an array of email addresses.

## Denylist Mechanism (Disposable Email Providers)

This project uses a layered denylist strategy:

1. Open-source baseline list
- File: `data/disposable_domains_base.txt`
- Source: `disposable/disposable-email-domains` (GitHub)
- Purpose: broad coverage for known temporary/disposable email domains

2. Project-specific custom block list
- File: `data/custom_disposable_domains_block.txt`
- Purpose: add domains you want to block based on your own abuse patterns

3. Project-specific allowlist override
- File: `data/disposable_domains_allow.txt`
- Purpose: explicitly permit domains from the base/custom block list when needed

Lookup flow:
- Merge base list + custom block list
- Remove anything present in allowlist
- Check recipient domains against the final in-memory set

Behavior:
- If `DISPOSABLE_DOMAIN_CHECK_ENABLED=true` and `BLOCK_DISPOSABLE_DOMAINS=true`, matching recipient domains are blocked.
- If `BLOCK_DISPOSABLE_DOMAINS=false`, matches are returned as warnings only.

Update baseline list:

```bash
npm run denylist:update
```

This runs `scripts/update_disposable_domains.sh` and refreshes the local snapshot.

## Aurora MySQL Bootstrap (Quota Storage)

This project includes a one-shot SQL bootstrap script for creating a simple database and tables for IP/UA quota counters:

- `scripts/bootstrap_aurora_mysql.sql`

What it creates:
- Application database
- `quota_counters` table for atomic quota increments
- `schema_migrations` table to lock schema version

### Run in Aurora Query Editor v2

1. Open `scripts/bootstrap_aurora_mysql.sql`.
2. Replace placeholders:
- `__DB_NAME__`
3. Connect Query Editor using an admin account.
4. Paste and execute the full script once.

The bootstrap script intentionally does not create database users or passwords.
Manage Lambda credentials separately using your existing secrets workflow.

### Run from Terminal (one command)

```bash
mysql -h <AURORA_CLUSTER_ENDPOINT> -P 3306 -u <ADMIN_USER> -p --ssl-mode=REQUIRED < scripts/bootstrap_aurora_mysql.sql
```

Use this terminal path after replacing placeholders in the script file.

### Verify Bootstrap

```sql
USE <DB_NAME>;

SHOW TABLES;

SELECT version, description, applied_at
FROM schema_migrations
ORDER BY applied_at DESC;
```

Atomic upsert test (same pattern Lambda will use):

```sql
INSERT INTO quota_counters (
  key_type, key_value, window_start, window_seconds, request_count, expires_at
) VALUES (
  'ip_ua',
  '203.0.113.10|uaHash',
  '2026-06-08 12:00:00',
  60,
  1,
  DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY)
)
ON DUPLICATE KEY UPDATE
  request_count = request_count + 1,
  updated_at = CURRENT_TIMESTAMP;
```

Cleanup query for scheduled maintenance:

```sql
DELETE FROM quota_counters WHERE expires_at < UTC_TIMESTAMP();
```

### Lambda Environment Variables (MySQL)

- `DB_HOST`
- `DB_PORT` (typically `3306`)
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

## Response Format

All responses use a unified shape:

```json
{
  "ok": true,
  "code": "EMAIL_SENT",
  "message": "Email sent successfully.",
  "requestId": "...",
  "warnings": [],
  "data": {}
}
```

Failure responses use the same contract with `ok: false` and relevant `code`.

Quota-specific failures:
- `429 QUOTA_EXCEEDED`: request exceeded per-minute or per-hour limits for IP + UA fingerprint.
- `503 QUOTA_CHECK_FAILED`: quota backend unavailable when `QUOTA_FAIL_OPEN=false`.

## Notes

- Validation is intentionally basic and fast for in-function checks.
- Persistent quota/rate limiting (IP/UA) should use an external datastore (for example Aurora or DynamoDB) for reliability under Lambda scaling.
