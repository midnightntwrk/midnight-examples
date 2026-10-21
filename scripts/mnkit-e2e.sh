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

# mnkit end to end, as a user gets it, before anything is on npm:
#
#   scripts/mnkit-e2e.sh [--devnet] [--from-registry <version>] [fixture ...]
#
# Packs mnkit and the three runtime packages with `npm pack`, then for each
# fixture under packages/mnkit/test/fixtures (default: hello-world and
# private-tip-jar, the ones with completed tests; see its README) runs the
# packed CLI in a directory outside the repo:
#
#   mnkit init → copy the fixture's contracts in → compile:fast → derive twice
#   (the second run must change nothing) → copy the fixture's completed files
#   (overlay/) in → typecheck → test:sim → with --devnet, validate (compile,
#   local network, DUST, test:local)
#
# MNKIT_LOCAL_PACKAGES points init at the tarballs. --from-registry <version>
# skips the packing and runs `npx mnkit@<version>` from whatever registry npm
# is configured for: npm itself after a release (the release workflow's smoke
# test), or a local one (scripts/mnkit-rehearsal.sh). The work dir must be
# outside the repo: Node resolves packages by walking up, so a project inside
# the repo would pick up the monorepo's node_modules and hide missing deps.
# Set MNKIT_E2E_DIR to choose it (default: a new temp dir), e.g. CI's
# $RUNNER_TEMP.

set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
FIXTURES="$REPO/packages/mnkit/test/fixtures"
USAGE="Usage: scripts/mnkit-e2e.sh [--devnet] [--from-registry <version>] [fixture ...]"
DEVNET=0
FROM_REGISTRY=
SELECTED=()
while [ $# -gt 0 ]; do
  case "$1" in
    --devnet) DEVNET=1 ;;
    --from-registry)
      [ $# -ge 2 ] || { echo "✖ --from-registry needs a version. $USAGE" >&2; exit 1; }
      FROM_REGISTRY=$2
      shift
      ;;
    -*) echo "✖ unknown option $1. $USAGE" >&2; exit 1 ;;
    *) SELECTED+=("$1") ;;
  esac
  shift
done
if [ ${#SELECTED[@]} -eq 0 ]; then SELECTED=(hello-world private-tip-jar); fi

WORK=${MNKIT_E2E_DIR:-$(mktemp -d -t mnkit-e2e-XXXXXX)}
WORK=$(mkdir -p "$WORK" && cd "$WORK" && pwd)
case "$WORK/" in
  "$REPO"/*) echo "✖ MNKIT_E2E_DIR ($WORK) is inside the repo; use a directory outside it." >&2; exit 1 ;;
esac

if [ -n "$FROM_REGISTRY" ]; then
  echo "▶ mnkit@$FROM_REGISTRY from $(npm config get registry)"
  init_mnkit() { npx --yes "mnkit@$FROM_REGISTRY" init "$@"; }
else
  VERSION=$(node -p "require('$REPO/packages/mnkit/package.json').version")
  PKGS="$WORK/pkgs"
  rm -rf "$PKGS" && mkdir -p "$PKGS"
  echo "▶ npm pack (mnkit $VERSION and the runtime packages) into $PKGS"
  for p in mnkit fast-sync sim coins; do
    (cd "$REPO/packages/$p" && npm pack --silent --pack-destination "$PKGS" >/dev/null)
  done
  ls "$PKGS"
  init_mnkit() { MNKIT_LOCAL_PACKAGES="$PKGS" npx --yes --package="$PKGS/mnkit-$VERSION.tgz" mnkit init "$@"; }
fi

for fixture in "${SELECTED[@]}"; do
  src="$FIXTURES/$fixture"
  [ -d "$src/contract" ] || { echo "✖ no fixture $fixture under $FIXTURES" >&2; exit 1; }
  echo
  echo "━━ $fixture ━━"
  cd "$WORK"
  rm -rf "$fixture"
  flags=()
  [ -f "$src/contract/witnesses.ts" ] && flags+=(--witnesses)
  init_mnkit "$fixture" "${flags[@]}"
  cd "$WORK/$fixture"
  test ! -e .npmrc || { echo "✖ init wrote an .npmrc" >&2; exit 1; }
  cp "$src"/contract/*.compact contract/
  npm run compile:fast
  npx mnkit derive
  rm -rf "$WORK/$fixture.first" && cp -r . "$WORK/$fixture.first"
  npx mnkit derive > /dev/null
  diff -r --exclude=node_modules --exclude=managed "$WORK/$fixture.first" . \
    || { echo "✖ a second derive changed files" >&2; exit 1; }
  rm -rf "$WORK/$fixture.first"
  if [ -d "$src/overlay" ]; then cp -r "$src/overlay/." .; fi
  npm run typecheck
  npm run test:sim
  if [ "$DEVNET" = 1 ]; then npm run validate; fi
  echo "✔ $fixture"
done
echo
echo "✔ mnkit e2e passed for: ${SELECTED[*]} (work dir $WORK)"
