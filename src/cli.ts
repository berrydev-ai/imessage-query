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

export type CliDependencies = {
  inspectDatabase: typeof inspectDatabase;
  listChats: typeof listChats;
  searchMessages: typeof searchMessages;
  formatChats: typeof formatChats;
  formatDoctor: typeof formatDoctor;
  formatMessages: typeof formatMessages;
  formatTailBatch: typeof formatTailBatch;
  formatTailDone: typeof formatTailDone;
  formatTailReady: typeof formatTailReady;
  pollTailBatch: typeof pollTailBatch;
  resolveTailCursor: typeof resolveTailCursor;
  sleep: (milliseconds: number) => Promise<void>;
};

export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export type RunCliOptions = {
  deps?: Partial<CliDependencies>;
  io?: Partial<CliIo>;
};

const defaultDependencies: CliDependencies = {
  inspectDatabase,
  listChats,
  searchMessages,
  formatChats,
  formatDoctor,
  formatMessages,
  formatTailBatch,
  formatTailDone,
  formatTailReady,
  pollTailBatch,
  resolveTailCursor,
  sleep: Bun.sleep,
};

const defaultIo: CliIo = {
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
};

export async function runCli(
  args: string[],
  options: RunCliOptions = {},
): Promise<number> {
  const deps: CliDependencies = {
    ...defaultDependencies,
    ...options.deps,
  };
  const io: CliIo = {
    ...defaultIo,
    ...options.io,
  };

  try {
    const [command, ...rest] = args;

    if (!command || command === "help" || command === "--help") {
      io.stdout(HELP_TEXT);
      return 0;
    }

    switch (command) {
      case "doctor":
        handleDoctor(rest, deps, io);
        return 0;
      case "chats":
        handleChats(rest, deps, io);
        return 0;
      case "messages":
        handleMessages(rest, deps, io);
        return 0;
      case "tail":
        await handleTail(rest, deps, io);
        return 0;
      default:
        throw new UsageError(`Unknown command: ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(error.message);
      io.stderr("");
      io.stderr(HELP_TEXT);
      return 2;
    }

    if (error instanceof Error) {
      io.stderr(error.message);
    } else {
      io.stderr(String(error));
    }
    return 1;
  }
}

export async function runMain(args = Bun.argv.slice(2)): Promise<void> {
  const exitCode = await runCli(args);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

function handleDoctor(
  args: string[],
  deps: CliDependencies,
  io: CliIo,
): void {
  if (args.includes("--help")) {
    io.stdout(DOCTOR_HELP);
    return;
  }

  const { values } = parseCliArgs<{
    json: boolean;
  }>({
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

  const report = deps.inspectDatabase();
  printOutput(report, values.json, deps.formatDoctor(report), io);
}

function handleChats(
  args: string[],
  deps: CliDependencies,
  io: CliIo,
): void {
  if (args.includes("--help")) {
    io.stdout(CHATS_HELP);
    return;
  }

  const { values } = parseCliArgs<{
    limit?: string;
    search?: string;
    json: boolean;
  }>({
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

  const chats = deps.listChats({
    limit: parseOptionalInteger(values.limit, "--limit"),
    search: values.search,
  });

  printOutput({ chats }, values.json, deps.formatChats(chats), io);
}

function handleMessages(
  args: string[],
  deps: CliDependencies,
  io: CliIo,
): void {
  if (args.includes("--help")) {
    io.stdout(MESSAGES_HELP);
    return;
  }

  const { values } = parseCliArgs<{
    query?: string;
    chat?: string;
    "chat-id"?: string;
    "chat-exact"?: string;
    participant?: string;
    "participant-exact"?: string;
    from?: string;
    to?: string;
    "from-me": boolean;
    incoming: boolean;
    unread: boolean;
    "has-attachments": boolean;
    "after-rowid"?: string;
    sort?: string;
    limit?: string;
    json: boolean;
  }>({
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
  const result = deps.searchMessages({
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

  printOutput(result, values.json, deps.formatMessages(result), io);
}

async function handleTail(
  args: string[],
  deps: CliDependencies,
  io: CliIo,
): Promise<void> {
  if (args.includes("--help")) {
    io.stdout(TAIL_HELP);
    return;
  }

  const { values } = parseCliArgs<{
    chat?: string;
    "chat-id"?: string;
    "chat-exact"?: string;
    participant?: string;
    "participant-exact"?: string;
    from?: string;
    to?: string;
    "from-me": boolean;
    incoming: boolean;
    unread: boolean;
    "has-attachments": boolean;
    "after-rowid"?: string;
    limit?: string;
    "poll-interval-ms"?: string;
    "max-polls"?: string;
    once: boolean;
    json: boolean;
  }>({
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
    deps.resolveTailCursor(baseOptions);
  let pollCount = 0;

  const readyEvent: TailReadyEvent = {
    type: "ready",
    cursor,
    pollIntervalMs,
  };
  printEvent(readyEvent, values.json, deps.formatTailReady(readyEvent), io);

  while (true) {
    const batch = deps.pollTailBatch({
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
      printEvent(
        batchEvent,
        values.json,
        deps.formatTailBatch(batchEvent),
        io,
      );
    }

    if (values.once) {
      const doneEvent: TailDoneEvent = {
        type: "done",
        cursor,
        pollCount,
        reason: "once",
      };
      printEvent(doneEvent, values.json, deps.formatTailDone(doneEvent), io);
      return;
    }

    if (maxPolls !== undefined && pollCount >= maxPolls) {
      const doneEvent: TailDoneEvent = {
        type: "done",
        cursor,
        pollCount,
        reason: "max-polls",
      };
      printEvent(doneEvent, values.json, deps.formatTailDone(doneEvent), io);
      return;
    }

    await deps.sleep(pollIntervalMs);
  }
}

function printOutput(
  value: unknown,
  json: boolean,
  text: string,
  io: CliIo,
): void {
  if (json) {
    io.stdout(JSON.stringify(value, null, 2));
    return;
  }

  io.stdout(text);
}

function printEvent(
  value: unknown,
  json: boolean,
  text: string,
  io: CliIo,
): void {
  if (json) {
    io.stdout(JSON.stringify(value));
    return;
  }

  io.stdout(text);
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

function parseCliArgs<TValues extends Record<string, unknown>>(
  options: Parameters<typeof parseArgs>[0],
): Omit<ReturnType<typeof parseArgs>, "values"> & {
  values: TValues;
} {
  try {
    return parseArgs(options) as Omit<ReturnType<typeof parseArgs>, "values"> & {
      values: TValues;
    };
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new UsageError(error.message);
    }

    throw new UsageError(String(error));
  }
}

if (import.meta.main) {
  await runMain();
}
