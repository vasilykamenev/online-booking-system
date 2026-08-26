---
name: test-site
description: Runs a full automated QA pass on the Meridian site — static checks (typecheck, lint, build, i18n key parity) plus live browser verification via Chrome DevTools across every route, both locales (ru/en), both themes, and mobile/desktop viewports, checking console errors, network requests, and accessibility basics. Use when the user asks to test/QA the site, run a smoke test, check for regressions, or before wrapping up a UI/design iteration, commit, or push.
---

# Test Site

Run this via the dedicated `test-site` agent (Agent tool, `subagent_type: "test-site"`) rather
than inline — the full pass generates a lot of build/console/network/screenshot output that the
orchestrating session doesn't need to hold onto, and the agent's report-only tool access keeps it
from silently "fixing" what it finds. Wait for its report before deciding whether to commit/push.

A QA pass has two phases: **static** (fast, catches most regressions) and **live**
(catches what only a running page reveals — hydration, console errors, hard-coded
external assets, layout breaks). Never skip straight to live checks — a build that
doesn't compile makes the browser pass meaningless.

Report findings as you go; don't silently fix things you find. Fixing is a separate
decision from the user unless they've asked you to also fix issues this pass turns up.

## 1. Static checks

Run in order, stop and report if any fails before continuing:

```bash
npm run typecheck
npm run lint
npm run build
```

Then check i18n key parity — a missing key in one locale is a silent runtime fallback,
not a build error, so it won't be caught above:

```bash
node -e "
const ru = require('./messages/ru.json');
const en = require('./messages/en.json');
const flatten = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  typeof v === 'object' && v !== null ? flatten(v, p + k + '.') : [p + k]);
const [ruKeys, enKeys] = [flatten(ru), flatten(en)];
const missing = (a, b, label) => a.filter(k => !b.includes(k)).forEach(k => console.log(label, k));
missing(ruKeys, enKeys, 'missing in en:');
missing(enKeys, ruKeys, 'missing in ru:');
"
```

**Completion criterion:** typecheck/lint/build all exit 0 with no output beyond the
normal success banner, and the key-parity script prints nothing.

## 2. Get a dev server

Check whether one is already running before starting your own — a leftover server
from a prior session is common in this project.

```bash
netstat -ano | grep ":3000" | grep LISTENING
```

- **Already running:** reuse it. Remember you did NOT start it — do not kill it in step 6.
- **Not running:** start it with `npm run dev`, wait for "Ready in", remember the PID —
  you own it and must kill it in step 6.

## 3. Enumerate what to check

Discover routes instead of hardcoding them, so this stays correct as pages get added:

```bash
find src/app -name "page.tsx"
```

Each `page.tsx` under `src/app/[locale]/...` maps to a route. For a dynamic segment
(e.g. `vessels/[slug]`), pick one real id from the matching file in `src/data/` rather
than skipping it.

The check matrix is: **every discovered route** × **both locales** (`/ru`, `/en`).
Within that matrix, theme and viewport are checked on the home route only (§5, §6) —
doing it on every route is redundant once the pattern is confirmed once.

## 4. Per route × locale: console, network, screenshot

For each combination, using the `mcp__chrome-devtools__*` tools:

1. `navigate_page` to the URL, then `list_console_messages`.
   - Fail on any `error`.
   - Fail on any `warn` except the known-acceptable one: Next.js suggesting
     `loading="eager"` for the LCP image. Note it doesn't need fixing but flag anything
     else as a finding.
2. `list_network_requests` (or read the `<img>`/`<script>`/`<link>` src/href via
   `evaluate_script`). Fail if any request targets a host other than `localhost` —
   this project vendors all images locally (`public/images/`), so an external request
   means someone reintroduced a remote URL. Also fail on any 4xx/5xx.
3. `take_screenshot` at desktop width. Look at it — does the layout match the design
   system (§5 of CLAUDE.md: generous whitespace, `font-light` large headings, no
   hardcoded colors bleeding through)? Note anything that looks broken, not just
   anything that errors.

**Completion criterion:** every route × locale combination has been navigated, and
each has an explicit pass/fail recorded for console, network, and visual — not just
the ones that happened to fail.

## 5. Theme check (home route)

Click the actual theme-toggle button in the UI — do not fake it by setting
`document.documentElement.classList` via `evaluate_script`. Direct DOM mutation
desyncs next-themes' internal React state from the DOM, so subsequent real clicks
stop working and you'll misdiagnose a working toggle as broken.

1. Click toggle, confirm `document.documentElement.className` gains `dark`.
2. Screenshot dark mode. Check contrast — text should never wash out against its
   background (this project has hit that bug before, in a CTA section).
3. Reload the page (`navigate_page` type `reload`). Confirm the theme persisted
   (still `dark`) — this exercises the localStorage + inline-script flash-prevention
   path, not just the in-memory React state.

## 6. Responsive check (home route)

`resize_page` to a mobile width (390×844). Screenshot both locales. Per CLAUDE.md §5,
mobile must use a carousel where desktop uses a grid, and a bottom sheet (`vaul`)
where desktop uses a modal — confirm those patterns are actually in effect, not just
that the grid squished. Confirm no horizontal scroll on `<body>`.

## 7. Accessibility spot-check

On the home route, desktop, light theme:

1. `take_snapshot` and confirm every icon-only button (theme toggle, mobile menu
   trigger, etc.) has an accessible name — not blank, not "button".
2. Tab through the first ~10 interactive elements (`press_key` Tab repeatedly) and
   confirm a visible focus ring appears at each stop (screenshot or check computed
   `outline`/`box-shadow` via `evaluate_script`).

## 8. Report

Summarize as a table: check × result. List every console warning/error verbatim,
every external/failed network request, every i18n key mismatch, and every visual or
accessibility issue you noticed — even ones that aren't hard failures. A clean pass
still gets a report; don't only speak up when something's broken.

## 9. Clean up

If you started the dev server in step 2, kill it now. If you reused an existing one,
leave it running.
