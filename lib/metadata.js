const { randomUUID } = require("crypto");

function normalizeHeaders(headers) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers || {})) {
        normalized[String(key).toLowerCase()] = value;
    }
    return normalized;
}

function parseSourceIp(headers, requestContext) {
    const forwardedFor = headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
        return forwardedFor.split(",")[0].trim();
    }

    return (
        requestContext?.http?.sourceIp ||
        requestContext?.identity?.sourceIp ||
        "unknown"
    );
}

function extractRequestMetadata(event) {
    const headers = normalizeHeaders(event?.headers);
    const requestContext = event?.requestContext || {};

    return {
        requestId: requestContext.requestId || randomUUID(),
        sourceIp: parseSourceIp(headers, requestContext),
        userAgent: headers["user-agent"] || "unknown",
        origin: headers.origin || headers["x-origin"] || null,
        referer: headers.referer || headers.referrer || null,
        timestamp: new Date().toISOString(),
    };
}

module.exports = {
    extractRequestMetadata,
};