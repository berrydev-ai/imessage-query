import { describe, expect, it, mock } from "bun:test";
import type {
  ChatRecord,
  DoctorReport,
  MessageRecord,
  MessageSearchResult,
} from "../src/imessage.ts";
import { runCli, type CliDependencies, type CliIo } from "../src/cli.ts";

describe("runCli", () => {
  it("renders doctor output in json mode", async () => {
    const report: DoctorReport = {
      platform: "darwin",
      dbPath: "/tmp/chat.db",
      exists: true,
      readable: true,
      readOnly: true,
      messageColumns: ["guid"],
      supports: {
        attributedBody: true,
        guid: true,
        attachments: true,
        unreadFilter: true,
      },
      error: null,
    };

    const { deps, io, stdoutLines } = createHarness({
      inspectDatabase: mock(() => report),
      formatDoctor: mock(() => "formatted doctor"),
    });

    const exitCode = await runCli(["doctor", "--json"], { deps, io });

    expect(exitCode).toBe(0);
    expect(deps.inspectDatabase).toHaveBeenCalledTimes(1);
    expect(deps.formatDoctor).toHaveBeenCalledWith(report);
    expect(stdoutLines).toEqual([JSON.stringify(report, null, 2)]);
  });

  it("passes exact message filters through to the search layer", async () => {
    const result: MessageSearchResult = {
      messages: [],
      scanned: 0,
      truncated: false,
      nextAfterRowId: null,
    };

    const { deps, io, stdoutLines } = createHarness({
      searchMessages: mock(() => result),
      formatMessages: mock(() => "formatted messages"),
    });

    const exitCode = await runCli(
      [
        "messages",
        "--chat-id",
        "chat-123",
        "--participant-exact",
        "+15551234567",
        "--after-rowid",
        "42",
        "--sort",
        "asc",
        "--limit",
        "25",
      ],
      { deps, io },
    );

    expect(exitCode).toBe(0);
    expect(deps.searchMessages).toHaveBeenCalledWith({
      query: undefined,
      chat: undefined,
      chatId: "chat-123",
      chatExact: undefined,
      participant: undefined,
      participantExact: "+15551234567",
      from: undefined,
      to: undefined,
      fromMe: false,
      incoming: false,
      unread: false,
      hasAttachments: false,
      afterRowId: 42,
      sort: "asc",
      limit: 25,
    });
    expect(stdoutLines).toEqual(["formatted messages"]);
  });

  it("emits ready, batch, and done events for tail --once", async () => {
    const messages: MessageRecord[] = [
      {
        rowId: 8,
        guid: "msg-8",
        text: "hello",
        textSource: "text",
        direction: "incoming",
        isFromMe: false,
        isUnread: false,
        date: "2026-04-14T00:00:00.000Z",
        unixMs: new Date("2026-04-14T00:00:00.000Z").getTime(),
        senderId: "+15551230001",
        chatId: "chat-1",
        chatName: "Alice",
        chatParticipants: ["+15551230001"],
        participantCount: 1,
        hasAttachments: false,
      },
    ];

    const { deps, io, stdoutLines } = createHarness({
      resolveTailCursor: mock(() => 7),
      pollTailBatch: mock(() => ({
        cursor: 8,
        messages,
      })),
    });

    const exitCode = await runCli(["tail", "--once", "--json"], {
      deps,
      io,
    });

    expect(exitCode).toBe(0);
    expect(deps.resolveTailCursor).toHaveBeenCalledWith({
      chat: undefined,
      chatId: undefined,
      chatExact: undefined,
      participant: undefined,
      participantExact: undefined,
      from: undefined,
      to: undefined,
      fromMe: false,
      incoming: false,
      unread: false,
      hasAttachments: false,
    });
    expect(deps.pollTailBatch).toHaveBeenCalledWith({
      chat: undefined,
      chatId: undefined,
      chatExact: undefined,
      participant: undefined,
      participantExact: undefined,
      from: undefined,
      to: undefined,
      fromMe: false,
      incoming: false,
      unread: false,
      hasAttachments: false,
      afterRowId: 7,
      limit: 50,
    });
    expect(deps.sleep).not.toHaveBeenCalled();

    const events = stdoutLines.map((line) => JSON.parse(line));
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: "ready",
      cursor: 7,
      pollIntervalMs: 2000,
    });
    expect(events[1]).toMatchObject({
      type: "batch",
      cursor: 8,
      pollCount: 1,
    });
    expect(events[2]).toMatchObject({
      type: "done",
      cursor: 8,
      pollCount: 1,
      reason: "once",
    });
  });

  it("treats invalid options as usage errors", async () => {
    const { io, stderrLines } = createHarness();

    const exitCode = await runCli(["chats", "--unknown"], { io });

    expect(exitCode).toBe(2);
    expect(stderrLines[0]).toContain("Unknown option");
    expect(stderrLines.join("\n")).toContain("Usage:");
  });
});

function createHarness(
  overrides: Partial<CliDependencies> = {},
): {
  deps: CliDependencies;
  io: CliIo;
  stdoutLines: string[];
  stderrLines: string[];
} {
  const chats: ChatRecord[] = [];
  const messages: MessageSearchResult = {
    messages: [],
    scanned: 0,
    truncated: false,
    nextAfterRowId: null,
  };
  const doctor: DoctorReport = {
    platform: "darwin",
    dbPath: "/tmp/chat.db",
    exists: false,
    readable: false,
    readOnly: true,
    messageColumns: [],
    supports: {
      attributedBody: false,
      guid: false,
      attachments: false,
      unreadFilter: false,
    },
    error: null,
  };

  const deps: CliDependencies = {
    inspectDatabase: mock(() => doctor),
    listChats: mock(() => chats),
    searchMessages: mock(() => messages),
    formatChats: mock(() => "formatted chats"),
    formatDoctor: mock(() => "formatted doctor"),
    formatMessages: mock(() => "formatted messages"),
    formatTailBatch: mock(() => "formatted tail batch"),
    formatTailDone: mock(() => "formatted tail done"),
    formatTailReady: mock(() => "formatted tail ready"),
    pollTailBatch: mock(() => ({
      cursor: null,
      messages: [],
    })),
    resolveTailCursor: mock(() => null),
    sleep: mock(async () => {}),
    ...overrides,
  };

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const io: CliIo = {
    stdout: mock((text: string) => {
      stdoutLines.push(text);
    }),
    stderr: mock((text: string) => {
      stderrLines.push(text);
    }),
  };

  return {
    deps,
    io,
    stdoutLines,
    stderrLines,
  };
}
