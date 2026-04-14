import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildResolvedChatName,
  resolveExactContactHandles,
  resolveFuzzyContactHandles,
} from "./contacts.ts";

const CORE_DATA_EPOCH_MS = Date.UTC(2001, 0, 1);
const NS_PER_MS = 1_000_000;
const NSSTRING_MARKER = Buffer.from("NSString");
const DEFAULT_DB_PATH = join(homedir(), "Library/Messages/chat.db");
const DEFAULT_MESSAGE_LIMIT = 20;
const DEFAULT_CHAT_LIMIT = 15;
const MAX_LIMIT = 500;
const SEARCH_BATCH_SIZE = 250;
const MAX_SCANNED_MESSAGES = 10_000;
const PARTICIPANT_SEPARATOR = String.fromCharCode(31);

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

type TableName =
  | "message"
  | "chat"
  | "handle"
  | "chat_message_join"
  | "chat_handle_join";

type MessageQueryRow = {
  row_id: number;
  guid: string | null;
  text: string | null;
  attributed_body: Uint8Array | null;
  is_from_me: number;
  date: number;
  sender_id: string | null;
  chat_id: string;
  chat_name: string | null;
  chat_participants_csv: string | null;
  has_attachments: number;
  is_unread: number | null;
};

export type ChatRecord = {
  chatId: string;
  displayName: string;
  participants: string[];
  lastMessageDate: string | null;
  isGroupChat: boolean;
};

export type MessageRecord = {
  rowId: number;
  guid: string | null;
  text: string;
  textSource: "text" | "attributedBody" | "unreadable" | "empty";
  direction: "incoming" | "outgoing";
  isFromMe: boolean;
  isUnread: boolean | null;
  date: string;
  unixMs: number;
  senderId: string;
  chatId: string;
  chatName: string;
  chatParticipants: string[];
  participantCount: number;
  hasAttachments: boolean;
};

export type DoctorReport = {
  platform: NodeJS.Platform;
  dbPath: string;
  exists: boolean;
  readable: boolean;
  readOnly: boolean;
  messageColumns: string[];
  supports: {
    attributedBody: boolean;
    guid: boolean;
    attachments: boolean;
    unreadFilter: boolean;
  };
  error: string | null;
};

export type ListChatsOptions = {
  dbPath?: string;
  limit?: number;
  search?: string;
};

export type SearchMessagesOptions = {
  dbPath?: string;
  query?: string;
  chat?: string;
  chatId?: string;
  chatExact?: string;
  participant?: string;
  participantExact?: string;
  from?: string;
  to?: string;
  fromMe?: boolean;
  incoming?: boolean;
  unread?: boolean;
  hasAttachments?: boolean;
  afterRowId?: number;
  limit?: number;
  sort?: "asc" | "desc";
};

export type MessageSearchResult = {
  messages: MessageRecord[];
  scanned: number;
  truncated: boolean;
  nextAfterRowId: number | null;
};

type Capabilities = {
  messageColumns: Set<string>;
  hasGuid: boolean;
  hasAttributedBody: boolean;
  hasAttachments: boolean;
  unreadCondition: string | null;
};

export function getChatDbPath(override = Bun.env.IMESSAGE_QUERY_DB_PATH): string {
  return override || DEFAULT_DB_PATH;
}

export function openChatDb(dbPath = getChatDbPath()): Database {
  return new Database(dbPath, { readonly: true });
}

export function macosTimestampToDate(nanoseconds: number): Date {
  const ms = nanoseconds / NS_PER_MS;
  return new Date(CORE_DATA_EPOCH_MS + ms);
}

export function dateToMacosTimestamp(date: Date): number {
  const ms = date.getTime() - CORE_DATA_EPOCH_MS;
  return ms * NS_PER_MS;
}

export function getMessageText(
  text: string | null,
  attributedBody: Uint8Array | null,
): string {
  return getMessageContent(text, attributedBody).text;
}

export function getMessageContent(
  text: string | null,
  attributedBody: Uint8Array | null,
): {
  text: string;
  source: MessageRecord["textSource"];
} {
  if (text) {
    return {
      text,
      source: "text",
    };
  }

  if (!attributedBody) {
    return {
      text: "",
      source: "empty",
    };
  }

  const parsed = parseAttributedBody(attributedBody);
  if (parsed) {
    return {
      text: parsed,
      source: "attributedBody",
    };
  }

  return {
    text: "[attachment or unreadable message]",
    source: "unreadable",
  };
}

