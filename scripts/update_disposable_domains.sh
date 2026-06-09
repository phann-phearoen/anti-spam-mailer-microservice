#!/usr/bin/env zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_FILE="$ROOT_DIR/data/disposable_domains_base.txt"
SOURCE_URL="https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.txt"

echo "Updating disposable domain list from upstream..."
curl -fsSL "$SOURCE_URL" -o "$TARGET_FILE"
echo "Updated $(wc -l < "$TARGET_FILE" | tr -d ' ') domains in $TARGET_FILE"
