/* selection-cache.js — Minimal script to cache selection on mouseup */
(function() {
  document.addEventListener('mouseup', function() {
    setTimeout(function() {
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        try {
          chrome.runtime.sendMessage({
            action: 'cacheSelection',
            text: sel.toString(),
          });
        } catch(e) {}
      }
    }, 20);
  });

  document.addEventListener('keyup', function(e) {
    if (e.shiftKey || e.key === 'Shift') {
      setTimeout(function() {
        var sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim()) {
          try {
            chrome.runtime.sendMessage({
              action: 'cacheSelection',
              text: sel.toString(),
            });
          } catch(e) {}
        }
      }, 20);
    }
  });
})();
