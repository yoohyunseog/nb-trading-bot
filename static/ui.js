// ui.js loader stub (<2000 lines). Full implementation moved to ui-main.js.
(function(){
  // Separate loader guard so ui-main.js still runs its own duplicate check
  if (window.uiLoaderLoaded) return;
  window.uiLoaderLoaded = true;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  const currentScript = document.currentScript;
  let versionQuery = '';
  if (currentScript && currentScript.src.includes('?')) {
    versionQuery = currentScript.src.slice(currentScript.src.indexOf('?'));
  } else {
    versionQuery = '?v=dev';
  }

  loadScript('/static/ui-main.js' + versionQuery)
    .catch(err => console.error('ui-main.js load failed:', err));
})();
