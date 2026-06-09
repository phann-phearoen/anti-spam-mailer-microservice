const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /https?:\/\/[^\s"'<>]+/gi;
const { findDisposableRecipients } = require("./denylist");

const SUSPICIOUS_PATTERNS = [
    /act\s+now/i,
    /limited\s+time/i,
    /urgent\s+transfer/i,
    /verify\s+your\s+account/i,
    /crypto/i,
    /guaranteed\s+profit/i,
    /click\s+here/i,
];

function stripHtml(input) {
    return input.replace(/<[^>]*>/g, " ");
}

function countSymbolRatioPercent(input) {
    const compact = input.replace(/\s+/g, "");
    if (!compact.length) {
        return 0;
    }

    const symbolMatches = compact.match(/[^a-zA-Z0-9]/g) || [];
    return Math.round((symbolMatches.length / compact.length) * 100);
}

function detectRepeatedChunkSpam(input, antiSpamConfig) {
    const minBodyLength = antiSpamConfig.gibberishMinBodyLength || 120;
    const minChunkLength = antiSpamConfig.gibberishMinRepeatedChunkLength || 8;
    const minRepetitions = antiSpamConfig.gibberishMinRepetitions || 6;

    if (!input || input.length < minBodyLength) {
        return null;
    }

    const plainText = stripHtml(input).replace(/&nbsp;/gi, " ");
    const compact = plainText.replace(/\s+/g, "");
    if (compact.length < minBodyLength) {
        return null;
    }

    const maxChunkLength = Math.min(80, Math.floor(compact.length / minRepetitions));
    if (maxChunkLength < minChunkLength) {
        return null;
    }

    for (let chunkLength = minChunkLength; chunkLength <= maxChunkLength; chunkLength += 1) {
        let consecutiveRepeats = 1;

        for (let i = chunkLength; i + chunkLength <= compact.length; i += chunkLength) {
            const previous = compact.slice(i - chunkLength, i);
            const current = compact.slice(i, i + chunkLength);

            if (previous === current) {
                consecutiveRepeats += 1;

                if (consecutiveRepeats >= minRepetitions) {
                    const alnumCount = (current.match(/[\p{L}\p{N}]/gu) || []).length;
                    const alnumRatio = alnumCount / current.length;

                    if (alnumRatio < 0.6) {
                        continue;
                    }

                    return {
                        chunkLength,
                        repetitions: consecutiveRepeats,
                    };
                }
            } else {
                consecutiveRepeats = 1;
            }
        }
    }

    return null;
}

function getLongestUnbrokenSegmentLength(input) {
    const plainText = stripHtml(input || "").replace(/&nbsp;/gi, " ").trim();
    if (!plainText) {
        return 0;
    }

    const segments = plainText.split(/\s+/).filter(Boolean);
    let maxLength = 0;

    for (const segment of segments) {
        if (segment.length > maxLength) {
            maxLength = segment.length;
        }
    }

    return maxLength;
}

function validateRequiredFields(input) {
    const reasons = [];

    if (!input.authEmail) {
        reasons.push({ code: "MISSING_AUTH_EMAIL", message: "authEmail is required." });
    }
    if (!input.toRecipients.length) {
        reasons.push({ code: "MISSING_RECIPIENT", message: "At least one recipient is required." });
    }
    if (!input.subject) {
        reasons.push({ code: "MISSING_SUBJECT", message: "subject is required." });
    }
    if (!input.emailBody) {
        reasons.push({ code: "MISSING_BODY", message: "body is required." });
    }

    return {
        ok: reasons.length === 0,
        reasons,
    };
}

function validateEmailFields(input, antiSpamConfig) {
    const reasons = [];
    const warnings = [];

    if (!EMAIL_REGEX.test(input.authEmail)) {
        reasons.push({ code: "INVALID_AUTH_EMAIL", message: "authEmail format is invalid." });
    }

    for (const recipient of input.toRecipients) {
        if (!EMAIL_REGEX.test(recipient)) {
            reasons.push({ code: "INVALID_RECIPIENT_EMAIL", message: `Invalid recipient email: ${recipient}` });
        }
    }

    if (input.toRecipients.length > antiSpamConfig.maxRecipients) {
        reasons.push({
            code: "TOO_MANY_RECIPIENTS",
            message: `Recipient count exceeds limit (${antiSpamConfig.maxRecipients}).`,
        });
    }

    if (antiSpamConfig.disposableDomainCheckEnabled) {
        const disposableMatches = findDisposableRecipients(input.toRecipients);
        if (disposableMatches.length > 0) {
            const disposableDomains = [...new Set(disposableMatches.map((match) => match.domain))];
            const message = `Disposable recipient domains detected: ${disposableDomains.join(", ")}.`;

            if (antiSpamConfig.blockDisposableDomains) {
                reasons.push({
                    code: "DISPOSABLE_RECIPIENT_DOMAIN",
                    message,
                });
            } else {
                warnings.push({
                    code: "WARN_DISPOSABLE_RECIPIENT_DOMAIN",
                    message,
                });
            }
        }
    }

    const uniqueDomains = new Set(
        input.toRecipients.map((recipient) => recipient.split("@")[1]).filter(Boolean)
    );

    if (uniqueDomains.size >= 5) {
        warnings.push({
            code: "WARN_HIGH_DOMAIN_DIVERSITY",
            message: "Recipients span many different domains.",
        });
    }

    const suspiciousAddressRecipients = input.toRecipients.filter((recipient) => {
        const [localPart] = recipient.split("@");
        if (!localPart) {
            return false;
        }

        const normalizedLocalPart = localPart.toLowerCase();
        const digitCount = (normalizedLocalPart.match(/\d/g) || []).length;
        const hasSuspiciousToken = /(temp|fake|spam|noreply|asdf|qwer|test123)/i.test(normalizedLocalPart);
        const hasHighDigitRatio = normalizedLocalPart.length >= 8 && (digitCount / normalizedLocalPart.length) > 0.5;

        return hasSuspiciousToken || hasHighDigitRatio;
    });

    if (suspiciousAddressRecipients.length > 0) {
        warnings.push({
            code: "WARN_SUSPICIOUS_RECIPIENT_ADDRESS",
            message: "Some recipient addresses look suspicious based on local-part patterns.",
        });
    }

    return {
        blocked: reasons.length > 0,
        reasons,
        warnings,
    };
}

function validateTextFields(input, antiSpamConfig) {
    const reasons = [];

    if (input.subject.length > antiSpamConfig.maxSubjectLength) {
        reasons.push({
            code: "SUBJECT_TOO_LONG",
            message: `subject exceeds max length (${antiSpamConfig.maxSubjectLength}).`,
        });
    }

    if (input.emailBody.length > antiSpamConfig.maxBodyLength) {
        reasons.push({
            code: "BODY_TOO_LONG",
            message: `body exceeds max length (${antiSpamConfig.maxBodyLength}).`,
        });
    }

    const longestUnbrokenLength = getLongestUnbrokenSegmentLength(input.emailBody);
    if (longestUnbrokenLength > antiSpamConfig.maxUnbrokenTextLength) {
        reasons.push({
            code: "LONG_UNBROKEN_TEXT",
            message: `body contains an unbroken text segment that exceeds ${antiSpamConfig.maxUnbrokenTextLength} characters.`,
        });
    }

    const repeatedChunkMatch = detectRepeatedChunkSpam(input.emailBody, antiSpamConfig);
    if (repeatedChunkMatch) {
        reasons.push({
            code: "GIBBERISH_REPEATED_PATTERN",
            message: `body contains repeated chunk patterns (${repeatedChunkMatch.repetitions} repetitions, chunk length ${repeatedChunkMatch.chunkLength}).`,
        });
    }

    return {
        blocked: reasons.length > 0,
        reasons,
    };
}

function evaluateHeuristics(input, antiSpamConfig) {
    const warnings = [];
    const reasons = [];

    const urlMatches = input.emailBody.match(URL_REGEX) || [];
    if (urlMatches.length > antiSpamConfig.warnUrlCount) {
        warnings.push({
            code: "WARN_HIGH_URL_COUNT",
            message: `Email body includes ${urlMatches.length} links.`,
        });
    }
    if (urlMatches.length > antiSpamConfig.blockUrlCount) {
        reasons.push({
            code: "BLOCK_EXCESSIVE_LINKS",
            message: `Email body includes too many links (${urlMatches.length}).`,
        });
    }

    const normalizedText = `${input.subject} ${stripHtml(input.emailBody)}`;
    const symbolRatioPercent = countSymbolRatioPercent(normalizedText);

    if (symbolRatioPercent > antiSpamConfig.maxSymbolRatioPercent) {
        warnings.push({
            code: "WARN_HIGH_SYMBOL_RATIO",
            message: `Input contains elevated symbol density (${symbolRatioPercent}%).`,
        });
    }

    if (/([!?$#*])\1{5,}/.test(normalizedText)) {
        warnings.push({
            code: "WARN_REPEATED_PUNCTUATION",
            message: "Input contains repeated punctuation patterns.",
        });
    }

    const matchedPatterns = SUSPICIOUS_PATTERNS.filter((pattern) => pattern.test(normalizedText));
    if (matchedPatterns.length > 0) {
        warnings.push({
            code: "WARN_SUSPICIOUS_TOKENS",
            message: "Input matched suspicious token patterns.",
        });
    }

    const blocked = antiSpamConfig.blockOnHeuristics && reasons.length > 0;

    return {
        blocked,
        reasons,
        warnings,
    };
}

function runValidationPipeline(input, antiSpamConfig) {
    const requiredResult = validateRequiredFields(input);
    if (!requiredResult.ok) {
        return {
            blocked: true,
            reasons: requiredResult.reasons,
            warnings: [],
        };
    }

    const textResult = validateTextFields(input, antiSpamConfig);
    if (textResult.blocked) {
        return {
            blocked: true,
            reasons: textResult.reasons,
            warnings: [],
        };
    }

    const emailResult = validateEmailFields(input, antiSpamConfig);
    if (emailResult.blocked) {
        return {
            blocked: true,
            reasons: emailResult.reasons,
            warnings: emailResult.warnings,
        };
    }

    if (!antiSpamConfig.enabled) {
        return {
            blocked: false,
            reasons: [],
            warnings: emailResult.warnings,
        };
    }

    const heuristicResult = evaluateHeuristics(input, antiSpamConfig);

    return {
        blocked: heuristicResult.blocked,
        reasons: heuristicResult.reasons,
        warnings: [...emailResult.warnings, ...heuristicResult.warnings],
    };
}

module.exports = {
    runValidationPipeline,
};