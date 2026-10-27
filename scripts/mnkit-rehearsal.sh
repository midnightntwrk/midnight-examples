#!/usr/bin/env bash
# This file is part of mn-examples.
# Copyright (C) Midnight Foundation
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# You may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Publish rehearsal for mnkit, before the real npm publish:
#
#   scripts/mnkit-rehearsal.sh [--devnet] [fixture ...]
#
# Starts a throwaway Verdaccio registry on localhost, publishes mnkit and the
# three runtime packages to it with `npm publish`, then runs
# scripts/mnkit-e2e.sh --from-registry against it: `npx mnkit@<version> init`
# and the `^<version>` ranges it writes resolve exactly as they will on npm.
# Every other package is proxied from registry.npmjs.org.
#
# Your npm config is neither read nor written: npm uses user and global
# config files in the work dir, which set the registry, the @midnight-ntwrk
# scope registry and the publish token (a dummy, Verdaccio accepts anonymous
# publishes here). npm takes a scoped package's registry from a scope line
# before --registry, so a `@midnight-ntwrk:registry` line in ~/.npmrc would
# otherwise send the publishes to the real npm. The npm cache is a fresh one
# in the work dir too, so no rehearsal tarball lands in your own cache.
# Verdaccio is stopped on exit. MNKIT_E2E_DIR picks the work dir (default: a
# temp dir).

set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
VERDACCIO_VERSION=6.10.5
PORT=${MNKIT_REHEARSAL_PORT:-4873}
REGISTRY="http://localhost:$PORT/"

WORK=${MNKIT_E2E_DIR:-$(mktemp -d -t mnkit-rehearsal-XXXXXX)}
WORK=$(mkdir -p "$WORK" && cd "$WORK" && pwd)
case "$WORK/" in
  "$REPO"/*) echo "✖ MNKIT_E2E_DIR ($WORK) is inside the repo; use a directory outside it." >&2; exit 1 ;;
esac
VERSION=$(node -p "require('$REPO/packages/mnkit/package.json').version")

mkdir -p "$WORK/verdaccio"
cat > "$WORK/verdaccio/config.yaml" <<EOF
storage: $WORK/verdaccio/storage
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  'mnkit':
    access: \$all
    publish: \$anonymous
  '@midnight-ntwrk/mnkit-*':
    access: \$all
    publish: \$anonymous
  '**':
    access: \$all
    proxy: npmjs
log: { type: stdout, format: pretty, level: warn }
EOF

cat > "$WORK/npmrc" <<EOF
registry=$REGISTRY
@midnight-ntwrk:registry=$REGISTRY
//localhost:$PORT/:_authToken=rehearsal
EOF
: > "$WORK/npmrc-global"
export NPM_CONFIG_USERCONFIG="$WORK/npmrc" NPM_CONFIG_GLOBALCONFIG="$WORK/npmrc-global"
export npm_config_cache="$WORK/npm-cache"
echo "▶ verdaccio@$VERDACCIO_VERSION on $REGISTRY (storage in $WORK/verdaccio)"
# In its own process group, so stopping it also stops the server npx starts.
# Verdaccio itself comes from npm: the rehearsal registry isn't up yet.
setsid npx --yes --registry https://registry.npmjs.org/ "verdaccio@$VERDACCIO_VERSION" --config "$WORK/verdaccio/config.yaml" --listen "$PORT" \
  > "$WORK/verdaccio/verdaccio.log" 2>&1 &
VERDACCIO_PID=$!
trap 'kill -- "-$VERDACCIO_PID" 2>/dev/null || true' EXIT
for i in $(seq 1 60); do
  curl -sf "${REGISTRY}-/ping" > /dev/null && break
  kill -0 "$VERDACCIO_PID" 2>/dev/null || { cat "$WORK/verdaccio/verdaccio.log" >&2; echo "✖ verdaccio exited" >&2; exit 1; }
  sleep 1
done
curl -sf "${REGISTRY}-/ping" > /dev/null || { echo "✖ verdaccio did not start" >&2; exit 1; }

# Runtime packages first, as the release workflow does.
for p in sim coins fast-sync mnkit; do
  echo "▶ npm publish packages/$p → $REGISTRY"
  (cd "$REPO/packages/$p" && npm publish --access public)
done

MNKIT_E2E_DIR="$WORK" bash "$REPO/scripts/mnkit-e2e.sh" --from-registry "$VERSION" "$@"

# What each project got from where: our packages from the rehearsal registry,
# the rest from npm through it.
for lock in "$WORK"/*/package-lock.json; do
  [ -f "$lock" ] || continue
  echo
  echo "Resolved in $lock:"
  node -e '
    const lock = require(process.argv[1]);
    for (const [k, v] of Object.entries(lock.packages)) {
      if (/node_modules\/(mnkit|@midnight-ntwrk\/mnkit-[a-z]+)$/.test(k)) console.log(`  ${k.replace(/.*node_modules\//, "")}@${v.version}  ${v.resolved}`);
    }' "$lock"
done
echo "✔ rehearsal passed: mnkit@$VERSION installs and works from a registry"
