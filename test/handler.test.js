const test = require("node:test");
const assert = require("node:assert/strict");

const projectRoot = "/Users/phearoenphann/Ryong/nodemailer";

function clearProjectModuleCache() {
    for (const key of Object.keys(require.cache)) {
        const isHandlerOrLibModule =
            key === `${projectRoot}/index.js` ||
            key.startsWith(`${projectRoot}/lib/`);

        if (isHandlerOrLibModule) {
            delete require.cache[key];
        }
    }
}

function withMockedNodemailer(mockExports) {
    const nodemailerPath = require.resolve("nodemailer");
    const original = require.cache[nodemailerPath];

    require.cache[nodemailerPath] = {
        id: nodemailerPath,
        filename: nodemailerPath,
        loaded: true,
        exports: mockExports,
    };

    return () => {
        if (original) {
            require.cache[nodemailerPath] = original;
        } else {
            delete require.cache[nodemailerPath];
        }
    };
}

function withMockedProjectModule(relativePath, mockExports) {
    const modulePath = require.resolve(`../${relativePath}`, { paths: [__dirname] });
    const original = require.cache[modulePath];

    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports: mockExports,
    };

    return () => {
        if (original) {
            require.cache[modulePath] = original;
        } else {
            delete require.cache[modulePath];
        }
    };
}

function parseResponse(result) {
    return {
        statusCode: result.statusCode,
        body: JSON.parse(result.body),
    };
}

function setRequiredEnv() {
    process.env.KINKAN_PASSWORD = "kinkan-secret";
    process.env.WG_PASSWORD = "wg-secret";
    process.env.RSF_PASSWORD = "rsf-secret";
    process.env.BLOCK_DISPOSABLE_DOMAINS = "false";
}

test("handler returns INVALID_JSON for malformed payload", async () => {
    setRequiredEnv();

    const restore = withMockedNodemailer({
        createTransport: () => ({
            verify: async () => undefined,
            sendMail: async () => ({ messageId: "msg-1", response: "ok" }),
        }),
    });

    try {
        clearProjectModuleCache();
        const { handler } = require("../index");

        const response = parseResponse(await handler({ body: "{invalid-json" }));

        assert.equal(response.statusCode, 400);
        assert.equal(response.body.ok, false);
        assert.equal(response.body.code, "INVALID_JSON");
    } finally {
        restore();
    }
});

test("handler returns UNAUTHORIZED_SENDER for unknown authEmail", async () => {
    setRequiredEnv();

    const restore = withMockedNodemailer({
        createTransport: () => ({
            verify: async () => undefined,
            sendMail: async () => ({ messageId: "msg-1", response: "ok" }),
        }),
    });

    try {
        clearProjectModuleCache();
        const { handler } = require("../index");

        const response = parseResponse(
            await handler({
                body: JSON.stringify({
                    authEmail: "unknown@example.com",
                    to: "valid@example.com",
                    subject: "hello",
                    body: "<p>world</p>",
                }),
            })
        );

        assert.equal(response.statusCode, 403);
        assert.equal(response.body.code, "UNAUTHORIZED_SENDER");
    } finally {
        restore();
    }
});

test("handler returns SMTP_VERIFY_FAILED when transporter verification fails", async () => {
    setRequiredEnv();

    const restore = withMockedNodemailer({
        createTransport: () => ({
            verify: async () => {
                throw new Error("bad smtp");
            },
            sendMail: async () => ({ messageId: "msg-1", response: "ok" }),
        }),
    });

    try {
        clearProjectModuleCache();
        const { handler } = require("../index");

        const response = parseResponse(
            await handler({
                body: JSON.stringify({
                    authEmail: "info@kinkan.travel",
                    to: "valid@example.com",
                    subject: "hello",
                    body: "<p>world</p>",
                    smtpProvider: "gmail",
                }),
            })
        );

        assert.equal(response.statusCode, 500);
        assert.equal(response.body.code, "SMTP_VERIFY_FAILED");
    } finally {
        restore();
    }
});

test("handler returns EMAIL_SENT when sending succeeds", async () => {
    setRequiredEnv();

    const restore = withMockedNodemailer({
        createTransport: () => ({
            verify: async () => undefined,
            sendMail: async () => ({ messageId: "msg-1", response: "accepted" }),
        }),
    });

    try {
        clearProjectModuleCache();
        const { handler } = require("../index");

        const response = parseResponse(
            await handler({
                requestContext: { requestId: "req-123" },
                body: JSON.stringify({
                    authEmail: "info@kinkan.travel",
                    to: "valid@example.com",
                    subject: "hello",
                    body: "<p>world</p>",
                    smtpProvider: "gmail",
                }),
            })
        );

        assert.equal(response.statusCode, 200);
        assert.equal(response.body.ok, true);
        assert.equal(response.body.code, "EMAIL_SENT");
        assert.equal(response.body.requestId, "req-123");
        assert.equal(response.body.data.messageId, "msg-1");
        assert.deepEqual(response.body.warnings, []);
    } finally {
        restore();
    }
});

test("handler returns QUOTA_EXCEEDED when quota backend denies request", async () => {
    setRequiredEnv();

    clearProjectModuleCache();

    const restoreMailer = withMockedNodemailer({
        createTransport: () => ({
            verify: async () => undefined,
            sendMail: async () => ({ messageId: "msg-1", response: "accepted" }),
        }),
    });

    const restoreQuota = withMockedProjectModule("lib/quota.js", {
        applyQuotaLimit: async () => ({
            allowed: false,
            statusCode: 429,
            code: "QUOTA_EXCEEDED",
            message: "Quota exceeded for this IP and user-agent fingerprint.",
            data: {
                keyType: "ip_ua",
                exceeded: [{ window: "minute", count: 31, limit: 30 }],
            },
            warnings: [],
        }),
    });

    try {
        const { handler } = require("../index");

        const response = parseResponse(
            await handler({
                requestContext: { requestId: "req-quota" },
                body: JSON.stringify({
                    authEmail: "info@kinkan.travel",
                    to: "valid@example.com",
                    subject: "hello",
                    body: "<p>world</p>",
                    smtpProvider: "gmail",
                }),
            })
        );

        assert.equal(response.statusCode, 429);
        assert.equal(response.body.ok, false);
        assert.equal(response.body.code, "QUOTA_EXCEEDED");
        assert.equal(response.body.requestId, "req-quota");
    } finally {
        restoreQuota();
        restoreMailer();
    }
});
