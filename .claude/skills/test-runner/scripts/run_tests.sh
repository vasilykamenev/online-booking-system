#!/usr/bin/env bash
#
# run_tests.sh — run Vitest (unit) or Playwright (e2e) tests in a Next.js
# project and print a compact summary instead of the full raw output.
#
# Usage:
#   run_tests.sh unit [path-or-pattern] [-- extra runner args]
#   run_tests.sh e2e  [path-or-pattern] [-- extra runner args]
#
# Env:
#   TEST_PROJECT_DIR   Optional. Directory to start searching for package.json
#                       from. Defaults to the current directory.
#
# Always exits with the underlying test runner's exit code.

set -uo pipefail

MODE="${1:-}"
shift || true

if [[ "$MODE" != "unit" && "$MODE" != "e2e" ]]; then
  echo "Usage: run_tests.sh <unit|e2e> [path-or-pattern] [-- extra args]" >&2
  exit 2
fi

EXTRA_ARGS=()
POSITIONAL=()
SEEN_DASHDASH=false
for arg in "$@"; do
  if [[ "$arg" == "--" ]]; then
    SEEN_DASHDASH=true
    continue
  fi
  if $SEEN_DASHDASH; then
    EXTRA_ARGS+=("$arg")
  else
    POSITIONAL+=("$arg")
  fi
done

# ---- Locate the nearest package.json, walking up from TEST_PROJECT_DIR/cwd ----
START_DIR="${TEST_PROJECT_DIR:-$(pwd)}"
PROJECT_ROOT=""
dir="$START_DIR"
while [[ "$dir" != "/" ]]; do
  if [[ -f "$dir/package.json" ]]; then
    PROJECT_ROOT="$dir"
    break
  fi
  dir="$(dirname "$dir")"
done

if [[ -z "$PROJECT_ROOT" ]]; then
  echo "Could not find a package.json above $START_DIR. Set TEST_PROJECT_DIR or cd into the project first." >&2
  exit 2
fi

cd "$PROJECT_ROOT"

LOG_DIR="$PROJECT_ROOT/.claude-test-logs"
mkdir -p "$LOG_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/${MODE}-${TS}.log"

# ---- Pick a package manager ----
PM="npm"
if [[ -f "pnpm-lock.yaml" ]]; then PM="pnpm"; fi
if [[ -f "yarn.lock" ]]; then PM="yarn"; fi
if [[ -f "bun.lockb" ]]; then PM="bun"; fi

run_via_pm() {
  local script_name="$1"; shift
  case "$PM" in
    npm)  npm run "$script_name" -- "$@" ;;
    pnpm) pnpm run "$script_name" -- "$@" ;;
    yarn) yarn run "$script_name" "$@" ;;
    bun)  bun run "$script_name" "$@" ;;
  esac
}

has_script() {
  node -e "const s=require('$PROJECT_ROOT/package.json').scripts||{}; process.exit(s['$1']?0:1)" 2>/dev/null
}

# ---- Build the command ----
CMD_DESC=""
if [[ "$MODE" == "unit" ]]; then
  export CI=true   # forces Vitest out of watch mode regardless of script contents
  TARGET_ARGS=()
  [[ ${#POSITIONAL[@]} -gt 0 ]] && TARGET_ARGS+=("${POSITIONAL[@]}")
  REPORTER_ARGS=(--reporter=dot)
  [[ ${#EXTRA_ARGS[@]} -gt 0 ]] && REPORTER_ARGS=("${EXTRA_ARGS[@]}")

  if has_script "test:unit"; then
    CMD_DESC="$PM run test:unit"
    run_via_pm "test:unit" --run "${REPORTER_ARGS[@]}" "${TARGET_ARGS[@]}" > "$LOG_FILE" 2>&1
    STATUS=$?
  elif has_script "test"; then
    CMD_DESC="$PM run test"
    run_via_pm "test" --run "${REPORTER_ARGS[@]}" "${TARGET_ARGS[@]}" > "$LOG_FILE" 2>&1
    STATUS=$?
  else
    CMD_DESC="npx vitest run"
    npx vitest run "${REPORTER_ARGS[@]}" "${TARGET_ARGS[@]}" > "$LOG_FILE" 2>&1
    STATUS=$?
  fi
else
  export CI=true
  TARGET_ARGS=()
  [[ ${#POSITIONAL[@]} -gt 0 ]] && TARGET_ARGS+=("${POSITIONAL[@]}")
  REPORTER_ARGS=(--reporter=line)
  [[ ${#EXTRA_ARGS[@]} -gt 0 ]] && REPORTER_ARGS=("${EXTRA_ARGS[@]}")

  if has_script "test:e2e"; then
    CMD_DESC="$PM run test:e2e"
    run_via_pm "test:e2e" "${REPORTER_ARGS[@]}" "${TARGET_ARGS[@]}" > "$LOG_FILE" 2>&1
    STATUS=$?
  elif has_script "e2e"; then
    CMD_DESC="$PM run e2e"
    run_via_pm "e2e" "${REPORTER_ARGS[@]}" "${TARGET_ARGS[@]}" > "$LOG_FILE" 2>&1
    STATUS=$?
  else
    CMD_DESC="npx playwright test"
    npx playwright test "${REPORTER_ARGS[@]}" "${TARGET_ARGS[@]}" > "$LOG_FILE" 2>&1
    STATUS=$?
  fi
fi

# ---- Compact summary ----
echo "== ran: $CMD_DESC (mode=$MODE) in $PROJECT_ROOT =="
echo "== exit code: $STATUS =="
echo

if [[ "$MODE" == "unit" ]]; then
  grep -E "Test Files|^ *Tests |Duration" "$LOG_FILE" || true
  if [[ $STATUS -ne 0 ]]; then
    echo
    echo "-- failing tests --"
    grep -E "FAIL|✗|×" "$LOG_FILE" | sort -u || true
  fi
else
  grep -E "passed|failed|flaky|skipped" "$LOG_FILE" | tail -5 || true
  if [[ $STATUS -ne 0 ]]; then
    echo
    echo "-- failing tests --"
    grep -E "^\s*[0-9]+\) " "$LOG_FILE" || true
    grep -E "Serving HTML report|npx playwright show-report" "$LOG_FILE" || true
  fi
fi

echo
echo "Full log: $LOG_FILE"

exit $STATUS
