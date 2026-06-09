const fs = require("fs");
const path = require("path");

const BASE_LIST_FILE = path.join(__dirname, "..", "data", "disposable_domains_base.txt");
const CUSTOM_BLOCK_FILE = path.join(__dirname, "..", "data", "custom_disposable_domains_block.txt");
const CUSTOM_ALLOW_FILE = path.join(__dirname, "..", "data", "disposable_domains_allow.txt");

let cachedDenylist = null;

function parseDomainFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }

    const content = fs.readFileSync(filePath, "utf8");
    return content
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line && !line.startsWith("#"));
}

function buildDenylist() {
    const baseDomains = parseDomainFile(BASE_LIST_FILE);
    const customBlocked = parseDomainFile(CUSTOM_BLOCK_FILE);
    const customAllowed = new Set(parseDomainFile(CUSTOM_ALLOW_FILE));

    const merged = new Set([...baseDomains, ...customBlocked]);
    for (const allowed of customAllowed) {
        merged.delete(allowed);
    }

    return merged;
}

function getDenylist() {
    if (!cachedDenylist) {
        cachedDenylist = buildDenylist();
    }
    return cachedDenylist;
}

function extractEmailDomain(email) {
    if (typeof email !== "string") {
        return null;
    }

    const parts = email.toLowerCase().split("@");
    if (parts.length !== 2) {
        return null;
    }

    return parts[1].trim() || null;
}

function findDisposableRecipients(recipients) {
    const denylist = getDenylist();
    const matches = [];

    for (const recipient of recipients) {
        const domain = extractEmailDomain(recipient);
        if (domain && denylist.has(domain)) {
            matches.push({
                email: recipient,
                domain,
            });
        }
    }

    return matches;
}

function resetDenylistCache() {
    cachedDenylist = null;
}

module.exports = {
    extractEmailDomain,
    findDisposableRecipients,
    resetDenylistCache,
};