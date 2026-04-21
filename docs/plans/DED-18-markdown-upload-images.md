# Markdown Upload Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `toolist markdown upload-images` for public upload and in-place Markdown URL rewriting.

**Architecture:** Add a focused command module under `src/commands/markdown/` that scans Markdown text, resolves local file paths relative to each Markdown file, calls the existing `uploadCommand`, and writes updated content in place. Keep CLI-specific argument parsing and help text in `src/cli.ts`, following existing command patterns.

**Tech Stack:** TypeScript, Node.js fs/path APIs, `glob`, Vitest integration tests.

---

### Task 1: CLI Contract Tests

**Files:**
- Create: `tests/integration/markdown-upload-images-command.test.ts`

- [ ] Write failing tests for single-file replacement of markdown images and `coverImage`, requiring `--public` and `--in-place`.
- [ ] Write failing tests for duplicate local image reuse, remote URL skipping, batch mode with `--root` and `--glob`, and missing image failure.
- [ ] Run the new test file and confirm failures are due to missing command support.

### Task 2: Command Module

**Files:**
- Create: `src/commands/markdown/upload-images.ts`

- [ ] Implement Markdown image token scanning that preserves alt text and optional title by replacing only URL content.
- [ ] Implement frontmatter `coverImage` scanning for unquoted, single-quoted, and double-quoted scalar values.
- [ ] Resolve local paths relative to each Markdown file directory.
- [ ] Skip `http:`, `https:`, and `data:image/` URLs.
- [ ] Upload each unique absolute local image path once per run with `public: true`; require `public_url` in the result.
- [ ] Write changed files in place and return the report shape required by the ticket.

### Task 3: CLI Wiring

**Files:**
- Modify: `src/cli.ts`

- [ ] Add `markdown` to root help and create `getMarkdownHelp` plus `getMarkdownUploadImagesHelp`.
- [ ] Parse `--input`, `--root`, `--glob`, `--in-place`, `--public`, `--env`, `--base-url`, `--token`, `--config-path`, and `--json`.
- [ ] Enforce argument validation in CLI before calling the command.
- [ ] Reuse existing credential resolution and pass credentials into the command.

### Task 4: Validation and Delivery

**Files:**
- Modify: `docs/workpad/DED-18.md`

- [ ] Run targeted tests for the new command.
- [ ] Run `npm run lint`, `npm test`, `npm run build`, and `npm run verify:pack-install`.
- [ ] Attempt hosted `--env test` smoke if auth and gateway contract are available; otherwise record the blocker.
- [ ] Self-review diff and update the workpad with validation results.
- [ ] Push the branch, create or update the PR to `staging`, add the Linear handoff comment, and move DED-18 to Code Review.
