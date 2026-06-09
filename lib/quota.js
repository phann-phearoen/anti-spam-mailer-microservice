const crypto = require("crypto");
const mysql = require("mysql2/promise");

let pool = null;

function toMysqlDatetimeUTC(date) {
    return date.toISOString().slice(0, 19).replace("T", " ");
}

function getWindowStart(now, windowSeconds) {
    const timestampMs = now.getTime();
    const flooredMs = Math.floor(timestampMs / (windowSeconds * 1000)) * windowSeconds * 1000;
    return new Date(flooredMs);
}

function hashUserAgent(userAgent) {
    return crypto.createHash("sha256").update(userAgent || "unknown").digest("hex");
}

function getPool(quotaConfig) {
    if (pool) {
        return pool;
    }

    pool = mysql.createPool({
        host: quotaConfig.db.host,
        port: quotaConfig.db.port,
        user: quotaConfig.db.user,
        password: quotaConfig.db.password,
        database: quotaConfig.db.name,
        waitForConnections: true,
        connectionLimit: quotaConfig.db.connectionLimit,
        queueLimit: 0,
        connectTimeout: quotaConfig.db.connectTimeoutMs,
        timezone: "Z",
    });

    return pool;
}

function buildWindowSpecs(quotaConfig) {
    const specs = [];

    if (quotaConfig.limitPerMinute > 0) {
        specs.push({ windowSeconds: 60, limit: quotaConfig.limitPerMinute, label: "minute" });
    }
    if (quotaConfig.limitPerHour > 0) {
        specs.push({ windowSeconds: 3600, limit: quotaConfig.limitPerHour, label: "hour" });
    }

    return specs;
}

async function incrementWindowCounter(connection, { keyType, keyValue, windowStart, windowSeconds, expiresAt }) {
    const sql = `
        INSERT INTO quota_counters (
          key_type, key_value, window_start, window_seconds, request_count, expires_at
        ) VALUES (?, ?, ?, ?, 1, ?)
        ON DUPLICATE KEY UPDATE
          request_count = LAST_INSERT_ID(request_count + 1),
          updated_at = CURRENT_TIMESTAMP,
          expires_at = VALUES(expires_at)
    `;

    await connection.execute(sql, [keyType, keyValue, windowStart, windowSeconds, expiresAt]);
    const [rows] = await connection.query("SELECT LAST_INSERT_ID() AS request_count");

    return Number(rows[0]?.request_count || 0);
}

function validateQuotaConfig(quotaConfig) {
    if (!quotaConfig.db.host || !quotaConfig.db.user || !quotaConfig.db.password || !quotaConfig.db.name) {
        return {
            ok: false,
            message: "Quota DB configuration is incomplete.",
        };
    }

    return { ok: true };
}

async function applyQuotaLimit({ metadata }, quotaConfig) {
    if (!quotaConfig.enabled) {
        return { allowed: true, warnings: [] };
    }

    const configStatus = validateQuotaConfig(quotaConfig);
    if (!configStatus.ok) {
        if (quotaConfig.failOpen) {
            return {
                allowed: true,
                warnings: [{ code: "WARN_QUOTA_CONFIG_MISSING", message: configStatus.message }],
            };
        }

        return {
            allowed: false,
            statusCode: 503,
            code: "QUOTA_CHECK_FAILED",
            message: configStatus.message,
            data: { reason: "config_missing" },
            warnings: [],
        };
    }

    const sourceIp = metadata.sourceIp || "unknown";
    const userAgentHash = hashUserAgent(metadata.userAgent || "unknown");
    const keyValue = `${sourceIp}|${userAgentHash}`;
    const now = new Date();
    const windows = buildWindowSpecs(quotaConfig);

    if (windows.length === 0) {
        return { allowed: true, warnings: [] };
    }

    const exceeded = [];
    const windowCounts = [];

    try {
        const dbPool = getPool(quotaConfig);
        const connection = await dbPool.getConnection();

        try {
            for (const windowSpec of windows) {
                const windowStartDate = getWindowStart(now, windowSpec.windowSeconds);
                const expiresAtDate = new Date(now.getTime() + quotaConfig.recordTtlDays * 24 * 3600 * 1000);

                const count = await incrementWindowCounter(connection, {
                    keyType: "ip_ua",
                    keyValue,
                    windowStart: toMysqlDatetimeUTC(windowStartDate),
                    windowSeconds: windowSpec.windowSeconds,
                    expiresAt: toMysqlDatetimeUTC(expiresAtDate),
                });

                windowCounts.push({
                    window: windowSpec.label,
                    count,
                    limit: windowSpec.limit,
                    windowSeconds: windowSpec.windowSeconds,
                });

                if (count > windowSpec.limit) {
                    exceeded.push({
                        window: windowSpec.label,
                        count,
                        limit: windowSpec.limit,
                    });
                }
            }
        } finally {
            connection.release();
        }
    } catch (error) {
        if (quotaConfig.failOpen) {
            return {
                allowed: true,
                warnings: [{ code: "WARN_QUOTA_UNAVAILABLE", message: "Quota backend unavailable." }],
            };
        }

        return {
            allowed: false,
            statusCode: 503,
            code: "QUOTA_CHECK_FAILED",
            message: "Quota backend unavailable.",
            data: { reason: "db_error" },
            warnings: [],
        };
    }

    if (exceeded.length > 0) {
        return {
            allowed: false,
            statusCode: 429,
            code: "QUOTA_EXCEEDED",
            message: "Quota exceeded for this IP and user-agent fingerprint.",
            data: {
                keyType: "ip_ua",
                exceeded,
                windowCounts,
            },
            warnings: [],
        };
    }

    return {
        allowed: true,
        warnings: [],
    };
}

async function __resetQuotaPool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

module.exports = {
    applyQuotaLimit,
    __resetQuotaPool,
    __internal: {
        hashUserAgent,
        toMysqlDatetimeUTC,
        getWindowStart,
        buildWindowSpecs,
    },
};