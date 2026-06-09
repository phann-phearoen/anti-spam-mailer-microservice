# Manual Deployed Lambda Test Pack

This folder provides copy-ready Lambda event JSON files for manual post-deploy verification.

## How To Run

1. Open AWS Lambda console.
2. Select your function.
3. Go to the Test tab.
4. Create a new test event and paste one JSON file from this folder.
5. Run tests one by one.

## Prerequisites

- Sender credentials are configured in Lambda environment variables.
- For denylist enforcement tests, keep `DISPOSABLE_DOMAIN_CHECK_ENABLED=true`.
- For strict denylist blocking tests, keep `BLOCK_DISPOSABLE_DOMAINS=true`.
- For quota tests, set `QUOTA_ENABLED=true` and valid MySQL connection values.

## Test Files And Expected Outcomes

- `01_invalid_json_event.json`
  - Expected: `400 INVALID_JSON`

- `02_missing_required_fields_event.json`
  - Expected: `400 INVALID_REQUEST`
  - Reason codes should include missing required fields.

- `03_invalid_recipient_email_event.json`
  - Expected: `400 INVALID_REQUEST`
  - Reason code should include `INVALID_RECIPIENT_EMAIL`.

- `04_unauthorized_sender_event.json`
  - Expected: `403 UNAUTHORIZED_SENDER`

- `05_disposable_domain_block_event.json`
  - Expected when blocking is enabled: `400 INVALID_REQUEST` with `DISPOSABLE_RECIPIENT_DOMAIN`.
  - Expected when blocking is disabled: request continues and warning `WARN_DISPOSABLE_RECIPIENT_DOMAIN` appears.

- `06_spam_like_warning_event.json`
  - Expected: request should pass validation and include warning codes such as:
    - `WARN_SUSPICIOUS_TOKENS`
    - `WARN_REPEATED_PUNCTUATION`
    - `WARN_HIGH_URL_COUNT`

- `07_happy_path_event.json`
  - Expected: `200 EMAIL_SENT` (or `202 EMAIL_ACCEPTED_UNCERTAIN` depending provider response).

- `08_quota_probe_event.json`
  - Run this same event repeatedly.
  - Expected: eventually `429 QUOTA_EXCEEDED` after crossing configured minute/hour limits for the same IP+UA fingerprint.

- `09_quota_backend_unavailable_event.json`
  - Use only for fail-open/fail-closed checks by changing DB connectivity or settings.
  - With `QUOTA_FAIL_OPEN=true`, expected behavior is allow with warning `WARN_QUOTA_UNAVAILABLE`.
  - With `QUOTA_FAIL_OPEN=false`, expected behavior is `503 QUOTA_CHECK_FAILED`.

- `10_gibberish_repeated_pattern_block_event.json`
  - Expected: `400 INVALID_REQUEST`
  - Reason code should include `GIBBERISH_REPEATED_PATTERN`.

- `11_long_unbroken_text_block_event.json`
  - Expected: `400 INVALID_REQUEST`
  - Reason code should include `LONG_UNBROKEN_TEXT`.

- `12_japanese_multiline_safe_event.json`
  - Expected: request should pass validation and continue to send stage.
  - Useful to confirm the long-unbroken-text filter does not overblock normal Japanese templates with line breaks.

## Notes

- Response payload shape should always include: `ok`, `code`, `message`, `requestId`, `warnings`.
- `sourceIp` is derived from `x-forwarded-for` first value.
- Quota fingerprint is based on `sourceIp + sha256(user-agent)`.