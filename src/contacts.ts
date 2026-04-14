import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ADDRESSBOOK_ROOT = join(
  homedir(),
  "Library",
  "Application Support",
  "AddressBook",
);

type ContactIndex = {
  exactNameToHandles: Map<string, Set<string>>;
  handleToNames: Map<string, Set<string>>;
};

let cachedKey: string | null = null;
let cachedIndex: ContactIndex | null = null;

export function resolveExactContactHandles(name: string): string[] {
  const normalized = normalizeName(name);
  if (!normalized) {
    return [];
  }

  const handles = getContactIndex().exactNameToHandles.get(normalized);
  if (!handles) {
    return [];
  }

  return [...handles].sort();
}

export function resolveFuzzyContactHandles(query: string): string[] {
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) {
    return [];
  }

  const handles = new Set<string>();
  for (const [name, mappedHandles] of getContactIndex().exactNameToHandles) {
    if (!name.includes(normalizedQuery)) {
      continue;
    }
    for (const handle of mappedHandles) {
      handles.add(handle);
    }
  }

  return [...handles].sort();
}

export function resolveHandleDisplayName(handle: string): string | null {
  const normalizedHandle = normalizeHandle(handle);
  if (!normalizedHandle) {
    return null;
  }

  const names = getContactIndex().handleToNames.get(normalizedHandle);
  if (!names || names.size === 0) {
    return null;
  }

  return [...names].sort(byShortestThenAlphabetical)[0] ?? null;
}

export function buildResolvedChatName(
  rawDisplayName: string | null,
  participants: string[],
  fallback: string,
): string {
  const trimmedDisplayName = rawDisplayName?.trim();
  if (trimmedDisplayName) {
    return trimmedDisplayName;
  }

  const labels = participants.map((participant) => {
    return resolveHandleDisplayName(participant) || participant;
  });

  const uniqueLabels = [...new Set(labels.filter(Boolean))];
  return uniqueLabels.join(", ") || fallback;
}

export function resetContactCache(): void {
  cachedKey = null;
  cachedIndex = null;
}

function getContactIndex(): ContactIndex {
  const dbPaths = getContactDbPaths();
  const key = dbPaths.join("|");

  if (cachedIndex && cachedKey === key) {
    return cachedIndex;
  }

  const exactNameToHandles = new Map<string, Set<string>>();
  const handleToNames = new Map<string, Set<string>>();

  for (const dbPath of dbPaths) {
    let db: Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
      const rows = db
        .query<
          {
            name: string | null;
            phone: string | null;
            email: string | null;
          },
          []
        >(
          `SELECT
            COALESCE(NULLIF(r.ZNAME, ''), trim(COALESCE(r.ZFIRSTNAME, '') || ' ' || COALESCE(r.ZLASTNAME, ''))) AS name,
            p.ZFULLNUMBER AS phone,
            e.ZADDRESS AS email
          FROM ZABCDRECORD r
          LEFT JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
          LEFT JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
          WHERE (p.ZFULLNUMBER IS NOT NULL AND p.ZFULLNUMBER != '')
             OR (e.ZADDRESS IS NOT NULL AND e.ZADDRESS != '')`,
        )
        .all();

      for (const row of rows) {
        const name = normalizeName(row.name);
        if (!name) {
          continue;
        }

        const displayName = row.name?.trim();
        const handles = [row.phone, row.email]
          .map((value) => normalizeHandle(value))
          .filter((value): value is string => Boolean(value));

        for (const handle of handles) {
          addToMultiMap(exactNameToHandles, name, handle);
          if (displayName) {
            addToMultiMap(handleToNames, handle, displayName);
          }
        }
      }
    } catch {
      continue;
    } finally {
      db?.close();
    }
  }

  cachedKey = key;
  cachedIndex = {
    exactNameToHandles,
    handleToNames,
  };
  return cachedIndex;
}

function getContactDbPaths(): string[] {
  const override = Bun.env.IMESSAGE_QUERY_CONTACT_DB_PATHS;
  if (override) {
    return override
      .split(":")
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => existsSync(value));
  }

  if (!existsSync(ADDRESSBOOK_ROOT)) {
    return [];
  }

  const paths: string[] = [];
  walkAddressBook(ADDRESSBOOK_ROOT, paths);
  return [...new Set(paths)].sort();
}

function walkAddressBook(directory: string, paths: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walkAddressBook(fullPath, paths);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".abcddb")) {
      paths.push(fullPath);
    }
  }
}

function addToMultiMap(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const bucket = map.get(key);
  if (bucket) {
    bucket.add(value);
    return;
  }

  map.set(key, new Set([value]));
}

function normalizeName(value: string | null | undefined): string {
  return value?.trim().toLowerCase() || "";
}

function normalizeHandle(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  if (raw.includes("@")) {
    return raw.toLowerCase();
  }

  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) {
    return raw.toLowerCase();
  }

  return raw.startsWith("+") ? `+${digits}` : digits;
}

function byShortestThenAlphabetical(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  return left.localeCompare(right);
}
