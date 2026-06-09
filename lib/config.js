function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        return fallback;
    }
    return parsed;
}

const APP_CONFIG = {
    antiSpam: {
        enabled: process.env.ANTISPAM_ENABLED !== "false",
        blockOnHeuristics: process.env.ANTISPAM_BLOCK_ON_HEURISTICS === "true",
        disposableDomainCheckEnabled: process.env.DISPOSABLE_DOMAIN_CHECK_ENABLED !== "false",
        blockDisposableDomains: process.env.BLOCK_DISPOSABLE_DOMAINS !== "false",
        maxSubjectLength: toInt(process.env.MAX_SUBJECT_LENGTH, 200),
        maxBodyLength: toInt(process.env.MAX_BODY_LENGTH, 20000),
        maxUnbrokenTextLength: toInt(process.env.MAX_UNBROKEN_TEXT_LENGTH, 260),
        maxRecipients: toInt(process.env.MAX_RECIPIENTS, 20),
        warnUrlCount: toInt(process.env.MAX_URLS_WARN, 10),
        blockUrlCount: toInt(process.env.MAX_URLS_BLOCK, 20),
        maxSymbolRatioPercent: toInt(process.env.MAX_SYMBOL_RATIO_PERCENT, 45),
        gibberishMinBodyLength: toInt(process.env.GIBBERISH_MIN_BODY_LENGTH, 120),
        gibberishMinRepeatedChunkLength: toInt(process.env.GIBBERISH_MIN_REPEATED_CHUNK_LENGTH, 8),
        gibberishMinRepetitions: toInt(process.env.GIBBERISH_MIN_REPETITIONS, 6),
    },
    retry: {
        count: toInt(process.env.RETRY_COUNT, 2),
        baseBackoffMs: toInt(process.env.RETRY_BACKOFF_MS, 1000),
    },
    response: {
        includeDebugMeta: process.env.INCLUDE_DEBUG_META_IN_RESPONSE === "true",
    },
    quota: {
        enabled: process.env.QUOTA_ENABLED === "true",
        failOpen: process.env.QUOTA_FAIL_OPEN !== "false",
        limitPerMinute: toInt(process.env.QUOTA_LIMIT_PER_MINUTE, 30),
        limitPerHour: toInt(process.env.QUOTA_LIMIT_PER_HOUR, 300),
        recordTtlDays: toInt(process.env.QUOTA_RECORD_TTL_DAYS, 7),
        db: {
            host: process.env.DB_HOST || "",
            port: toInt(process.env.DB_PORT, 3306),
            user: process.env.DB_USER || "",
            password: process.env.DB_PASSWORD || "",
            name: process.env.DB_NAME || "",
            connectionLimit: toInt(process.env.DB_CONNECTION_LIMIT, 2),
            connectTimeoutMs: toInt(process.env.DB_CONNECT_TIMEOUT_MS, 5000),
        },
    },
};

module.exports = {
    APP_CONFIG,
};