/* content.js - Page Grabber Content Script */

(function () {
  'use strict';

  // Clean up previous listeners if re-injected
  if (window.__pgCleanup) {
    try { window.__pgCleanup(); } catch(e) {}
  }

  // --- Cache selection via message to background ---
  function saveSelection() {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) {
      const text = sel.toString();
      try {
        chrome.runtime.sendMessage({
          action: 'cacheSelection',
          text: text,
        });
        // Visual debug: show brief toast so user knows it worked
        showToast('选区已缓存: ' + text.substring(0, 20) + '...');
      } catch (e) {
        showToast('缓存失败: ' + e.message);
      }
    }
  }

  function onMouseUp() {
    setTimeout(saveSelection, 20);
  }

  function onKeyUp(e) {
    if (e.shiftKey || e.key === 'Shift') {
      setTimeout(saveSelection, 20);
    }
  }

  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keyup', onKeyUp);

  // Cleanup function for re-injection
  window.__pgCleanup = () => {
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keyup', onKeyUp);
  };

  // --- Float button ---
  function createFloatButton() {
    if (document.getElementById('page-grabber-float-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'page-grabber-float-btn';
    btn.title = 'Page Grabber: 抓取页面内容';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
    btn.addEventListener('click', () => {
      grabAndCopy('full');
    });
    document.body.appendChild(btn);
  }

  function showToast(msg) {
    let toast = document.getElementById('page-grabber-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'page-grabber-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // --- Content Extraction ---
  const SEMANTIC_SELECTORS = [
    'article',
    'main',
    '[role="main"]',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '#content',
  ];

  const NOISE_TAGS = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'noscript', 'svg', 'iframe'];

  function cleanBodyClone() {
    const bodyClone = document.body.cloneNode(true);
    NOISE_TAGS.forEach(tag => {
      bodyClone.querySelectorAll(tag).forEach(el => el.remove());
    });
    // Remove hidden elements and empty containers
    bodyClone.querySelectorAll('[style*="display: none"], [style*="display:none"], [hidden], [aria-hidden="true"]').forEach(el => el.remove());
    return bodyClone;
  }

  // Normalize extracted text: collapse excessive whitespace/newlines
  function normalizeText(text) {
    return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  }

  function isContentMeaningful(text) {
    if (!text) return false;
    // Strip all whitespace and check if remaining chars are meaningful
    const stripped = text.replace(/\s+/g, '');
    return stripped.length >= 50;
  }

  function extractFullPage(format) {
    const title = document.title;
    let content = '';

    // 1. Try Readability
    try {
      const docClone = document.cloneNode(true);
      const reader = new Readability(docClone);
      const article = reader.parse();
      if (article && article.content) {
        const text = format === 'markdown' ? htmlToMarkdown(article.content) : (article.textContent || '');
        if (isContentMeaningful(text)) {
          return { title: article.title || title, url: location.href, content: normalizeText(text) };
        }
      }
    } catch (e) {
      // Readability failed, continue to fallback
    }

    // 2. Try semantic selectors (use markdown only for these clean containers)
    for (const selector of SEMANTIC_SELECTORS) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          const text = format === 'markdown' ? htmlToMarkdown(el.innerHTML) : el.innerText;
          if (isContentMeaningful(text)) {
            content = normalizeText(text);
            break;
          }
        }
      } catch (e) {
        // This selector failed, try next
      }
    }

    // 3. Fallback: cleaned body — always use innerText (no markdown for full body)
    if (!isContentMeaningful(content)) {
      try {
        const bodyClone = cleanBodyClone();
        content = normalizeText(bodyClone.innerText || '');
      } catch (e) {
        content = normalizeText(document.body.innerText || '');
      }
    }

    return { title, url: location.href, content };
  }

  function htmlToMarkdown(html) {
    // Remove base64 images and data URIs from HTML before conversion
    // They bloat output massively (a single image can be 10K+ chars)
    const cleanHtml = html
      .replace(/<img[^>]+src=["']data:[^"']*["'][^>]*>/gi, '')
      .replace(/url\(["']?data:[^)]*\)/gi, 'url()');

    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    // Skip images with data: URIs that survived HTML cleaning
    td.addRule('removeDataImages', {
      filter: function (node) {
        return node.nodeName === 'IMG' && node.getAttribute('src') && node.getAttribute('src').startsWith('data:');
      },
      replacement: function () { return ''; }
    });
    td.addRule('table', {
      filter: 'table',
      replacement: function (content, node) {
        return convertTableToMarkdown(node);
      }
    });
    return td.turndown(cleanHtml);
  }

  function convertTableToMarkdown(tableEl) {
    const rows = tableEl.querySelectorAll('tr');
    if (!rows.length) return '';
    const lines = [];
    rows.forEach((row, i) => {
      const cells = row.querySelectorAll('th, td');
      const cellTexts = Array.from(cells).map(c => c.textContent.trim().replace(/\|/g, '\\|'));
      lines.push('| ' + cellTexts.join(' | ') + ' |');
      if (i === 0) {
        lines.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |');
      }
    });
    return '\n\n' + lines.join('\n') + '\n\n';
  }

  // --- Grab and copy ---
  async function grabAndCopy(mode, promptTemplate, fallbackText) {
    const settings = await getSettings();
    const format = settings.outputFormat || 'markdown';
    let result;

    if (mode === 'selection') {
      if (fallbackText) {
        result = { title: document.title, url: location.href, content: fallbackText };
      } else {
        // Try live selection
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim()) {
          const content = format === 'markdown' ? (() => {
            try {
              const range = sel.getRangeAt(0);
              const container = document.createElement('div');
              container.appendChild(range.cloneContents());
              return htmlToMarkdown(container.innerHTML);
            } catch(e) { return sel.toString(); }
          })() : sel.toString();
          result = { title: document.title, url: location.href, content };
        }
      }
      if (!result || !result.content) {
        showToast('没有选中内容');
        return null;
      }
    } else {
      result = extractFullPage(format);
    }

    let finalText = `# ${result.title}\n\n> 来源: ${result.url}\n\n${result.content}`;
    if (promptTemplate) {
      finalText = promptTemplate + '\n\n---\n\n' + finalText;
    }

    try {
      await navigator.clipboard.writeText(finalText);
      showToast('已复制到剪贴板');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = finalText;
      ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('已复制到剪贴板');
    }

    return result;
  }

  function getSettings() {
    return new Promise(resolve => {
      chrome.storage.sync.get({
        outputFormat: 'markdown',
        showFloatButton: true,
        promptTemplates: [],
        segmentSize: 8000,
      }, resolve);
    });
  }

  // --- Message listener ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
      return false;
    }

    if (msg.action === 'extractContent') {
      (async () => {
        try {
          const settings = await getSettings();
          const format = settings.outputFormat || 'markdown';
          const result = extractFullPage(format);
          sendResponse(result);
        } catch (e) {
          sendResponse({
            title: document.title,
            url: location.href,
            content: document.body.innerText || '',
          });
        }
      })();
      return true;
    }

    if (msg.action === 'grabAndCopy') {
      (async () => {
        const result = await grabAndCopy(msg.mode || 'full', msg.promptTemplate, msg.fallbackText);
        sendResponse(result);
      })();
      return true;
    }
  });

  // --- Init ---
  async function init() {
    try {
      const settings = await getSettings();
      if (settings.showFloatButton) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', createFloatButton);
        } else {
          createFloatButton();
        }
      }
    } catch(e) {
      // Extension context invalidated
    }
  }

  init();
})();
