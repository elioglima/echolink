import { normalizeJournalUserPhrase } from "./journalPhraseDedup";

const LEGACY_DB_NAME = "echoLinkTranscriptJournal";
const LEGACY_STORE = "entries";
const REGISTRY_DB_NAME = "echoLinkJournalRegistry";
const REGISTRY_STORE = "voices";
const JOURNAL_DB_PREFIX = "echoLinkJournal__";
const JOURNAL_STORE = "entries";
const REGISTRY_VERSION = 1;
const JOURNAL_DB_VERSION = 1;

export type TranscriptJournalRow = {
  journalKey: string;
  date: string;
  voice_id: string;
  voice_label?: string;
  fraseusuario: string;
  frasetranformada: string;
  audiobase64: string;
  selected: number;
};

export type JournalVoiceBucket = {
  voiceId: string;
  slug: string;
};

export function createTranscriptJournalKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB"));
  });
}

async function sha256Hex16(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle && typeof TextEncoder !== "undefined") {
    const buf = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  }
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h, 33) ^ text.charCodeAt(i)!;
  }
  return `djb2_${(h >>> 0).toString(16)}`.slice(0, 16).padEnd(16, "0");
}

export async function voiceIdToJournalSlug(voiceId: string): Promise<string> {
  const norm = voiceId.trim() || "__default__";
  return sha256Hex16(norm);
}

const journalDbPromises = new Map<string, Promise<IDBDatabase>>();
let registryDbPromise: Promise<IDBDatabase> | null = null;
let legacyMigrationPromise: Promise<void> | null = null;

function openRegistryDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("no idb"));
  }
  if (!registryDbPromise) {
    registryDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(REGISTRY_DB_NAME, REGISTRY_VERSION);
      req.onerror = () => {
        registryDbPromise = null;
        reject(req.error ?? new Error("idb registry"));
      };
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(REGISTRY_STORE)) {
          db.createObjectStore(REGISTRY_STORE, { keyPath: "slug" });
        }
      };
    });
  }
  return registryDbPromise;
}

function openJournalDbForSlug(slug: string): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("no idb"));
  }
  let p = journalDbPromises.get(slug);
  if (!p) {
    const dbName = `${JOURNAL_DB_PREFIX}${slug}`;
    p = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, JOURNAL_DB_VERSION);
      req.onerror = () => {
        journalDbPromises.delete(slug);
        reject(req.error ?? new Error("idb journal"));
      };
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(JOURNAL_STORE)) {
          db.createObjectStore(JOURNAL_STORE, { keyPath: "journalKey" });
        }
      };
    });
    journalDbPromises.set(slug, p);
  }
  return p;
}

async function registerVoiceSlug(voiceId: string, slug: string): Promise<void> {
  try {
    const db = await openRegistryDb();
    const tx = db.transaction(REGISTRY_STORE, "readwrite");
    await idbRequest(
      tx.objectStore(REGISTRY_STORE).put({
        slug,
        voiceId: voiceId.trim(),
      })
    );
  } catch {
    /* ignore */
  }
}

async function migrateLegacyJournalOnce(): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return;
  }
  if (!legacyMigrationPromise) {
    legacyMigrationPromise = new Promise((resolve) => {
      const req = indexedDB.open(LEGACY_DB_NAME, 1);
      req.onerror = () => resolve();
      req.onsuccess = async () => {
        const db = req.result;
        try {
          if (!db.objectStoreNames.contains(LEGACY_STORE)) {
            db.close();
            indexedDB.deleteDatabase(LEGACY_DB_NAME);
            resolve();
            return;
          }
          const tx = db.transaction(LEGACY_STORE, "readonly");
          const all = (await idbRequest(
            tx.objectStore(LEGACY_STORE).getAll()
          )) as TranscriptJournalRow[];
          db.close();
          for (const row of all) {
            const vid = (row.voice_id ?? "").trim();
            const slug = await voiceIdToJournalSlug(vid);
            const jdb = await openJournalDbForSlug(slug);
            const wtx = jdb.transaction(JOURNAL_STORE, "readwrite");
            await idbRequest(wtx.objectStore(JOURNAL_STORE).put(row));
            await registerVoiceSlug(vid, slug);
          }
          indexedDB.deleteDatabase(LEGACY_DB_NAME);
        } catch {
          try {
            db.close();
          } catch {
            /* ignore */
          }
        }
        resolve();
      };
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LEGACY_STORE)) {
          db.createObjectStore(LEGACY_STORE, { keyPath: "journalKey" });
        }
      };
    });
  }
  await legacyMigrationPromise;
}

