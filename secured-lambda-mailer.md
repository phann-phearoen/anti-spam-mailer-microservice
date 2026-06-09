# Secured Lambda Mailer API Spec

This document describes the request contract, validation rules, response format, and suggested client-side handling for the Lambda mailer function.

## Overview

The function accepts a JSON payload, validates sender authorization and content safety, applies IP + user-agent quota checks, and then sends the email through the configured SMTP provider.

The Lambda returns a standard JSON response envelope with:
- `statusCode` at the transport layer
- `body` as JSON string containing `ok`, `code`, `message`, `requestId`, `warnings`, and optional `data` / `meta`

## Request Parameters

All requests must be sent as JSON in the Lambda event `body`.

### Required

- `authEmail` string
  - Sender email address.
  - Must match one of the authorized sender accounts configured in Lambda environment variables.

- `to` string | string[]
  - Recipient email address or comma-separated list of recipient addresses.
  - Can also be provided as an array of strings.

- `subject` string
  - Email subject line.

- `body` string
  - Email body content.
  - Usually HTML.

### Optional

- `smtpProvider` string
  - Supported values: `gmail`, `zoho`
  - Default: `gmail`

## Validation Rules

The function applies validation before attempting to send email.

### 1. JSON Parsing

- Invalid JSON returns:
  - `400 INVALID_JSON`

### 2. Required Fields

- Missing `authEmail`, `to`, `subject`, or `body` returns:
  - `400 INVALID_REQUEST`

### 3. Email Format

- Invalid sender or recipient email format returns:
  - `400 INVALID_REQUEST`

### 4. Sender Authorization

- If `authEmail` is not in the configured allowlist, returns:
  - `403 UNAUTHORIZED_SENDER`

### 5. Denylist / Disposable Domain Detection

- Disposable recipient domains can be blocked or warned depending on configuration.
- If blocking is enabled and a disposable domain is detected:
  - `400 INVALID_REQUEST`
  - reason code: `DISPOSABLE_RECIPIENT_DOMAIN`
- If blocking is disabled:
  - request continues
  - warning code: `WARN_DISPOSABLE_RECIPIENT_DOMAIN`

### 6. Spam-like Text Detection

The function flags suspicious content patterns such as:
- suspicious token phrases
- repeated punctuation
- high URL count
- repeated gibberish chunks
- very long unbroken text

Behavior:
- Some are warnings only
- Some are hard blocks

Relevant block codes:
- `GIBBERISH_REPEATED_PATTERN`
- `LONG_UNBROKEN_TEXT`
- `BLOCK_EXCESSIVE_LINKS`

Relevant warning codes:
- `WARN_SUSPICIOUS_TOKENS`
- `WARN_REPEATED_PUNCTUATION`
- `WARN_HIGH_URL_COUNT`

### 7. Quota Check

The function applies an IP + user-agent quota check using Aurora MySQL.

- If quota is exceeded:
  - `429 QUOTA_EXCEEDED`
- If quota backend is unavailable and fail-open is disabled:
  - `503 QUOTA_CHECK_FAILED`
- If fail-open is enabled, request may continue with warning:
  - `WARN_QUOTA_UNAVAILABLE`

## Response Format

The client should handle responses by HTTP status class, not by individual code names.

### 2xx: Success

- Meaning: the message was accepted or sent successfully.
- Client behavior:
  - show success message
  - optionally redirect or clear the form
  - display warnings only if present and relevant

Example payload:

```json
{
  "ok": true,
  "code": "EMAIL_SENT",
  "message": "Email sent successfully.",
  "requestId": "...",
  "warnings": [],
  "data": {
    "messageId": "..."
  }
}
```

### 4xx: Failed by User Input

- Meaning: the request should be corrected by the user.
- Client behavior:
  - show error message
  - highlight invalid fields if validation details are present
  - suggest input checking and editing
  - do not retry automatically

Example payload:

```json
{
  "ok": false,
  "code": "INVALID_REQUEST",
  "message": "Validation failed.",
  "requestId": "...",
  "warnings": [],
  "data": {
    "reasons": []
  }
}
```

Typical 4xx causes in this function:
- invalid JSON
- missing required fields
- invalid email format
- unauthorized sender
- quota exceeded
- blocked by validation rules

### 5xx: Failed by Server

- Meaning: the issue is server-side or infrastructure-side.
- Client behavior:
  - show error message
  - suggest trying again later
  - allow retry after a delay if the UI supports it

Typical 5xx causes in this function:
- SMTP verification failure
- send failure after retries
- quota backend unavailable when fail-open is disabled

## Suggested Client Handling

### Recommended Flow

1. Parse the Lambda response body as JSON.
2. Read `statusCode` first and branch by `2xx`, `4xx`, or `5xx`.
3. Show `message` to the user.
4. Use `warnings` as non-blocking notices.
5. Use `data.reasons` when validation fails to highlight specific fields.

### Retry Guidance

- Retry automatically only for server-side failures if your product allows it.
- Do not retry user-input failures.
- If retry is enabled, use a short backoff for `5xx` and only retry `4xx` when the error is known to be quota-related and your UX explicitly supports it.


## Notes

- `requestId` should be used for tracing support/debug sessions.
- `warnings` do not necessarily mean failure.
- HTML email templates are supported, but long unbroken text and repeated gibberish may still be blocked.