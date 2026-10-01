"use client";

import type { TapInput } from "@/lib/taps";

/**
 * Taps are written here first (IndexedDB, in-memory fallback) and removed once
 * the server has accepted them. Survives reloads; retried with backoff.
 */

export type OutboxTap = TapInput & { queuedAt: number };

const DB_NAME = "live-splits-outbox";
const STORE = "taps";

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, OutboxTap>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientTapId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    run(t.objectStore(STORE));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function outboxAdd(tap: OutboxTap): Promise<void> {
  memory.set(tap.clientTapId, tap);
  const db = await openDb();
  if (db) await tx(db, "readwrite", (s) => s.put(tap)).catch(() => {});
}

export async function outboxRemove(ids: string[]): Promise<void> {
  for (const id of ids) memory.delete(id);
  const db = await openDb();
  if (db) await tx(db, "readwrite", (s) => ids.forEach((id) => s.delete(id))).catch(() => {});
}

/** Everything still unsent, oldest first. Loads IndexedDB into memory on first call. */
export async function outboxAll(): Promise<OutboxTap[]> {
  const db = await openDb();
  if (db) {
    const stored = await new Promise<OutboxTap[]>((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as OutboxTap[]);
      req.onerror = () => resolve([]);
    });
    for (const t of stored) memory.set(t.clientTapId, t);
  }
  return [...memory.values()].sort((a, b) => a.queuedAt - b.queuedAt);
}
