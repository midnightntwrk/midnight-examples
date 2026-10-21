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
#   scripts/mnkit-e2e.sh [--devnet] [--from-registry <version>]
#                        [--upgrade-from <git-ref|version>] [fixture ...]
#
# Packs mnkit and the three runtime packages with `npm pack`, then for each
# fixture under packages/mnkit/test/fixtures (default: hello-world and
# private-tip-jar, the ones with completed tests; see its README) runs the
# packed CLI in a directory outside the repo:
#
#   mnkit init → copy the fixture's contracts in → compile:fast → derive twice
#   (the second run must change nothing) → copy the fixture's completed files
#   (overlay/) in → typecheck → test:sim → compile (with proving keys) → add ui
#   → the UI's typecheck, test:unit and build → with --devnet, validate
#   (compile, local network, DUST, test:local)
#
# MNKIT_LOCAL_PACKAGES points init at the tarballs. --from-registry <version>
# skips the packing and runs `npx mnkit@<version>` from whatever registry npm
# is configured for: npm itself after a release (the release workflow's smoke
# test), or a local one (scripts/mnkit-rehearsal.sh).
#
# --upgrade-from <git-ref|version> is the upgrade test: each fixture is
# scaffolded, derived and overlaid with an older mnkit, then moved to the
# packed one with `mnkit upgrade`, which must leave nothing to merge
# (.mnkit-new) and a clean `upgrade --check`; the rest of the run is as usual.
# A git ref is packed from a worktree of this repo at that ref; anything else
# is a version from the registry (`npx mnkit@<version>`).
#
# The work dir must be
# outside the repo: Node resolves packages by walking up, so a project inside
# the repo would pick up the monorepo's node_modules and hide missing deps.
# Set MNKIT_E2E_DIR to choose it (default: a new temp dir), e.g. CI's
# $RUNNER_TEMP.

set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
FIXTURES="$REPO/packages/mnkit/test/fixtures"
USAGE="Usage: scripts/mnkit-e2e.sh [--devnet] [--from-registry <version>] [--upgrade-from <git-ref|version>] [fixture ...]"
DEVNET=0
FROM_REGISTRY=
UPGRADE_FROM=
SELECTED=()
while [ $# -gt 0 ]; do
  case "$1" in
    --devnet) DEVNET=1 ;;
    --from-registry)
      [ $# -ge 2 ] || { echo "✖ --from-registry needs a version. $USAGE" >&2; exit 1; }
      FROM_REGISTRY=$2
      shift
      ;;
    --upgrade-from)
      [ $# -ge 2 ] || { echo "✖ --upgrade-from needs a git ref or a version. $USAGE" >&2; exit 1; }
      UPGRADE_FROM=$2
      shift
      ;;
    -*) echo "✖ unknown option $1. $USAGE" >&2; exit 1 ;;
    *) SELECTED+=("$1") ;;
  esac
  shift
done
if [ ${#SELECTED[@]} -eq 0 ]; then SELECTED=(hello-world private-tip-jar); fi
if [ -n "$FROM_REGISTRY" ] && [ -n "$UPGRADE_FROM" ]; then
  echo "✖ --from-registry and --upgrade-from don't combine: the upgrade test upgrades to the packed mnkit. $USAGE" >&2
  exit 1
fi

# Run on the Node in .nvmrc, as CI and most users do: its bundled npm is the
# one `mnkit init` runs, and npm majors resolve peer dependencies differently
# (vitest 4's optional peers crash npm 10 but not npm 11). MNKIT_E2E_ANY_NODE=1
# skips the check.
WANT_NODE=$(tr -d '[:space:]v' < "$REPO/.nvmrc")
HAVE_NODE=$(node -p 'process.versions.node.split(".")[0]')
if [ "$HAVE_NODE" != "$WANT_NODE" ] && [ "${MNKIT_E2E_ANY_NODE:-}" != 1 ]; then
  echo "✖ Node $HAVE_NODE is on PATH but .nvmrc says $WANT_NODE (npm $(npm --version)). Switch Node (nvm use), or set MNKIT_E2E_ANY_NODE=1." >&2
  exit 1
fi

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
  # The packed mnkit, run in a project whose own (older) mnkit is installed.
  new_mnkit() { MNKIT_LOCAL_PACKAGES="$PKGS" npx --yes --package="$PKGS/mnkit-$VERSION.tgz" mnkit "$@"; }
fi

if [ -n "$UPGRADE_FROM" ]; then
  if git -C "$REPO" rev-parse --verify --quiet "$UPGRADE_FROM^{commit}" > /dev/null; then
    OLD_SRC="$WORK/old-src"
    OLD_PKGS="$WORK/old-pkgs"
    echo "▶ packing mnkit at $UPGRADE_FROM (a worktree in $OLD_SRC) into $OLD_PKGS"
    git -C "$REPO" worktree remove --force "$OLD_SRC" 2> /dev/null || rm -rf "$OLD_SRC"
    git -C "$REPO" worktree add --detach "$OLD_SRC" "$UPGRADE_FROM" > /dev/null
    trap 'git -C "$REPO" worktree remove --force "$OLD_SRC" 2> /dev/null || true' EXIT
    (cd "$OLD_SRC" && corepack yarn install --immutable > /dev/null)
    rm -rf "$OLD_PKGS" && mkdir -p "$OLD_PKGS"
    for p in mnkit fast-sync sim coins; do
      (cd "$OLD_SRC/packages/$p" && npm pack --silent --pack-destination "$OLD_PKGS" > /dev/null)
    done
    OLD_VERSION=$(node -p "require('$OLD_SRC/packages/mnkit/package.json').version")
    old_init() { MNKIT_LOCAL_PACKAGES="$OLD_PKGS" npx --yes --package="$OLD_PKGS/mnkit-$OLD_VERSION.tgz" mnkit init "$@"; }
  else
    echo "▶ upgrading from mnkit@$UPGRADE_FROM ($(npm config get registry))"
    old_init() { npx --yes "mnkit@$UPGRADE_FROM" init "$@"; }
  fi
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
  if [ -n "$UPGRADE_FROM" ]; then old_init "$fixture" "${flags[@]}"; else init_mnkit "$fixture" "${flags[@]}"; fi
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
  if [ -n "$UPGRADE_FROM" ]; then
    echo "▶ mnkit upgrade ($UPGRADE_FROM → $VERSION)"
    new_mnkit upgrade
    leftovers=$(find . -name '*.mnkit-new' -not -path './node_modules/*')
    [ -z "$leftovers" ] || { echo "✖ upgrade left files to merge by hand: $leftovers" >&2; exit 1; }
    MNKIT_LOCAL_PACKAGES="$PKGS" npx mnkit upgrade --check
  fi
  npm run typecheck
  npm run test:sim
  npm run compile
  npx mnkit add ui --contract "$fixture"
  npm run typecheck --workspace ui
  npm run test:unit --workspace ui
  npm run build --workspace ui
  if [ "$DEVNET" = 1 ]; then npm run validate; fi
  echo "✔ $fixture"
done
echo
echo "✔ mnkit e2e passed for: ${SELECTED[*]} (work dir $WORK)"
