import {
  type MessageRecord,
  type SearchMessagesOptions,
  searchMessages,
} from "./imessage.ts";

export type TailSearchOptions = Omit<SearchMessagesOptions, "query" | "sort">;

export type TailReadyEvent = {
  type: "ready";
  cursor: number | null;
  pollIntervalMs: number;
};

export type TailBatchEvent = {
  type: "batch";
  cursor: number | null;
  pollCount: number;
  messages: MessageRecord[];
};

export type TailDoneEvent = {
  type: "done";
  cursor: number | null;
  pollCount: number;
  reason: "once" | "max-polls";
};

export function resolveTailCursor(
  options: Omit<TailSearchOptions, "afterRowId" | "limit">,
): number | null {
  const snapshot = searchMessages({
    ...options,
    sort: "desc",
    limit: 1,
  });

  return snapshot.nextAfterRowId;
}

export function pollTailBatch(options: TailSearchOptions): {
  cursor: number | null;
  messages: MessageRecord[];
} {
  const result = searchMessages({
    ...options,
    sort: "asc",
  });

  return {
    cursor: result.nextAfterRowId ?? options.afterRowId ?? null,
    messages: result.messages,
  };
}
