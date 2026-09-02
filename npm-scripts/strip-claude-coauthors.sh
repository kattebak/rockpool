#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

ORIGIN_URL="${ORIGIN_URL:-https://github.com/kattebak/rockpool.git}"
SCRATCH_ROOT="${SCRATCH_ROOT:-${HOME}/development/.tmp}"
FILTER_REPO="${FILTER_REPO:-git-filter-repo}"

usage() {
  cat <<'EOF'
Strip "Co-Authored-By" trailers naming Claude or Anthropic from every commit.

Usage: npm run rewrite:strip-claude-coauthors [-- --push]

  -h, --help        show this help
      --push        force-push the rewritten history to origin
      --origin URL  clone from URL instead of the default remote

Without --push this is a dry run: the history is rewritten in a throwaway
clone, the result is verified, and nothing leaves this machine.

Environment:
  ORIGIN_URL    default remote to clone and push (github kattebak/rockpool)
  SCRATCH_ROOT  where the throwaway clone lives (~/development/.tmp)
  FILTER_REPO   git-filter-repo executable
EOF
}

push=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --push) push=1 ;;
    --origin)
      shift
      ORIGIN_URL="${1:-}"
      [ -n "${ORIGIN_URL}" ] || {
        echo "error: --origin needs a URL" >&2
        exit 2
      }
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if ! command -v "${FILTER_REPO}" > /dev/null 2>&1; then
  echo "error: ${FILTER_REPO} not found on PATH" >&2
  echo "install it from https://github.com/newren/git-filter-repo" >&2
  exit 1
fi

WORK_DIR="${SCRATCH_ROOT}/strip-claude-coauthors-$$"
CLONE_DIR="${WORK_DIR}/rockpool"
RULES_FILE="${WORK_DIR}/replace-message.txt"

cleanup() {
  [ -d "${WORK_DIR}" ] || return 0
  if command -v scratch-clean > /dev/null 2>&1; then
    scratch-clean "${WORK_DIR}" > /dev/null || true
    return 0
  fi
  echo "note: scratch-clean not found, remove ${WORK_DIR} yourself" >&2
}
trap cleanup EXIT

mkdir -p "${WORK_DIR}"

echo "cloning ${ORIGIN_URL}"
git clone --no-local --quiet "${ORIGIN_URL}" "${CLONE_DIR}"

cat > "${RULES_FILE}" <<'EOF'
regex:(?m)^Co-[Aa]uthored-[Bb]y:[^\n]*(?:[Aa]nthropic|[Cc]laude)[^\n]*\n?==>
regex:(?s)\n{2,}\Z==>\n
EOF

identity() {
  git -C "${CLONE_DIR}" log --all --reverse --format='%an <%ae> | %cn <%ce> | %at %ct'
}

trailer_count() {
  git -C "${CLONE_DIR}" log --all --format=%B | grep -ci 'co-authored-by.*anthropic' || true
}

BEFORE_IDENTITY="${WORK_DIR}/identity-before.txt"
AFTER_IDENTITY="${WORK_DIR}/identity-after.txt"

identity > "${BEFORE_IDENTITY}"
before_trailers="$(trailer_count)"
before_commits="$(git -C "${CLONE_DIR}" rev-list --all --count)"

echo "found ${before_trailers} trailer lines in ${before_commits} commits"

if [ "${before_trailers}" -eq 0 ]; then
  echo "nothing to rewrite"
  exit 0
fi

git -C "${CLONE_DIR}" log --all --format='%h %s' -i --grep='^Co-[Aa]uthored-[Bb]y:.*anthropic' -E \
  | sed 's/^/  affected: /'

(cd "${CLONE_DIR}" && "${FILTER_REPO}" --force --replace-message "${RULES_FILE}")

identity > "${AFTER_IDENTITY}"
after_trailers="$(trailer_count)"
after_commits="$(git -C "${CLONE_DIR}" rev-list --all --count)"

COMMIT_MAP="${CLONE_DIR}/.git/filter-repo/commit-map"
rewritten=0
if [ -f "${COMMIT_MAP}" ]; then
  rewritten="$(awk 'length($1)==40 && length($2)==40 && $1!=$2' "${COMMIT_MAP}" | wc -l | tr -d ' ')"
fi

echo "removed ${before_trailers} trailer lines; ${rewritten} of ${before_commits} commits got new hashes"

if [ "${after_trailers}" -ne 0 ]; then
  echo "error: ${after_trailers} trailer lines still present after rewrite" >&2
  exit 1
fi

if [ "${after_commits}" -ne "${before_commits}" ]; then
  echo "error: commit count changed from ${before_commits} to ${after_commits}" >&2
  exit 1
fi

if ! diff -q "${BEFORE_IDENTITY}" "${AFTER_IDENTITY}" > /dev/null; then
  echo "error: author, committer or dates changed" >&2
  diff "${BEFORE_IDENTITY}" "${AFTER_IDENTITY}" >&2 || true
  exit 1
fi

echo "verified: zero anthropic trailers, ${after_commits} commits, identities and dates unchanged"

if [ "${push}" -eq 0 ]; then
  echo "dry run, nothing pushed. rerun with --push to publish"
  exit 0
fi

git -C "${CLONE_DIR}" remote add origin "${ORIGIN_URL}"
git -C "${CLONE_DIR}" push --force --all origin
git -C "${CLONE_DIR}" push --force --tags origin

cat <<EOF

history rewritten and pushed. every clone now has stale commits.

reset your checkout at ${ROOT_DIR}:
  git fetch origin && git reset --hard origin/main

open pull request branches and any other clone must rebase onto the new
main, or they will reintroduce the old commits on merge.
EOF
