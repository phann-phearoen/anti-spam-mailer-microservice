function parseEventBody(event) {
    if (!event || typeof event.body !== "string") {
        throw new Error("INVALID_JSON");
    }

    return JSON.parse(event.body);
}

function normalizeToRecipients(to) {
    if (Array.isArray(to)) {
        return to
            .filter((value) => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean);
    }

    if (typeof to === "string") {
        return to
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
    }

    return [];
}

function normalizeInput(rawBody) {
    const authEmail = typeof rawBody.authEmail === "string" ? rawBody.authEmail.trim() : "";
    const toRecipients = normalizeToRecipients(rawBody.to);
    const subject = typeof rawBody.subject === "string" ? rawBody.subject.trim() : "";
    const emailBody = typeof rawBody.body === "string" ? rawBody.body.trim() : "";
    const smtpProvider =
        typeof rawBody.smtpProvider === "string" && rawBody.smtpProvider.trim()
            ? rawBody.smtpProvider.trim().toLowerCase()
            : "gmail";

    return {
        authEmail,
        toRecipients,
        to: toRecipients.join(", "),
        subject,
        emailBody,
        smtpProvider,
    };
}

module.exports = {
    parseEventBody,
    normalizeInput,
};