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
npm install -g github:berrydev-ai/imessage-query#vX.Y.Z
```

This project is Bun-only. `npm` can install the wrapper script from GitHub, but
the runtime still requires Bun on the target machine.

Once installed, the executable is `imessage-query`.

## Agent Skill

This repo also ships an installable agent skill at [skills/imessage-query/SKILL.md](/Users/eberry/Code/github.com/berrydev-ai/imessage-query/skills/imessage-query/SKILL.md).

Install the skill with the `skills` CLI:

```bash
npx skills add berrydev-ai/imessage-query@imessage-query -g -y
```

The skill teaches an agent how to use the already-installed `imessage-query`
CLI. It does not install the binary for you, so install the CLI first.

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

Versioning uses semantic versioning:

- `patch` for fixes and small non-breaking updates
- `minor` for new backward-compatible features
- `major` for breaking changes

Release management is done with the `Release` GitHub Actions workflow:

1. Open the `Release` workflow in GitHub Actions.
2. Choose the semver bump: `patch`, `minor`, or `major`.
3. Optionally provide a short release summary.
4. Run the workflow.

The workflow will:

- verify the repo with `bun run ci`
- bump `package.json`
- prepend a dated entry in `CHANGELOG.md`
- commit the version change to `main`
- create a `vX.Y.Z` git tag
- create a GitHub release
- attach `imessage-query-<version>.tgz` built with `npm pack`

You can install a pinned release from GitHub by tag:

```bash
npm install -g github:berrydev-ai/imessage-query#vX.Y.Z
```
