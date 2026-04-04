const DB_NAME = "echoLinkVoiceTranslationCache";
const DB_VERSION = 1;
const STORE = "phrases";
const INDEX_CREATED = "byCreated";
const MAX_ENTRIES = 50;

function normalizePhraseForVoiceCache(pt: string): string {
  return pt.trim().replace(/\s+/g, " ").toLowerCase();
}

async function phraseCacheKey(
  pt: string,
  voiceIdForKey: string
): Promise<string> {
  const norm = normalizePhraseForVoiceCache(pt);
  const v = voiceIdForKey.trim().toLowerCase() || "_default";
  const payload = `${norm}\0${v}`;
  if (
    typeof crypto !== "undefined" &&
    crypto.subtle &&
    typeof TextEncoder !== "undefined"
  ) {
    const buf = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  let h = 5381;
  for (let i = 0; i < payload.length; i++) {
    h = Math.imul(h, 33) ^ payload.charCodeAt(i)!;
  }
  return `djb2_${(h >>> 0).toString(16)}_${payload.length}`;
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openVoiceTranslationCacheDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("no idb"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error("idb open"));
      };
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "key" });
          os.createIndex(INDEX_CREATED, "createdAt", { unique: false });
        }
      };
    });
  }
  return dbPromise;
}

type CacheRow = {
  key: string;
  translatedText: string;
  audio: ArrayBuffer;
  createdAt: number;
};

async function evictOldestIfOverLimit(db: IDBDatabase): Promise<void> {
  const txr = db.transaction(STORE, "readonly");
  const count = await idbRequest(txr.objectStore(STORE).count());
  if (count <= MAX_ENTRIES) {
    return;
  }
  const toRemove = count - MAX_ENTRIES;
  const txw = db.transaction(STORE, "readwrite");
  const idx = txw.objectStore(STORE).index(INDEX_CREATED);
  await new Promise<void>((resolve, reject) => {
    let removed = 0;
    const cursorReq = idx.openCursor();
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (!cur || removed >= toRemove) {
        resolve();
        return;
      }
      cur.delete();
      removed += 1;
      cur.continue();
    };
  });
}

export async function lookupVoiceTranslationCache(
  ptText: string,
  voiceIdForKey: string
): Promise<{ translatedText: string; audio: ArrayBuffer } | null> {
  const raw = ptText.trim();
  if (raw.length === 0) {
    return null;
  }
  try {
    const db = await openVoiceTranslationCacheDb();
    const key = await phraseCacheKey(raw, voiceIdForKey);
    const tx = db.transaction(STORE, "readonly");
    const row = (await idbRequest(
      tx.objectStore(STORE).get(key)
    )) as CacheRow | undefined;
    if (!row?.audio || typeof row.translatedText !== "string") {
      return null;
    }
    return {
      translatedText: row.translatedText,
      audio: row.audio.slice(0),
    };
  } catch {
    return null;
  }
}

export async function storeVoiceTranslationCache(
  ptText: string,
  translatedText: string,
  audio: ArrayBuffer,
  voiceIdForKey: string
): Promise<void> {
  const raw = ptText.trim();
  if (raw.length === 0 || !translatedText.trim()) {
    return;
  }
  try {
    const db = await openVoiceTranslationCacheDb();
    const key = await phraseCacheKey(raw, voiceIdForKey);
    const tx = db.transaction(STORE, "readwrite");
    const row: CacheRow = {
      key,
      translatedText,
      audio: audio.slice(0),
      createdAt: Date.now(),
    };
    await idbRequest(tx.objectStore(STORE).put(row));
    await evictOldestIfOverLimit(db);
  } catch {
    /* ignore */
  }
}
