#!/usr/bin/env bash
# Phase 1 secrets-scan test case: confirms no committed credentials.
# Deliberately dependency-free (no external scanner install required) so it
# runs the same way in this sandbox and in CI. Looks for common
# credential-shaped patterns in tracked files, excluding known-safe files.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PATTERN='(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----|xox[baprs]-[0-9A-Za-z-]{10,}|(secret|api|access)_?key["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9/+=_-]{16,}["'"'"'])'

MATCHES=$(git grep -InE "$PATTERN" -- . ':!*.example' ':!scripts/secrets-scan.sh' || true)

if [ -n "$MATCHES" ]; then
  echo "Potential committed credential found:"
  echo "$MATCHES"
  exit 1
fi

echo "Secrets scan: no committed credentials found."
