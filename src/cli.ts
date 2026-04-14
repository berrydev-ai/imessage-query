import { parseArgs } from "node:util";
import {
  inspectDatabase,
  listChats,
  searchMessages,
  UsageError,
} from "./imessage.ts";
import {
  formatChats,
  formatDoctor,
  formatMessages,
  formatTailBatch,
  formatTailDone,
  formatTailReady,
} from "./format.ts";
import {
  pollTailBatch,
  resolveTailCursor,
  type TailBatchEvent,
  type TailDoneEvent,
  type TailReadyEvent,
} from "./tail.ts";

const HELP_TEXT = `imessage-query

Usage:
  imessage-query doctor [--json]
  imessage-query chats [--limit N] [--search TEXT] [--json]
  imessage-query messages [options]
  imessage-query tail [options]

Messages options:
  --query TEXT
  --chat TEXT
  --chat-id TEXT
  --chat-exact TEXT
  --participant TEXT
  --participant-exact TEXT
  --from ISO_DATE
  --to ISO_DATE
  --from-me
  --incoming
  --unread
  --has-attachments
  --after-rowid N
  --sort asc|desc
  --limit N
  --json

Tail options:
  --chat TEXT
  --chat-id TEXT
  --chat-exact TEXT
  --participant TEXT
  --participant-exact TEXT
  --from ISO_DATE
  --to ISO_DATE
  --from-me
  --incoming
  --unread
  --has-attachments
  --after-rowid N
  --limit N
  --poll-interval-ms N
  --max-polls N
  --once
  --json
`;

const DOCTOR_HELP = `Usage: imessage-query doctor [--json]`;
const CHATS_HELP = `Usage: imessage-query chats [--limit N] [--search TEXT] [--json]`;
const MESSAGES_HELP = `Usage: imessage-query messages [--query TEXT] [--chat TEXT] [--chat-id TEXT] [--chat-exact TEXT] [--participant TEXT] [--participant-exact TEXT] [--from ISO_DATE] [--to ISO_DATE] [--from-me] [--incoming] [--unread] [--has-attachments] [--after-rowid N] [--sort asc|desc] [--limit N] [--json]`;
const TAIL_HELP = `Usage: imessage-query tail [--chat TEXT] [--chat-id TEXT] [--chat-exact TEXT] [--participant TEXT] [--participant-exact TEXT] [--from ISO_DATE] [--to ISO_DATE] [--from-me] [--incoming] [--unread] [--has-attachments] [--after-rowid N] [--limit N] [--poll-interval-ms N] [--max-polls N] [--once] [--json]

If --after-rowid is omitted, tail starts from the current end of the matching stream and emits only future messages.`;

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2);

  if (!command || command === "help" || command === "--help") {
    console.log(HELP_TEXT);
    return;
  }

  switch (command) {
    case "doctor":
      handleDoctor(args);
      return;
    case "chats":
      handleChats(args);
      return;
    case "messages":
      handleMessages(args);
      return;
    case "tail":
      await handleTail(args);
      return;
    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

function handleDoctor(args: string[]): void {
  if (args.includes("--help")) {
    console.log(DOCTOR_HELP);
    return;
  }

  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      json: {
        type: "boolean",
        default: false,
      },
    },
  });

  const report = inspectDatabase();
  printOutput(report, values.json, formatDoctor(report));
}

function handleChats(args: string[]): void {
  if (args.includes("--help")) {
    console.log(CHATS_HELP);
    return;
  }

  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      limit: {
        type: "string",
      },
      search: {
        type: "string",
      },
      json: {
        type: "boolean",
        default: false,
      },
    },
  });

  const chats = listChats({
    limit: parseOptionalInteger(values.limit, "--limit"),
    search: values.search,
  });

  printOutput({ chats }, values.json, formatChats(chats));
}

function handleMessages(args: string[]): void {
  if (args.includes("--help")) {
    console.log(MESSAGES_HELP);
    return;
  }

  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      query: {
        type: "string",
      },
      chat: {
        type: "string",
      },
      "chat-id": {
        type: "string",
      },
      "chat-exact": {
        type: "string",
      },
      participant: {
        type: "string",
      },
      "participant-exact": {
        type: "string",
      },
      from: {
        type: "string",
      },
      to: {
        type: "string",
      },
      "from-me": {
        type: "boolean",
        default: false,
      },
      incoming: {
        type: "boolean",
        default: false,
      },
      unread: {
        type: "boolean",
        default: false,
      },
      "has-attachments": {
        type: "boolean",
        default: false,
      },
      "after-rowid": {
        type: "string",
      },
      sort: {
        type: "string",
      },
      limit: {
        type: "string",
      },
      json: {
        type: "boolean",
        default: false,
      },
    },
  });

  const sort = parseSort(values.sort);
  const result = searchMessages({
    query: values.query,
    chat: values.chat,
    chatId: values["chat-id"],
    chatExact: values["chat-exact"],
    participant: values.participant,
    participantExact: values["participant-exact"],
    from: values.from,
    to: values.to,
    fromMe: values["from-me"],
    incoming: values.incoming,
    unread: values.unread,
    hasAttachments: values["has-attachments"],
    afterRowId: parseOptionalInteger(values["after-rowid"], "--after-rowid"),
    sort,
    limit: parseOptionalInteger(values.limit, "--limit"),
  });

  printOutput(result, values.json, formatMessages(result));
}

