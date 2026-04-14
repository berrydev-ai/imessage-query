import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { resetContactCache } from "../src/contacts.ts";
import {
  createAttributedBodyFixture,
  dateToMacosTimestamp,
  inspectDatabase,
  listChats,
  searchMessages,
} from "../src/imessage.ts";
import { pollTailBatch, resolveTailCursor } from "../src/tail.ts";

const dbPaths: string[] = [];

afterEach(() => {
  delete Bun.env.IMESSAGE_QUERY_CONTACT_DB_PATHS;
  delete Bun.env.IMESSAGE_QUERY_DB_PATH;
  resetContactCache();
  for (const dbPath of dbPaths.splice(0)) {
    rmSync(dbPath, { force: true });
  }
});

describe("imessage-query", () => {
  it("inspects the schema and reports support flags", () => {
    const dbPath = createFixtureDb();
    const report = inspectDatabase(dbPath);

    expect(report.readable).toBe(true);
    expect(report.supports.attributedBody).toBe(true);
    expect(report.supports.unreadFilter).toBe(true);
    expect(report.messageColumns).toContain("guid");
  });

  it("lists recent chats with participants", () => {
    const dbPath = createFixtureDb();
    const chats = listChats({ dbPath, limit: 10 });

    expect(chats).toHaveLength(2);
    expect(chats[0]?.chatId).toBe("chat-group");
    expect(chats[0]?.participants).toEqual([
      "+15551230001",
      "+15551230002",
    ]);
    expect(chats[1]?.displayName).toBe("Alice");
  });

  it("searches messages and falls back to attributedBody parsing", () => {
    const dbPath = createFixtureDb();
    const result = searchMessages({
      dbPath,
      query: "secret plan",
      limit: 10,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.text).toBe("Secret plan");
    expect(result.messages[0]?.hasAttachments).toBe(true);
  });

  it("supports unread and chat filters", () => {
    const dbPath = createFixtureDb();
    const result = searchMessages({
      dbPath,
      unread: true,
      chat: "Alice",
      limit: 10,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.senderId).toBe("+15551230001");
    expect(result.messages[0]?.isUnread).toBe(true);
  });

  it("supports rowid cursors in ascending order", () => {
    const dbPath = createFixtureDb();
    const result = searchMessages({
      dbPath,
      afterRowId: 1,
      sort: "asc",
      limit: 10,
    });

    expect(result.messages.map((message) => message.rowId)).toEqual([2, 3]);
    expect(result.nextAfterRowId).toBe(3);
  });

  it("supports exact chat and participant targeting with richer metadata", () => {
    const dbPath = createFixtureDb();
    const result = searchMessages({
      dbPath,
      chatId: "chat-group",
      chatExact: "Weekend Plans",
      participantExact: "+15551230002",
      limit: 10,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      rowId: 3,
      direction: "incoming",
      textSource: "attributedBody",
      chatParticipants: ["+15551230001", "+15551230002"],
      participantCount: 2,
      unixMs: new Date("2026-01-02T15:00:00.000Z").getTime(),
    });
  });

  it("resolves chat-exact through the contact database", () => {
    const dbPath = createFixtureDb();
    const contactsDbPath = createContactsFixtureDb();
    Bun.env.IMESSAGE_QUERY_CONTACT_DB_PATHS = contactsDbPath;
    resetContactCache();

    const result = searchMessages({
      dbPath,
      chatExact: "Nathan Tiek",
      limit: 10,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      rowId: 3,
      chatName: "Weekend Plans",
      senderId: "+15551230002",
    });
  });

  it("searches chats by resolved contact name", () => {
    const dbPath = createFixtureDb();
    const contactsDbPath = createContactsFixtureDb();
    Bun.env.IMESSAGE_QUERY_CONTACT_DB_PATHS = contactsDbPath;
    resetContactCache();

    const chats = listChats({
      dbPath,
      search: "Nathan",
      limit: 10,
    });

    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({
      chatId: "chat-group",
      displayName: "Weekend Plans",
    });
  });

  it("resolves the current tail cursor from the latest matching row", () => {
    const dbPath = createFixtureDb();

    const cursor = resolveTailCursor({
      dbPath,
      chatExact: "Weekend Plans",
    });

    expect(cursor).toBe(3);
  });

  it("polls only messages after the tail cursor in ascending order", () => {
    const dbPath = createFixtureDb();

    const batch = pollTailBatch({
      dbPath,
      afterRowId: 1,
      limit: 10,
    });

    expect(batch.cursor).toBe(3);
    expect(batch.messages.map((message) => message.rowId)).toEqual([2, 3]);
  });
});

function createFixtureDb(): string {
  const dbPath = join(
    tmpdir(),
    `imessage-query-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  dbPaths.push(dbPath);

  const db = new Database(dbPath);

  try {
    db.exec(`
      CREATE TABLE handle (
        ROWID INTEGER PRIMARY KEY,
        id TEXT NOT NULL
      );

      CREATE TABLE chat (
        ROWID INTEGER PRIMARY KEY,
        chat_identifier TEXT NOT NULL,
        display_name TEXT
      );

      CREATE TABLE message (
        ROWID INTEGER PRIMARY KEY,
        guid TEXT,
        text TEXT,
        attributedBody BLOB,
        is_from_me INTEGER NOT NULL,
        date INTEGER NOT NULL,
        handle_id INTEGER,
        cache_has_attachments INTEGER NOT NULL DEFAULT 0,
        is_read INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE chat_message_join (
        chat_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL
      );

      CREATE TABLE chat_handle_join (
        chat_id INTEGER NOT NULL,
        handle_id INTEGER NOT NULL
      );
    `);

    db.query("INSERT INTO handle (ROWID, id) VALUES (?, ?)")
      .run(1, "+15551230001");
    db.query("INSERT INTO handle (ROWID, id) VALUES (?, ?)")
      .run(2, "+15551230002");

    db.query("INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)")
      .run(1, "chat-alice", "Alice");
    db.query("INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)")
      .run(2, "chat-group", "Weekend Plans");

    db.query("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)")
      .run(1, 1);
    db.query("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)")
      .run(2, 1);
    db.query("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)")
      .run(2, 2);

    insertMessage(db, {
      rowId: 1,
      guid: "msg-1",
      text: "Hello from Alice",
      attributedBody: null,
      isFromMe: 0,
      isoDate: "2026-01-01T10:00:00.000Z",
      handleId: 1,
      hasAttachments: 0,
      isRead: 0,
      chatId: 1,
    });

    insertMessage(db, {
      rowId: 2,
      guid: "msg-2",
      text: "Reply from me",
      attributedBody: null,
      isFromMe: 1,
      isoDate: "2026-01-01T10:05:00.000Z",
      handleId: null,
      hasAttachments: 0,
      isRead: 1,
      chatId: 1,
    });

    insertMessage(db, {
      rowId: 3,
      guid: "msg-3",
      text: null,
      attributedBody: createAttributedBodyFixture("Secret plan"),
      isFromMe: 0,
      isoDate: "2026-01-02T15:00:00.000Z",
      handleId: 2,
      hasAttachments: 1,
      isRead: 1,
      chatId: 2,
    });
  } finally {
    db.close();
  }

  return dbPath;
}

function createContactsFixtureDb(): string {
  const dbPath = join(
    tmpdir(),
    `imessage-contacts-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  dbPaths.push(dbPath);

  const db = new Database(dbPath);

  try {
    db.exec(`
      CREATE TABLE ZABCDRECORD (
        Z_PK INTEGER PRIMARY KEY,
        ZNAME TEXT,
        ZFIRSTNAME TEXT,
        ZLASTNAME TEXT
      );

      CREATE TABLE ZABCDPHONENUMBER (
        Z_PK INTEGER PRIMARY KEY,
        ZOWNER INTEGER,
        ZFULLNUMBER TEXT
      );

      CREATE TABLE ZABCDEMAILADDRESS (
        Z_PK INTEGER PRIMARY KEY,
        ZOWNER INTEGER,
        ZADDRESS TEXT
      );
    `);

    db.query(
      "INSERT INTO ZABCDRECORD (Z_PK, ZNAME, ZFIRSTNAME, ZLASTNAME) VALUES (?, ?, ?, ?)",
    ).run(1, "Nathan Tiek", "Nathan", "Tiek");
    db.query(
      "INSERT INTO ZABCDPHONENUMBER (Z_PK, ZOWNER, ZFULLNUMBER) VALUES (?, ?, ?)",
    ).run(1, 1, "+1 (555) 123-0002");
    db.query(
      "INSERT INTO ZABCDRECORD (Z_PK, ZNAME, ZFIRSTNAME, ZLASTNAME) VALUES (?, ?, ?, ?)",
    ).run(2, "Nathan Hopper", "Nathan", "Hopper");
    db.query(
      "INSERT INTO ZABCDPHONENUMBER (Z_PK, ZOWNER, ZFULLNUMBER) VALUES (?, ?, ?)",
    ).run(2, 2, "+1 (555) 123-0003");
  } finally {
    db.close();
  }

  return dbPath;
}

function insertMessage(
  db: Database,
  options: {
    rowId: number;
    guid: string;
    text: string | null;
    attributedBody: Uint8Array | null;
    isFromMe: number;
    isoDate: string;
    handleId: number | null;
    hasAttachments: number;
    isRead: number;
    chatId: number;
  },
): void {
  db.query(
    `INSERT INTO message (
      ROWID,
      guid,
      text,
      attributedBody,
      is_from_me,
      date,
      handle_id,
      cache_has_attachments,
      is_read
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    options.rowId,
    options.guid,
    options.text,
    options.attributedBody,
    options.isFromMe,
    dateToMacosTimestamp(new Date(options.isoDate)),
    options.handleId,
    options.hasAttachments,
    options.isRead,
  );

  db.query("INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)")
    .run(options.chatId, options.rowId);
}
