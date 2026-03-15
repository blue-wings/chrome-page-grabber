/* background.js - Service Worker */

const DEFAULT_TEMPLATES = [
  { id: 'none', label: '（无模板）', text: '' },
  { id: 'summary', label: '总结要点', text: '请总结以下文章的要点：' },
  { id: 'translate', label: '翻译成中文', text: '请将以下内容翻译成中文：' },
  { id: 'extract', label: '提取关键信息', text: '请提取以下内容的关键信息：' },
  { id: 'analyze', label: '分析评论', text: '请分析以下内容并给出你的看法：' },
  { id: 'qa', label: '基于内容回答', text: '请基于以下内容回答问题：[你的问题]\n' },
];

// --- Context menu ---
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'collect-selection',
      title: '收集选中内容',
      contexts: ['selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
  chrome.storage.sync.get(null, (data) => {
    if (!data.outputFormat) {
      chrome.storage.sync.set({
        outputFormat: 'markdown',
        showFloatButton: true,
        segmentSize: 8000,
        customTemplates: [],
      });
    }
  });
});

// --- Toast in page ---
async function showToastInTab(tabId, msg) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (message) => {
        let toast = document.getElementById('page-grabber-toast');
        if (!toast) {
          toast = document.createElement('div');
          toast.id = 'page-grabber-toast';
          document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
      },
      args: [msg],
    });
  } catch(e) {}
}

// --- Collect selection: append to snippets list ---
async function collectSelection(tab, text) {
  const snippet = {
    text: text,
    title: tab.title || '',
    url: tab.url || '',
    time: Date.now(),
  };

  const data = await chrome.storage.local.get({ _snippets: [] });
  const snippets = data._snippets;
  snippets.push(snippet);
  await chrome.storage.local.set({ _snippets: snippets });

  await showToastInTab(tab.id, `已收集 (${snippets.length} 条)`);
  // Update badge
  chrome.action.setBadgeText({ text: String(snippets.length) });
  chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const selectedText = info.selectionText || '';
  if (!selectedText) return;

  if (info.menuItemId === 'collect-selection') {
    await collectSelection(tab, selectedText);
    addHistory(tab);
  }
});

// --- Keyboard shortcuts ---
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'grab-full-page') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'grabAndCopy',
      mode: 'full',
    });
    addHistory(tab);
  } else if (command === 'grab-selection') {
    // Collect selection via shortcut
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString(),
    }).then(results => {
      const text = results && results[0] && results[0].result;
      if (text) {
        collectSelection(tab, text);
      }
    });
  }
});

// --- History ---
function addHistory(tab) {
  const entry = {
    title: tab.title || '',
    url: tab.url || '',
    time: Date.now(),
  };
  chrome.storage.local.get({ history: [] }, (data) => {
    const history = data.history;
    history.unshift(entry);
    if (history.length > 100) history.length = 100;
    chrome.storage.local.set({ history });
  });
}

// --- Restore badge on startup ---
chrome.storage.local.get({ _snippets: [] }, (data) => {
  const count = data._snippets.length;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getSnippets') {
    chrome.storage.local.get({ _snippets: [] }, (data) => {
      sendResponse(data._snippets);
    });
    return true;
  }

  if (msg.action === 'clearSnippets') {
    chrome.storage.local.set({ _snippets: [] }, () => {
      chrome.action.setBadgeText({ text: '' });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.action === 'removeSnippet') {
    chrome.storage.local.get({ _snippets: [] }, (data) => {
      data._snippets.splice(msg.index, 1);
      chrome.storage.local.set({ _snippets: data._snippets }, () => {
        const count = data._snippets.length;
        chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
        sendResponse(data._snippets);
      });
    });
    return true;
  }

  if (msg.action === 'addHistory') {
    const entry = { title: msg.title || '', url: msg.url || '', time: Date.now() };
    chrome.storage.local.get({ history: [] }, (data) => {
      const history = data.history;
      history.unshift(entry);
      if (history.length > 100) history.length = 100;
      chrome.storage.local.set({ history });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.action === 'getHistory') {
    chrome.storage.local.get({ history: [] }, (data) => {
      sendResponse(data.history);
    });
    return true;
  }

  if (msg.action === 'clearHistory') {
    chrome.storage.local.set({ history: [] }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.action === 'getDefaultTemplates') {
    sendResponse(DEFAULT_TEMPLATES);
    return false;
  }
});