async function handleTail(args: string[]): Promise<void> {
  if (args.includes("--help")) {
    console.log(TAIL_HELP);
    return;
  }

  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      chat: {
        type: "string",
      },
      "chat-id": {
        type: "string",
      },
      "chat-exact": {
        type: "string",
      },
      participant: {
        type: "string",
      },
      "participant-exact": {
        type: "string",
      },
      from: {
        type: "string",
      },
      to: {
        type: "string",
      },
      "from-me": {
        type: "boolean",
        default: false,
      },
      incoming: {
        type: "boolean",
        default: false,
      },
      unread: {
        type: "boolean",
        default: false,
      },
      "has-attachments": {
        type: "boolean",
        default: false,
      },
      "after-rowid": {
        type: "string",
      },
      limit: {
        type: "string",
      },
      "poll-interval-ms": {
        type: "string",
      },
      "max-polls": {
        type: "string",
      },
      once: {
        type: "boolean",
        default: false,
      },
      json: {
        type: "boolean",
        default: false,
      },
    },
  });

  const baseOptions = {
    chat: values.chat,
    chatId: values["chat-id"],
    chatExact: values["chat-exact"],
    participant: values.participant,
    participantExact: values["participant-exact"],
    from: values.from,
    to: values.to,
    fromMe: values["from-me"],
    incoming: values.incoming,
    unread: values.unread,
    hasAttachments: values["has-attachments"],
  };

  const limit = parseOptionalInteger(values.limit, "--limit") ?? 50;
  const pollIntervalMs =
    parseOptionalInteger(values["poll-interval-ms"], "--poll-interval-ms") ?? 2000;
  const maxPolls = parseOptionalInteger(values["max-polls"], "--max-polls");

  let cursor =
    parseOptionalInteger(values["after-rowid"], "--after-rowid") ??
    resolveTailCursor(baseOptions);
  let pollCount = 0;

  const readyEvent: TailReadyEvent = {
    type: "ready",
    cursor,
    pollIntervalMs,
  };
  printEvent(readyEvent, values.json, formatTailReady(readyEvent));

  while (true) {
    const batch = pollTailBatch({
      ...baseOptions,
      afterRowId: cursor ?? undefined,
      limit,
    });

    pollCount += 1;
    cursor = batch.cursor;

    if (batch.messages.length > 0) {
      const batchEvent: TailBatchEvent = {
        type: "batch",
        cursor,
        pollCount,
        messages: batch.messages,
      };
      printEvent(batchEvent, values.json, formatTailBatch(batchEvent));
    }

    if (values.once) {
      const doneEvent: TailDoneEvent = {
        type: "done",
        cursor,
        pollCount,
        reason: "once",
      };
      printEvent(doneEvent, values.json, formatTailDone(doneEvent));
      return;
    }

    if (maxPolls !== undefined && pollCount >= maxPolls) {
      const doneEvent: TailDoneEvent = {
        type: "done",
        cursor,
        pollCount,
        reason: "max-polls",
      };
      printEvent(doneEvent, values.json, formatTailDone(doneEvent));
      return;
    }

    await Bun.sleep(pollIntervalMs);
  }
}

function printOutput(value: unknown, json: boolean, text: string): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  console.log(text);
}

function printEvent(value: unknown, json: boolean, text: string): void {
  if (json) {
    console.log(JSON.stringify(value));
    return;
  }

  console.log(text);
}

function parseOptionalInteger(
  raw: string | undefined,
  flagName: string,
): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new UsageError(`${flagName} must be a positive integer.`);
  }
  return parsed;
}

function parseSort(raw: string | undefined): "asc" | "desc" | undefined {
  if (!raw) {
    return undefined;
  }

  if (raw === "asc" || raw === "desc") {
    return raw;
  }

  throw new UsageError("--sort must be either asc or desc.");
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(error.message);
    console.error("");
    console.error(HELP_TEXT);
    process.exit(2);
  }

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
