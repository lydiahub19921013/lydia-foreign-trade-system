import { STORAGE_KEY, migrateState } from "./core/data.js";

const MENU_ID = "send-to-foreign-trade-development-plugin";

async function ensureState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  await chrome.storage.local.set({ [STORAGE_KEY]: migrateState(stored[STORAGE_KEY]) });
}

async function createContextMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "发送到外贸开发插件",
    contexts: ["selection"]
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureState();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await createContextMenu();
});

chrome.runtime.onStartup.addListener(ensureState);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;

  await chrome.storage.local.set({ pendingSelection: info.selectionText.trim().slice(0, 8000) });
  if (tab?.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});
