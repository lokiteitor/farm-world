#!/usr/bin/env bash
#
# Fails with a non-zero status when a copy of shared/ differs from the source.
#
# This is the CI half of the mitigation described in plan section 4: sync-types
# keeps the copies fresh locally, and this check makes drift impossible to merge.
# The comparison uses the same exclusion list as the synchronisation, so the two
# scripts cannot disagree about what "in sync" means.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${ROOT}/shared"
DESTINATIONS=(
    "${ROOT}/backend/src/shared"
    "${ROOT}/frontend/app/shared"
)

EXCLUDES=(
    --exclude='node_modules/'
    --exclude='package.json'
    --exclude='package-lock.json'
    --exclude='tsconfig.json'
    --exclude='vitest.config.ts'
    --exclude='__tests__/'
    --exclude='*.test.ts'
    --exclude='*.spec.ts'
    --exclude='coverage/'
    --exclude='*.tsbuildinfo'
    --exclude='README.md'
)

if ! command -v rsync >/dev/null 2>&1; then
    echo "check-shared-sync: rsync is required and was not found in PATH." >&2
    exit 1
fi

status=0

for destination in "${DESTINATIONS[@]}"; do
    relative="${destination#"${ROOT}/"}"

    if [[ ! -d "${destination}" ]]; then
        echo "check-shared-sync: ${relative} does not exist. Run 'make sync-types'." >&2
        status=1
        continue
    fi

    # Dry run with content checksums. Itemised lines that start with a dot are
    # attribute-only differences and are not drift; anything else is.
    drift="$(
        rsync -rn --checksum --delete --itemize-changes \
            "${EXCLUDES[@]}" "${SOURCE}/" "${destination}/" |
            grep -v '^\.' || true
    )"

    if [[ -n "${drift}" ]]; then
        echo "check-shared-sync: ${relative} is out of sync with shared/:" >&2
        echo "${drift}" | sed 's/^/    /' >&2
        status=1
    else
        echo "check-shared-sync: ${relative} is in sync"
    fi
done

if [[ "${status}" -ne 0 ]]; then
    echo "" >&2
    echo "Run 'make sync-types' and commit nothing from the copies: they are generated." >&2
fi

exit "${status}"
