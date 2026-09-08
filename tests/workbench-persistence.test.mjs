import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKBENCH_SNAPSHOT_FORMAT,
  createIndexedDbPersistence,
  createWorkbenchSnapshot,
  normalizeWorkbenchSnapshot
} from "../apps/lead-workbench/persistence.mjs";

function fakeIndexedDb() {
  const records = new Map();
  const stores = new Set();

  function request(action, transaction) {
    const result = {};
    queueMicrotask(() => {
      try {
        result.result = action();
        result.onsuccess?.();
        queueMicrotask(() => transaction.oncomplete?.());
      } catch (error) {
        result.error = error;
        transaction.error = error;
        result.onerror?.();
        transaction.onerror?.();
      }
    });
    return result;
  }

  return {
    open() {
      const result = {};
      queueMicrotask(() => {
        const database = {
          objectStoreNames: { contains: (name) => stores.has(name) },
          createObjectStore: (name) => stores.add(name),
          transaction(storeName) {
            if (!stores.has(storeName)) throw new Error("missing store");
            const transaction = {
              objectStore() {
                return {
                  get: (key) => request(() => records.get(key), transaction),
                  put: (value, key) => request(() => records.set(key, structuredClone(value)), transaction),
                  delete: (key) => request(() => records.delete(key), transaction)
                };
              }
            };
            return transaction;
          }
        };
        result.result = database;
        result.onupgradeneeded?.();
        result.onsuccess?.();
      });
      return result;
    }
  };
}

test("workbench snapshots are versioned and detached from live state", () => {
  const state = {
    currentResult: { count: 1 },
    selectedWebsiteEvidenceIds: ["evidence-1"],
    apiKey: "must-not-persist",
    ui: {
      channel: "alibaba",
      prospectSearchConfirmed: "true",
      websiteConfirmed: "true",
      secretToken: "must-not-persist"
    }
  };
  const snapshot = createWorkbenchSnapshot(state, { savedAt: "2026-09-08T08:00:00.000Z" });
  state.currentResult.count = 9;
  assert.equal(snapshot.format, WORKBENCH_SNAPSHOT_FORMAT);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.savedAt, "2026-09-08T08:00:00.000Z");
  assert.equal(snapshot.state.currentResult.count, 1);
  assert.equal(snapshot.state.ui.channel, "alibaba");
  assert.equal("apiKey" in snapshot.state, false);
  assert.equal("prospectSearchConfirmed" in snapshot.state.ui, false);
  assert.equal("websiteConfirmed" in snapshot.state.ui, false);
  assert.equal(JSON.stringify(snapshot).includes("must-not-persist"), false);
});

test("snapshot normalization rejects corrupt and future data", () => {
  assert.throws(() => normalizeWorkbenchSnapshot({}), /格式/);
  assert.throws(() => normalizeWorkbenchSnapshot({
    format: WORKBENCH_SNAPSHOT_FORMAT,
    schemaVersion: 2,
    savedAt: "2026-09-08T08:00:00.000Z",
    state: {}
  }), /更新版本/);
  assert.throws(() => normalizeWorkbenchSnapshot({
    format: WORKBENCH_SNAPSHOT_FORMAT,
    schemaVersion: 1,
    savedAt: "not-a-date",
    state: {}
  }), /保存时间/);
});

test("IndexedDB persistence saves, restores and clears one current snapshot", async () => {
  const persistence = createIndexedDbPersistence(fakeIndexedDb(), {
    databaseName: "test-lydia",
    storeName: "snapshots"
  });
  assert.equal(await persistence.load(), null);

  const snapshot = createWorkbenchSnapshot({
    currentResult: { count: 2, apiKey: undefined },
    currentProspectResult: { count: 3 }
  }, { savedAt: "2026-09-08T09:00:00.000Z" });
  await persistence.save(snapshot);
  const restored = await persistence.load();
  assert.deepEqual(restored, snapshot);

  restored.state.currentResult.count = 99;
  assert.equal((await persistence.load()).state.currentResult.count, 2);
  await persistence.clear();
  assert.equal(await persistence.load(), null);
});
