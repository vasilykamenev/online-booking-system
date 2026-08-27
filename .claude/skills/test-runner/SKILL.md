---
name: test-runner
description: Run unit tests (Vitest + React Testing Library) and end-to-end tests (Playwright) in a Next.js project without burning tokens on raw test output. Use this skill any time the user asks to "run the tests", "run unit tests", "run e2e tests", "check if tests pass", "run vitest", "run playwright", wants to verify a fix didn't break anything, or asks about test failures/CI status in a Next.js codebase — even if they don't name Vitest or Playwright explicitly. Always prefer this skill's script over manually typing `npm test`, `npx vitest`, or `npx playwright test`.
---

# Next.js Test Runner (Vitest + Playwright)

Runs tests via a bash script that redirects the full raw output to a log
file on disk and prints only a compact summary to the terminal. This is the
whole point of the skill: reading a full Vitest/Playwright run into context
(hundreds or thousands of lines, most of them irrelevant passing-test noise)
wastes tokens. The script forces compact reporters (`dot` for Vitest, `line`
for Playwright) and CI mode (no watch mode, no hanging) and gives you a path
to the full log for deep-diving only the parts you actually need.

## How to run tests

There are two equivalent helper scripts (relative to this skill's
directory — check bundled resources for the exact path). Use whichever
matches the environment you're actually running commands in — check the OS
before picking, don't assume from what the user's project targets:

**macOS/Linux (bash):**
```bash
bash scripts/run_tests.sh unit                     # all unit tests
bash scripts/run_tests.sh unit src/components/Foo   # a specific file/pattern
bash scripts/run_tests.sh e2e                       # all e2e tests
bash scripts/run_tests.sh e2e tests/login.spec.ts    # a specific spec
bash scripts/run_tests.sh e2e -- --project=chromium  # forward extra flags
```

**Windows (PowerShell):**
```powershell
pwsh scripts/run_tests.ps1 unit
pwsh scripts/run_tests.ps1 unit src/components/Foo
pwsh scripts/run_tests.ps1 e2e
pwsh scripts/run_tests.ps1 e2e tests/login.spec.ts
pwsh scripts/run_tests.ps1 e2e -- --project=chromium
```
On Windows PowerShell (not PowerShell 7+), `pwsh` may not exist — use
`powershell -File scripts/run_tests.ps1 unit` instead. If script execution
is blocked by the system's execution policy, run once:
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that
session, or invoke via
`powershell -ExecutionPolicy Bypass -File scripts/run_tests.ps1 unit`.

Both scripts behave identically:
- Walks up from the current directory to find the nearest `package.json`
  (set `TEST_PROJECT_DIR=/path/to/project` env var first if you're not
  already inside the repo).
- Detects the package manager from the lockfile (npm/pnpm/yarn/bun).
- Prefers an explicit `test:unit` / `test:e2e` npm script if the project
  has one, otherwise falls back to `test` / `e2e`, otherwise falls back to
  calling `vitest run` / `playwright test` directly.
- Forces `CI=true` so Vitest never sits in watch mode waiting for input.
- Writes full output to `.claude-test-logs/<mode>-<timestamp>.log` inside
  the project root, and prints just the pass/fail counts, duration, and (if
  anything failed) the list of failing test names/files.

## What to do with the result

- **All passed:** just report the summary line (files/tests passed, time
  taken). Don't cat the log.
- **Something failed:** the summary already lists which tests failed. Only
  pull more detail from the log file for the specific tests you're actually
  investigating — e.g. `grep -A 20 "ComponentName" <logfile>` or
  `sed -n '120,160p' <logfile>` around a failure. Don't `cat` the whole log
  unless it's small or the user explicitly asks for the raw output.
- **Playwright failures:** the summary points to the HTML report command
  (`npx playwright show-report`). Mention it to the user instead of dumping
  trace/screenshot paths from the log.
- After fixing code based on a failure, re-run only the affected
  file/pattern first (fast feedback), then run the full suite once things
  look right.

## Troubleshooting

- **"Could not find a package.json"** — you're not inside the Next.js repo.
  `cd` into it or set `TEST_PROJECT_DIR` (`$env:TEST_PROJECT_DIR` on
  Windows).
- **Playwright complains browsers aren't installed** — run
  `npx playwright install --with-deps` once, then re-run the skill.
- **A project uses a non-standard script name** for tests (not `test`,
  `test:unit`, `test:e2e`, or `e2e`) — check `package.json` yourself and
  either call `run_tests.sh` with `-- <script's real flags>` after invoking
  the right npm script manually, or just tell the user the script name
  doesn't match convention and ask which one to use.
- **Watch mode explicitly wanted** — this skill is for one-shot/CI-style
  runs. If the user wants interactive watch mode, tell them to run
  `npx vitest` themselves in their own terminal; that's not a good fit for
  an agent-driven run.
