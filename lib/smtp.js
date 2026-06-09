function buildTransportConfig({ smtpProvider, authEmail, password }) {
    switch (smtpProvider) {
        case "zoho":
            return {
                host: "smtp.zoho.com",
                port: 465,
                secure: true,
                auth: {
                    user: authEmail,
                    pass: password,
                },
            };
        case "gmail":
        default:
            return {
                service: "gmail",
                auth: {
                    user: authEmail,
                    pass: password,
                },
            };
    }
}

async function verifyTransporter(transporter) {
    await transporter.verify();
}

module.exports = {
    buildTransportConfig,
    verifyTransporter,
};