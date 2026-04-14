---
name: imessage-query
description: Query local iMessage history on macOS with the `imessage-query` CLI. Use when the user wants to list chats, search messages, inspect a conversation by person or chat, or tail new messages for agent workflows. This skill is read-only and assumes the `imessage-query` executable is already installed and authorized to read Messages data.
allowed-tools: Bash(imessage-query:*)
metadata:
  author: berrydev-ai
  version: "0.1.0"
  homepage: https://github.com/berrydev-ai/imessage-query
  source: https://github.com/berrydev-ai/imessage-query
---

# imessage-query

Use this skill when the task is to read or search local iMessage history on a
macOS machine that already has the `imessage-query` CLI installed.

## Preconditions

- macOS
- `imessage-query` is on `PATH`, or you are inside the repo and can run
  `bun run src/cli.ts ...`
- the host app running the command has Full Disk Access
- the task is read-only

If the CLI is not installed yet, ask the user to install it first:

```bash
npm install -g github:berrydev-ai/imessage-query
```

If you are working inside the source repo instead of a global install, use:

```bash
bun run src/cli.ts doctor
```

## Default Workflow

1. Run `imessage-query doctor --json` first.
2. If access is denied or `readable` is `false`, stop and tell the user to fix
   Full Disk Access before continuing.
3. Prefer `--json` for agent workflows.
4. Start broad with `chats`, then narrow with `messages`.
5. Use `tail` with `nextAfterRowId` or `--after-rowid` for incremental polling.

## Command Patterns

### Health check

```bash
imessage-query doctor --json
```

### Find likely chats

```bash
imessage-query chats --search "Nathan" --limit 10 --json
imessage-query chats --limit 20 --json
```

### Read or search messages

```bash
imessage-query messages --chat-exact "Nathan Hopkins" --limit 20 --json
imessage-query messages --chat-id chat123456 --limit 20 --json
imessage-query messages --participant-exact "+15551234567" --incoming --limit 20 --json
imessage-query messages --query "meeting" --from 2026-01-01T00:00:00Z --to 2026-01-31T23:59:59Z --limit 25 --json
imessage-query messages --unread --has-attachments --limit 25 --json
```

### Tail new messages

```bash
imessage-query tail --chat-exact "Nathan Hopkins" --json
imessage-query tail --after-rowid 240477 --once --json
imessage-query tail --participant-exact "+15551234567" --incoming --max-polls 5 --json
```

## Targeting Rules

- Prefer `--chat-id` when you already know the exact chat identifier.
- Use `--chat-exact` for stable exact thread targeting by display name or
  resolved contact name.
- Use `--participant-exact` for stable handle targeting by exact phone number
  or email.
- Use fuzzy `--chat`, `--participant`, or `--query` only when discovery is the
  goal.
- `--from-me` and `--incoming` are mutually exclusive.
- Always set an explicit `--limit` in agent loops.

## Result Handling

- `messages --json` returns:
  - `messages`
  - `scanned`
  - `truncated`
  - `nextAfterRowId`
- `tail --json` emits newline-delimited JSON events:
  - `ready`
  - `batch`
  - `done`
- Use `nextAfterRowId` as the durable cursor for follow-up polling.
- Treat empty results as a valid outcome, not a failure.

## Failure Handling

- If `doctor` reports `authorization denied`, `readable: false`, or an empty
  schema, stop and tell the user to grant Full Disk Access to the app hosting
  the terminal or agent.
- If a chat lookup is ambiguous, use `chats --search ... --json` first and then
  rerun `messages` with `--chat-id` or `--chat-exact`.
- If the user gives relative dates like "today" or "yesterday", convert them to
  concrete ISO timestamps before running the command.

## Safety

- This tool is read-only. Do not use it to send, edit, or delete messages.
- Do not infer message delivery state or sendability from `chat.db`.
- Do not continue retrying permission errors. Ask the user to fix the macOS
  privacy setting first.
