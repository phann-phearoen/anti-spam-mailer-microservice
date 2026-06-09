function authorizeSender(authEmail, credentialsMap) {
    const password = credentialsMap[authEmail];

    if (!password) {
        return {
            authorized: false,
            password: null,
        };
    }

    return {
        authorized: true,
        password,
    };
}

module.exports = {
    authorizeSender,
};