#!/usr/bin/env bash
# Reconcile one midnight-examples PR into midnight-examples-mirror.
#
#   mirror-pr.sh <pr-number>
#
# Reads the PR's current state from the public repo and makes the mirror match:
# branch pr/<N> at the PR's head commit, and one mirror PR from it with the same
# base, title, body and draft state, closed once the upstream PR is closed. It
# looks only at current state, never at which event fired, so re-running it is
# always safe (backfill, retries, out-of-order events).
#
# The PR's code is fetched as git objects and pushed. It is never checked out
# or run: mirror.yml calls this from pull_request_target, with secrets present.
#
# Env:
#   SRC_TOKEN     read token for SRC_REPO (the workflow's GITHUB_TOKEN)
#   MIRROR_TOKEN  write token for MIRROR_REPO (the GitHub App's token)
#   SRC_REPO      default midnightntwrk/midnight-examples
#   MIRROR_REPO   default midnightntwrk/midnight-examples-mirror
set -euo pipefail

n=${1:?usage: mirror-pr.sh <pr-number>}
[[ "$n" =~ ^[0-9]+$ ]] || { echo "::error::not a PR number: $n"; exit 1; }
: "${SRC_TOKEN:?}" "${MIRROR_TOKEN:?}"
src=${SRC_REPO:-midnightntwrk/midnight-examples}
mirror=${MIRROR_REPO:-midnightntwrk/midnight-examples-mirror}
branch="pr/$n"

src_gh()    { GH_TOKEN=$SRC_TOKEN gh "$@"; }
mirror_gh() { GH_TOKEN=$MIRROR_TOKEN gh "$@"; }

# git push to the mirror, with the token as a header so it never lands in a
# URL, a remote or .git/config.
auth=$(printf 'x-access-token:%s' "$MIRROR_TOKEN" | base64 -w0)
mirror_git() {
  git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth" "$@"
}
mirror_url="https://github.com/$mirror.git"

pr=$(src_gh api "repos/$src/pulls/$n")
field() { jq -r "$1" <<<"$pr"; }
state=$(field .state)
base=$(field .base.ref)
draft=$(field .draft)
title="#$n: $(field .title)"
author=$(field .user.login)
url=$(field .html_url)

# Fork PRs stay out. In the mirror, pr/<N> is a same-repo branch, so any
# workflow a fork adds would run there on push, with the mirror's secrets.
if [[ $(field '.head.repo.full_name // ""') != "$src" ]]; then
  echo "::notice::#$n is from a fork; not mirrored"
  exit 0
fi

# The newest mirror PR for this branch, open ones first.
mirror_pr() {
  mirror_gh pr list -R "$mirror" --head "$branch" --state "$1" \
    --json number,state,isDraft,baseRefName --jq 'sort_by(-.number) | .[0] // empty'
}

if [[ "$state" == closed ]]; then
  existing=$(mirror_pr open)
  if [[ -n "$existing" ]]; then
    m=$(jq -r .number <<<"$existing")
    if [[ $(field .merged) == true ]]; then
      note="Merged upstream in $url as \`$(field .merge_commit_sha)\`. Mirror \`main\` follows through mirror.yml."
    else
      note="Closed upstream in $url without merging."
    fi
    mirror_gh pr comment "$m" -R "$mirror" --body "$note"
    mirror_gh pr close "$m" -R "$mirror"
    echo "Closed mirror PR #$m"
  fi
  # Delete the branch even with no open mirror PR (a run that failed halfway).
  if mirror_git push -q "$mirror_url" --delete "refs/heads/$branch" 2>/dev/null; then
    echo "Deleted $branch"
  fi
  exit 0
fi

# Open upstream: put pr/<N> at the PR head, fetched from refs/pull/<N>/head.
# No token needed: the repo is public.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git init -q "$work"
cd "$work"
refspecs=("+refs/pull/$n/head:refs/heads/pr")
# A stacked PR's base branch must exist in the mirror for the diff to be right.
# main is owned by mirror.yml's mirror-main job, so it is never pushed here.
[[ "$base" != main ]] && refspecs+=("+refs/heads/$base:refs/heads/base")
git fetch -q --no-tags "https://github.com/$src.git" "${refspecs[@]}"
push=("+refs/heads/pr:refs/heads/$branch")
[[ "$base" != main ]] && push+=("+refs/heads/base:refs/heads/$base")
mirror_git push -q "$mirror_url" "${push[@]}"
echo "Pushed $branch at $(git rev-parse --short refs/heads/pr)"

# GitHub caps a PR body at 65536 characters; leave room for the header.
upstream_body=$(field '.body // ""')
if (( ${#upstream_body} > 60000 )); then
  upstream_body="${upstream_body:0:60000}"$'\n\n_(truncated; see the upstream PR)_'
fi
body="> Mirror of $url by @$author, maintained by \`.github/workflows/mirror.yml\` in $src.
> Review and comment here. Don't push to \`$branch\` or merge: every sync overwrites it, and the upstream PR is what merges.

---

$upstream_body"

existing=$(mirror_pr open)
if [[ -z "$existing" ]]; then
  # Reopened upstream: reopen the last mirror PR. GitHub refuses that when the
  # branch was deleted and recreated, so fall back to a new PR.
  closed=$(mirror_pr closed)
  if [[ -n "$closed" ]] && mirror_gh pr reopen "$(jq -r .number <<<"$closed")" -R "$mirror" 2>/dev/null; then
    existing=$(mirror_pr open)
  fi
fi

if [[ -z "$existing" ]]; then
  flags=()
  [[ "$draft" == true ]] && flags+=(--draft)
  mirror_gh pr create -R "$mirror" --head "$branch" --base "$base" \
    --title "$title" --body "$body" "${flags[@]}"
  exit 0
fi

m=$(jq -r .number <<<"$existing")
edit=(--title "$title" --body "$body")
[[ $(jq -r .baseRefName <<<"$existing") != "$base" ]] && edit+=(--base "$base")
mirror_gh pr edit "$m" -R "$mirror" "${edit[@]}" >/dev/null
mirror_draft=$(jq -r .isDraft <<<"$existing")
if [[ "$draft" == true && "$mirror_draft" == false ]]; then
  mirror_gh pr ready "$m" -R "$mirror" --undo
elif [[ "$draft" == false && "$mirror_draft" == true ]]; then
  mirror_gh pr ready "$m" -R "$mirror"
fi
echo "Updated mirror PR #$m"
