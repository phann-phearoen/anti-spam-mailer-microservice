const test = require("node:test");
const assert = require("node:assert/strict");

function withMockedMysql(mockExports) {
    const mysqlPath = require.resolve("mysql2/promise");
    const original = require.cache[mysqlPath];

    require.cache[mysqlPath] = {
        id: mysqlPath,
        filename: mysqlPath,
        loaded: true,
        exports: mockExports,
    };

    return () => {
        if (original) {
            require.cache[mysqlPath] = original;
        } else {
            delete require.cache[mysqlPath];
        }
    };
}

function loadQuotaModule() {
    const quotaPath = require.resolve("../lib/quota");
    delete require.cache[quotaPath];
    return require("../lib/quota");
}

function buildQuotaConfig(overrides = {}) {
    return {
        enabled: true,
        failOpen: true,
        limitPerMinute: 30,
        limitPerHour: 300,
        recordTtlDays: 7,
        db: {
            host: "db.example.local",
            port: 3306,
            user: "mailer_app",
            password: "secret",
            name: "mailer_security",
            connectionLimit: 2,
            connectTimeoutMs: 5000,
        },
        ...overrides,
    };
}

function buildMetadata(overrides = {}) {
    return {
        sourceIp: "203.0.113.10",
        userAgent: "Mozilla/5.0",
        ...overrides,
    };
}

const { __internal } = loadQuotaModule();

test("quota windows include minute and hour when limits are positive", () => {
    const windows = __internal.buildWindowSpecs({
        limitPerMinute: 10,
        limitPerHour: 100,
    });

    assert.deepEqual(windows, [
        { windowSeconds: 60, limit: 10, label: "minute" },
        { windowSeconds: 3600, limit: 100, label: "hour" },
    ]);
});

test("quota windows can disable minute/hour independently", () => {
    const windows = __internal.buildWindowSpecs({
        limitPerMinute: 0,
        limitPerHour: 50,
    });

    assert.deepEqual(windows, [{ windowSeconds: 3600, limit: 50, label: "hour" }]);
});

test("hashUserAgent produces stable SHA256 value", () => {
    const a = __internal.hashUserAgent("Mozilla/5.0");
    const b = __internal.hashUserAgent("Mozilla/5.0");
    const c = __internal.hashUserAgent("Different-UA");

    assert.equal(a.length, 64);
    assert.equal(a, b);
    assert.notEqual(a, c);
});

test("getWindowStart rounds down to fixed window boundary", () => {
    const now = new Date("2026-06-08T12:34:56.789Z");
    const minuteWindow = __internal.getWindowStart(now, 60);
    const hourWindow = __internal.getWindowStart(now, 3600);

    assert.equal(minuteWindow.toISOString(), "2026-06-08T12:34:00.000Z");
    assert.equal(hourWindow.toISOString(), "2026-06-08T12:00:00.000Z");
});

test("toMysqlDatetimeUTC renders UTC timestamp string", () => {
    const out = __internal.toMysqlDatetimeUTC(new Date("2026-06-08T12:34:56.000Z"));
    assert.equal(out, "2026-06-08 12:34:56");
});

test("applyQuotaLimit allows request when quota is disabled", async () => {
    const { applyQuotaLimit, __resetQuotaPool } = loadQuotaModule();

    try {
        const result = await applyQuotaLimit(
            { metadata: buildMetadata() },
            buildQuotaConfig({ enabled: false })
        );

        assert.deepEqual(result, { allowed: true, warnings: [] });
    } finally {
        await __resetQuotaPool();
    }
});

test("applyQuotaLimit returns warning when DB config missing and failOpen enabled", async () => {
    const { applyQuotaLimit, __resetQuotaPool } = loadQuotaModule();

    try {
        const result = await applyQuotaLimit(
            { metadata: buildMetadata() },
            buildQuotaConfig({
                failOpen: true,
                db: {
                    host: "",
                    port: 3306,
                    user: "",
                    password: "",
                    name: "",
                    connectionLimit: 2,
                    connectTimeoutMs: 5000,
                },
            })
        );

        assert.equal(result.allowed, true);
        assert.equal(result.warnings[0].code, "WARN_QUOTA_CONFIG_MISSING");
    } finally {
        await __resetQuotaPool();
    }
});

