# imessage-query

Read-only Bun CLI for querying local iMessage history on macOS.

## Status

Current MVP scope:

- `doctor` checks platform, database path, and read access
- `chats` lists recent conversations and resolves contact names from AddressBook
- `messages` lists or searches messages with agent-friendly JSON output,
  exact targeting flags, contact-name matching, and stable cursor metadata
- `tail` polls for new messages after a stable rowid cursor for agent workflows

Writes are intentionally out of scope for now.

## Requirements

- Bun 1.3+
- macOS
- Full Disk Access for the app running this CLI if you want to read the real
  `~/Library/Messages/chat.db` and local AddressBook databases

## Install

Local development:

```bash
bun install
```

Run directly:

```bash
bun run src/cli.ts doctor
```

Install from GitHub:

```bash
npm install -g github:berrydev-ai/imessage-query
```

Install a tagged release:

```bash
npm install -g github:berrydev-ai/imessage-query#v0.1.0
```

This project is Bun-only. `npm` can install the wrapper script from GitHub, but
the runtime still requires Bun on the target machine.

Once installed, the executable is `imessage-query`.

## Development

Run the full local verification loop:

```bash
bun run ci
```

## Commands

### doctor

```bash
imessage-query doctor
imessage-query doctor --json
```

### chats

```bash
imessage-query chats --limit 20
imessage-query chats --search alice --json
imessage-query chats --search "Nathan" --json
```

### messages

```bash
imessage-query messages --limit 20
imessage-query messages --chat Weekend --limit 50 --json
imessage-query messages --chat-id chat123456 --json
imessage-query messages --chat-exact "Weekend Plans" --json
imessage-query messages --chat-exact "Nathan Hopkins" --json
imessage-query messages --participant +15551234567 --incoming
imessage-query messages --participant-exact +15551234567 --json
imessage-query messages --participant-exact "Nathan Hopkins" --json
imessage-query messages --query "meeting" --from 2026-01-01T00:00:00Z --json
imessage-query messages --after-rowid 123456 --sort asc --json
imessage-query messages --unread --has-attachments --limit 25
```

### tail

```bash
imessage-query tail --chat-exact "Nathan Hopkins"
imessage-query tail --chat-exact "Nathan Hopkins" --json
imessage-query tail --after-rowid 240477 --once --json
imessage-query tail --chat-id chat123456 --incoming --poll-interval-ms 1000
imessage-query tail --participant-exact "Nathan Hopkins" --max-polls 5 --json
```

If `--after-rowid` is omitted, `tail` starts from the current end of the
matching stream and emits only future messages.

`tail --json` emits newline-delimited JSON events:

- `ready`
- `batch`
- `done`

## Message JSON fields

`messages --json` returns per-message fields including:

- `rowId`
- `guid`
- `text`
- `textSource`
- `direction`
- `isFromMe`
- `isUnread`
- `date`
- `unixMs`
- `senderId`
- `chatId`
- `chatName`
- `chatParticipants`
- `participantCount`
- `hasAttachments`

## Test Fixture Override

For development and tests, you can point the CLI at a different SQLite file:

```bash
IMESSAGE_QUERY_DB_PATH=/tmp/test-chat.db bun run src/cli.ts messages --json
```

## Release Workflow

Versioning is managed with semantic versioning and Conventional Commits:

- `fix:` bumps the patch version
- `feat:` bumps the minor version
- `feat!:` or `BREAKING CHANGE:` bumps the major version

Release management is automated:

1. Merge conventional commits into `main`.
2. GitHub Actions runs Release Please and opens or updates a release PR.
3. Merge the release PR to update `package.json`, `CHANGELOG.md`, and create a Git tag and GitHub release.
4. The release workflow builds `imessage-query-<version>.tgz` with `npm pack` and attaches it to the GitHub release.

You can install a pinned release from GitHub by tag:

```bash
npm install -g github:berrydev-ai/imessage-query#vX.Y.Z
```
