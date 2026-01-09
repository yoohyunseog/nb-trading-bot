// Information Trust System module
(function() {
  'use strict';

  if (window.trustModuleLoaded) return;
  window.trustModuleLoaded = true;

  const state = {
    mlTrust: 9,  // default ML trust (N/B 우선)
    nbTrust: 91, // default N/B trust
    lastSaved: 0
  };

  const els = {
    mlTrustSlider: null,
    nbTrustSlider: null,
    mlTrustValue: null,
    nbTrustValue: null,
    mlTrustBar: null,
    nbTrustBar: null,
    trustStatusText: null,
    trustBalanceText: null
  };

  let eventsBound = false;

  function cacheElements() {
    els.mlTrustSlider = document.getElementById('mlTrustSlider');
    els.nbTrustSlider = document.getElementById('nbTrustSlider');
    els.mlTrustValue = document.getElementById('mlTrustValue');
    els.nbTrustValue = document.getElementById('nbTrustValue');
    els.mlTrustBar = document.getElementById('mlTrustBar');
    els.nbTrustBar = document.getElementById('nbTrustBar');
    els.trustStatusText = document.getElementById('trustStatusText');
    els.trustBalanceText = document.getElementById('trustBalanceText');
  }

  async function loadTrustConfig() {
    let loaded = false;
    try {
      const response = await fetch('/api/trust/config');
      if (response.ok) {
        const serverConfig = await response.json();
        console.log('[Trust] Server response:', serverConfig);
        
        if (serverConfig && serverConfig.ok) {
          state.mlTrust = serverConfig.ml_trust ?? state.mlTrust;
          state.nbTrust = serverConfig.nb_trust ?? state.nbTrust;
          
          // 실제 모델 신뢰도 캐시 (설정값이 아닌 계산된 값)
          window.mlPredictionCached = serverConfig.ml_prediction || {};
          window.nbResultCached = serverConfig.nb_result || {};
          window.finalZoneCached = {
            final_zone: serverConfig.final_zone,
            information_trust_level: serverConfig.information_trust_level ?? 50,
            zone_agreement: serverConfig.zone_agreement ?? 'NO',
            ml_confidence: serverConfig.ml_confidence ?? 50,
            nb_confidence: serverConfig.nb_confidence ?? 50
          };
          
          console.log('[Trust] Cached values:', window.finalZoneCached);
          
          loaded = true;
          const infoLevel = serverConfig.information_trust_level ?? 50;
          console.log('[Trust] Loaded - Info: ' + infoLevel + '%, ML: ' + serverConfig.ml_confidence + '%, N/B: ' + serverConfig.nb_confidence + '%');
        }
      }
    } catch (e) {
      console.error('[Trust] Load failed:', e);
    }

    if (!loaded) {
      try {
        const saved = localStorage.getItem('trustConfig');
        if (saved) {
          const parsed = JSON.parse(saved);
          state.mlTrust = parsed.mlTrust ?? state.mlTrust;
          state.nbTrust = parsed.nbTrust ?? state.nbTrust;
        }
      } catch (e) {
        console.error('[Trust] LocalStorage load error:', e);
      }
    }
  }

  async function saveTrustConfig() {
    state.lastSaved = Date.now();
    try {
      const response = await fetch('/api/trust/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ml_trust: state.mlTrust, nb_trust: state.nbTrust })
      });
      if (response.ok) {
        console.log('✅ Trust config saved to server');
      } else {
        console.log('⚠️ Failed to save trust config to server, using local storage');
      }
    } catch (e) {
      console.log('Server not available, saving trust config locally only');
    }

    try {
      localStorage.setItem('trustConfig', JSON.stringify(state));
    } catch (e) {
      console.error('Error saving trust config to local storage:', e);
    }
  }

  function updateTrustUI() {
    if (!els.mlTrustValue || !els.nbTrustValue || !els.mlTrustBar || !els.nbTrustBar || !els.trustStatusText || !els.trustBalanceText) {
      console.warn('[Trust] UI elements not ready');
      return;
    }

    // API에서 계산한 실제 신뢰도 사용
    const cached = window.finalZoneCached;
    const mlDisplay = cached?.ml_confidence ?? 50;
    const nbDisplay = cached?.nb_confidence ?? 50;
    const infoTrustLevel = cached?.information_trust_level ?? 50;
    
    console.log('[Trust] UI values - ML:' + mlDisplay + ', NB:' + nbDisplay + ', Info:' + infoTrustLevel);
    
    els.mlTrustValue.textContent = mlDisplay + '%';
    els.nbTrustValue.textContent = nbDisplay + '%';
    els.mlTrustBar.style.width = mlDisplay + '%';
    els.nbTrustBar.style.width = nbDisplay + '%';
    els.trustBalanceText.textContent = 'ML: ' + mlDisplay + '% | N/B: ' + nbDisplay + '%';

    // Information Trust Level 표시
    if (infoTrustLevel >= 80) {
      els.trustStatusText.textContent = 'Very High (' + infoTrustLevel + '%)';
      els.trustStatusText.className = 'badge bg-success';
    } else if (infoTrustLevel >= 60) {
      els.trustStatusText.textContent = 'High (' + infoTrustLevel + '%)';
      els.trustStatusText.className = 'badge bg-info';
    } else if (infoTrustLevel >= 40) {
      els.trustStatusText.textContent = 'Medium (' + infoTrustLevel + '%)';
      els.trustStatusText.className = 'badge bg-warning';
    } else {
      els.trustStatusText.textContent = 'Low (' + infoTrustLevel + '%)';
      els.trustStatusText.className = 'badge bg-danger';
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    if (!els.mlTrustSlider || !els.nbTrustSlider) return;
    eventsBound = true;

    els.mlTrustSlider.addEventListener('input', (e) => {
      state.mlTrust = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0));
      updateTrustUI();
      saveTrustConfig();
    });

    els.nbTrustSlider.addEventListener('input', (e) => {
      state.nbTrust = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0));
      updateTrustUI();
      saveTrustConfig();
    });
  }

  function getTrustWeightedZone() {
    // 캐시된 최종 zone 반환 (설정이 아닌 실제 계산된 값)
    const cached = window.finalZoneCached;
    if (cached && typeof cached === 'object' && cached.final_zone) {
      return cached.final_zone;
    }
    return window.zoneNow || 'BLUE';
  }

  async function init() {
    cacheElements();
    if (!els.mlTrustSlider || !els.nbTrustSlider) {
      // Retry after DOM settles
      setTimeout(init, 500);
      return;
    }
    await loadTrustConfig();
    updateTrustUI();
    bindEvents();
  }

  window.trustModule = {
    init,
    getWeightedZone: getTrustWeightedZone,
    getState: () => ({ ...state }),
    save: saveTrustConfig,
    updateUI: updateTrustUI
  };
})();