test("applyQuotaLimit fails with 503 when DB config missing and failOpen disabled", async () => {
    const { applyQuotaLimit, __resetQuotaPool } = loadQuotaModule();

    try {
        const result = await applyQuotaLimit(
            { metadata: buildMetadata() },
            buildQuotaConfig({
                failOpen: false,
                db: {
                    host: "",
                    port: 3306,
                    user: "",
                    password: "",
                    name: "",
                    connectionLimit: 2,
                    connectTimeoutMs: 5000,
                },
            })
        );

        assert.equal(result.allowed, false);
        assert.equal(result.statusCode, 503);
        assert.equal(result.code, "QUOTA_CHECK_FAILED");
        assert.equal(result.data.reason, "config_missing");
    } finally {
        await __resetQuotaPool();
    }
});

test("applyQuotaLimit returns warning when DB is unavailable and failOpen enabled", async () => {
    const restoreMysql = withMockedMysql({
        createPool: () => ({
            getConnection: async () => {
                throw new Error("db down");
            },
            end: async () => undefined,
        }),
    });
    const { applyQuotaLimit, __resetQuotaPool } = loadQuotaModule();

    try {
        const result = await applyQuotaLimit(
            { metadata: buildMetadata() },
            buildQuotaConfig({ failOpen: true })
        );

        assert.equal(result.allowed, true);
        assert.equal(result.warnings[0].code, "WARN_QUOTA_UNAVAILABLE");
    } finally {
        await __resetQuotaPool();
        restoreMysql();
    }
});

test("applyQuotaLimit fails with 503 when DB is unavailable and failOpen disabled", async () => {
    const restoreMysql = withMockedMysql({
        createPool: () => ({
            getConnection: async () => {
                throw new Error("db down");
            },
            end: async () => undefined,
        }),
    });
    const { applyQuotaLimit, __resetQuotaPool } = loadQuotaModule();

    try {
        const result = await applyQuotaLimit(
            { metadata: buildMetadata() },
            buildQuotaConfig({ failOpen: false })
        );

        assert.equal(result.allowed, false);
        assert.equal(result.statusCode, 503);
        assert.equal(result.code, "QUOTA_CHECK_FAILED");
        assert.equal(result.data.reason, "db_error");
    } finally {
        await __resetQuotaPool();
        restoreMysql();
    }
});

test("applyQuotaLimit blocks request when minute quota is exceeded", async () => {
    const lastInsertIds = [31, 120];
    const executedParams = [];
    let released = false;

    const restoreMysql = withMockedMysql({
        createPool: () => ({
            getConnection: async () => ({
                execute: async (_sql, params) => {
                    executedParams.push(params);
                },
                query: async () => [[{ request_count: lastInsertIds.shift() }]],
                release: () => {
                    released = true;
                },
            }),
            end: async () => undefined,
        }),
    });
    const { applyQuotaLimit, __resetQuotaPool } = loadQuotaModule();

    try {
        const result = await applyQuotaLimit(
            { metadata: buildMetadata() },
            buildQuotaConfig({ limitPerMinute: 30, limitPerHour: 300 })
        );

        assert.equal(result.allowed, false);
        assert.equal(result.statusCode, 429);
        assert.equal(result.code, "QUOTA_EXCEEDED");
        assert.equal(result.data.keyType, "ip_ua");
        assert.equal(result.data.exceeded[0].window, "minute");
        assert.equal(result.data.exceeded[0].count, 31);
        assert.equal(released, true);
        assert.equal(executedParams.length, 2);
    } finally {
        await __resetQuotaPool();
        restoreMysql();
    }
});

test("applyQuotaLimit allows request when counters are within limits", async () => {
    const lastInsertIds = [2, 15];
    const restoreMysql = withMockedMysql({
        createPool: () => ({
            getConnection: async () => ({
                execute: async () => undefined,
                query: async () => [[{ request_count: lastInsertIds.shift() }]],
                release: () => undefined,
            }),
            end: async () => undefined,
        }),
    });
    const { applyQuotaLimit, __resetQuotaPool } = loadQuotaModule();

    try {
        const result = await applyQuotaLimit(
            { metadata: buildMetadata() },
            buildQuotaConfig({ limitPerMinute: 30, limitPerHour: 300 })
        );

        assert.deepEqual(result, { allowed: true, warnings: [] });
    } finally {
        await __resetQuotaPool();
        restoreMysql();
    }
});