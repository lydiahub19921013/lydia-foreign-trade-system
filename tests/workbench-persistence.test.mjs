import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_WORKSPACE_NAME,
  WORKBENCH_SNAPSHOT_FORMAT,
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_INDEX_FORMAT,
  assertPayloadMatchesWorkspace,
  createIndexedDbPersistence,
  createRestoredWorkspaceName,
  createWorkbenchSnapshot,
  createWorkspaceBackup,
  createWorkspaceFilename,
  createWorkspaceReference,
  normalizeWorkbenchSnapshot,
  normalizeWorkspaceBackup,
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
    currentResult: {
      count: 1,
      providerMetadata: {
        apiKey: "must-not-persist",
        label: "safe"
      }
    },
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
  assert.deepEqual(snapshot.state.currentResult.providerMetadata, { label: "safe" });
  assert.equal(snapshot.state.ui.channel, "alibaba");
  assert.equal("apiKey" in snapshot.state, false);
  assert.equal("prospectSearchConfirmed" in snapshot.state.ui, false);
  assert.equal("websiteConfirmed" in snapshot.state.ui, false);
  assert.equal(JSON.stringify(snapshot).includes("must-not-persist"), false);
});

test("workbench snapshots reject cyclic state instead of silently producing a broken backup", () => {
  const cyclic = { count: 1 };
  cyclic.self = cyclic;
  assert.throws(() => createWorkbenchSnapshot({ currentResult: cyclic }), /循环引用/);
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

test("full workspace backups are versioned, whitelisted and detached", () => {
  const state = {
    currentResult: { count: 4 },
    currentRelationshipResult: {
      paths: [{
        id: "path-1",
        evidence: { authorization: "must-not-persist", note: "safe" }
      }]
    },
    selectedWebsiteEvidenceIds: ["evidence-1"],
    secretToken: "must-not-persist",
    ui: {
      channel: "alibaba",
      prospectSearchConfirmed: "true",
      apiKey: "must-not-persist"
    }
  };
  const workspace = { id: "ws_test_one", name: "客户 A" };
  const backup = createWorkspaceBackup(workspace, state, { exportedAt: "2026-09-08T11:00:00.000Z" });
  state.currentResult.count = 99;
  assert.equal(backup.format, WORKSPACE_BACKUP_FORMAT);
  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.workspace.name, "客户 A");
  assert.equal(backup.snapshot.state.currentResult.count, 4);
  assert.deepEqual(backup.snapshot.state.currentRelationshipResult.paths[0].evidence, { note: "safe" });
  assert.equal(backup.snapshot.state.ui.channel, "alibaba");
  assert.equal(JSON.stringify(backup).includes("must-not-persist"), false);
  assert.equal("prospectSearchConfirmed" in backup.snapshot.state.ui, false);
  assert.deepEqual(normalizeWorkspaceBackup(backup), backup);
  assert.throws(() => normalizeWorkspaceBackup({}), /完整客户空间备份/);
  assert.throws(() => normalizeWorkspaceBackup({ ...backup, schemaVersion: 2 }), /更新版本/);
});

test("fictional full-backup example remains importable", async () => {
  const payload = JSON.parse(await readFile(new URL("../examples/workspace-backup.sample.json", import.meta.url), "utf8"));
  const backup = normalizeWorkspaceBackup(payload);
  assert.equal(backup.workspace.name, "虚构备份客户 · 礼品");
  assert.equal(backup.snapshot.state.currentRelationshipResult.paths.length, 1);
  assert.equal(backup.snapshot.state.ui.channel, "made-in-china");
});

test("restored workspace names never overwrite an existing customer", () => {
  assert.equal(createRestoredWorkspaceName("客户 A", [{ name: "客户 B" }]), "客户 A");
  assert.equal(createRestoredWorkspaceName("客户 A", [{ name: "客户 A" }]), "客户 A · 恢复");
  assert.equal(createRestoredWorkspaceName("客户 A", [
    { name: "客户 A" },
    { name: "客户 A · 恢复" }
  ]), "客户 A · 恢复 2");
  const longName = "客".repeat(60);
  assert.equal(createRestoredWorkspaceName(longName, [{ name: longName }]).length, 60);
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

test("restoring a full backup creates a new isolated workspace without overwriting the current one", async () => {
  let id = 0;
  const persistence = createIndexedDbPersistence(fakeIndexedDb(), {
    databaseName: "test-lydia-restore",
    storeName: "snapshots",
    idFactory: () => `restore_${++id}`
  });
  let index = await persistence.initializeWorkspaces();
  const originalId = index.activeWorkspaceId;
  index = await persistence.renameWorkspace(originalId, "客户 A");
  const originalSnapshot = createWorkbenchSnapshot({
    currentResult: { count: 4, customer: "original" }
  }, { savedAt: "2026-09-08T11:00:00.000Z" });
  await persistence.saveWorkspace(originalId, originalSnapshot);

  const backup = createWorkspaceBackup({ id: "ws_source_backup", name: "客户 A" }, {
    currentResult: { count: 9, customer: "restored" },
    currentRelationshipResult: { paths: [{ id: "path-1" }] },
    ui: { channel: "made-in-china", websiteConfirmed: "true" }
  }, { exportedAt: "2026-09-08T12:00:00.000Z" });
  const restored = await persistence.restoreWorkspaceBackup(backup);
  assert.equal(restored.workspace.name, "客户 A · 恢复");
  assert.equal(restored.index.activeWorkspaceId, restored.workspace.id);
  assert.equal(restored.index.workspaces.length, 2);
  assert.deepEqual(await persistence.loadWorkspace(originalId), originalSnapshot);
  const restoredSnapshot = await persistence.loadWorkspace(restored.workspace.id);
  assert.equal(restoredSnapshot.state.currentResult.count, 9);
  assert.equal(restoredSnapshot.state.currentRelationshipResult.paths.length, 1);
  assert.equal(restoredSnapshot.state.ui.channel, "made-in-china");
  assert.equal("websiteConfirmed" in restoredSnapshot.state.ui, false);

  const secondRestore = await persistence.restoreWorkspaceBackup(backup);
  assert.equal(secondRestore.workspace.name, "客户 A · 恢复 2");
  assert.equal(secondRestore.index.workspaces.length, 3);
});
