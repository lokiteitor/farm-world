#!/usr/bin/env bash
#
# Synchronises shared/ into the two consuming projects.
#
# shared/ at the repository root is the single source of truth (plan section 4).
# The copies are generated, listed in .gitignore and never edited by hand. The
# known risk of this option — copies drifting from the source — is mitigated by
# making this script a prerequisite of the dev, build, test and lint targets, and
# by check-shared-sync.sh failing in CI when a copy differs.
#
# Tests of the shared rules run only against the source, never against a copy, so
# __tests__ and test files are deliberately excluded from the destinations.

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
    # Regenerated below on every run; excluded so --delete does not fight it.
    --exclude='README.md'
)

if ! command -v rsync >/dev/null 2>&1; then
    echo "sync-shared-types: rsync is required and was not found in PATH." >&2
    echo "  Debian/Ubuntu: sudo apt-get install rsync" >&2
    exit 1
fi

if [[ ! -d "${SOURCE}" ]]; then
    echo "sync-shared-types: ${SOURCE} does not exist." >&2
    exit 1
fi

for destination in "${DESTINATIONS[@]}"; do
    # Guard against a mistyped path: --delete on the wrong directory would erase
    # hand-written source.
    if [[ "${destination}" != */shared ]]; then
        echo "sync-shared-types: refusing to write to ${destination}." >&2
        exit 1
    fi

    mkdir -p "${destination}"
    rsync -rt --delete "${EXCLUDES[@]}" "${SOURCE}/" "${destination}/"

    relative="${destination#"${ROOT}/"}"
    cat >"${destination}/README.md" <<EOF
<!-- GENERATED FILE — DO NOT EDIT -->

# ${relative} (fichero generado, no editar)

Copia sincronizada de \`shared/\`, producida por \`scripts/sync-shared-types.sh\`
(objetivo \`make sync-types\`). El directorio esta en \`.gitignore\`.

Cualquier cambio hecho aqui se pierde en la siguiente sincronizacion y hace
fallar \`make check-sync\`. La fuente de verdad es \`shared/\` en la raiz del
repositorio.

Las pruebas de las reglas compartidas se ejecutan solo sobre el origen, por lo
que \`__tests__/\` y los ficheros \`*.test.ts\` no se copian.
EOF

    file_count="$(find "${destination}" -type f -name '*.ts' | wc -l | tr -d ' ')"
    echo "sync-shared-types: ${relative} <- shared/ (${file_count} ficheros .ts)"
done
