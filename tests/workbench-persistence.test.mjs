import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WORKSPACE_NAME,
  WORKBENCH_SNAPSHOT_FORMAT,
  WORKSPACE_INDEX_FORMAT,
  assertPayloadMatchesWorkspace,
  createIndexedDbPersistence,
  createWorkbenchSnapshot,
  createWorkspaceFilename,
  createWorkspaceReference,
  normalizeWorkbenchSnapshot,
  normalizeWorkspaceIndex,
  normalizeWorkspaceName
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
    records,
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

test("workspace names and indexes reject unsafe or ambiguous records", () => {
  assert.equal(normalizeWorkspaceName("  客户 A   户外家具 "), "客户 A 户外家具");
  assert.throws(() => normalizeWorkspaceName("  "), /不能为空/);
  assert.throws(() => normalizeWorkspaceName("a".repeat(61)), /60/);
  const workspace = {
    id: "ws_test_one",
    name: "客户 A",
    createdAt: "2026-09-08T08:00:00.000Z",
    updatedAt: "2026-09-08T08:00:00.000Z"
  };
  const normalized = normalizeWorkspaceIndex({
    format: WORKSPACE_INDEX_FORMAT,
    schemaVersion: 1,
    activeWorkspaceId: workspace.id,
    workspaces: [workspace],
    secretToken: "must-not-persist"
  });
  assert.equal(normalized.workspaces[0].name, "客户 A");
  assert.equal("secretToken" in normalized, false);
  assert.throws(() => normalizeWorkspaceIndex({
    ...normalized,
    workspaces: [workspace, { ...workspace, id: "ws_test_two", name: "客户 a" }]
  }), /名称不能重复/);
  assert.throws(() => normalizeWorkspaceIndex({ ...normalized, schemaVersion: 2 }), /更新版本/);
});

test("exports carry a customer-space marker and mismatched imports fail closed", () => {
  const workspace = { id: "ws_test_one", name: "客户 A / 户外家具" };
  const reference = createWorkspaceReference(workspace, { exportedAt: "2026-09-08T08:00:00.000Z" });
  assert.deepEqual(reference, {
    format: "lydia-workspace-reference",
    schemaVersion: 1,
    id: "ws_test_one",
    name: "客户 A / 户外家具",
    exportedAt: "2026-09-08T08:00:00.000Z"
  });
  assert.equal(
    createWorkspaceFilename(workspace, "客户分级", { exportedAt: "2026-09-08T08:00:00.000Z" }),
    "Lydia-客户-A---户外家具-客户分级-2026-09-08.json"
  );
  assert.doesNotThrow(() => assertPayloadMatchesWorkspace({ workspace: reference }, workspace));
  assert.doesNotThrow(() => assertPayloadMatchesWorkspace({ workspace: { ...reference, id: "ws_other", name: workspace.name } }, workspace));
  assert.throws(() => assertPayloadMatchesWorkspace({
    workspace: { ...reference, id: "ws_other", name: "客户 B" }
  }, workspace), /防止串客户/);
  assert.doesNotThrow(() => assertPayloadMatchesWorkspace({ results: [] }, workspace));
});

test("legacy current snapshot migrates into the first isolated workspace", async () => {
  const indexedDb = fakeIndexedDb();
  const legacySnapshot = createWorkbenchSnapshot({
    currentResult: { count: 2 }
  }, { savedAt: "2026-09-08T09:00:00.000Z" });
  indexedDb.records.set("current", structuredClone(legacySnapshot));
  const persistence = createIndexedDbPersistence(indexedDb, {
    databaseName: "test-lydia",
    storeName: "snapshots"
  });
  const index = await persistence.initializeWorkspaces();
  assert.equal(index.workspaces.length, 1);
  assert.equal(index.workspaces[0].name, DEFAULT_WORKSPACE_NAME);
  assert.equal(index.activeWorkspaceId, "ws_legacy_current");
  assert.deepEqual(await persistence.loadWorkspace(index.activeWorkspaceId), legacySnapshot);
  assert.equal(indexedDb.records.has("current"), false);
  assert.equal(indexedDb.records.has("workspace:ws_legacy_current"), true);
});

test("IndexedDB keeps customer workspaces separate and clears only the selected one", async () => {
  let id = 0;
  const persistence = createIndexedDbPersistence(fakeIndexedDb(), {
    databaseName: "test-lydia-isolation",
    storeName: "snapshots",
    idFactory: () => `test_${++id}`
  });
  const initialIndex = await persistence.initializeWorkspaces();
  const firstId = initialIndex.activeWorkspaceId;

  const firstSnapshot = createWorkbenchSnapshot({
    currentResult: { count: 2, apiKey: undefined },
    currentProspectResult: { count: 3, customer: "A" }
  }, { savedAt: "2026-09-08T09:00:00.000Z" });
  await persistence.saveWorkspace(firstId, firstSnapshot);

  const secondIndex = await persistence.createWorkspace("客户 B");
  const secondId = secondIndex.activeWorkspaceId;
  assert.notEqual(secondId, firstId);
  assert.equal(await persistence.loadWorkspace(secondId), null);
  const secondSnapshot = createWorkbenchSnapshot({
    currentResult: { count: 7 },
    currentProspectResult: { count: 1, customer: "B" }
  }, { savedAt: "2026-09-08T10:00:00.000Z" });
  await persistence.saveWorkspace(secondId, secondSnapshot);

  assert.deepEqual(await persistence.loadWorkspace(firstId), firstSnapshot);
  assert.deepEqual(await persistence.loadWorkspace(secondId), secondSnapshot);
  const restored = await persistence.loadWorkspace(firstId);
  restored.state.currentResult.count = 99;
  assert.equal((await persistence.loadWorkspace(firstId)).state.currentResult.count, 2);

  await persistence.clearWorkspace(secondId);
  assert.equal(await persistence.loadWorkspace(secondId), null);
  assert.deepEqual(await persistence.loadWorkspace(firstId), firstSnapshot);

  const renamed = await persistence.renameWorkspace(firstId, "客户 A · 家具");
  assert.equal(renamed.workspaces.find((workspace) => workspace.id === firstId).name, "客户 A · 家具");
  await assert.rejects(() => persistence.createWorkspace("客户 B"), /名称不能重复/);

  const activeFirst = await persistence.setActiveWorkspace(firstId);
  assert.equal(activeFirst.activeWorkspaceId, firstId);
  const afterDelete = await persistence.deleteWorkspace(secondId);
  assert.equal(afterDelete.workspaces.length, 1);
  assert.equal(afterDelete.activeWorkspaceId, firstId);
  await assert.rejects(() => persistence.deleteWorkspace(firstId), /至少保留/);
});
