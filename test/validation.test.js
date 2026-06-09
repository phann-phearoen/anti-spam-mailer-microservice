const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { parseEventBody, normalizeInput } = require("../lib/parsing");
const { runValidationPipeline } = require("../lib/validation");
const {
    extractEmailDomain,
    findDisposableRecipients,
    resetDenylistCache,
} = require("../lib/denylist");

const allowFilePath = path.join(__dirname, "..", "data", "disposable_domains_allow.txt");

function baseAntiSpamConfig(overrides = {}) {
    return {
        enabled: true,
        blockOnHeuristics: false,
        disposableDomainCheckEnabled: true,
        blockDisposableDomains: true,
        maxSubjectLength: 200,
        maxBodyLength: 20000,
        maxUnbrokenTextLength: 260,
        maxRecipients: 20,
        warnUrlCount: 3,
        blockUrlCount: 10,
        maxSymbolRatioPercent: 45,
        gibberishMinBodyLength: 120,
        gibberishMinRepeatedChunkLength: 8,
        gibberishMinRepetitions: 6,
        ...overrides,
    };
}

test("parseEventBody parses JSON payload", () => {
    const body = parseEventBody({ body: JSON.stringify({ hello: "world" }) });
    assert.deepEqual(body, { hello: "world" });
});

test("normalizeInput supports comma-separated recipients", () => {
    const normalized = normalizeInput({
        authEmail: "info@kinkan.travel",
        to: "user1@example.com, user2@example.com",
        subject: "Hello",
        body: "<p>Body</p>",
        smtpProvider: "GMAIL",
    });

    assert.equal(normalized.authEmail, "info@kinkan.travel");
    assert.deepEqual(normalized.toRecipients, ["user1@example.com", "user2@example.com"]);
    assert.equal(normalized.smtpProvider, "gmail");
});

test("extractEmailDomain returns domain", () => {
    assert.equal(extractEmailDomain("user@mailinator.com"), "mailinator.com");
    assert.equal(extractEmailDomain("invalid-address"), null);
});

test("denylist matches open-source domain", () => {
    resetDenylistCache();
    const matches = findDisposableRecipients(["user@mailinator.com"]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].domain, "mailinator.com");
});

test("denylist allowlist override bypasses open-source match", () => {
    const originalAllowFile = fs.readFileSync(allowFilePath, "utf8");

    try {
        fs.writeFileSync(allowFilePath, `${originalAllowFile.trim()}\nmailinator.com\n`, "utf8");
        resetDenylistCache();

        const matches = findDisposableRecipients(["user@mailinator.com"]);
        assert.equal(matches.length, 0);
    } finally {
        fs.writeFileSync(allowFilePath, originalAllowFile, "utf8");
        resetDenylistCache();
    }
});

test("validation blocks disposable recipient domain by default", () => {
    const result = runValidationPipeline(
        {
            authEmail: "info@kinkan.travel",
            toRecipients: ["user@mailinator.com"],
            subject: "hello",
            emailBody: "world",
            smtpProvider: "gmail",
        },
        baseAntiSpamConfig()
    );

    assert.equal(result.blocked, true);
    assert.equal(result.reasons[0].code, "DISPOSABLE_RECIPIENT_DOMAIN");
});

test("validation warns instead of block when disposable block is disabled", () => {
    const result = runValidationPipeline(
        {
            authEmail: "info@kinkan.travel",
            toRecipients: ["user@mailinator.com"],
            subject: "hello",
            emailBody: "world",
            smtpProvider: "gmail",
        },
        baseAntiSpamConfig({ blockDisposableDomains: false })
    );

    assert.equal(result.blocked, false);
    assert.equal(
        result.warnings.some((warning) => warning.code === "WARN_DISPOSABLE_RECIPIENT_DOMAIN"),
        true
    );
});

test("validation adds warning for suspicious spam-like token patterns", () => {
    const result = runValidationPipeline(
        {
            authEmail: "info@kinkan.travel",
            toRecipients: ["user@example.com"],
            subject: "Act now for guaranteed profit",
            emailBody: "Limited time offer, click here now.",
            smtpProvider: "gmail",
        },
        baseAntiSpamConfig({
            disposableDomainCheckEnabled: false,
        })
    );

    assert.equal(result.blocked, false);
    assert.equal(
        result.warnings.some((warning) => warning.code === "WARN_SUSPICIOUS_TOKENS"),
        true
    );
});

test("validation adds warning for repeated punctuation", () => {
    const result = runValidationPipeline(
        {
            authEmail: "info@kinkan.travel",
            toRecipients: ["user@example.com"],
            subject: "Deal!!!!!!",
            emailBody: "Get this now!!!!!!",
            smtpProvider: "gmail",
        },
        baseAntiSpamConfig({
            disposableDomainCheckEnabled: false,
        })
    );

    assert.equal(result.blocked, false);
    assert.equal(
        result.warnings.some((warning) => warning.code === "WARN_REPEATED_PUNCTUATION"),
        true
    );
});

