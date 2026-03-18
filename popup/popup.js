/* popup.js */
(function () {
  'use strict';

  const DEFAULT_TEMPLATES = [
    { id: 'none', label: '（无模板）', text: '' },
    { id: 'summary', label: '总结要点', text: '请总结以下文章的要点：' },
    { id: 'translate', label: '翻译成中文', text: '请将以下内容翻译成中文：' },
    { id: 'extract', label: '提取关键信息', text: '请提取以下内容的关键信息：' },
    { id: 'analyze', label: '分析评论', text: '请分析以下内容并给出你的看法：' },
    { id: 'qa', label: '基于内容回答', text: '请基于以下内容回答问题：[你的问题]\n' },
  ];

  let extractedData = null;
  let segments = [];
  let currentSegment = 0;
  let activeTabId = null;
  let currentSnippets = [];

  // --- DOM refs ---
  const pageTitleEl = document.getElementById('pageTitle');
  const pageUrlEl = document.getElementById('pageUrl');

  // Full page tab
  const fullpagePanel = document.getElementById('fullpagePanel');
  const templateSelect = document.getElementById('templateSelect');
  const preview = document.getElementById('preview');
  const tokenCount = document.getElementById('tokenCount');
  const tokenWarning = document.getElementById('tokenWarning');
  const segmentControls = document.getElementById('segmentControls');
  const segmentInfo = document.getElementById('segmentInfo');
  const copyBtn = document.getElementById('copyBtn');
  const copyAllBtn = document.getElementById('copyAllBtn');

  // Store unsegmented full text for "copy all"
  let fullUnsegmentedText = '';

  // Snippets tab
  const snippetsPanel = document.getElementById('snippetsPanel');
  const snippetBadge = document.getElementById('snippetBadge');
  const snippetList = document.getElementById('snippetList');
  const snippetTemplateSelect = document.getElementById('snippetTemplateSelect');
  const snippetPreview = document.getElementById('snippetPreview');
  const snippetTokenCount = document.getElementById('snippetTokenCount');
  const snippetTokenWarning = document.getElementById('snippetTokenWarning');
  const copySnippetsBtn = document.getElementById('copySnippetsBtn');
  const clearSnippetsBtn = document.getElementById('clearSnippetsBtn');

  // History tab
  const historyPanel = document.getElementById('historyPanel');
  const historyList = document.getElementById('historyList');

  // --- Init ---
  async function init() {
    await loadTemplates();
    setupListeners();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      activeTabId = tab.id;
      pageTitleEl.textContent = tab.title || '无标题';
      pageUrlEl.textContent = tab.url || '';
      pageUrlEl.href = tab.url || '#';
    }

    await extractFullPage();
    await loadSnippets();
  }

  // --- Templates ---
  async function loadTemplates() {
    const data = await chromeStorageGet({ customTemplates: [] });
    const allTemplates = [...DEFAULT_TEMPLATES, ...data.customTemplates];

    [templateSelect, snippetTemplateSelect].forEach(sel => {
      sel.innerHTML = '';
      allTemplates.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.text;
        opt.textContent = t.label;
        sel.appendChild(opt);
      });
    });
  }

  // --- Listeners ---
  function setupListeners() {
    // Full page tab
    templateSelect.addEventListener('change', updateFullPagePreview);
    preview.addEventListener('input', () => updateTokenDisplay(preview, tokenCount, tokenWarning));
    copyBtn.addEventListener('click', () => copyText(preview.value, copyBtn, segments.length > 1 ? '复制当前段' : '复制全页面到剪贴板'));
    copyAllBtn.addEventListener('click', () => copyText(fullUnsegmentedText, copyAllBtn, '复制全部内容（不分段）'));
    document.getElementById('prevSegment').addEventListener('click', () => navigateSegment(-1));
    document.getElementById('nextSegment').addEventListener('click', () => navigateSegment(1));

    // Snippets tab
    snippetTemplateSelect.addEventListener('change', updateSnippetPreview);
    snippetPreview.addEventListener('input', () => updateTokenDisplay(snippetPreview, snippetTokenCount, snippetTokenWarning));
    copySnippetsBtn.addEventListener('click', () => copyText(snippetPreview.value, copySnippetsBtn, '复制收集内容到剪贴板'));
    clearSnippetsBtn.addEventListener('click', clearSnippets);

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');

    fullpagePanel.style.display = tab === 'fullpage' ? 'block' : 'none';
    snippetsPanel.style.display = tab === 'snippets' ? 'block' : 'none';
    historyPanel.style.display = tab === 'history' ? 'block' : 'none';

    if (tab === 'history') loadHistory();
    if (tab === 'snippets') loadSnippets();
  }

  // --- Full page extraction ---
  async function ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch (e) {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content/float-button.css'],
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['lib/readability.js', 'lib/turndown.js', 'content/content.js'],
      });
    }
  }

  async function extractFullPage() {
    if (!activeTabId) {
      preview.value = '无法获取页面';
      updateTokenDisplay(preview, tokenCount, tokenWarning);
      return;
    }

    const url = pageUrlEl.href;
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
      preview.value = '无法在 Chrome 内部页面上使用';
      updateTokenDisplay(preview, tokenCount, tokenWarning);
      return;
    }

    try {
      await ensureContentScript(activeTabId);
      const result = await chrome.tabs.sendMessage(activeTabId, {
        action: 'extractContent',
        mode: 'full',
      });

      if (result) {
        extractedData = result;
        updateFullPagePreview();
      } else {
        preview.value = '无法提取内容';
        updateTokenDisplay(preview, tokenCount, tokenWarning);
      }
    } catch (e) {
      preview.value = '无法连接到页面';
      updateTokenDisplay(preview, tokenCount, tokenWarning);
    }
  }

  function updateFullPagePreview() {
    if (!extractedData) return;

    // Empty content protection: strip all whitespace to check for real content
    const strippedContent = (extractedData.content || '').replace(/\s+/g, '');
    if (strippedContent.length < 50) {
      preview.value = '⚠ 未能提取到有效页面内容。\n\n可能原因：\n- 页面内容尚未加载完成（SPA 应用）\n- 页面结构不支持自动提取\n- 页面内容为空\n\n建议：等待页面完全加载后重试，或手动选中内容后使用「收集选区」功能。';
      segmentControls.style.display = 'none';
      updateTokenDisplay(preview, tokenCount, tokenWarning);
      return;
    }

    const template = templateSelect.value;
    let text = `# ${extractedData.title}\n\n> 来源: ${extractedData.url}\n\n${extractedData.content}`;
    if (template) {
      text = template + '\n\n---\n\n' + text;
    }

    chromeStorageGet({ segmentSize: 8000 }).then(data => {
      const totalTokens = TokenEstimator.estimate(text);
      fullUnsegmentedText = text;
      if (totalTokens > data.segmentSize) {
        segments = splitIntoSegments(text, data.segmentSize);
        currentSegment = 0;
        copyBtn.textContent = '复制当前段';
        copyAllBtn.style.display = '';
        showSegment();
      } else {
        segments = [text];
        currentSegment = 0;
        segmentControls.style.display = 'none';
        copyBtn.textContent = '复制全页面到剪贴板';
        copyAllBtn.style.display = 'none';
        preview.value = text;
        updateTokenDisplay(preview, tokenCount, tokenWarning);
      }
    });
  }

  function splitIntoSegments(text, maxTokens) {
    const paragraphs = text.split(/\n\n+/);
    const result = [];
    let current = '';
    for (const para of paragraphs) {
      const test = current ? current + '\n\n' + para : para;
      if (TokenEstimator.estimate(test) > maxTokens && current) {
        result.push(current);
        current = para;
      } else {
        current = test;
      }
    }
    if (current) result.push(current);
    const total = result.length;
    if (total > 1) {
      return result.map((seg, i) => {
        return `[第${i + 1}/${total}部分] 以下是文章内容，请等我发完所有部分后再回复：\n\n` + seg;
      });
    }
    return result;
  }

  function showSegment() {
    if (segments.length <= 1) {
      segmentControls.style.display = 'none';
    } else {
      segmentControls.style.display = 'flex';
      segmentInfo.textContent = `第 ${currentSegment + 1}/${segments.length} 部分`;
    }
    preview.value = segments[currentSegment] || '';
    updateTokenDisplay(preview, tokenCount, tokenWarning);
  }

  function navigateSegment(dir) {
    currentSegment = Math.max(0, Math.min(segments.length - 1, currentSegment + dir));
    showSegment();
  }

  // --- Snippets ---
  async function loadSnippets() {
    currentSnippets = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'getSnippets' }, resolve);
    }) || [];

    snippetBadge.textContent = currentSnippets.length > 0 ? currentSnippets.length : '';
    renderSnippetList();
    updateSnippetPreview();
  }

  function renderSnippetList() {
    snippetList.innerHTML = '';
    if (!currentSnippets.length) {
      snippetList.innerHTML = '<div class="empty-msg">暂无收集内容，右键选中文字可收集</div>';
      return;
    }

    currentSnippets.forEach((s, i) => {
      const div = document.createElement('div');
      div.className = 'snippet-item';
      const sourceHost = s.url ? new URL(s.url).hostname : '';
      div.innerHTML = `
        <div class="s-content">
          <div class="s-text">${escapeHtml(s.text)}</div>
          <div class="s-source">${escapeHtml(s.title || sourceHost)}</div>
        </div>
        <button class="s-remove" data-index="${i}" title="删除">×</button>
      `;
      div.querySelector('.s-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeSnippet(i);
      });
      snippetList.appendChild(div);
    });
  }

  function updateSnippetPreview() {
    if (!currentSnippets.length) {
      snippetPreview.value = '';
      updateTokenDisplay(snippetPreview, snippetTokenCount, snippetTokenWarning);
      return;
    }

    const template = snippetTemplateSelect.value;
    const parts = currentSnippets.map((s, i) => {
      const source = s.url ? `> 来源: ${s.title || ''} (${s.url})` : '';
      return `## 片段 ${i + 1}\n\n${source}\n\n${s.text}`;
    });

    let text = parts.join('\n\n---\n\n');
    if (template) {
      text = template + '\n\n---\n\n' + text;
    }

    snippetPreview.value = text;
    updateTokenDisplay(snippetPreview, snippetTokenCount, snippetTokenWarning);
  }

  async function removeSnippet(index) {
    const updated = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'removeSnippet', index }, resolve);
    });
    currentSnippets = updated || [];
    snippetBadge.textContent = currentSnippets.length > 0 ? currentSnippets.length : '';
    renderSnippetList();
    updateSnippetPreview();
  }

  async function clearSnippets() {
    await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'clearSnippets' }, resolve);
    });
    currentSnippets = [];
    snippetBadge.textContent = '';
    renderSnippetList();
    updateSnippetPreview();
  }

  // --- History ---
  async function loadHistory() {
    const history = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'getHistory' }, resolve);
    });
    historyList.innerHTML = '';
    if (!history || !history.length) {
      historyList.innerHTML = '<div class="empty-msg">暂无抓取历史</div>';
      return;
    }
    history.forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const time = new Date(item.time).toLocaleString('zh-CN');
      div.innerHTML = `
        <div class="h-title">${escapeHtml(item.title)}</div>
        <div class="h-meta">${time}</div>
      `;
      div.addEventListener('click', () => {
        chrome.tabs.create({ url: item.url });
      });
      historyList.appendChild(div);
    });
  }

  // --- Shared helpers ---
  function updateTokenDisplay(textarea, countEl, warningEl) {
    const text = textarea.value;
    const tokens = TokenEstimator.estimate(text);
    countEl.textContent = TokenEstimator.format(tokens);
    warningEl.textContent = TokenEstimator.getWarning(tokens);
  }

  async function copyText(text, btn, originalLabel) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    btn.textContent = '已复制!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = originalLabel;
      btn.classList.remove('copied');
    }, 1500);

    if (extractedData) {
      chrome.runtime.sendMessage({
        action: 'addHistory',
        title: extractedData.title,
        url: extractedData.url,
      });
    }
  }

  function chromeStorageGet(defaults) {
    return new Promise(resolve => chrome.storage.sync.get(defaults, resolve));
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  init();
})();