export function inspectDatabase(dbPath = getChatDbPath()): DoctorReport {
  const exists = existsSync(dbPath);
  const base: DoctorReport = {
    platform: process.platform,
    dbPath,
    exists,
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

  if (!exists) {
    return {
      ...base,
      error: "chat.db was not found at the configured path",
    };
  }

  try {
    const db = openChatDb(dbPath);
    try {
      db.query("SELECT 1").get();
      const capabilities = getCapabilities(db);

      return {
        ...base,
        readable: true,
        messageColumns: [...capabilities.messageColumns].sort(),
        supports: {
          attributedBody: capabilities.hasAttributedBody,
          guid: capabilities.hasGuid,
          attachments: capabilities.hasAttachments,
          unreadFilter: capabilities.unreadCondition !== null,
        },
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      ...base,
      error: formatUnknownError(error),
    };
  }
}

export function listChats(options: ListChatsOptions = {}): ChatRecord[] {
  const dbPath = options.dbPath || getChatDbPath();
  const limit = normalizeLimit(options.limit, DEFAULT_CHAT_LIMIT);
  const db = openChatDb(dbPath);

  try {
    const conditions: string[] = [];
    const params: Array<number | string> = [];

    if (options.search) {
      const search = toLike(options.search);
      const contactHandles = resolveFuzzyContactHandles(options.search);
      const contactHandleClause =
        contactHandles.length > 0
          ? `
        OR EXISTS (
          SELECT 1
          FROM chat_handle_join chj
          JOIN handle h ON h.ROWID = chj.handle_id
          WHERE chj.chat_id = c.ROWID
            AND h.id IN (${contactHandles.map(() => "?").join(", ")})
        )`
          : "";

      conditions.push(`(
        lower(COALESCE(c.display_name, '')) LIKE ?
        OR lower(COALESCE(c.chat_identifier, '')) LIKE ?
        OR EXISTS (
          SELECT 1
          FROM chat_handle_join chj
          JOIN handle h ON h.ROWID = chj.handle_id
          WHERE chj.chat_id = c.ROWID
            AND lower(h.id) LIKE ?
        )${contactHandleClause}
      )`);
      params.push(search, search, search, ...contactHandles);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = db
      .query<
        {
          chat_id: string;
          display_name: string | null;
          last_date: number | null;
          participants_csv: string | null;
        },
        Array<number | string>
      >(
        `SELECT
          c.chat_identifier AS chat_id,
          c.display_name,
          MAX(m.date) AS last_date,
          (
            SELECT GROUP_CONCAT(participant_id, char(31))
            FROM (
              SELECT DISTINCT h2.id AS participant_id
              FROM chat_handle_join chj2
              JOIN handle h2 ON h2.ROWID = chj2.handle_id
              WHERE chj2.chat_id = c.ROWID
              ORDER BY participant_id
            )
          ) AS participants_csv
        FROM chat c
        LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
        LEFT JOIN message m ON m.ROWID = cmj.message_id
        ${whereClause}
        GROUP BY c.ROWID
        ORDER BY last_date IS NULL, last_date DESC
        LIMIT ?`,
      )
      .all(...params, limit);

    return rows.map((row) => {
      const participants = splitParticipants(row.participants_csv);
      return {
        chatId: row.chat_id,
        displayName: buildResolvedChatName(
          row.display_name,
          participants,
          row.chat_id,
        ),
        participants,
        lastMessageDate: row.last_date
          ? macosTimestampToDate(row.last_date).toISOString()
          : null,
        isGroupChat: participants.length > 1,
      };
    });
  } finally {
    db.close();
  }
}

export function searchMessages(
  options: SearchMessagesOptions = {},
): MessageSearchResult {
  if (options.fromMe && options.incoming) {
    throw new UsageError("Use either --from-me or --incoming, not both.");
  }

  const dbPath = options.dbPath || getChatDbPath();
  const limit = normalizeLimit(options.limit, DEFAULT_MESSAGE_LIMIT);
  const sort = options.sort === "asc" ? "asc" : "desc";
  const db = openChatDb(dbPath);

  try {
    const capabilities = getCapabilities(db);
    const base = buildMessageBaseQuery(options, capabilities);

    if (!options.query) {
      const rows = db
        .query<MessageQueryRow, Array<number | string>>(
          `${base.sql}
          LIMIT ? OFFSET ?`,
        )
        .all(...base.params, limit, 0);
      const messages = rows.map(mapMessageRow);
      return {
        messages,
        scanned: messages.length,
        truncated: false,
        nextAfterRowId: getNextAfterRowId(messages),
      };
    }

    const searchTerm = options.query.toLowerCase();
    const messages: MessageRecord[] = [];
    let scanned = 0;
    let offset = 0;
    let truncated = false;

    while (messages.length < limit && scanned < MAX_SCANNED_MESSAGES) {
      const rows = db
        .query<MessageQueryRow, Array<number | string>>(
          `${base.sql}
          LIMIT ? OFFSET ?`,
        )
        .all(...base.params, SEARCH_BATCH_SIZE, offset);

      if (rows.length === 0) {
        break;
      }

      const batch = rows.map(mapMessageRow);
      scanned += batch.length;
      offset += rows.length;

      for (const message of batch) {
        if (matchesQuery(message, searchTerm)) {
          messages.push(message);
          if (messages.length >= limit) {
            break;
          }
        }
      }
    }

    if (messages.length < limit && scanned >= MAX_SCANNED_MESSAGES) {
      truncated = true;
    }

    if (sort === "asc") {
      messages.sort((left, right) => left.rowId - right.rowId);
    }

    return {
      messages,
      scanned,
      truncated,
      nextAfterRowId: getNextAfterRowId(messages),
    };
  } finally {
    db.close();
  }
}

function parseAttributedBody(raw: Uint8Array): string {
  const blob = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  const index = blob.indexOf(NSSTRING_MARKER);
  if (index === -1) {
    return "";
  }

  const content = blob.subarray(index + NSSTRING_MARKER.length + 5);
  if (content.length === 0) {
    return "";
  }

  let length: number;
  let start: number;
  const firstByte = content[0];

  if (firstByte === undefined) {
    return "";
  }

  if (firstByte === 0x81) {
    const byte1 = content[1];
    const byte2 = content[2];
    if (byte1 === undefined || byte2 === undefined) {
      return "";
    }
    length = byte1 | (byte2 << 8);
    start = 3;
  } else if (firstByte === 0x82) {
    const byte1 = content[1];
    const byte2 = content[2];
    const byte3 = content[3];
    const byte4 = content[4];
    if (
      byte1 === undefined ||
      byte2 === undefined ||
      byte3 === undefined ||
      byte4 === undefined
    ) {
      return "";
    }
    length =
      byte1 |
      (byte2 << 8) |
      (byte3 << 16) |
      (byte4 << 24);
    start = 5;
  } else {
    length = firstByte;
    start = 1;
  }

  if (content.length < start + length) {
    return "";
  }

  return content.subarray(start, start + length).toString("utf-8");
}

function getCapabilities(db: Database): Capabilities {
  const messageColumns = getTableColumns(db, "message");
  const unreadCondition = messageColumns.has("is_read")
    ? "COALESCE(m.is_read, 0) = 0"
    : messageColumns.has("date_read")
      ? "COALESCE(m.date_read, 0) = 0"
      : null;

  return {
    messageColumns,
    hasGuid: messageColumns.has("guid"),
    hasAttributedBody: messageColumns.has("attributedBody"),
    hasAttachments: messageColumns.has("cache_has_attachments"),
    unreadCondition,
  };
}

function getTableColumns(db: Database, tableName: TableName): Set<string> {
  const rows = db
    .query<{ name: string }, []>(`PRAGMA table_info(${tableName})`)
    .all();
  return new Set(rows.map((row) => row.name));
}

function buildMessageBaseQuery(
  options: SearchMessagesOptions,
  capabilities: Capabilities,
): { sql: string; params: Array<number | string> } {
  const conditions: string[] = [];
  const params: Array<number | string> = [];

  if (options.chat) {
    const exact = options.chat;
    const like = toLike(options.chat);
    const contactHandles = resolveFuzzyContactHandles(options.chat);
    const contactHandleClause =
      contactHandles.length > 0
        ? `
      OR EXISTS (
        SELECT 1
        FROM chat_handle_join chj
        JOIN handle h ON h.ROWID = chj.handle_id
        WHERE chj.chat_id = c.ROWID
          AND h.id IN (${contactHandles.map(() => "?").join(", ")})
      )`
        : "";

    conditions.push(`(
      c.chat_identifier = ?
      OR lower(COALESCE(c.chat_identifier, '')) LIKE ?
      OR lower(COALESCE(c.display_name, '')) LIKE ?
      OR EXISTS (
        SELECT 1
        FROM chat_handle_join chj
        JOIN handle h ON h.ROWID = chj.handle_id
        WHERE chj.chat_id = c.ROWID
          AND lower(h.id) LIKE ?
      )${contactHandleClause}
    )`);
    params.push(exact, like, like, like, ...contactHandles);
  }

  if (options.chatId) {
    conditions.push("c.chat_identifier = ?");
    params.push(options.chatId);
  }

  if (options.chatExact) {
    const contactHandles = resolveExactContactHandles(options.chatExact);
    const contactHandleClause =
      contactHandles.length > 0
        ? `
      OR EXISTS (
        SELECT 1
        FROM chat_handle_join chj
        JOIN handle h ON h.ROWID = chj.handle_id
        WHERE chj.chat_id = c.ROWID
          AND h.id IN (${contactHandles.map(() => "?").join(", ")})
      )`
        : "";

    conditions.push(`(
      c.chat_identifier = ?
      OR COALESCE(c.display_name, '') = ?${contactHandleClause}
    )`);
    params.push(options.chatExact, options.chatExact, ...contactHandles);
  }

  if (options.participant) {
    const like = toLike(options.participant);
    const contactHandles = resolveFuzzyContactHandles(options.participant);
    const contactHandleClause =
      contactHandles.length > 0
        ? `
      OR (
        COALESCE(sender.id, '') IN (${contactHandles.map(() => "?").join(", ")})
        OR EXISTS (
          SELECT 1
          FROM chat_handle_join chj
          JOIN handle h ON h.ROWID = chj.handle_id
          WHERE chj.chat_id = c.ROWID
            AND h.id IN (${contactHandles.map(() => "?").join(", ")})
        )
      )`
        : "";

    conditions.push(`(
      lower(COALESCE(sender.id, '')) LIKE ?
      OR EXISTS (
        SELECT 1
        FROM chat_handle_join chj
        JOIN handle h ON h.ROWID = chj.handle_id
        WHERE chj.chat_id = c.ROWID
          AND lower(h.id) LIKE ?
      )${contactHandleClause}
    )`);
    params.push(like, like, ...contactHandles, ...contactHandles);
  }

  if (options.participantExact) {
    const contactHandles = resolveExactContactHandles(options.participantExact);
    const contactHandleClause =
      contactHandles.length > 0
        ? `
      OR (
        COALESCE(sender.id, '') IN (${contactHandles.map(() => "?").join(", ")})
        OR EXISTS (
          SELECT 1
          FROM chat_handle_join chj
          JOIN handle h ON h.ROWID = chj.handle_id
          WHERE chj.chat_id = c.ROWID
            AND h.id IN (${contactHandles.map(() => "?").join(", ")})
        )
      )`
        : "";

    conditions.push(`(
      COALESCE(sender.id, '') = ?
      OR EXISTS (
        SELECT 1
        FROM chat_handle_join chj
        JOIN handle h ON h.ROWID = chj.handle_id
        WHERE chj.chat_id = c.ROWID
          AND h.id = ?
      )${contactHandleClause}
    )`);
    params.push(
      options.participantExact,
      options.participantExact,
      ...contactHandles,
      ...contactHandles,
    );
  }

  if (options.from) {
    conditions.push("m.date >= ?");
    params.push(dateToMacosTimestamp(parseDateInput(options.from, "--from")));
  }

  if (options.to) {
    conditions.push("m.date <= ?");
    params.push(dateToMacosTimestamp(parseDateInput(options.to, "--to")));
  }

  if (typeof options.afterRowId === "number") {
    conditions.push("m.ROWID > ?");
    params.push(options.afterRowId);
  }

  if (options.fromMe) {
    conditions.push("m.is_from_me = 1");
  }

  if (options.incoming) {
    conditions.push("m.is_from_me = 0");
  }

  if (options.hasAttachments) {
    if (!capabilities.hasAttachments) {
      throw new UsageError("Attachment filtering is not supported by this chat.db schema.");
    }
    conditions.push("COALESCE(m.cache_has_attachments, 0) = 1");
  }

  if (options.unread) {
    if (!capabilities.unreadCondition) {
      throw new UsageError("Unread filtering is not supported by this chat.db schema.");
    }
    conditions.push(`m.is_from_me = 0 AND ${capabilities.unreadCondition}`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderDirection = options.sort === "asc" ? "ASC" : "DESC";

  return {
    sql: `SELECT DISTINCT
      m.ROWID AS row_id,
      ${capabilities.hasGuid ? "m.guid" : "NULL"} AS guid,
      m.text,
      ${capabilities.hasAttributedBody ? "m.attributedBody" : "NULL"} AS attributed_body,
      m.is_from_me,
      m.date,
      sender.id AS sender_id,
      c.chat_identifier AS chat_id,
      c.display_name AS chat_name,
      (
        SELECT GROUP_CONCAT(participant_id, char(31))
        FROM (
          SELECT DISTINCT h2.id AS participant_id
          FROM chat_handle_join chj2
          JOIN handle h2 ON h2.ROWID = chj2.handle_id
          WHERE chj2.chat_id = c.ROWID
          ORDER BY participant_id
        )
      ) AS chat_participants_csv,
      ${capabilities.hasAttachments ? "COALESCE(m.cache_has_attachments, 0)" : "0"} AS has_attachments,
      ${capabilities.unreadCondition ? `(${capabilities.unreadCondition})` : "NULL"} AS is_unread
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    LEFT JOIN handle sender ON sender.ROWID = m.handle_id
    ${whereClause}
    ORDER BY m.date ${orderDirection}, m.ROWID ${orderDirection}`,
    params,
  };
}

function mapMessageRow(row: MessageQueryRow): MessageRecord {
  const content = getMessageContent(row.text, row.attributed_body);
  const chatParticipants = splitParticipants(row.chat_participants_csv);
  const date = macosTimestampToDate(row.date);
  const chatName = buildResolvedChatName(
    row.chat_name,
    chatParticipants,
    row.chat_id,
  );
  return {
    rowId: row.row_id,
    guid: row.guid,
    text: content.text,
    textSource: content.source,
    direction: row.is_from_me === 1 ? "outgoing" : "incoming",
    isFromMe: row.is_from_me === 1,
    isUnread: row.is_unread === null ? null : row.is_unread === 1,
    date: date.toISOString(),
    unixMs: date.getTime(),
    senderId: row.is_from_me === 1 ? "me" : row.sender_id || "unknown",
    chatId: row.chat_id,
    chatName,
    chatParticipants,
    participantCount: chatParticipants.length,
    hasAttachments: row.has_attachments === 1,
  };
}

function matchesQuery(message: MessageRecord, searchTerm: string): boolean {
  const haystacks = [
    message.text,
    message.senderId,
    message.chatId,
    message.chatName,
    ...message.chatParticipants,
  ];

  return haystacks.some((value) => value.toLowerCase().includes(searchTerm));
}

function parseDateInput(raw: string, flagName: string): Date {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new UsageError(`${flagName} must be a valid ISO-8601 date.`);
  }
  return date;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new UsageError("--limit must be a positive integer.");
  }
  return Math.min(resolved, MAX_LIMIT);
}

function splitParticipants(participantsCsv: string | null): string[] {
  if (!participantsCsv) {
    return [];
  }

  return participantsCsv
    .split(PARTICIPANT_SEPARATOR)
    .map((value) => value.trim())
    .filter(Boolean);
}

function getNextAfterRowId(messages: MessageRecord[]): number | null {
  if (messages.length === 0) {
    return null;
  }

  return messages.reduce((max, message) => Math.max(max, message.rowId), 0);
}

function toLike(value: string): string {
  return `%${value.toLowerCase()}%`;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createAttributedBodyFixture(text: string): Uint8Array {
  const prefix = Buffer.concat([
    Buffer.from("NSString"),
    Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]),
  ]);
  const content = Buffer.from(text, "utf-8");

  if (content.length > 0xffff) {
    throw new UsageError("Fixture text is too long.");
  }

  const lengthPrefix =
    content.length >= 0x81
      ? Buffer.from([0x81, content.length & 0xff, (content.length >> 8) & 0xff])
      : Buffer.from([content.length]);

  return Buffer.concat([prefix, lengthPrefix, content]);
}

export function makeTempDbPath(fileName: string): string {
  return join(tmpdir(), fileName);
}
