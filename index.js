const nodemailer = require('nodemailer');
const { APP_CONFIG } = require('./lib/config');
const { parseEventBody, normalizeInput } = require('./lib/parsing');
const { extractRequestMetadata } = require('./lib/metadata');
const { runValidationPipeline } = require('./lib/validation');
const { authorizeSender } = require('./lib/auth');
const { buildTransportConfig, verifyTransporter } = require('./lib/smtp');
const { sendWithRetry } = require('./lib/send');
const { success, failure } = require('./lib/response');
const { applyQuotaLimit } = require('./lib/quota');

const AUTH_CREDENTIALS = {
    "info@kinkan.travel": process.env.KINKAN_PASSWORD,
    "date@wannagrow.co.jp": process.env.WG_PASSWORD,
    "business@rsf-1.co.jp": process.env.RSF_PASSWORD,
    "kokotag@mama-ranger.com": process.env.KOKOTAG_PASSWORD,
    "business@exrise-project.co.jp": process.env.EXRISE_PASSWORD,
};

exports.handler = async (event) => {
    const metadata = extractRequestMetadata(event);
    let parsedBody;

    try {
        parsedBody = parseEventBody(event);
    } catch (error) {
        return failure({
            statusCode: 400,
            code: 'INVALID_JSON',
            message: 'Invalid JSON format.',
            requestId: metadata.requestId,
        });
    }

    const input = normalizeInput(parsedBody);

    const validation = runValidationPipeline(input, APP_CONFIG.antiSpam);
    const warnings = [...validation.warnings];

    if (validation.blocked) {
        return failure({
            statusCode: 400,
            code: 'INVALID_REQUEST',
            message: 'Validation failed.',
            requestId: metadata.requestId,
            warnings,
            data: {
                reasons: validation.reasons,
            },
            meta: APP_CONFIG.response.includeDebugMeta ? metadata : undefined,
        });
    }

    const authResult = authorizeSender(input.authEmail, AUTH_CREDENTIALS);

    if (!authResult.authorized) {
        return failure({
            statusCode: 403,
            code: 'UNAUTHORIZED_SENDER',
            message: 'Unauthorized sender email.',
            requestId: metadata.requestId,
            warnings,
            meta: APP_CONFIG.response.includeDebugMeta ? metadata : undefined,
        });
    }

    const quotaResult = await applyQuotaLimit(
        {
            metadata,
        },
        APP_CONFIG.quota
    );

    if (quotaResult.warnings && quotaResult.warnings.length > 0) {
        warnings.push(...quotaResult.warnings);
    }

    if (!quotaResult.allowed) {
        return failure({
            statusCode: quotaResult.statusCode || 429,
            code: quotaResult.code || 'QUOTA_EXCEEDED',
            message: quotaResult.message || 'Quota exceeded.',
            requestId: metadata.requestId,
            warnings,
            data: quotaResult.data,
            meta: APP_CONFIG.response.includeDebugMeta ? metadata : undefined,
        });
    }

    const transporterConfig = buildTransportConfig({
        smtpProvider: input.smtpProvider,
        authEmail: input.authEmail,
        password: authResult.password,
    });

    const transporter = nodemailer.createTransport(transporterConfig);

    try {
        await verifyTransporter(transporter);
    } catch (error) {
        console.error('Transporter verification failed:', error.message);
        return failure({
            statusCode: 500,
            code: 'SMTP_VERIFY_FAILED',
            message: 'SMTP verification failed.',
            requestId: metadata.requestId,
            warnings,
            meta: APP_CONFIG.response.includeDebugMeta ? metadata : undefined,
        });
    }

    const mailOptions = {
        from: input.authEmail,
        to: input.to,
        subject: input.subject,
        html: input.emailBody,
    };

    let sendResult;
    try {
        sendResult = await sendWithRetry(transporter, mailOptions, APP_CONFIG.retry);
    } catch (error) {
        console.error('Failed to send email after retries:', error.message);
        return failure({
            statusCode: 500,
            code: 'SEND_FAILED',
            message: 'Failed to send email after retries.',
            requestId: metadata.requestId,
            warnings,
            meta: APP_CONFIG.response.includeDebugMeta ? metadata : undefined,
        });
    }

    if (sendResult.status === 'sent') {
        console.log(`Email sent from ${input.authEmail} via ${input.smtpProvider}:`, sendResult.info.response);
        return success({
            statusCode: 200,
            code: 'EMAIL_SENT',
            message: 'Email sent successfully.',
            requestId: metadata.requestId,
            warnings,
            data: {
                messageId: sendResult.info.messageId,
            },
            meta: APP_CONFIG.response.includeDebugMeta ? metadata : undefined,
        });
    }

    console.warn('No messageId but info exists:', sendResult.info);
    return success({
        statusCode: 202,
        code: 'EMAIL_ACCEPTED_UNCERTAIN',
        message: 'Email likely sent, but response was unclear.',
        requestId: metadata.requestId,
        warnings,
        data: {
            providerResponse: sendResult.info ? sendResult.info.response : null,
        },
        meta: APP_CONFIG.response.includeDebugMeta ? metadata : undefined,
    });
};