test("validation warns for high link count without blocking when heuristic blocking is disabled", () => {
    const emailBody = [
        "https://a.example.com",
        "https://b.example.com",
        "https://c.example.com",
        "https://d.example.com",
    ].join(" ");

    const result = runValidationPipeline(
        {
            authEmail: "info@kinkan.travel",
            toRecipients: ["user@example.com"],
            subject: "Links",
            emailBody,
            smtpProvider: "gmail",
        },
        baseAntiSpamConfig({
            disposableDomainCheckEnabled: false,
            warnUrlCount: 3,
            blockUrlCount: 3,
            blockOnHeuristics: false,
        })
    );

    assert.equal(result.blocked, false);
    assert.equal(
        result.warnings.some((warning) => warning.code === "WARN_HIGH_URL_COUNT"),
        true
    );
});

test("validation blocks excessive links when heuristic blocking is enabled", () => {
    const emailBody = [
        "https://a.example.com",
        "https://b.example.com",
        "https://c.example.com",
        "https://d.example.com",
    ].join(" ");

    const result = runValidationPipeline(
        {
            authEmail: "info@kinkan.travel",
            toRecipients: ["user@example.com"],
            subject: "Links",
            emailBody,
            smtpProvider: "gmail",
        },
        baseAntiSpamConfig({
            disposableDomainCheckEnabled: false,
            warnUrlCount: 2,
            blockUrlCount: 3,
            blockOnHeuristics: true,
        })
    );

    assert.equal(result.blocked, true);
    assert.equal(
        result.reasons.some((reason) => reason.code === "BLOCK_EXCESSIVE_LINKS"),
        true
    );
});

test("validation blocks repeated gibberish chunk pattern", () => {
    const repeatedChunk = "NS:IEUHosghvnosduxehgvo";
    const emailBody = repeatedChunk.repeat(18);

    const result = runValidationPipeline(
        {
            authEmail: "info@kinkan.travel",
            toRecipients: ["user@example.com"],
            subject: "message",
            emailBody,
            smtpProvider: "gmail",
        },
        baseAntiSpamConfig({
            disposableDomainCheckEnabled: false,
        })
    );

    assert.equal(result.blocked, true);
    assert.equal(
        result.reasons.some((reason) => reason.code === "GIBBERISH_REPEATED_PATTERN"),
        true
    );
});

test("validation does not block normal Japanese template text", () => {
    const emailBody = "お問い合わせありがとうございます。ご予約内容を確認の上、担当者より折り返しご連絡いたします。";

    const result = runValidationPipeline(
        {
            authEmail: "info@kinkan.travel",
            toRecipients: ["user@example.com"],
            subject: "ご予約確認",
            emailBody,
            smtpProvider: "gmail",
        },
        baseAntiSpamConfig({
            disposableDomainCheckEnabled: false,
        })
    );

    assert.equal(result.blocked, false);
    assert.equal(
        result.reasons.some((reason) => reason.code === "GIBBERISH_REPEATED_PATTERN"),
        false
    );
});

test("validation blocks very long unbroken body text", () => {
    const emailBody = "A".repeat(320);

    const result = runValidationPipeline(
        {
            authEmail: "info@kinkan.travel",
            toRecipients: ["user@example.com"],
            subject: "no breaks",
            emailBody,
            smtpProvider: "gmail",
        },
        baseAntiSpamConfig({
            disposableDomainCheckEnabled: false,
            maxUnbrokenTextLength: 260,
        })
    );

    assert.equal(result.blocked, true);
    assert.equal(
        result.reasons.some((reason) => reason.code === "LONG_UNBROKEN_TEXT"),
        true
    );
});

test("validation allows long Japanese body when line breaks are present", () => {
    const line = "お問い合わせありがとうございます。ご予約内容を確認の上、担当者より折り返しご連絡いたします。";
    const emailBody = `${line}\n${line}\n${line}\n${line}`;

    const result = runValidationPipeline(
        {
            authEmail: "info@kinkan.travel",
            toRecipients: ["user@example.com"],
            subject: "ご予約確認",
            emailBody,
            smtpProvider: "gmail",
        },
        baseAntiSpamConfig({
            disposableDomainCheckEnabled: false,
            maxUnbrokenTextLength: 120,
        })
    );

    assert.equal(result.blocked, false);
});

test("validation does not block normal HTML inquiry template", () => {
    const emailBody = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #FF8100;">下記、お問い合わせがありました。<br/>対応してください。</h2>
      <p>---------------------------------------------------</p>
      <p>Last Name： Phearoen</p>
      <p>Email Address： [phearoen.p@wannagrow.co.jp](mailto:phearoen.p@wannagrow.co.jp)</p>
      <p>Nationality： Cambodia</p>
      <p>Preferred Dates： 2026/06/27</p>
      <p>Inquiry Details： Hello, this is a test message.</p>
      <p>---------------------------------------------------</p>
      <p>※Kinkan Tripより自動で送信されています。</p>
    </div>`;

    const result = runValidationPipeline(
        {
            authEmail: "info@kinkan.travel",
            toRecipients: ["user@example.com"],
            subject: "お問い合わせ",
            emailBody,
            smtpProvider: "gmail",
        },
        baseAntiSpamConfig({
            disposableDomainCheckEnabled: false,
        })
    );

    assert.equal(result.blocked, false);
    assert.equal(
        result.reasons.some((reason) => reason.code === "GIBBERISH_REPEATED_PATTERN"),
        false
    );
});