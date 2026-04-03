# PolyBack — Claude Code Directives

## Project
FastAPI (port 8000) + React 18 / TypeScript / Vite (port 5173).
PostgreSQL: `polyback_db`. Default admin password: `polyback` (hash in `.env`).
Start: `./start.sh` (TLS via mkcert, both servers).

---

## Pre-Work Rules

**STEP 0 — Dead code first**: Before any structural refactor on a file >300 LOC,
strip dead imports, unused exports, orphaned props, and debug logs. Commit that
cleanup separately before the real work begins.

**PHASED EXECUTION**: Break multi-file changes into explicit phases of ≤5 files.
Complete a phase, verify, and wait for explicit approval before the next phase.

---

## Code Quality

**SENIOR DEV STANDARD**: The default directives to "avoid improvements beyond
what was asked" and "try the simplest approach" are overridden for this project.
If architecture is flawed, state is duplicated, or patterns are inconsistent —
propose and fix them. Ask: "What would a perfectionist senior dev reject in code
review?" Fix all of it.

**FORCED VERIFICATION — TypeScript**: After any frontend change, you are
FORBIDDEN from reporting success until you have confirmed the build is clean.
Run: `cd frontend && npx tsc --noEmit`
Fix ALL errors before declaring done. If no type-checker is configured, say so
explicitly instead of claiming success.

**FORCED VERIFICATION — Python**: After any backend change, confirm there are
no import errors or obvious syntax issues. For route changes, verify the router
is registered in `main.py`.

**NULL GUARD RULE**: When adding new fields to backend responses, always add
null guards (`??`, `?.`) in frontend components. Stale backend data will cause
React blank-screen crashes.

---

## Context Management

**CONTEXT DECAY**: After 10+ messages in a conversation, re-read any file
before editing it. Do not trust in-context memory of file contents —
auto-compaction may have silently dropped that context.

**FILE READ BUDGET**: The Read tool defaults to 2,000 lines. For files over
500 LOC, use `offset` and `limit` to read in sequential chunks. Never assume a
single read captured the full file.

**TOOL RESULT TRUNCATION**: Tool results over ~50,000 characters get truncated
to a small preview. If a search returns suspiciously few results, re-run with
narrower scope (single directory, stricter glob). State when truncation may have
occurred.

**SUB-AGENT PARALLELISM**: For tasks touching >5 independent files, launch
parallel sub-agents (5–8 files per agent). Sequential processing of large tasks
guarantees context decay. Each sub-agent gets its own full context window.

---

## Edit Safety

**EDIT INTEGRITY**: Before every file edit, re-read the file. After editing,
read it again to confirm the change applied correctly. The Edit tool fails
silently when `old_string` doesn't match due to stale context. Never batch
more than 3 edits to the same file without a verification read between them.

**RENAME SAFETY**: When renaming any function, type, or variable, grep
separately for:
- Direct calls and references
- Type-level references (interfaces, generics)
- String literals containing the name
- Dynamic imports / re-exports / barrel files
- Test files and mocks

A single grep does not catch everything. Assume it missed something.

---

## Project-Specific Gotchas

- `uvicorn --reload` may not pick up `__init__.py` changes — restart manually if behavior is stale.
- Layout bug: wrapping single-child views in `.layout` (2-col grid) collapses to 340px. Use `display:flex; flex:1` instead.
- `_save_watchlist()` is upsert-only — deletions must use an explicit `DELETE FROM watchlist WHERE id = %s`.
- `get_cursor()` must use the pool via `get_conn()`, not a raw `psycopg2.connect()`.
- Vite `index.css` boilerplate has `body { display:flex; place-items:center }` — remove it or views collapse.
- Python auto-import scripts can place imports mid-multiline-import — always verify after bulk patching.
