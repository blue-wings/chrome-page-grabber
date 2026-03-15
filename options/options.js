/* options.js */
(function () {
  'use strict';

  const segmentSizeEl = document.getElementById('segmentSize');
  const showFloatButtonEl = document.getElementById('showFloatButton');
  const templateListEl = document.getElementById('templateList');
  const newLabelEl = document.getElementById('newTemplateLabel');
  const newTextEl = document.getElementById('newTemplateText');
  const addBtn = document.getElementById('addTemplateBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const historyCountEl = document.getElementById('historyCount');
  const statusEl = document.getElementById('status');

  // --- Load settings ---
  function loadSettings() {
    chrome.storage.sync.get({
      outputFormat: 'markdown',
      segmentSize: 8000,
      showFloatButton: true,
      customTemplates: [],
    }, (data) => {
      document.querySelector(`input[name="outputFormat"][value="${data.outputFormat}"]`).checked = true;
      segmentSizeEl.value = data.segmentSize;
      showFloatButtonEl.checked = data.showFloatButton;
      renderTemplates(data.customTemplates);
    });

    chrome.storage.local.get({ history: [] }, (data) => {
      historyCountEl.textContent = data.history.length + ' 条记录';
    });
  }

  function renderTemplates(templates) {
    templateListEl.innerHTML = '';
    if (!templates.length) {
      templateListEl.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:8px 0;">暂无自定义模板</div>';
      return;
    }
    templates.forEach((t, i) => {
      const div = document.createElement('div');
      div.className = 'template-item';
      div.innerHTML = `
        <div>
          <div class="tpl-label">${escapeHtml(t.label)}</div>
          <div class="tpl-text">${escapeHtml(t.text)}</div>
        </div>
        <button class="delete-btn" data-index="${i}">&times;</button>
      `;
      templateListEl.appendChild(div);
    });

    // Delete handlers
    templateListEl.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        chrome.storage.sync.get({ customTemplates: [] }, (data) => {
          data.customTemplates.splice(idx, 1);
          chrome.storage.sync.set({ customTemplates: data.customTemplates }, () => {
            renderTemplates(data.customTemplates);
            showStatus('模板已删除');
          });
        });
      });
    });
  }

  // --- Save on change ---
  document.querySelectorAll('input[name="outputFormat"]').forEach(radio => {
    radio.addEventListener('change', () => {
      chrome.storage.sync.set({ outputFormat: radio.value }, () => showStatus('已保存'));
    });
  });

  segmentSizeEl.addEventListener('change', () => {
    const val = Math.max(1000, parseInt(segmentSizeEl.value) || 8000);
    segmentSizeEl.value = val;
    chrome.storage.sync.set({ segmentSize: val }, () => showStatus('已保存'));
  });

  showFloatButtonEl.addEventListener('change', () => {
    chrome.storage.sync.set({ showFloatButton: showFloatButtonEl.checked }, () => showStatus('已保存'));
  });

  // --- Add template ---
  addBtn.addEventListener('click', () => {
    const label = newLabelEl.value.trim();
    const text = newTextEl.value.trim();
    if (!label || !text) return;

    chrome.storage.sync.get({ customTemplates: [] }, (data) => {
      const id = 'custom-' + Date.now();
      data.customTemplates.push({ id, label, text });
      chrome.storage.sync.set({ customTemplates: data.customTemplates }, () => {
        renderTemplates(data.customTemplates);
        newLabelEl.value = '';
        newTextEl.value = '';
        showStatus('模板已添加');
      });
    });
  });

  // --- Clear history ---
  clearHistoryBtn.addEventListener('click', () => {
    if (!confirm('确定要清除所有抓取历史吗？')) return;
    chrome.runtime.sendMessage({ action: 'clearHistory' }, () => {
      historyCountEl.textContent = '0 条记录';
      showStatus('历史已清除');
    });
  });

  function showStatus(msg) {
    statusEl.textContent = msg;
    statusEl.style.display = 'block';
    setTimeout(() => { statusEl.style.display = 'none'; }, 1500);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  loadSettings();
})();
