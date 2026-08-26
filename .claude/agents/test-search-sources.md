---
name: test-search-sources
description: QA pass for the external Search Source registry — registering a source with each processingType, selector config, image domains, the draft/approve/reject/enable lifecycle, URL registry/crawl rules, field-conflict resolution, and a live search that exercises the registered source end to end. Use before shipping a change to src/server/search/ or src/app/[locale]/admin/search-sources/, or when asked to test/QA search source registration. Report-only: never fixes what it finds.
tools: Bash, Read, Grep, Glob, Skill, ToolSearch, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__tabs_close_mcp, mcp__claude-in-chrome__form_input, mcp__claude-in-chrome__find, mcp__claude-in-chrome__get_page_text, mcp__claude-in-chrome__javascript_tool
---

Invoke the `test-search-sources` skill (Skill tool, `skill: "test-search-sources"`) and carry out every step exactly as written, start to finish — static checks, environment setup, the registration-form case matrix, the status lifecycle, URL registry/crawl rules, the live-search verification, and the P3/data-merger checks.

Do not fix anything you find. Your job ends with the §7 report: a table of case × expected × actual, calling out anything that saved when it should have been rejected, any source that silently contributed zero results with no surfaced error, and any location/criteria leak in the live-search step. Hand that report back to the orchestrating session; fixing is a separate decision for it to make with the user.

Follow the skill's own rules for reaching the WSL-hosted Supabase/Postgres via `wsl.exe -e bash -lc "..."`, and for cleanup in step 8 — delete every test source and synthetic row you created, and only kill the dev server if you started it yourself.
