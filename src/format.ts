import type {
  ChatRecord,
  DoctorReport,
  MessageSearchResult,
} from "./imessage.ts";
import type {
  TailBatchEvent,
  TailDoneEvent,
  TailReadyEvent,
} from "./tail.ts";

export function formatDoctor(report: DoctorReport): string {
  const lines = [
    `platform: ${report.platform}`,
    `db_path: ${report.dbPath}`,
    `exists: ${report.exists ? "yes" : "no"}`,
    `readable: ${report.readable ? "yes" : "no"}`,
    `read_only: ${report.readOnly ? "yes" : "no"}`,
  ];

  if (report.error) {
    lines.push(`error: ${report.error}`);
  }

  lines.push(
    `supports: attributedBody=${report.supports.attributedBody ? "yes" : "no"}, guid=${report.supports.guid ? "yes" : "no"}, attachments=${report.supports.attachments ? "yes" : "no"}, unreadFilter=${report.supports.unreadFilter ? "yes" : "no"}`,
  );

  if (report.messageColumns.length > 0) {
    lines.push(`message_columns: ${report.messageColumns.join(", ")}`);
  }

  return lines.join("\n");
}

export function formatChats(chats: ChatRecord[]): string {
  if (chats.length === 0) {
    return "No chats found.";
  }

  return chats
    .map((chat) => {
      const lines = [
        chat.chatId,
        `  name: ${chat.displayName}`,
        `  participants: ${chat.participants.join(", ") || "(none)"}`,
        `  last_message: ${chat.lastMessageDate || "unknown"}`,
        `  group: ${chat.isGroupChat ? "yes" : "no"}`,
      ];
      return lines.join("\n");
    })
    .join("\n\n");
}

export function formatMessages(result: MessageSearchResult): string {
  if (result.messages.length === 0) {
    return "No messages found.";
  }

  const body = result.messages
    .map((message) => {
      const flags: string[] = [];
      if (message.hasAttachments) {
        flags.push("attachments");
      }
      if (message.isUnread === true) {
        flags.push("unread");
      }
      flags.push(message.direction);

      const header = `[${message.rowId}] ${message.date} ${message.isFromMe ? "me" : message.senderId} @ ${message.chatName}`;
      const flagLine = flags.length > 0 ? `  flags: ${flags.join(", ")}` : null;

      return [header, `  text: ${message.text}`, flagLine]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const footer = [
    `scanned: ${result.scanned}`,
    `next_after_rowid: ${result.nextAfterRowId ?? "none"}`,
    `truncated: ${result.truncated ? "yes" : "no"}`,
  ].join("\n");

  return `${body}\n\n${footer}`;
}

export function formatTailReady(event: TailReadyEvent): string {
  return `ready: cursor=${event.cursor ?? "none"} poll_interval_ms=${event.pollIntervalMs}`;
}

export function formatTailBatch(event: TailBatchEvent): string {
  const body = formatMessages({
    messages: event.messages,
    scanned: event.messages.length,
    truncated: false,
    nextAfterRowId: event.cursor,
  });

  return `batch: poll=${event.pollCount}\n${body}`;
}

export function formatTailDone(event: TailDoneEvent): string {
  return `done: reason=${event.reason} cursor=${event.cursor ?? "none"} poll_count=${event.pollCount}`;
}