export async function ensureJournalStorageReady(): Promise<void> {
  await migrateLegacyJournalOnce();
}

export async function listJournalVoiceBuckets(): Promise<JournalVoiceBucket[]> {
  try {
    await ensureJournalStorageReady();
    const db = await openRegistryDb();
    const tx = db.transaction(REGISTRY_STORE, "readonly");
    const all = (await idbRequest(
      tx.objectStore(REGISTRY_STORE).getAll()
    )) as { slug: string; voiceId: string }[];
    const seen = new Set<string>();
    const out: JournalVoiceBucket[] = [];
    for (const r of all) {
      if (!r?.slug || seen.has(r.slug)) continue;
      seen.add(r.slug);
      out.push({
        slug: r.slug,
        voiceId: typeof r.voiceId === "string" ? r.voiceId : "",
      });
    }
    out.sort((a, b) =>
      (a.voiceId || "__default__").localeCompare(b.voiceId || "__default__")
    );
    return out;
  } catch {
    return [];
  }
}

export async function listTranscriptJournalRowsForVoice(
  voiceId: string
): Promise<TranscriptJournalRow[]> {
  try {
    await ensureJournalStorageReady();
    const slug = await voiceIdToJournalSlug(voiceId);
    const db = await openJournalDbForSlug(slug);
    const tx = db.transaction(JOURNAL_STORE, "readonly");
    const all = (await idbRequest(
      tx.objectStore(JOURNAL_STORE).getAll()
    )) as TranscriptJournalRow[];
    return [...all].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  } catch {
    return [];
  }
}

export async function upsertTranscriptJournalRow(
  row: TranscriptJournalRow
): Promise<void> {
  try {
    await ensureJournalStorageReady();
    const vid = (row.voice_id ?? "").trim();
    const slug = await voiceIdToJournalSlug(vid);
    const db = await openJournalDbForSlug(slug);
    const tx = db.transaction(JOURNAL_STORE, "readwrite");
    await idbRequest(tx.objectStore(JOURNAL_STORE).put(row));
    await registerVoiceSlug(vid, slug);
  } catch {
    /* ignore */
  }
}

export async function hasJournalUserPhraseDuplicateForVoice(
  userPhrasePt: string,
  voiceId: string
): Promise<boolean> {
  const needle = normalizeJournalUserPhrase(userPhrasePt);
  if (!needle) {
    return false;
  }
  try {
    const rows = await listTranscriptJournalRowsForVoice(voiceId);
    return rows.some(
      (r) => normalizeJournalUserPhrase(r.fraseusuario) === needle
    );
  } catch {
    return false;
  }
}

export async function deleteTranscriptJournalRow(
  journalKey: string,
  voiceId: string
): Promise<boolean> {
  try {
    await ensureJournalStorageReady();
    const slug = await voiceIdToJournalSlug(voiceId);
    const db = await openJournalDbForSlug(slug);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(JOURNAL_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("idb"));
      tx.objectStore(JOURNAL_STORE).delete(journalKey);
    });
    const countTx = db.transaction(JOURNAL_STORE, "readonly");
    const count = await idbRequest(
      countTx.objectStore(JOURNAL_STORE).count()
    );
    if (count === 0) {
      journalDbPromises.delete(slug);
      try {
        db.close();
      } catch {
        /* ignore */
      }
      indexedDB.deleteDatabase(`${JOURNAL_DB_PREFIX}${slug}`);
      const reg = await openRegistryDb();
      const rtx = reg.transaction(REGISTRY_STORE, "readwrite");
      await idbRequest(rtx.objectStore(REGISTRY_STORE).delete(slug));
    }
    return true;
  } catch {
    return false;
  }
}

export async function patchTranscriptJournalSelected(
  journalKey: string,
  selected: number,
  voiceId: string
): Promise<void> {
  try {
    await ensureJournalStorageReady();
    const slug = await voiceIdToJournalSlug(voiceId);
    const db = await openJournalDbForSlug(slug);
    const tx = db.transaction(JOURNAL_STORE, "readwrite");
    const store = tx.objectStore(JOURNAL_STORE);
    const cur = (await idbRequest(store.get(journalKey))) as
      | TranscriptJournalRow
      | undefined;
    if (!cur) {
      return;
    }
    await idbRequest(
      store.put({
        ...cur,
        selected: Math.max(0, Math.round(selected)),
      })
    );
  } catch {
    /* ignore */
  }
}

export function decodeBase64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}

export function arrayBufferToBase64Mp3(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    const end = Math.min(i + chunk, bytes.length);
    for (let j = i; j < end; j++) {
      binary += String.fromCharCode(bytes[j]!);
    }
  }
  return btoa(binary);
}
