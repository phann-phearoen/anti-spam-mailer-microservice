function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(transporter, mailOptions, retryConfig) {
    const retries = retryConfig.count;
    const baseBackoffMs = retryConfig.baseBackoffMs;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const info = await transporter.sendMail(mailOptions);

            if (info && info.messageId) {
                return {
                    status: "sent",
                    info,
                };
            }

            return {
                status: "uncertain",
                info,
            };
        } catch (error) {
            if (attempt === retries) {
                throw error;
            }

            await wait(baseBackoffMs * (attempt + 1));
        }
    }

    return {
        status: "uncertain",
        info: null,
    };
}

module.exports = {
    sendWithRetry,
};