function createApiResponse(statusCode, payload) {
    return {
        statusCode,
        body: JSON.stringify(payload),
    };
}

function buildPayload({
    ok,
    code,
    message,
    requestId,
    warnings = [],
    data,
    meta,
}) {
    const payload = {
        ok,
        code,
        message,
        requestId,
        warnings,
    };

    if (data !== undefined) {
        payload.data = data;
    }

    if (meta !== undefined) {
        payload.meta = meta;
    }

    return payload;
}

function success({ code, message, requestId, warnings = [], data, meta, statusCode = 200 }) {
    return createApiResponse(
        statusCode,
        buildPayload({ ok: true, code, message, requestId, warnings, data, meta })
    );
}

function failure({ code, message, requestId, warnings = [], data, meta, statusCode = 400 }) {
    return createApiResponse(
        statusCode,
        buildPayload({ ok: false, code, message, requestId, warnings, data, meta })
    );
}

module.exports = {
    success,
    failure,
};