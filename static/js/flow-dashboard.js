// ============================================================================
// GLOBAL VARIABLES & HELPERS (FlowDashboard 외부 - 외부 접근 가능)
// ============================================================================
let ccLastNbversePath = null; // 마지막 저장된 NBverse 경로

const FlowDashboard = (() => {
  /**
   * Flow Dashboard Module
   * 8BIT Trading Bot - Flow-based Trading Interface
   */

  // ===== DEFAULT CONFIGURATION =====
  const DEFAULT_MARKET = 'KRW-BTC';

  // ===== STATE PERSISTENCE MANAGER =====
  class StateManager {
    constructor(storageKey = 'flowDashboard') {
      this.key = storageKey;
      this.version = '1.0';
    }

    save(state) {
      // Save state to localStorage with timestamp
      const data = {
        version: this.version,
        timestamp: Date.now(),
        state: state
      };
      try {
        localStorage.setItem(this.key, JSON.stringify(data));
        console.log('✅ State saved to localStorage');
        return true;
      } catch (err) {
        console.error('❌ Failed to save state:', err);
        return false;
      }
    }

    load() {
      // Load state from localStorage
      try {
        const saved = localStorage.getItem(this.key);
        if (!saved) return null;
        const data = JSON.parse(saved);
        console.log('✅ State loaded from localStorage (timestamp:', new Date(data.timestamp).toLocaleTimeString(), ')');
        return data.state;
      } catch (err) {
        console.error('❌ Failed to load state:', err);
        return null;
      }
    }

    restore(targetObject) {
      // Restore state to target object (e.g., window.flowDashboardState)
      const saved = this.load();
      if (saved && typeof targetObject === 'object') {
        Object.assign(targetObject, saved);
        console.log('✅ State restored to object');
        return true;
      }
      return false;
    }

    clear() {
      // Clear saved state
      try {
        localStorage.removeItem(this.key);
        console.log('✅ State cleared from localStorage');
        return true;
      } catch (err) {
        console.error('❌ Failed to clear state:', err);
        return false;
      }
    }

    getSize() {
      // Get size of saved state in bytes
      const saved = localStorage.getItem(this.key);
      return saved ? new Blob([saved]).size : 0;
    }
  }

  const stateManager = new StateManager('flowDashboardState');
  
  // Expose StateManager globally
  window.stateManager = stateManager;

  // ✅ 자동저장 함수 및 스냅샷 함수 (나중에 init에서 구현하여 외부에 노출)
  let autoSaveCurrentCardFn = null;
  let addCurrentWinSnapshotFn = null;

  const state = window.flowDashboardState || {
    currentStep: 1,
    marketData: null,
    signalData: null,
    tradeData: null,
    nbWave: null,
    nbWaveZones: null,
    zoneSeries: null,
    nbStats: null,
    mlStats: null,
    currentZone: null,
    selectedInterval: 'minute10',
    timeframes: ['minute1', 'minute3', 'minute5', 'minute10', 'minute15', 'minute30', 'minute60', 'minute240', 'day'],
    currentTfIndex: 3,
    waveSegmentCount: null,
    savedNbWaveData: null,
    nbWaveCached: null
  };

  let winGradeTrendChart = null;
  let ccSummaryChart = null;

  // Shared references
  let ccCurrentData = window.ccCurrentData || null;
  let ccCurrentRating = window.ccCurrentRating || null; // ✅ 초기화 필수
  let winClientHistory = Array.isArray(window.winClientHistory) ? window.winClientHistory : [];

  // Timeframe labels for UI
  const timeframeLabel = {
    minute1: '1분',
    minute3: '3분',
    minute5: '5분',
    minute10: '10분',
    minute15: '15분',
    minute30: '30분',
    minute60: '1시간',
    minute240: '4시간',
    day: '1일'
  };

  // Live price polling (updates window.candleDataCache)
  let livePricePoller = null;
  function stopLivePricePolling() {
    try {
      if (livePricePoller) {
        clearInterval(livePricePoller);
        livePricePoller = null;
      }
    } catch(_) {}
  }
  async function fetchLatestCandle(interval) {
    try {
      const tf = interval || state.selectedInterval || 'minute10';
      const resp = await fetch(`/api/ohlcv?interval=${encodeURIComponent(tf)}&count=1`);
      const json = await resp.json();
      const rows = Array.isArray(json?.data) ? json.data : [];
      const last = rows[rows.length - 1];
      if (last && Number.isFinite(Number(last.close))) {
        const candle = {
          time: Math.floor(Number(last.time) / 1000),
          open: Number(last.open || 0),
          high: Number(last.high || 0),
          low: Number(last.low || 0),
          close: Number(last.close || 0)
        };
        return candle;
      }
      return null;
    } catch(_) { return null; }
  }
  function startLivePricePolling(interval) {
    stopLivePricePolling();
    const tf = interval || state.selectedInterval || 'minute10';
    livePricePoller = setInterval(async () => {
      const latest = await fetchLatestCandle(tf);
      if (!latest) return;
      try {
        if (!Array.isArray(window.candleDataCache)) window.candleDataCache = [];
        window.candleDataCache.push(latest);
        // 메모리 누수 방지: 최근 24개 캔들만 유지
        if (window.candleDataCache.length > 24) {
          window.candleDataCache = window.candleDataCache.slice(-24);
        }
        
        // BTC 가격 업데이트
        updateBTCPrice();
      } catch(_) {}
    }, 3000); // poll every 3s to keep UI fresh without overloading API
  }

  // BTC 가격 업데이트
  async function updateBTCPrice() {
    try {
      const btcPriceEl = document.getElementById('btcPrice');
      if (!btcPriceEl) return;
      
      // 캐시에서 최신 BTC 데이터 확인
      if (window.ccCurrentData && window.ccCurrentData.coin === 'BTC') {
        const currentPrice = window.ccCurrentData.current_price || window.ccCurrentData.price;
        if (currentPrice) {
          btcPriceEl.textContent = `$${parseFloat(currentPrice).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }
      }
    } catch(err) {
      console.warn('BTC 가격 업데이트 실패:', err);
    }
  }

  // Prefix API paths with optional base (for proxy/local usage)
  function withApiBase(path) {
    const base = window.API_BASE || '';
    if (!path) return base;
    if (/^https?:\/\//i.test(path)) return path;
    return `${base}${path}`;
  }
  // Expose helper for external callers (e.g., inline button handlers)
  window.withApiBase = withApiBase;

  // Fetch helper that retries when API responds with 410 (rate-limit or transient)
  async function fetchWith410Retry(url, options = {}, maxRetries = 3, retryDelayMs = 1000) {
    let attempt = 0;
    while (true) {
      const resp = await fetch(url, options);
      if (resp.status !== 410 || attempt >= maxRetries) {
        return resp;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      attempt += 1;
    }
  }
  async function postJson(path, data) {
    try {
      const resp = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {})
      });
      return await resp.json();
    } catch (err) {
      console.error('POST fail', path, err);
      return { ok: false, error: String(err) };
    }
  }

  // ===== CARD RATING HELPER FUNCTIONS (Refactored) =====
  function calculateRScore(max, min) {
    // Calculate R score (0~1) based on MAX + MIN: ratio analysis
    const sum = max + min;
    const ratio = max > 0 && min > 0 ? max / min : 1;
    const sumScore = Math.min(0.5, sum / 198 * 0.5);
    const ratioScore = ratio > 1 
      ? Math.min(0.5, (ratio - 1) * 0.2) 
      : Math.max(-0.3, (1 - 1/ratio) * -0.3);
    return Math.max(0, Math.min(1, sumScore + ratioScore + 0.3));
  }

  function rScoreToLetter(r) {
    // Convert R score to letter grade (S~F)
    if (r >= 0.80) return 'S';
    if (r >= 0.70) return 'A';
    if (r >= 0.60) return 'B';
    if (r >= 0.50) return 'C';
    if (r >= 0.40) return 'D';
    if (r >= 0.30) return 'E';
    return 'F';
  }

  function calculateNBZoneBias(nbBlue, nbOrange, nbBlueCount, nbOrangeCount, nbLastZone) {
    // Calculate bias multiplier based on N/B zone distribution
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const nbBlueRatio = Number.isFinite(nbBlue) ? clamp01(nbBlue) : 0.5;
    const nbOrangeRatio = Number.isFinite(nbOrange) ? clamp01(nbOrange) : (1 - nbBlueRatio);
    
    const ratioBias = 1 + (nbOrangeRatio - nbBlueRatio) * 0.6;
    
    const totalCnt = (Number.isFinite(nbBlueCount) ? nbBlueCount : 0) + (Number.isFinite(nbOrangeCount) ? nbOrangeCount : 0);
    const countBias = totalCnt > 0 ? 1 + ((nbOrangeCount - nbBlueCount) / totalCnt) * 0.4 : 1;
    
    const lastZoneBias = nbLastZone === 'ORANGE' ? 1.1 : (nbLastZone === 'BLUE' ? 0.9 : 1);
    
    const rawBias = ratioBias * countBias * lastZoneBias;
    return Math.max(0.5, Math.min(1.5, rawBias));
  }

  function calculateCardPts(letters, sign, bias) {
    // Calculate avgPts from letter grades and sign
    const letterPts = { F:0, E:1, D:2, C:3, B:4, A:5, S:6 };
    const avgPtsRaw = letters.reduce((sum, ch) => sum + (letterPts[ch] || 0), 0) / letters.length;
    const signAdjustment = sign === '+' ? 0.25 : (sign === '-' ? -0.25 : 0);
    return (avgPtsRaw + signAdjustment) * bias;
  }

  function getLeagueName(avgPts) {
    // Determine league based on avgPts
    if (avgPts < 2.0) return '브론즈';
    if (avgPts < 3.0) return '실버';
    if (avgPts < 4.0) return '골드';
    if (avgPts < 5.0) return '플래티넘';
    if (avgPts < 5.75) return '다이아';
    return '첼린저';
  }

  function computeCardCodeFS(params) {
    const { priceMax, priceMin, volumeMax, volumeMin, amountMax, amountMin, nbBlue, nbOrange, nbBlueCount, nbOrangeCount, nbLastZone } = params || {};
    if ([priceMax, priceMin, volumeMax, volumeMin, amountMax, amountMin].some(v => v == null || isNaN(Number(v)))) {
      throw new Error('invalid params');
    }

    const toNum = (v) => Number(v);
    const pMax = toNum(priceMax);
    const pMin = toNum(priceMin);
    const vMax = toNum(volumeMax);
    const vMin = toNum(volumeMin);
    const aMax = toNum(amountMax);
    const aMin = toNum(amountMin);

    // Calculate R scores for each metric
    const rPrice = calculateRScore(pMax, pMin);
    const rVol = calculateRScore(vMax, vMin);
    const rAmt = calculateRScore(aMax, aMin);

    const spreadPrice = Math.abs(pMax - pMin);
    const spreadVol = Math.abs(vMax - vMin);
    const spreadAmt = Math.abs(aMax - aMin);

    // Convert R scores to letter grades
    const pL = rScoreToLetter(rPrice);
    const vL = rScoreToLetter(rVol);
    const aL = rScoreToLetter(rAmt);

    const avgR = (rPrice + rVol + rAmt) / 3;

    // Calculate N/B zone bias and extract intermediate values
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const nbBlueRatio = Number.isFinite(nbBlue) ? clamp01(nbBlue) : 0.5;
    const nbOrangeRatio = Number.isFinite(nbOrange) ? clamp01(nbOrange) : (1 - nbBlueRatio);
    const bias = calculateNBZoneBias(nbBlue, nbOrange, nbBlueCount, nbOrangeCount, nbLastZone);
    const biasedAvgR = Math.max(0, Math.min(1, avgR * bias));
    
    // Extract rawBias for return value
    const ratioBias = 1 + (nbOrangeRatio - nbBlueRatio) * 0.6;
    const totalCnt = (Number.isFinite(nbBlueCount) ? nbBlueCount : 0) + (Number.isFinite(nbOrangeCount) ? nbOrangeCount : 0);
    const countBias = totalCnt > 0 ? 1 + ((nbOrangeCount - nbBlueCount) / totalCnt) * 0.4 : 1;
    const lastZoneBias = nbLastZone === 'ORANGE' ? 1.1 : (nbLastZone === 'BLUE' ? 0.9 : 1);
    const rawBias = ratioBias * countBias * lastZoneBias;

    // Calculate points and signs
    const sign = biasedAvgR >= 0.65 ? '+' : (biasedAvgR <= 0.45 ? '-' : '');
    const code = `${pL}${vL}${aL}${sign}`;
    
    const avgPts = calculateCardPts([pL, vL, aL], sign, bias);
    const league = getLeagueName(avgPts);
    const group = avgPts < 2.5 ? 'EASY' : (avgPts < 4.5 ? 'NORMAL' : 'HARD');
    // Determine super status
    const countAS = [pL, vL, aL].filter(ch => ch === 'A' || ch === 'S').length;
    const countS = [pL, vL, aL].filter(ch => ch === 'S').length;
    const isSuper = (countS >= 2) || (avgPts >= 5.5) || (sign === '+' && countAS >= 2);

    // Calculate enhancement value based on magnitude
    const meanMax = (pMax + vMax + aMax) / 3;
    const magnitudeBoost = Math.log10(Math.max(1, meanMax) + 1);
    const magnitudeFactor = 0.7 + 0.3 * Math.min(2, magnitudeBoost) / 2;
    const enhancement = Math.min(99, Math.max(1, Math.round((biasedAvgR * 100) * magnitudeFactor)));
    
    // Determine color based on sign
    const color = sign === '+' ? '#00d1ff' : (sign === '-' ? '#ffb703' : '#e6eefc');

    return {
      code,
      league,
      group,
      super: isSuper,
      avgDiff: (spreadPrice + spreadVol + spreadAmt) / 3,
      avgPts: avgPts,
      color,
      enhancement,
      // Raw values to feed AI
      priceMax, priceMin, volumeMax, volumeMin, amountMax, amountMin,
      diffPrice: spreadPrice, diffVol: spreadVol, diffAmt: spreadAmt,
      rPrice, rVol, rAmt,
      magnitudeBoost,
      magnitudeFactor,
      nbBlueRatio,
      nbOrangeRatio,
      nbBlueCount,
      nbOrangeCount,
      nbLastZone,
      rawBias,
      bias,
      biasedAvgR
    };
  }

  function requestMlRating(cardPayload, onDone) {
    try {
      fetch('/api/ml/rating/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card: cardPayload })
      })
        .then(r => r.json())
        .then(res => {
          if (res && res.ok && typeof onDone === 'function') {
            onDone(res);
          }
        })
        .catch(() => {});
    } catch (_) {}
  }

  function calculateAndDisplayCardRating(params) {
    try {
      const res = computeCardCodeFS(params);
      const ratingDisplay = document.getElementById('ccRatingDisplay');
      const ratingScore = document.getElementById('ccRatingScore');
      const ratingSection = document.getElementById('ccRatingSection');
      
      // 부호 결정: 현재 zone 기반 (nbLastZone)
      const currentZone = String(params.nbLastZone || '').toUpperCase();
      const enhancementSign = (currentZone === 'BLUE') ? '+' : (currentZone === 'ORANGE') ? '-' : '+';
      
      if (ratingDisplay && ratingScore && ratingSection) {
        ratingDisplay.innerHTML = `<span style="color:${res.color};">${res.code}</span> <span style="color:#ffd700;font-size:12px;">${enhancementSign}${res.enhancement}강</span>`;
        ratingScore.innerHTML = `${res.league} ${res.group}${res.super ? ' • SUPER' : ''}`;
        ratingSection.style.background = `linear-gradient(135deg, rgba(0,0,0,0.3), ${res.color}22)`;
        ratingSection.style.borderColor = `${res.color}44`;
      }
      ccCurrentRating = res;
      window.ccCurrentRating = res;

      // ccCurrentData 존재 여부 확인 (초기화되지 않았을 수 있음)
      if (typeof window.ccCurrentData === 'object' && window.ccCurrentData) {
        requestMlRating(ccCurrentData, (ml) => {
          ccCurrentRating.mlGrade = ml.grade;
          ccCurrentRating.mlEnhancement = ml.enhancement;
          if (ratingDisplay && ratingScore) {
            ratingDisplay.innerHTML = `<span style="color:${res.color};">${res.code}</span> <span style="color:#ffd700;font-size:12px;">${enhancementSign}${res.enhancement}강</span>`;
            ratingScore.innerHTML = `${res.league} ${res.group}${res.super ? ' • SUPER' : ''} | ML ${ml.grade} ${enhancementSign}${ml.enhancement}강`;
          }
        });
      }
    } catch (e) {
      console.warn('calculateAndDisplayCardRating failed:', e?.message);
    }
  }

  function drawSummaryChart(priceValues, volumeValues, turnoverValues) {
    const ctx = document.getElementById('ccSummaryChart');
    if (!ctx || typeof Chart === 'undefined') return;

    // Update last price label outside the chart to avoid overlay
    try {
      const lastPrice = Array.isArray(priceValues) && priceValues.length
        ? Number(priceValues[priceValues.length - 1])
        : null;
      const labelEl = document.getElementById('ccSummaryLastPrice');
      if (labelEl) {
        labelEl.textContent = lastPrice != null && isFinite(lastPrice)
          ? `₩${lastPrice.toLocaleString('ko-KR')}`
          : '-';
      }
    } catch (_) {}

    const step = Math.max(1, Math.ceil(priceValues.length / 15));
    const labels = Array.from({ length: Math.ceil(priceValues.length / step) }, () => '');
    const priceSample = priceValues.filter((_, i) => i % step === 0);
    const volumeSample = (volumeValues || []).filter((_, i) => i % step === 0);

    const normalize = (arr) => {
      if (!arr || arr.length === 0) return [];
      const vals = arr.filter(v => v != null);
      if (vals.length === 0) return arr.map(() => 0);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const range = max - min || 1;
      return arr.map(v => v == null ? 0 : (v - min) / range);
    };

    const normalizedPrice = normalize(priceSample);
    const normalizedVol = normalize(volumeSample);

    // ===== 예측 구간 데이터 추가 =====
    // ML 예측 결과를 미래 시점에 크고 투명한 동그라미로 표시
    const mlPrediction = window.flowDashboardState?.marketData || {};
    const mlAction = mlPrediction.action || mlPrediction.insight?.zone;
    const horizon = mlPrediction.horizon || 5; // 예측 범위 (5봉 후)
    
    // 미래 시점 레이블 추가 (예측 구간)
    const futureLabels = [...labels];
    for (let i = 0; i < horizon; i++) {
      futureLabels.push('');
    }
    
    // 예측 포인트 데이터 (현재 + 빈 값들 + 예측값)
    const predictionData = [...normalizedPrice];
    for (let i = 0; i < horizon - 1; i++) {
      predictionData.push(null); // 중간은 비움
    }
    // 마지막에 예측 포인트 추가 (현재 가격의 정규화 값 유지)
    predictionData.push(normalizedPrice[normalizedPrice.length - 1] || 0.5);
    
    // 예측 Zone에 따른 색상
    const predColor = mlAction === 'BLUE' ? 'rgba(0,209,255,0.4)' : 
                      mlAction === 'ORANGE' ? 'rgba(255,183,3,0.4)' : 
                      'rgba(128,128,128,0.3)';
    const predBorderColor = mlAction === 'BLUE' ? '#00d1ff' : 
                            mlAction === 'ORANGE' ? '#ffb703' : 
                            '#888888';

    if (ccSummaryChart) {
      try { ccSummaryChart.destroy(); } catch (_) {}
    }

    ccSummaryChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: '가격',
            data: normalizedPrice,
            borderColor: '#00d1ff',
            backgroundColor: 'rgba(0,209,255,0.15)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 1,
            pointHoverRadius: 2,
            pointBackgroundColor: '#00d1ff',
            yAxisID: 'y'
          },
          {
            label: '거래량',
            data: normalizedVol,
            borderColor: '#0ecb81',
            backgroundColor: 'transparent',
            borderWidth: 1,
            fill: false,
            tension: 0.3,
            pointRadius: 0.5,
            pointBackgroundColor: '#0ecb81',
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: {
          y: { type: 'linear', display: false, position: 'left', min: 0, max: 1 },
          y1: { type: 'linear', display: false, position: 'right', min: 0, max: 1 },
          x: { display: false, grid: { display: false } }
        }
      }
    });
    
    // Render mini zone chart for current card
    renderCurrentCardMiniZoneChart();
  }
  
  function renderCurrentCardMiniZoneChart() {
    const container = document.getElementById('ccMiniZoneChart');
    if (!container) return;
    
    // Use only window.nbWaveZonesConsole
    const zones = Array.isArray(window.nbWaveZonesConsole) && window.nbWaveZonesConsole.length > 0
      ? window.nbWaveZonesConsole.map(z => ({ zone: z }))
      : [];
    
    if (zones.length === 0) {
      container.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; color:#666; font-size:9px;">No zones</div>';
      console.warn('⚠️ renderCurrentCardMiniZoneChart: No zones available');
      return;
    }
    
    // Calculate percentage width for each div
    const eachWidth = (100 / zones.length).toFixed(2);
    
    // Render all zones without slicing (display all waves)
    const zoneHtml = zones.map(z => {
      const isOrange = z.zone === 'ORANGE';
      const bgGradient = isOrange 
        ? 'linear-gradient(180deg, rgba(255,183,3,0.8) 0%, rgba(255,183,3,0.3) 100%)'
        : 'linear-gradient(180deg, rgba(0,209,255,0.8) 0%, rgba(0,209,255,0.3) 100%)';
      return `<div style="width:${eachWidth}%; height:100%; background:${bgGradient}; border-radius:1px;"></div>`;
    }).join('');
    
    container.innerHTML = zoneHtml;
    const orangeCount = zones.filter(z => z.zone === 'ORANGE').length;
    console.log(`✅ Mini zone chart rendered: ${zones.length} total, ${orangeCount} orange, each width: ${eachWidth}%`);
  }

  // ===== CHART UPDATE HELPERS =====
  function prepareWinGradeTrendData(entries, maxPoints = 60) {
    // Transform entries to chart-ready format
    const list = Array.isArray(entries) ? entries.slice(0, maxPoints) : [];
    if (list.length === 0) return null;
    
    const ordered = list.slice().reverse();
    const labels = [];
    const data = [];
    
    ordered.forEach(item => {
      const ts = item.ts ? new Date(item.ts) : new Date();
      labels.push(ts.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
      const val = Number(item.avgPts != null ? item.avgPts : 0);
      data.push(Number(val.toFixed(2)));
    });
    
    return { labels, data, latestValue: data.length ? data[data.length - 1] : 0 };
  }

  function createWinGradeTrendChart(ctx, labels, data) {
    // Create new Chart.js instance for trend
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '카드 등급 점수',
          data,
          borderColor: '#ffd700',
          backgroundColor: 'rgba(255,215,0,0.15)',
          tension: 0.25,
          fill: true,
          pointRadius: 0,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            max: 7,
            ticks: { stepSize: 1 }
          }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  function updateWinGradeTrendChart(entries) {
    try {
      const trendData = prepareWinGradeTrendData(entries);
      if (!trendData) {
        console.warn('⚠️ No win grade trend data');
        return;
      }
      
      const { labels, data, latestValue } = trendData;

      // Update label
      const labelEl = document.getElementById('winGradeTrendLabel');
      if (labelEl) {
        labelEl.textContent = `${latestValue.toFixed(2)} pts`;
      }

      // Get canvas element
      const ctx = document.getElementById('winGradeTrendChart');
      if (!ctx) {
        console.error('❌ winGradeTrendChart element not found');
        return;
      }
      
      if (typeof Chart === 'undefined') {
        console.error('❌ Chart.js not loaded');
        return;
      }

      // Update or create chart
      if (winGradeTrendChart) {
        winGradeTrendChart.data.labels = labels;
        winGradeTrendChart.data.datasets[0].data = data;
        winGradeTrendChart.update();
        console.log('✅ Win grade trend chart updated:', data.length, 'points');
        return;
      }

      winGradeTrendChart = createWinGradeTrendChart(ctx, labels, data);
      console.log('✅ Win grade trend chart created:', data.length, 'points');
    } catch (err) {
      console.error('❌ Failed to update win grade trend chart:', err);
    }
  }

  // ===== END CHART HELPERS =====


  // Small sparkline for win snapshots
  function createWinPriceChart(canvasId, prices, color) {
    try {
      const cv = document.getElementById(canvasId);
      if (!cv || typeof Chart === 'undefined') return;
      if (cv._chart) {
        try { cv._chart.destroy(); } catch(_) {}
      }
      const labels = prices.map((_, i) => i);
      const dataset = prices.map(v => Number(v)).filter(v => Number.isFinite(v));
      const data = {
        labels,
        datasets: [{
          data: dataset,
          borderColor: color || '#9aa8c2',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0,
          tension: 0.25,
          fill: false
        }]
      };
      cv._chart = new Chart(cv, {
        type: 'line',
        data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: { x: { display: false }, y: { display: false } }
        }
      });
    } catch (e) {
      console.warn('sparkline chart error:', e?.message);
    }
  }

  function renderWinPanel() {
    try {
      const container = document.getElementById('winList');
      if (!container) return;

      const client = Array.isArray(winClientHistory) ? winClientHistory : [];
      const server = []; // 서버 항목은 목록에 표시하지 않음
      const tfMap = { minute1: '1m', minute3: '3m', minute5: '5m', minute10: '10m', minute15: '15m', minute30: '30m', minute60: '1h', day: '1D' };

      const clientHtml = client.map((s, idx) => {
        const zoneColor = s.zone === 'BLUE' ? '#00d1ff' : s.zone === 'ORANGE' ? '#ffb703' : '#888888';
        const zoneBg = s.zone === 'BLUE' ? 'rgba(0,209,255,0.10)' : s.zone === 'ORANGE' ? 'rgba(255,183,3,0.10)' : 'rgba(255,255,255,0.04)';
        const zoneLabel = s.zone === 'BLUE' ? '🔵 BLUE' : s.zone === 'ORANGE' ? '🟠 ORANGE' : '⚪ NONE';
        const tfLabel = tfMap[s.tf] || s.tf || '10m';
        // ORANGE면 마이너스(-), BLUE면 플러스(+)
        const enhPrefix = s.zone === 'ORANGE' ? '-' : '+';
        const enhLabel = s.enhancement ? `${enhPrefix}${s.enhancement}강` : '';
        // ML 등급도 ORANGE면 마이너스(-)
        const mlEnhPrefix = s.zone === 'ORANGE' ? '-' : '+';
        const mlLabel = s.mlGrade ? `ML ${s.mlGrade}${s.mlEnhancement ? ` ${mlEnhPrefix}${s.mlEnhancement}강` : ''}` : '';
        const priceLabel = s.price != null ? `₩${Number(s.price||0).toLocaleString()}` : '-';
        // N/B WAVE: display both waveR (BLUE) and waveW (ORANGE) like top N/B WAVE STATUS
        const waveRLabel = s.waveR != null ? Number(s.waveR).toFixed(3) : '-';
        const waveWLabel = s.waveW != null ? Number(s.waveW).toFixed(3) : '-';
        return `
          <div class="win-chip" style="border-left:3px solid ${zoneColor}; background:${zoneBg}; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; width:100%; margin-bottom:4px;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-weight:700; color:${zoneColor};">${zoneLabel}</span>
                <span style="font-weight:700; color:#e6eefc;">${s.code || '-'} ${enhLabel}</span>
                <span style="background:${zoneColor}; color:#0b1220; padding:1px 6px; border-radius:999px; font-size:10px; font-weight:700;">${tfLabel}</span>
              </div>
              <div style="color:${zoneColor}; font-weight:700; font-size:11px;">${priceLabel}</div>
            </div>
            <div style="display:flex; justify-content:space-between; width:100%; font-size:11px; color:#9aa8c2; margin-bottom:4px;">
              <span>${s.league || ''} ${s.group || ''}${s.super ? ' • SUPER' : ''}${mlLabel ? ' | ' + mlLabel : ''}</span>
              <span style="font-weight:700;">
                <span style="color:#00d1ff;">🔵 ${waveRLabel}</span>
                <span style="margin:0 4px;">|</span>
                <span style="color:#ffb703;">🟠 ${waveWLabel}</span>
              </span>
            </div>
            <div style="width:100%; height:24px; display:flex; gap:1px; margin-bottom:4px;" id="winZoneChart_${idx}"></div>
            <div style="width:100%; height:48px;">
              <canvas id="winPriceChart_${idx}" style="width:100% !important; height:48px !important;"></canvas>
            </div>
            <div style="font-size:9px; color:#9aa8c2; margin-top:4px;">
              ${mlLabel}
              <span style="margin-left:6px; background:${zoneColor}; color:#0b1220; padding:1px 6px; border-radius:999px;">N/B ${s.zone || '-'}</span>
              <span style="margin-left:6px;">${(new Date(s.ts)).toLocaleTimeString('ko-KR')}</span>
            </div>
          </div>`;
      }).join('');

      const serverHtml = server.map((s, idx) => {
          const zoneColor = s.zone === 'BLUE' ? '#00d1ff' : s.zone === 'ORANGE' ? '#ffb703' : '#888888';
        const zoneBg = 'rgba(255,255,255,0.06)';
        const tfLabel = tfMap[s.tf] || s.tf || '10m';
        const priceLabel = s.price != null ? `₩${Number(s.price||0).toLocaleString()}` : '-';
        return `
            <div class="win-chip" style="border-left:3px dashed ${zoneColor}; background:${zoneBg}; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; width:100%; margin-bottom:4px;">
              <div style="display:flex; align-items:center; gap:6px;">
                  <span style="font-weight:700; color:#e6eefc;">${s.label || 'NB MAX'}</span>
                <span style="background:${zoneColor}; color:#0b1220; padding:1px 6px; border-radius:999px; font-size:10px; font-weight:700;">${tfLabel}</span>
              </div>
              <div style="color:${zoneColor}; font-weight:700; font-size:11px;">${priceLabel}</div>
            </div>
            <div style="display:flex; justify-content:space-between; width:100%; font-size:11px; color:#9aa8c2;">
              <span>${(new Date(s.ts)).toLocaleTimeString('ko-KR')}</span>
              <span>${s.path ? '...'+String(s.path).slice(-28) : ''}</span>
            </div>
          </div>`;
      }).join('');

      const html = [serverHtml, clientHtml].filter(Boolean).join('');
      container.innerHTML = html || '<div style="color: #666; text-align: center; padding: 10px; font-size: 11px;">데이터 없음</div>';

      const localCountEl = document.getElementById('winLocalCount');
      const serverCountEl = document.getElementById('winServerCount');
      if (localCountEl) localCountEl.textContent = client.length;
      if (serverCountEl) serverCountEl.textContent = server.length;

      if (client.length) {
        const latest = client[0];
        const gradeEl = document.getElementById('winCardGrade');
        const leagueEl = document.getElementById('winCardLeague');
        const mlEl = document.getElementById('winCardMlGrade');
        if (gradeEl) gradeEl.textContent = latest.code || '-';
        if (leagueEl) leagueEl.textContent = `${latest.league || ''} ${latest.group || ''}${latest.super ? ' • SUPER' : ''}`.trim() || '-';
        if (mlEl) mlEl.textContent = latest.mlGrade ? `ML ${latest.mlGrade}${latest.mlEnhancement ? ` +${latest.mlEnhancement}강` : ''}` : '';
      }

      updateWinGradeTrendChart(client);
      
      // Render mini zone chart and price trend chart for each snapshot
      try {
        client.forEach((s, idx) => {
          // Render mini zone chart using zonesArray if present, else fallback to legacy s.zones
          const zoneChartContainer = document.getElementById(`winZoneChart_${idx}`);
          if (zoneChartContainer && Array.isArray(s.zonesArray) && s.zonesArray.length > 0) {
            const divWidth = (100 / s.zonesArray.length).toFixed(2); // Percentage width per zone
            const zoneHtml = s.zonesArray.map(zone => {
              const isOrange = zone === 'ORANGE';
              const bgGradient = isOrange 
                ? 'linear-gradient(180deg, rgba(255,183,3,0.8) 0%, rgba(255,183,3,0.3) 100%)'
                : 'linear-gradient(180deg, rgba(0,209,255,0.8) 0%, rgba(0,209,255,0.3) 100%)';
              return `<div style="width:${divWidth}%; background:${bgGradient}; border-radius:2px;"></div>`;
            }).join('');
            zoneChartContainer.innerHTML = zoneHtml;
            if (console.log) console.log(`✅ Win snapshot #${idx} zone chart: ${s.zonesArray.length} zones rendered`);
          } else if (zoneChartContainer && Array.isArray(s.zones) && s.zones.length > 0) {
            const divWidth = (100 / s.zones.length).toFixed(2);
            const zoneHtml = s.zones.map(z => {
              const isOrange = (z.zone === 'ORANGE') || (typeof z.value === 'number' && typeof z.base === 'number' && z.value > z.base);
              const bgGradient = isOrange 
                ? 'linear-gradient(180deg, rgba(255,183,3,0.8) 0%, rgba(255,183,3,0.3) 100%)'
                : 'linear-gradient(180deg, rgba(0,209,255,0.8) 0%, rgba(0,209,255,0.3) 100%)';
              return `<div style="width:${divWidth}%; background:${bgGradient}; border-radius:2px;"></div>`;
            }).join('');
            zoneChartContainer.innerHTML = zoneHtml;
            if (console.log) console.log(`✅ Win snapshot #${idx} zone chart (legacy): ${s.zones.length} zones rendered`);
          }
          
          // Render price trend chart
          if (!s || !Array.isArray(s.spark) || s.spark.length === 0) return;
          const zoneColor = s.zone === 'BLUE' ? '#00d1ff' : s.zone === 'ORANGE' ? '#ffb703' : '#888888';
          createWinPriceChart(`winPriceChart_${idx}`, s.spark, zoneColor);
        });
      } catch (e) { console.warn('price chart error:', e?.message); }
    } catch (err) {
      console.warn('renderWinPanel error:', err?.message);
    }
  }

  function addCurrentWinSnapshot(interval) {
    try {
      const cc = ccCurrentData || window.ccCurrentData;
      const cr = ccCurrentRating || window.ccCurrentRating;
      if (!cc || !cr) {
        console.log('⏭️ Skipping snapshot: missing cc or cr', {cc: !!cc, cr: !!cr});
        return;
      }

      const tf = interval || state.selectedInterval || cc.interval || 'minute10';
      const nowIso = new Date().toISOString();
      
      // Determine zone robustly: prefer last of window.nbWaveZonesConsole, then state/current fallbacks
      let zone = null;
      if (Array.isArray(window.nbWaveZonesConsole) && window.nbWaveZonesConsole.length > 0) {
        zone = window.nbWaveZonesConsole[window.nbWaveZonesConsole.length - 1];
      }
      if (!zone || zone === 'NONE') {
        const nbStats = state.nbStats || {};
        zone = nbStats.zone || state.currentZone || window.ccCurrentZone || (state.mlStats && state.mlStats.mlZone) || 'NONE';
      }
      if (!zone || zone === 'NONE') {
        console.log('⏭️ Skipping snapshot: no zone detected');
        return;
      }

      const last = winClientHistory[0];
      if (last) {
        const dt = Math.abs(new Date(nowIso).getTime() - new Date(last.ts).getTime());
        if (last.tf === tf && last.code === cr.code && dt < 2000) return;
      }

      // Use state.nbStats rValue and w (from Step 3) for consistency; fallback to ccCurrentData
      const waveR = (state.nbStats && typeof state.nbStats.rValue === 'number') ? state.nbStats.rValue : (cc.r ?? null);
      const waveW = (state.nbStats && typeof state.nbStats.w === 'number') ? state.nbStats.w : (cc.w ?? null);
      
      // Use window.nbWaveZonesConsole (BaselineSeries zone array from chart) or fallback to state.zoneSeries
      const zoneArray = window.nbWaveZonesConsole && window.nbWaveZonesConsole.length > 0
        ? window.nbWaveZonesConsole // Use chart's BaselineSeries zones (251 elements)
        : (state.zoneSeries && state.zoneSeries.length > 0 ? state.zoneSeries : []);

      const entry = {
        ts: nowIso,
        tf,
        zone,
        code: cr.code,
        league: cr.league,
        group: cr.group,
        super: !!cr.super,
        avgPts: cr.avgPts,
        enhancement: cr.mlEnhancement || cr.enhancement || 1,
        mlGrade: cr.mlGrade || null,
        mlEnhancement: cr.mlEnhancement || null,
        price: cc.current_price || 0,
        waveR: waveR,
        waveW: waveW,
        spark: Array.isArray(cc?.nb?.price?.values) ? cc.nb.price.values.slice(-30) : [],
        zonesArray: zoneArray // Store full zone array (all ORANGE/BLUE zones from chart)
      };

      winClientHistory.unshift(entry);
      winClientHistory = winClientHistory.slice(0, 24); // 메모리 누수 방지: 최근 24개만 유지
      window.winClientHistory = winClientHistory;

      // Train/update script-based AI on new snapshot
      try {
        if (typeof ScriptAI !== 'undefined' && ScriptAI && typeof ScriptAI.onSnapshotAdded === 'function') {
          ScriptAI.onSnapshotAdded(entry);
        }
      } catch(_) {}
      renderWinPanel();
    } catch (e) {
      console.warn('addCurrentWinSnapshot error:', e?.message);
    }
  }

  // ============================================================================
  // Script-based AI (no external ML): logistic regression on snapshots
  // ============================================================================
  const ScriptAI = (() => {
    const WKEY = 'scriptAI_weights_v1';
    const BKEY = 'scriptAI_bias_v1';
    let weights = [0, 0, 0, 0];
    let bias = 0;

    function load() {
      try {
        const w = JSON.parse(localStorage.getItem(WKEY) || 'null');
        const b = JSON.parse(localStorage.getItem(BKEY) || 'null');
        if (Array.isArray(w) && w.length === 4) weights = w.map(Number);
        if (typeof b === 'number') bias = b;
      } catch(_) {}
    }
    function save() {
      try {
        localStorage.setItem(WKEY, JSON.stringify(weights));
        localStorage.setItem(BKEY, JSON.stringify(bias));
      } catch(_) {}
    }

    function getFeatures(ctx) {
      const r = Number(ctx.rValue ?? 0.5);
      const w = Number(ctx.w ?? 0.5);
      const rw = r - w; // zone tilt
      let mom = 0;
      try {
        const cds = (window.candleDataCache || []).slice(-5);
        if (cds.length >= 2) {
          const p = Number(cds[cds.length-1]?.close || cds[cds.length-1]?.value || 0);
          const q = Number(cds[cds.length-2]?.close || cds[cds.length-2]?.value || 0);
          if (q) mom = (p - q) / q;
        }
      } catch(_) {}
      const vol = Number(ctx.volume ?? 0) > 0 ? Math.log10(Number(ctx.volume)) : 0;
      const mag = Number(ctx.magnitude ?? 0);
      return [rw, mom, vol, mag];
    }

    function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

    function predict(ctx) {
      const x = getFeatures(ctx);
      const z = (weights[0]*x[0]) + (weights[1]*x[1]) + (weights[2]*x[2]) + (weights[3]*x[3]) + bias;
      const p = sigmoid(z);
      const zone = p >= 0.5 ? 'BLUE' : 'ORANGE';
      const conf = Math.abs(p - 0.5) * 200; // 0-100
      return { zone, confidence: conf, p };
    }

    function trainFromSnapshots(snaps, epochs=30, lr=0.1) {
      if (!Array.isArray(snaps) || snaps.length < 10) return;
      for (let e=0; e<epochs; e++) {
        for (let i=0; i<snaps.length; i++) {
          const s = snaps[i];
          const ctx = {
            rValue: Number(s.waveR ?? state.nbStats?.rValue ?? 0.5),
            w: Number(s.waveW ?? state.nbStats?.w ?? 0.5),
            volume: Number(s.current_volume ?? 0),
            magnitude: Number(s.avgPts ?? 0)
          };
          const x = getFeatures(ctx);
          const y = s.zone === 'BLUE' ? 1 : 0;
          const z = (weights[0]*x[0]) + (weights[1]*x[1]) + (weights[2]*x[2]) + (weights[3]*x[3]) + bias;
          const p = sigmoid(z);
          const err = p - y;
          // gradient update
          weights[0] -= lr * err * x[0];
          weights[1] -= lr * err * x[1];
          weights[2] -= lr * err * x[2];
          weights[3] -= lr * err * x[3];
          bias      -= lr * err;
        }
      }
      save();
    }

    function currentContext() {
      return {
        rValue: Number(state.nbStats?.rValue ?? 0.5),
        w: Number(state.nbStats?.w ?? 0.5),
        volume: 0,
        magnitude: Number(window.ccCurrentRating?.avgPts ?? 0)
      };
    }

    function onSnapshotAdded() {
      try {
        const snaps = (window.winClientHistory || []).slice(0, 24); // 최근 24개 스냅샷만 훈련
        trainFromSnapshots(snaps, 20, 0.08);
      } catch(_) {}
    }

    function getPrediction() {
      load();
      const pred = predict(currentContext());
      window.scriptAiPrediction = pred;
      return pred;
    }

    return { getPrediction, onSnapshotAdded };
  })();

  window.ScriptAI = ScriptAI;

  async function fetchNBZoneStatus(interval) {
    // Prefer chart-fetched data if present; otherwise hit API
    const url = withApiBase(`/api/nb-wave-ohlcv?timeframe=${encodeURIComponent(interval)}&count=300&window=50`);
    try {
      let data = null;
      if (state.nbWave && Array.isArray(state.nbWave.data) && state.nbWave.data.length > 0 && state.nbWave.base != null) {
        data = { ok: true, wave_data: state.nbWave.data, base: state.nbWave.base, summary: state.nbWave.summary };
      }
      if (!data) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json || !json.ok || !Array.isArray(json.wave_data) || json.wave_data.length === 0) {
          throw new Error('Invalid wave data');
        }
        data = json;
        // cache for reuse (preserve zone array if present)
        try {
          // Derive zones by baseline rule to match chart coloring (value > base = ORANGE)
          const baseVal = Number(json.base || 0);
          const zonesArr = json.wave_data.map(pt => (Number(pt.value) > baseVal ? 'ORANGE' : 'BLUE'));
          state.nbWaveZones = zonesArr;
          state.nbWaveZonesConsole = zonesArr;
          window.nbWaveZonesConsole = zonesArr;
          console.log('📊 N/B Wave zones (baseline rule from API):', zonesArr);
        } catch(_){ state.nbWaveZones = undefined; }
        state.nbWave = { data: json.wave_data, base: json.base, summary: json.summary || null, fromAPI: true };
      }

      const base = Number(data.base || 0);
      const list = data.wave_data;
      const summary = data.summary || {};
      const blueCount = Number(summary.blue || 0);
      const orangeCount = Number(summary.orange || 0);
      const last = list[list.length - 1] || {};
      // Current zone must follow the last element of the zones array used in UI/mini strip
      let currentZone = null;
      if (Array.isArray(window.nbWaveZonesConsole) && window.nbWaveZonesConsole.length > 0) {
        currentZone = window.nbWaveZonesConsole[window.nbWaveZonesConsole.length - 1];
      } else if (Array.isArray(state.nbWaveZones) && state.nbWaveZones.length > 0) {
        currentZone = state.nbWaveZones[state.nbWaveZones.length - 1];
      } else {
        // Fallback to API last point or baseline rule if arrays not ready
        currentZone = last.zone || ((Number(last.value) > base) ? 'ORANGE' : 'BLUE');
      }
      const ratio = typeof last.ratio === 'number' ? Number(last.ratio) : (Number(last.value) > base ? 0.75 : 0.25);

      // Update NB zone box
      const zoneEl = document.getElementById('ccNBZone');
      window.ccCurrentZone = currentZone;
      if (zoneEl) {
        const zoneLabel = currentZone === 'BLUE' ? '🔵 BLUE' : currentZone === 'ORANGE' ? '🟠 ORANGE' : '⚪ NONE';
        const zoneCount = Number(data.summary?.total || list.length) || list.length;
        const zoneColor = currentZone === 'BLUE' ? '#00d1ff' : currentZone === 'ORANGE' ? '#ffb703' : '#888888';
        zoneEl.innerHTML = `
          <div style="text-align: center;">
            <div style="font-size: 13px; font-weight: 700; color: ${zoneColor}; margin-bottom: 4px;">${zoneLabel}</div>
            <div style="font-size: 10px; color: #d9e2f3;">지난 ${zoneCount}개 구간</div>
          </div>
        `;
      }

      // Update wave R/W metrics for current card
      const rVal = ratio; // BLUE side ratio
      const wVal = 1 - ratio; // ORANGE complementary
      $('#ccWaveR').html(`<span style="color: #00d1ff;">${rVal.toFixed(3)}</span>`);
      $('#ccWaveW').html(`<span style="color: #ffb703;">${wVal.toFixed(3)}</span>`);
      const waveStatus = (rVal > 0.7 || wVal > 0.7) ? '강세' : (rVal < 0.3 || wVal < 0.3) ? '약세' : 'Normal';
      const waveStatusColor = (waveStatus === '강세') ? '#2ecc71' : (waveStatus === '약세') ? '#f6465d' : '#2ecc71';
      $('#ccWaveStatus').html(`<span style="color: ${waveStatusColor};">${waveStatus}</span>`);

      // Sync state for other components (mini chart etc.)
      state.currentZone = currentZone;
      state.nbStats = { ...(state.nbStats||{}), zone: currentZone, rValue: rVal, w: wVal, blueCount, orangeCount, lastZone: currentZone };
      // If chart already saved a zone array, reuse; otherwise derive
      if (Array.isArray(state.nbWaveZones) && state.nbWaveZones.length === list.length) {
        state.zoneSeries = state.nbWaveZones.map(z => ({ zone: z }));
      } else {
        state.zoneSeries = list.map(pt => ({ zone: pt.zone || (Number(pt.value) > base ? 'ORANGE' : 'BLUE') }));
      }
      // Use API zone directly (already calculated server-side with chart base)
      state.zoneSeries = list.map(pt => ({ value: Number(pt.value), base, zone: pt.zone || (Number(pt.value) > base ? 'ORANGE' : 'BLUE') }));

      // Re-render mini zone strip
      try { renderCurrentCardMiniZoneChart(); } catch(_) {}

      return currentZone;
    } catch (err) {
      console.warn('fetchNBZoneStatus failed:', err?.message);
      return null;
    }
  }

  async function autoSaveCurrentCard() {
    if (!ccCurrentData) return;
    try {
      if (window.isAutoSaving) return;
      window.isAutoSaving = true;
      // Gather all card metadata for complete save
      const savePayload = {
        ...ccCurrentData,
        market: ccCurrentData.market || null,
        coin: ccCurrentData.market || null,
        card_rating: ccCurrentRating || {},
          nb_zone: {
          zone: ccCurrentData.zone || state.currentZone || 'NONE',
          zone_flag: ccCurrentData.zone_flag || 0,
          zone_conf: ccCurrentData.zone_conf || 0.0,
          dist_high: ccCurrentData.dist_high || 0.0,
          dist_low: ccCurrentData.dist_low || 0.0
        },
        ml_trust: {
          grade: document.getElementById('ccMlGrade')?.textContent || '-',
          enhancement: document.getElementById('ccMlEnhancement')?.textContent?.replace(/\D/g, '') || '0',
          trust_score: ccCurrentData.ml_trust_score
        },
        realized_pnl: {
          avg: parseFloat(document.getElementById('ccRealizedAvg')?.textContent?.replace(/[^0-9.-]/g, '') || '0'),
          max: parseFloat(document.getElementById('ccRealizedMax')?.textContent?.replace(/[^0-9.-]/g, '') || '0')
        },
        nb_wave: {
          r: ccCurrentData.r,
          w: ccCurrentData.w,
          ema_diff: ccCurrentData.ema_diff,
          pct_blue: ccCurrentData.pct_blue,
          pct_orange: ccCurrentData.pct_orange,
          extreme_gap: ccCurrentData.extreme_gap,
          zones_array: window.nbWaveZonesConsole || [],
          current_zone: state.currentZone,
          nb_stats: state.nbStats || {}
        }
      };
      
      const result = await postJson('/api/nbverse/save', savePayload);
      if (result && result.ok) {
        ccLastNbversePath = result.paths?.[0] || result.path || ccLastNbversePath;
        window.ccLastNbversePath = ccLastNbversePath;
        console.log('✅ 자동 저장 완료:', savePayload.interval, `(${result.count || 1}개 경로)`);
        const hint = document.getElementById('ccSaveHint');
        if (hint) hint.textContent = `✅ 저장 완료 (${result.count || 1}개)`;
        window.lastAutoSaveTs = Date.now();
        window.isAutoSaving = false;
        
        // 온라인 학습 트리거: 카드 등급 + 강화도 저장
        if (ccCurrentRating && ccCurrentRating.enhancement) {
          triggerAutoTraining(ccCurrentData, ccCurrentRating.enhancement);
        }
      } else {
        console.warn('⚠️ 자동 저장 실패:', result?.error || 'Unknown');
        window.isAutoSaving = false;
      }
    } catch (err) {
      console.warn('⚠️ 자동 저장 에러:', err?.message);
      window.isAutoSaving = false;
    }
  }

  async function triggerAutoTraining(cardData, enhancement) {
    /**
     * ML 자동 온라인 학습 트리거
     * 1. 가장 최근 nbverse 카드와 현재 가격 비교로 실제 수익률 계산
     * 2. 이전 카드 훈련 + 현재 카드 AI 예측
     */
    try {
      const trainPayload = {
        card: cardData,
        current_price: cardData.current_price,
        interval: cardData.interval
      };
      
      const response = await fetch('/api/ml/rating/auto-train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trainPayload)
      });
      
      if (!response.ok) {
        console.warn('[Auto-Train] API error:', response.status);
        return;
      }
      
      const result = await response.json();
      if (result.ok) {
        // 실제 수익률로 훈련
        if (result.actual_profit_rate !== undefined) {
          console.log('[Auto-Train] ✓ Prev card trained, profit_rate:', (result.actual_profit_rate * 100).toFixed(2) + '%');
        }
        
        // 현재 카드 AI 예측 받기
        if (result.current_prediction) {
          const pred = result.current_prediction;
          console.log('[Auto-Train] 🤖 AI prediction:', pred.grade, `+${pred.enhancement}강 (${pred.method})`);
          window.aiPredictionResult = pred;
        }
        
        // 전체 재훈련 완료
        if (result.full_retrain) {
          console.log('[Auto-Train] ✓ Full retrain:', result.full_retrain.train_count, 'samples, MAE:', result.full_retrain.mae.toFixed(2));
        }
      } else {
        console.debug('[Auto-Train] No action:', result.error || 'unknown');
      }
    } catch (err) {
      console.debug('[Auto-Train] Error:', err?.message);
    }
  }

  // ============================================================================
  // Progress Step Cycle (1-10)
  // ============================================================================
  const ProgressCycle = {
    currentStep: 0,
    
    // 단계별 메시지
    stepMessages: {
      1: '분봉 선택',
      2: 'ML Trust 로딩',
      3: 'N/B Zone 로딩',
      4: '그래프',
      5: '카드 생성',
      6: 'Win%',
      7: '추가 기능 7',
      8: '추가 기능 8',
      9: '추가 기능 9',
      10: '추가 기능 10'
    },
    
    // 특정 단계 시작
    startStep(stepNum) {
      // Track step timing
      if (window.trackStepStart) {
        window.trackStepStart(stepNum);
      }
      
      // 이전 단계 완료 처리
      if (this.currentStep > 0 && this.currentStep !== stepNum) {
        $(`.step-num[data-step="${this.currentStep}"]`)
          .removeClass('in-progress')
          .addClass('completed');
      }
      
      this.currentStep = stepNum;
      
      // 현재 단계 진행중 표시
      $(`.step-num[data-step="${this.currentStep}"]`)
        .removeClass('waiting completed')
        .addClass('in-progress');
        
      // 시스템 상태 메시지 업데이트
      const message = this.stepMessages[stepNum] || `${stepNum}번 단계`;
      $('#systemStatus').text(`${stepNum}번: ${message} 중...`);
    },
    
    // 현재 단계 완료
    completeStep(stepNum, detail = '') {
      // Track step timing
      if (window.trackStepEnd) {
        window.trackStepEnd(stepNum);
      }
      
      if (stepNum === this.currentStep) {
        $(`.step-num[data-step="${stepNum}"]`)
          .removeClass('in-progress')
          .addClass('completed');
          
        // 시스템 상태 메시지 업데이트
        const message = this.stepMessages[stepNum] || `${stepNum}번 단계`;
        const detailText = detail ? ` (${detail})` : '';
        $('#systemStatus').text(`${stepNum}번: ${message} 완료${detailText}`);
        
        return true; // 완료 반환
      }
      return false;
    },
    
    // 단계 실패 (빨간불, 정지)
    failStep(stepNum, detail = '') {
      if (stepNum === this.currentStep) {
        $(`.step-num[data-step="${stepNum}"]`)
          .removeClass('in-progress completed')
          .addClass('failed');
          
        // 시스템 상태 메시지 업데이트
        const message = this.stepMessages[stepNum] || `${stepNum}번 단계`;
        const detailText = detail ? ` - ${detail}` : '';
        $('#systemStatus').text(`⚠️ ${stepNum}번: ${message} 실패${detailText} [정지]`);
        
        return false; // 실패 반환
      }
      return false;
    },
    
    // 다음 단계로 진행
    nextStep() {
      if (this.currentStep > 0) {
        this.completeStep(this.currentStep);
      }
      
      const nextStep = this.currentStep + 1;
      
      // 10번 완료 후 초기화
      if (nextStep > 10) {
        setTimeout(() => {
          this.reset();
          this.startStep(1); // 1번부터 다시 시작
        }, 1500);
      } else {
        this.startStep(nextStep);
      }
    },
    
    reset() {
      // Clean up all timers and pollings to prevent memory leaks
      stopLivePricePolling();
      if (window.buyCardRefreshInterval) { clearInterval(window.buyCardRefreshInterval); window.buyCardRefreshInterval = null; }
      // Auto Buy 상태는 사용자 의사대로 유지 (강제 중지하지 않음)
      
      this.currentStep = 0;
      $('.step-num')
        .removeClass('in-progress completed')
        .addClass('waiting');
    }
  };

  // ============================================================================
  // UI Update Module
  // ============================================================================
  const UI = {
    updateProgress() {
      const progress = (state.currentStep / 4) * 100;
      $('#flowProgress').css('width', progress + '%');
    },

    // Lightweight inline notifier (no alert). Updates header status colorfully.
    notify(message, type = 'info') {
      try {
        const el = $('#systemStatus');
        if (!el.length) return;
        let prefix = 'ℹ️';
        let color = '#e6eefc';
        if (type === 'error') { prefix = '⚠️'; color = '#f6465d'; }
        else if (type === 'success') { prefix = '✅'; color = '#0ecb81'; }
        else if (type === 'warning') { prefix = '⚠️'; color = '#ffb703'; }
        el.text(`${prefix} ${message}`);
        el.css('color', color);
        setTimeout(() => { try { el.css('color', ''); } catch(_) {} }, 3500);
      } catch(_) {}
    },

    updateZoneBadge(selector, zone) {
      const badge = $('<span></span>')
        .addClass('zone-badge')
        .text(zone);
      
      if (zone === 'BLUE') {
        badge.addClass('blue');
      } else if (zone === 'ORANGE') {
        badge.addClass('orange');
      } else {
        badge.addClass('none');
      }
      
      $(selector).html(badge);
    },

    updateFlowSummary() {
      $('.flow-step-item').removeClass('active completed');
      $('.flow-step-item-status').text('대기중');
      
      for (let i = 1; i <= 4; i++) {
        const summaryItem = $('#summaryStep' + i);
        const summaryStatus = $('#summaryStatus' + i);
        
        if (i < state.currentStep) {
          summaryItem.addClass('completed');
          summaryStatus.text('완료');
        } else if (i === state.currentStep) {
          summaryItem.addClass('active');
          summaryStatus.text('진행중');
        } else {
          summaryStatus.text('대기중');
        }
      }
    },

    async renderNBWaveFromAPI(chart, interval) {
      try {
        console.log('🌊 Fetching N/B Wave from API:', interval);
        const resp = await fetch(withApiBase(`/api/nb-wave-ohlcv?timeframe=${interval}&count=300&window=50`));
        const data = await resp.json();
        
        if (!data.ok || !data.wave_data || data.wave_data.length === 0) {
          throw new Error('Invalid wave data from API');
        }
        
        console.log('🌊 N/B Wave API response:', data.wave_data.length, 'points');
        this.applyNBWaveToChart(chart, data);
        console.log('✅ N/B Wave rendered from API');
      } catch (error) {
        console.error('❌ N/B Wave API error:', error);
        throw error;
      }
    },

    async loadBuyMarkersForChart(candleData) {
      try {
        const resp = await fetch('/api/cards/buy');
        const data = await resp.json();
        const buyCards = (data.cards || data.data || []);
        
        if (!buyCards || buyCards.length === 0) {
          console.log('⚠️ 매수 카드가 없습니다');
          return [];
        }
        
        const candleTimeMap = {};
        candleData.forEach(c => {
          candleTimeMap[c.time] = true;
        });
        
        const markers = [];
        const ratingColors = {
          '브론즈': '#CD7F32',
          '실버': '#C0C0C0',
          '골드': '#FFD700',
          '플래티넘': '#E5E4E2',
          '다이아': '#00D1FF',
          '첼린저': '#FF1493'
        };
        
        buyCards.forEach((card, idx) => {
          try {
            // ts 또는 timestamp 사용 (ms 단위)
            let cardTime = card.ts || card.timestamp || 0;
            // ms를 초 단위로 변환
            if (cardTime > 1e10) cardTime = Math.floor(cardTime / 1000);
            
            const cardPrice = Number(card.price || 0);
            const ratingCode = card.league || '미평가';
            const ratingColor = ratingColors[ratingCode] || '#888888';
            const cardSize = Number(card.size || 0);
            
            // 시간이 유효한지 확인
            if (cardTime > 0 && cardPrice > 0) {
              // 정확한 시간이 없으면 가장 가까운 캔들 찾기
              let targetTime = cardTime;
              if (!candleTimeMap[targetTime]) {
                // 1분 이내의 캔들 찾기
                for (let t of Object.keys(candleTimeMap)) {
                  if (Math.abs(parseInt(t) - cardTime) <= 60) {
                    targetTime = parseInt(t);
                    break;
                  }
                }
              }
              
              if (candleTimeMap[targetTime]) {
                const marker = {
                  time: targetTime,
                  position: 'belowBar',
                  color: ratingColor,
                  shape: 'circle',
                  text: ratingCode,
                  size: 3
                };
                markers.push(marker);
                console.log(`📍 마커 ${idx+1}:`, { time: targetTime, rating: ratingCode, price: cardPrice, size: cardSize });
              } else {
                console.warn(`⚠️ 마커 ${idx+1} 시간 일치 실패: ${cardTime}`, { cardPrice, ratingCode });
              }
            }
          } catch (e) {
            console.warn('마커 생성 오류:', e?.message);
          }
        });
        
        console.log('✅ 매수 마커 준비 완료:', markers.length, '개 / 총 카드:', buyCards.length, '개');
        return markers;
      } catch (error) {
        console.error('❌ 매수 마커 로드 오류:', error);
        return [];
      }
    },
    
    applyNBWaveToChart(chart, nbWaveData) {
      try {
        console.log('🌊 Applying N/B Wave to chart');
        
        // Create or reuse baseline series
        let nbWaveSeries = chart._nbWaveSeries;
        if (!nbWaveSeries) {
          nbWaveSeries = chart.addBaselineSeries({
            baseValue: { type: 'price', price: nbWaveData.base },
            topFillColor1: 'rgba(255,183,3,0.70)',
            topFillColor2: 'rgba(255,183,3,0.40)',
            topLineColor: '#ffb703',
            bottomFillColor1: 'rgba(0,209,255,0.70)',
            bottomFillColor2: 'rgba(0,209,255,0.40)',
            bottomLineColor: '#00d1ff',
            lineWidth: 6,
            priceLineVisible: false,
            lastValueVisible: false
          });
          chart._nbWaveSeries = nbWaveSeries;
        } else {
          nbWaveSeries.applyOptions({ baseValue: { type: 'price', price: nbWaveData.base } });
        }
        // Set wave data
        nbWaveSeries.setData(nbWaveData.wave_data);
        
        // Persist for reuse (Step 1 zone status, current card)
        state.nbWave = { 
          data: nbWaveData.wave_data, 
          base: nbWaveData.base,
          summary: nbWaveData.summary || null,
          fromAPI: true
        };
        
        // Keep a simple zone series & zone array for current card mini strip
        try {
          const base = Number(nbWaveData.base || 0);
          // Generate zone array using BaselineSeries rule: value > base = ORANGE, else BLUE
          const zoneArrayBaseline = nbWaveData.wave_data.map(pt => (Number(pt.value) > base ? 'ORANGE' : 'BLUE'));
          const zoneSeries = nbWaveData.wave_data.map(pt => ({ value: Number(pt.value), base, zone: pt.zone || (Number(pt.value) > base ? 'ORANGE' : 'BLUE') }));
          
          state.zoneSeries = zoneSeries;
          state.nbWaveZones = zoneArrayBaseline; // pure ORANGE/BLUE array by baseline rule for reuse
          state.nbWaveZonesConsole = zoneArrayBaseline; // expose to console
          window.nbWaveZonesConsole = zoneArrayBaseline; // also attach to window for direct console access
          // Update current zone to the last zone from array
          state.currentZone = zoneArrayBaseline[zoneArrayBaseline.length - 1] || 'BLUE';
          console.log('📊 N/B Wave zones (baseline rule):', zoneArrayBaseline.length, 'zones');
          console.log('📊 Current zone (last):', state.currentZone);
        } catch(_){ }
        
        console.log('✅ N/B Wave applied to chart');
      } catch (error) {
        console.error('❌ Apply N/B Wave error:', error);
        throw error;
      }
    },

    renderNBWaveClientSide(chart, validRows, sortedCandles) {
      try {
        console.log('🌊 Rendering N/B Wave (client-side fallback)');
        
        const clamp = (v, lo=0, hi=100) => Math.min(hi, Math.max(lo, v));
        let nbWaveSeries = chart._nbWaveSeries;
        if (!nbWaveSeries) {
          nbWaveSeries = chart.addBaselineSeries({
            baseValue: { type: 'price', price: 0 },
            topFillColor1: 'rgba(255,183,3,0.70)',
            topFillColor2: 'rgba(255,183,3,0.40)',
            topLineColor: '#ffb703',
            bottomFillColor1: 'rgba(0,209,255,0.70)',
            bottomFillColor2: 'rgba(0,209,255,0.40)',
            bottomLineColor: '#00d1ff',
            lineWidth: 6,
            priceLineVisible: false,
            lastValueVisible: false
          });
          chart._nbWaveSeries = nbWaveSeries;
        }

        const n = 50;
        const outWave = [];
        for (let i = n-1; i < validRows.length; i++) {
          const win = validRows.slice(i-n+1, i+1);
          const highs = win.map(d => Number(d.high));
          const lows = win.map(d => Number(d.low));
          const closes = win.map(d => Number(d.close));
          const hi = Math.max(...highs);
          const lo = Math.min(...lows);
          const span = Math.max(hi - lo, 1e-9);
          const changes = [];
          for (let k = 1; k < closes.length; k++) {
            const prev = closes[k-1];
            const cur = closes[k];
            changes.push(((cur - prev) / (prev || 1)) * 100);
          }
          if (changes.length < 2) continue;
          let scoreMax = 50, scoreMin = 50;
          try {
            if (typeof BIT_MAX_NB === 'function') scoreMax = clamp(BIT_MAX_NB(changes));
            if (typeof BIT_MIN_NB === 'function') scoreMin = clamp(BIT_MIN_NB(changes));
          } catch(_) {}
          const ratio = (scoreMax + scoreMin) > 0 ? (scoreMax / (scoreMax + scoreMin)) : 0.5;
          const waveVal = lo + span * ratio;
          const t = Math.floor(Number(win[win.length-1].time) / 1000);
          outWave.push({ time: t, value: waveVal, ratio });
        }
        
        if (outWave.length) {
          const lastWin = validRows.slice(Math.max(0, validRows.length - n));
          const mid = (Math.max(...lastWin.map(d=>Number(d.high))) + Math.min(...lastWin.map(d=>Number(d.low)))) / 2;
          nbWaveSeries.applyOptions({ baseValue: { type: 'price', price: mid } });
          nbWaveSeries.setData(outWave);
          state.nbWave = { data: outWave, base: mid, fromAPI: false };
        }
        
        console.log('✅ N/B Wave rendered (client-side)');
      } catch (error) {
        console.error('❌ Client-side N/B Wave error:', error);
      }
    },

    renderZoneChart(zones) {
      const chartContainer = $('#zoneChart');
      chartContainer.empty();
      
      // If zones array is provided, render from API; otherwise, render from computed NB wave
      if (Array.isArray(zones) && zones.length > 0) {
        const validZones = zones.filter(z => z && z.zone);
        if (validZones.length === 0) {
          chartContainer.text('유효한 Zone 데이터 없음');
          return;
        }
        validZones.forEach((zoneData) => {
          const seg = $('<div></div>').addClass('zone-segment');
          if (zoneData.zone === 'BLUE') seg.addClass('blue');
          else if (zoneData.zone === 'ORANGE') seg.addClass('orange');
          else seg.addClass('neutral');
          chartContainer.append(seg);
        });
        return;
      }
      
      // Fallback: render from computed NB wave to match chart
      const nbWave = state.nbWave;
      if (!nbWave || !nbWave.data || nbWave.data.length === 0) {
        chartContainer.text('데이터 없음');
        return;
      }
      const base = Number(nbWave.base);
      // Use stored segment count or all available data
      const targetCount = state.waveSegmentCount || state.zoneSeries?.length || nbWave.data.length;
      const lastN = Math.min(targetCount, nbWave.data.length);
      const waveSlice = nbWave.data.slice(nbWave.data.length - lastN);
      waveSlice.forEach((pt) => {
        const val = Number(pt.value);
        const isOrange = Number.isFinite(val) && val > base;
        const seg = $('<div></div>').addClass('zone-segment').addClass(isOrange ? 'orange' : 'blue');
        chartContainer.append(seg);
      });
    },

    async renderPriceChart(chartData) {
      const container = document.getElementById('step2Graph');
      if (!container) {
        console.error('Chart container not found');
        return;
      }
      
      const rows = chartData?.data || [];
      if (!chartData || !rows || rows.length === 0) {
        container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">차트 데이터 없음</div>';
        console.warn('⚠️ Chart data missing:', { hasData: !!chartData, rowsLength: rows?.length });
        return;
      }
      
      // Check if LightweightCharts is available
      if (typeof LightweightCharts === 'undefined') {
        console.error('LightweightCharts not loaded');
        container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">차트 라이브러리 로딩 중...</div>';
        return;
      }
      
      try {
        // Step 1: N/B WAVE 데이터를 먼저 확인/로드 (Step 3에서 캐시된 데이터 우선)
        console.log('🌊 Step 1: N/B Wave 데이터 확인/로드');
        let nbWaveData = null;
        if (state.nbWaveCached && Array.isArray(state.nbWaveCached.wave_data) && state.nbWaveCached.wave_data.length > 0) {
          nbWaveData = state.nbWaveCached;
          console.log('✅ Step 4: Using cached NB Wave from Step 3:', nbWaveData.wave_data.length, 'points');
        } else {
          try {
            const data = await API.getNbWaveOhlcv(state.selectedInterval, 300, 50);
            if (data.ok && data.wave_data && data.wave_data.length > 0) {
              nbWaveData = data;
              console.log('✅ Step 4: Fetched NB Wave (no cache available):', data.wave_data.length, 'points');
            }
          } catch (err) {
            console.warn('⚠️ Step 4: N/B Wave API 오류:', err);
          }
        }
        
        // Step 2: 차트를 생성하거나 재사용합니다
        console.log('📊 Step 2: 차트 생성/재사용 시작');
        if (!container.style.position || container.style.position === 'static') {
          container.style.position = 'relative';
        }
        let chart = container._chartInstance;
        if (!chart) {
          chart = LightweightCharts.createChart(container, {
            autoSize: true,
            layout: { background: { type: 'solid', color: '#0b1220' }, textColor: '#e6eefc' },
            grid: {
              vertLines: { color: 'rgba(255,255,255,0.05)' },
              horzLines: { color: 'rgba(255,255,255,0.05)' }
            },
            rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
            leftPriceScale: { visible: false },
            timeScale: {
              borderColor: 'rgba(255,255,255,0.08)',
              timeVisible: true,
              secondsVisible: false,
              fixLeftEdge: false,
              fixRightEdge: true   // 우측 끝에 고정
            },
            crosshair: { mode: LightweightCharts.CrosshairMode.Magnet },
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
            handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: false }  // 마우스 휠/드래그로 확대/축소 가능
          });
          container._chartInstance = chart;
          container._series = {};
          
          // Add double-click listener to reset chart view
          container.addEventListener('dblclick', () => {
            try {
              chart.timeScale().fitContent();
              localStorage.removeItem('chartViewRange'); // 뷰 초기화도 함께 저장
              console.log('📊 차트 뷰 리셋 (더블클릭)');
            } catch(e) { console.warn('Chart reset error:', e?.message); }
          });
        } else {
          container._series = container._series || {};
        }
        
        // Add or reuse candlestick series - index.html과 동일한 색상
        let candleSeries = container._series.candle;
        if (!candleSeries) {
          candleSeries = chart.addCandlestickSeries({ 
            upColor: '#0ecb81', 
            downColor: '#f6465d', 
            wickUpColor: '#0ecb81', 
            wickDownColor: '#f6465d', 
            borderVisible: false 
          });
          container._series.candle = candleSeries;
        }
        
        // Prepare candlestick data from OHLCV rows
        const validRows = rows.filter(r => {
          if (!r) return false;
          const vals = [r.time, r.open, r.high, r.low, r.close];
          return vals.every(v => v !== null && v !== undefined && Number.isFinite(Number(v)));
        });

        const candleData = validRows.map(r => ({
          time: Math.floor(Number(r.time) / 1000), // ms -> seconds
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close)
        }));
        
        // 시간 오름차순 정렬
        const sortedCandles = candleData.sort((a, b) => a.time - b.time);

        // 거래량 라인 시리즈 추가/재사용 (파도 모양 - 별도 패널)
        let volumeSeries = container._series.volume;
        if (!volumeSeries) {
          volumeSeries = chart.addLineSeries({
            color: 'rgba(14,203,129,0.7)',      // 반투명 초록색
            lineWidth: 2,                        // 라인 두께
            priceFormat: { type: 'volume' },
            priceScaleId: '',                    // 별도 스케일 (빈 문자열)
            overlay: false,                      // 별도 패널로 분리
            scaleMargins: { top: 0, bottom: 0 },
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false
          });
          container._series.volume = volumeSeries;
        }

        const volumeData = validRows.map((r, idx) => {
          const isUp = sortedCandles[idx]?.close >= sortedCandles[idx]?.open;
          return {
            time: sortedCandles[idx]?.time,
            value: Number(r.volume || 0),
            color: isUp ? 'rgba(14,203,129,0.6)' : 'rgba(246,70,93,0.6)'
          };
        }).filter(d => d.time != null);

        console.log('📊 Candlestick data prepared:', sortedCandles.length, 'candles');
        console.log('📊 First candle:', sortedCandles[0]);
        console.log('📊 Last candle:', sortedCandles[sortedCandles.length - 1]);

        candleSeries.setData(sortedCandles);
        //volumeSeries.setData(volumeData);

        // 오른쪽 끝에 위치 고정
        try {
          chart.timeScale().scrollToRealTime();
          chart.timeScale().setRightOffset(0);
        } catch(_) {}

        // 매수 마커 표시 (Buy Cards)
        try {
          const buyMarkers = await this.loadBuyMarkersForChart(sortedCandles);
          if (buyMarkers.length > 0) {
            candleSeries.setMarkers(buyMarkers);
            console.log('📍 매수 마커 추가됨:', buyMarkers.length, '개');
          }
        } catch(e) {
          console.warn('⚠️ 매수 마커 로드 실패:', e?.message);
        }

        // Initialize global candle cache for live UI updates
        try {
          window.candleDataCache = Array.isArray(sortedCandles) ? sortedCandles.slice() : [];
        } catch(_) {}

        // Start live polling for latest candle to keep current price moving
        try { startLivePricePolling(state.selectedInterval); } catch(_) {}
        
        // 모든 데이터 업데이트 후 저장된 뷰 복원 (setData 호출이 뷰를 리셋할 수 있으므로)
        const restoreViewAfterDataUpdate = () => {
          try {
            const savedView = localStorage.getItem('chartViewRange');
            if (savedView) {
              const { from, to } = JSON.parse(savedView);
              if (typeof from === 'number' && typeof to === 'number' && from < to) {
                chart.timeScale().setVisibleRange({ from, to });
                console.log('🔄 데이터 업데이트 후 뷰 복원:', { from, to });
              }
            }
          } catch(e) {
            console.debug('View restore after update error:', e?.message);
          }
        };
        // requestAnimationFrame을 사용해 모든 렌더링이 완료된 후 뷰 복원
        requestAnimationFrame(() => restoreViewAfterDataUpdate());

        // Step 3: N/B wave를 차트에 렌더링 (이미 로드된 데이터 사용)
        console.log('🌊 Step 3: N/B Wave 차트에 렌더링');
        if (nbWaveData) {
          this.applyNBWaveToChart(chart, nbWaveData);
        } else {
          console.warn('⚠️ N/B Wave 데이터 없음, 클라이언트 계산 사용');
          this.renderNBWaveClientSide(chart, validRows, sortedCandles);
        }
        console.log('✅ N/B Wave 렌더링 완료 - Step 5 진행 가능');

        // --- EMA overlays (fast/slow) ---
        const ema = (values, period) => {
          const k = 2 / (period + 1);
          const out = [];
          let prev;
          values.forEach((v, i) => {
            const val = Number(v);
            if (!Number.isFinite(val)) {
              out.push(undefined);
              return;
            }
            if (i === 0 || prev === undefined) {
              prev = val;
            } else {
              prev = val * k + prev * (1 - k);
            }
            out.push(prev);
          });
          return out;
        };

        const closes = sortedCandles.map(c => c.close);
        const times = sortedCandles.map(c => c.time);
        const emaFastArr = ema(closes, 10).map((v, i) => ({ time: times[i], value: v })).filter(p => p.value !== undefined);
        const emaSlowArr = ema(closes, 30).map((v, i) => ({ time: times[i], value: v })).filter(p => p.value !== undefined);

        let emaFastSeries = container._series.emaFast;
        if (!emaFastSeries) {
          emaFastSeries = chart.addLineSeries({ color: 'rgba(14,203,129,0.9)', lineWidth: 2, priceLineVisible: false });
          container._series.emaFast = emaFastSeries;
        }
        let emaSlowSeries = container._series.emaSlow;
        if (!emaSlowSeries) {
          emaSlowSeries = chart.addLineSeries({ color: 'rgba(246,70,93,0.9)', lineWidth: 2, priceLineVisible: false });
          container._series.emaSlow = emaSlowSeries;
        }
        emaFastSeries.setData(emaFastArr);
        emaSlowSeries.setData(emaSlowArr);

        // --- SMA 50/100/200 overlays ---
        const sma = (arr, n) => {
          const out = [];
          let sum = 0;
          for (let i = 0; i < arr.length; i++) {
            sum += arr[i];
            if (i >= n) sum -= arr[i - n];
            out.push(i >= n - 1 ? sum / n : arr[i]);
          }
          return out;
        };
        const sma50 = sma(closes, 50).map((v, i) => ({ time: times[i], value: v }));
        const sma100 = sma(closes, 100).map((v, i) => ({ time: times[i], value: v }));
        const sma200 = sma(closes, 200).map((v, i) => ({ time: times[i], value: v }));
        let sma50Series = container._series.sma50;
        if (!sma50Series) {
          sma50Series = chart.addLineSeries({ color: '#9aa0a6', lineWidth: 1, priceLineVisible: false });
          container._series.sma50 = sma50Series;
        }
        let sma100Series = container._series.sma100;
        if (!sma100Series) {
          sma100Series = chart.addLineSeries({ color: '#c7cbd1', lineWidth: 1, priceLineVisible: false });
          container._series.sma100 = sma100Series;
        }
        let sma200Series = container._series.sma200;
        if (!sma200Series) {
          sma200Series = chart.addLineSeries({ color: '#e0e3e7', lineWidth: 1, priceLineVisible: false });
          container._series.sma200 = sma200Series;
        }
        sma50Series.setData(sma50);
        sma100Series.setData(sma100);
        sma200Series.setData(sma200);

        // --- EMA 9/12/26 overlays ---
        const ema9 = ema(closes, 9).map((v, i) => ({ time: times[i], value: v })).filter(p => p.value !== undefined);
        const ema12 = ema(closes, 12).map((v, i) => ({ time: times[i], value: v })).filter(p => p.value !== undefined);
        const ema26 = ema(closes, 26).map((v, i) => ({ time: times[i], value: v })).filter(p => p.value !== undefined);
        let ema9Series = container._series.ema9;
        if (!ema9Series) {
          ema9Series = chart.addLineSeries({ color: '#ffd166', lineWidth: 1, priceLineVisible: false });
          container._series.ema9 = ema9Series;
        }
        let ema12Series = container._series.ema12;
        if (!ema12Series) {
          ema12Series = chart.addLineSeries({ color: '#fca311', lineWidth: 1, priceLineVisible: false });
          container._series.ema12 = ema12Series;
        }
        let ema26Series = container._series.ema26;
        if (!ema26Series) {
          ema26Series = chart.addLineSeries({ color: '#fb8500', lineWidth: 1, priceLineVisible: false });
          container._series.ema26 = ema26Series;
        }
        ema9Series.setData(ema9);
        ema12Series.setData(ema12);
        ema26Series.setData(ema26);

        // N/B Wave Prediction Series (미래 zone 예측선)
        let nbPredictionSeries = chart._nbPredictionSeries;
        if (!nbPredictionSeries) {
          nbPredictionSeries = chart.addBaselineSeries({
            baseValue: { type: 'price', price: 0.5 },
            topLineColor: 'rgba(14, 203, 129, 0.3)',
            topFillColor1: 'rgba(14, 203, 129, 0.15)',
            topFillColor2: 'rgba(14, 203, 129, 0.05)',
            bottomLineColor: 'rgba(246, 70, 93, 0.3)',
            bottomFillColor1: 'rgba(246, 70, 93, 0.15)',
            bottomFillColor2: 'rgba(246, 70, 93, 0.05)',
            lineWidth: 2,
            lineStyle: 2,  // Dashed line
            priceLineVisible: false,
            lastValueVisible: false
          });
          chart._nbPredictionSeries = nbPredictionSeries;
        }
        // 초기에는 비워둠 (updateNBPrediction 호출 시 업데이트)
        nbPredictionSeries.setData([]);

        // Wave-only Price Prediction (no AI): project future price using recent volatility and N/B zone bias
        try {
          let wavePricePredSeries = chart._wavePricePredSeries;
          if (!wavePricePredSeries) {
            wavePricePredSeries = chart.addLineSeries({
              color: 'transparent',
              lineWidth: 0,
              priceLineVisible: false,
              lastValueVisible: false
            });
            chart._wavePricePredSeries = wavePricePredSeries;
          }

          const lastCandle = sortedCandles[sortedCandles.length - 1];
          const lastClose = Number(lastCandle?.close || 0);
          const timeStep = (sortedCandles.length > 1)
            ? (sortedCandles[1].time - sortedCandles[0].time)
            : 60; // fallback 60s
          const horizon = 10;

          // Recent absolute returns as volatility proxy
          const lookback = Math.min(30, closes.length - 1);
          let sumAbs = 0;
          for (let i = 1; i <= lookback; i++) {
            const p = closes[closes.length - i];
            const q = closes[closes.length - i - 1];
            if (q && p) sumAbs += Math.abs((p - q) / q);
          }
          const avgAbsRet = lookback > 0 ? (sumAbs / lookback) : 0.001;
          // Clamp to sensible bounds
          const vol = Math.max(0.0001, Math.min(0.02, avgAbsRet));

          // Zone bias: prefer ScriptAI → ML → NB current zone
          const mlZone = (state.mlStats?.mlZone || '').toUpperCase();
          const scriptAi = (window.ScriptAI && typeof window.ScriptAI.getPrediction === 'function') ? window.ScriptAI.getPrediction() : null;
          const aiZone = (scriptAi?.zone || mlZone || state.currentZone || 'NONE').toUpperCase();
          const sign = aiZone === 'BLUE' ? 1 : aiZone === 'ORANGE' ? -1 : 0;
          // Strength from r/w (distance from neutrality 0.5)
          const rVal = Number(state.nbStats?.rValue ?? 0.5);
          const wVal = Number(state.nbStats?.w ?? 0.5);
          const strength = 0.2 + Math.min(0.8, Math.abs(Math.max(rVal, wVal) - 0.5) * 2);
          const alpha = sign * vol * strength;

          const pred = [];
          let price = lastClose;
          for (let i = 1; i <= horizon; i++) {
            const decay = 1 - (i / horizon) * 0.5; // gentle tapering
            price = price * (1 + alpha * decay);
            pred.push({ time: lastCandle.time + timeStep * i, value: price });
          }

          wavePricePredSeries.setData(pred);
          // Transparent circle markers colored by AI zone
          const circleColor = aiZone === 'BLUE' ? 'rgba(0,209,255,0.35)' : aiZone === 'ORANGE' ? 'rgba(255,183,3,0.35)' : 'rgba(128,128,128,0.3)';
          const markers = pred.map(p => ({ time: p.time, position: 'aboveBar', color: circleColor, shape: 'circle', size: 2 }));
          try { wavePricePredSeries.setMarkers(markers); } catch(_) {}
        } catch (e) {
          console.debug('Wave-only prediction render error:', e?.message);
        }

        // EMA/Trust legend (top-left)
        const legendId = 'chartLegendBox';
        let legend = container.querySelector(`#${legendId}`);
        if (!legend) {
          legend = document.createElement('div');
          legend.id = legendId;
          legend.style.position = 'absolute';
          legend.style.top = '10px';
          legend.style.left = '10px';
          legend.style.padding = '8px 12px';
          legend.style.borderRadius = '10px';
          legend.style.fontSize = '11px';
          legend.style.lineHeight = '1.4';
          legend.style.background = 'rgba(0,0,0,0.55)';
          legend.style.border = '1px solid rgba(255,255,255,0.12)';
          legend.style.color = '#e6eefc';
          legend.style.boxShadow = '0 6px 16px rgba(0,0,0,0.35)';
          legend.style.backdropFilter = 'blur(3px)';
          legend.style.pointerEvents = 'none';
          legend.style.zIndex = '10';
          container.appendChild(legend);
        }

        const nbLegend = state.nbStats || {};
        const mlLegend = state.mlStats || {};
        const nbTrustTxt = nbLegend.nbTrust != null ? `${nbLegend.nbTrust.toFixed(1)}%` : '-';
        const mlTrustTxt = mlLegend.mlTrust != null ? `${mlLegend.mlTrust.toFixed(1)}%` : '-';
        const scriptAi = (window.ScriptAI && typeof window.ScriptAI.getPrediction === 'function') ? window.ScriptAI.getPrediction() : null;
        const scriptAiTxt = scriptAi ? `${scriptAi.zone} ${scriptAi.confidence.toFixed(1)}%` : '-';
        legend.innerHTML = `
          <div style="display:flex; gap:8px; align-items:center;">
            <span style="display:inline-flex; align-items:center; gap:4px;"><span style="width:10px;height:2px;background:rgba(14,203,129,0.9);"></span>EMA10</span>
            <span style="display:inline-flex; align-items:center; gap:4px;"><span style="width:10px;height:2px;background:rgba(246,70,93,0.9);"></span>EMA30</span>
          </div>
          <div style="margin-top:4px;">NB Trust: ${nbTrustTxt}</div>
          <div>ML Trust: ${mlTrustTxt}</div>
          <div>ScriptAI: ${scriptAiTxt}</div>
        `;

        // Restore saved chart view BEFORE fitContent (마우스 조정 뷰 복한 - 우선순위)
        let viewRestored = false;
        try {
          const savedView = localStorage.getItem('chartViewRange');
          if (savedView && container._series.candle) {
            const { from, to } = JSON.parse(savedView);
            if (typeof from === 'number' && typeof to === 'number' && from < to) {
              // requestAnimationFrame으로 렌더링 완료 후 복원 (더 안정적)
              requestAnimationFrame(() => {
                try {
                  chart.timeScale().setVisibleRange({ from, to });
                  viewRestored = true;
                  console.log('🔄 초기 차트 뷰 복원:', { from, to });
                } catch(e) {
                  console.debug('Initial view restore error:', e?.message);
                }
              });
              viewRestored = true;
            }
          }
        } catch(e) {
          console.debug('Initial view restore error:', e?.message);
        }
        
        // fitContent() only if no saved view (처음 로드하거나 저장된 뷰가 없을 때만)
        if (!viewRestored) {
          chart.timeScale().fitContent();
          // 기본값으로 살짝 왼쪽으로 이동 (우측 여백 확보)
          setTimeout(() => {
            try {
              chart.timeScale().scrollToPosition(-100, false); // 왼쪽으로 100바 이동
            } catch(e) {
              console.debug('Chart scroll adjustment error:', e?.message);
            }
          }, 100);
        }

        // Zone badge overlay (BLUE/ORANGE 식별)
        const zoneBadgeId = 'chartZoneBadge';
        let badge = container.querySelector(`#${zoneBadgeId}`);
        if (!badge) {
          badge = document.createElement('div');
          badge.id = zoneBadgeId;
          badge.style.position = 'absolute';
          badge.style.top = '10px';
          badge.style.right = '10px';
          badge.style.padding = '6px 12px';
          badge.style.borderRadius = '10px';
          badge.style.fontWeight = '700';
          badge.style.fontSize = '12px';
          badge.style.color = '#0b1220';
          badge.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
          badge.style.letterSpacing = '0.5px';
          badge.style.zIndex = '10';
          container.appendChild(badge);
        }
        const zone = state.currentZone || 'NONE';
        if (zone === 'BLUE') {
          badge.textContent = 'BLUE';
          badge.style.background = '#0ecb81';
        } else if (zone === 'ORANGE') {
          badge.textContent = 'ORANGE';
          badge.style.background = '#f39c12';
        } else {
          badge.textContent = 'ZONE -';
          badge.style.background = '#666';
        }

        // NB info box (trust, r, max/min) overlay bottom-left
        const infoId = 'chartNbInfoBox';
        let info = container.querySelector(`#${infoId}`);
        if (!info) {
          info = document.createElement('div');
          info.id = infoId;
          info.style.position = 'absolute';
          info.style.left = '10px';
          info.style.bottom = '10px';
          info.style.padding = '8px 12px';
          info.style.borderRadius = '10px';
          info.style.fontSize = '11px';
          info.style.lineHeight = '1.4';
          info.style.background = 'rgba(0,0,0,0.6)';
          info.style.border = '1px solid rgba(255,255,255,0.15)';
          info.style.color = '#e6eefc';
          info.style.boxShadow = '0 6px 16px rgba(0,0,0,0.35)';
          info.style.backdropFilter = 'blur(4px)';
          info.style.pointerEvents = 'none';
          info.style.zIndex = '10';
          container.appendChild(info);
        }

        const nbInfoBox = state.nbStats || {};
        const mlInfoBox = state.mlStats || {};
        const zoneLabel = zone === 'BLUE' ? 'BLUE' : zone === 'ORANGE' ? 'ORANGE' : '-';
        const trustTxt = nbInfoBox.nbTrust != null ? `${nbInfoBox.nbTrust.toFixed(1)}%` : '-';
        const rTxt = nbInfoBox.rValue != null ? nbInfoBox.rValue.toFixed(3) : '-';
        const maxTxt = nbInfoBox.maxBit != null ? nbInfoBox.maxBit.toFixed(2) : '-';
        const minTxt = nbInfoBox.minBit != null ? nbInfoBox.minBit.toFixed(2) : '-';
        const mlZoneLabel = mlInfoBox.mlZone || '-';
        const mlTrustTxtInfo = mlInfoBox.mlTrust != null ? `${mlInfoBox.mlTrust.toFixed(1)}%` : '-';
        const mlPctTxtInfo = (mlInfoBox.pctBlue != null && mlInfoBox.pctOrange != null)
          ? `B:${mlInfoBox.pctBlue.toFixed(1)}% / O:${mlInfoBox.pctOrange.toFixed(1)}%`
          : '';
        info.innerHTML = `N/B: ${zoneLabel} | Trust: ${trustTxt}<br>r: ${rTxt}<br>MAX: ${maxTxt} | MIN: ${minTxt}<br>ML: ${mlZoneLabel} | Trust: ${mlTrustTxtInfo}${mlPctTxtInfo ? `<br>${mlPctTxtInfo}` : ''}`;
        
        // Store chart instance for reuse
        container._chartInstance = chart;
        
        // N/B Wave 예측 업데이트 함수
        window.updateNBPrediction = async function() {
          try {
            // 항상 활성화 상태
            if (!window.nbPredictionEnabled) {
              window.nbPredictionEnabled = true;
            }
            
            const interval = state.selectedInterval;
            if (!interval) return;
            
            // 현재 NB Wave 데이터 가져오기
            const nbWaveData = chart._nbWaveSeries?.data?.() || [];
            if (!nbWaveData || nbWaveData.length < 30) {
              console.log('[NB Prediction] NB Wave 데이터 부족:', nbWaveData.length);
              return;
            }
            
            const lastTime = nbWaveData[nbWaveData.length - 1].time;
            const timeStep = nbWaveData[1].time - nbWaveData[0].time;
            
            // 최근 30개의 NB Wave 값 추출
            const recentNbSequence = nbWaveData.slice(-30).map(d => d.value);
            
            // LSTM V3 API 호출 (딥러닝 예측)
            const response = await fetch('/api/ml/rating/v3/predict', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                interval: interval,
                sequence_count: 30,
                nb_sequence: recentNbSequence
              })
            });
            
            if (!response.ok) {
              console.warn('[NB Prediction] API 오류:', response.status);
              return;
            }
            
            const result = await response.json();
            if (!result.ok || !result.predictions || result.predictions.length === 0) {
              console.warn('[NB Prediction] 예측 실패:', result.error);
              return;
            }
            
            // 예측 데이터 시각화
            const predictionData = result.predictions.map((pred, i) => ({
              time: lastTime + (timeStep * (i + 1)),
              value: pred.nb_value || 0.5  // 서버에서 계산한 NB value
            }));
            
            if (chart._nbPredictionSeries && predictionData.length > 0) {
              chart._nbPredictionSeries.setData(predictionData);
              
              const blueCount = result.predictions.filter(p => p.zone_flag > 0).length;
              const orangeCount = result.predictions.filter(p => p.zone_flag < 0).length;
              
              console.log(`[NB Prediction] ✓ 딥러닝 예측 완료`);
              console.log(`  Zone: BLUE ${blueCount}개, ORANGE ${orangeCount}개`);
            }
            
          } catch (err) {
            console.error('[NB Prediction] 오류:', err);
          }
        };
        
        // 초기 예측 업데이트 (항상 실행)
        setTimeout(() => window.updateNBPrediction(), 1000);
        
        // Save chart view on user interaction (마우스 조정 시 자동 저장)
        const saveChartView = () => {
          try {
            const range = chart.timeScale().getVisibleRange();
            if (range && range.from && range.to) {
              localStorage.setItem('chartViewRange', JSON.stringify({ from: range.from, to: range.to }));
            }
          } catch(e) { /* ignore */ }
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(saveChartView);
        
        console.log('✅ Candlestick chart rendered with', candleData.length, 'candles');
      } catch (error) {
        console.error('Chart rendering error:', error);
        container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #f6465d;">차트 렌더링 오류</div>';
      }
    },

    renderWinList() {
      renderWinPanel();
    },

    // 가벼운 현재 카드 정보 갱신 (차트/스냅샷/자동저장 없이 값만 업데이트)
    refreshCurrentCardInfo(cardData, interval) {
      try {
        const chart = Array.isArray(cardData?.chart) ? cardData.chart : [];
        const lastCandle = chart[chart.length - 1] || {};
        const currentPrice = Number(cardData?.current_price ?? lastCandle.close ?? 0);
        const currentVolume = Number(lastCandle.volume || 0);
        const currentTurnover = currentPrice * currentVolume;

        // Timestamp & timeframe 유지 갱신
        const now = new Date();
        $('#ccTimestamp').text(now.toLocaleTimeString('ko-KR'));
        $('#ccInterval').text(interval);
        $('#ccTimeframeDisplay').text(timeframeLabel[interval] || interval);

        // 가격/거래량/거래대금 갱신
        const priceText = currentPrice ? currentPrice.toLocaleString() : '-';
        $('#ccPrice').text(priceText);
        $('#ccCurrentPrice').text(priceText);
        $('#ccVolume').text(currentVolume > 0 ? currentVolume.toFixed(8) : '-');
        $('#ccTurnover').text(currentTurnover > 0 ? currentTurnover.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '-');

        // NB 통계(가격/거래량/거래대금) MAX/MIN 갱신
        const nb = cardData?.nb || {};
        const price = nb.price || {};
        const volume = nb.volume || {};
        const turnover = nb.turnover || {};
        const fmt = (v) => (v == null ? '-' : Number(v).toFixed(10));
        if (price) {
          $('#ccPriceMax').text(fmt(price.max));
          $('#ccPriceMin').text(fmt(price.min));
        }
        if (volume) {
          $('#ccVolMax').text(fmt(volume.max));
          $('#ccVolMin').text(fmt(volume.min));
        }
        if (turnover) {
          $('#ccTurnMax').text(fmt(turnover.max));
          $('#ccTurnMin').text(fmt(turnover.min));
        }

        // N/B Zone 박스 최신값 갱신 시도
        fetchNBZoneStatus(interval);

        // ML Trust 박스는 state.mlStats 재사용
        const mlStats = state.mlStats || {};
        const mlZone = mlStats.mlZone || 'NONE';
        const mlTrust = Number(mlStats.mlTrust || 0);
        const mlPctBlue = Number(mlStats.pctBlue || 0);
        const mlPctOrange = Number(mlStats.pctOrange || 0);
        $('#ccMLTrust').html(`
          <div style="text-align: center; font-size: 10px; color: #e6eefc;">
            <div style="font-weight: 600; margin-bottom: 2px;">${mlZone} ${mlTrust.toFixed(1)}%</div>
            <div style="font-size: 9px; color: #9aa8c2;">Blue: ${mlPctBlue.toFixed(1)}% | Orange: ${mlPctOrange.toFixed(1)}%</div>
          </div>
        `);

        // N/B Wave Status 표시
        const nbStats = state.nbStats || {};
        const waveR = (typeof nbStats.rValue === 'number') ? nbStats.rValue : 0;
        const waveW = (typeof nbStats.w === 'number') ? nbStats.w : 0;
        const waveStatus = (waveR > 0.7 || waveW > 0.7) ? '강세' : (waveR < 0.3 || waveW < 0.3) ? '약세' : 'Normal';
        const waveStatusColor = (waveStatus === '강세') ? '#2ecc71' : (waveStatus === '약세') ? '#f6465d' : '#2ecc71';
        $('#ccWaveR').html(`<span style="color: #00d1ff;">${waveR.toFixed(3)}</span>`);
        $('#ccWaveW').html(`<span style="color: #ffb703;">${waveW.toFixed(3)}</span>`);
        $('#ccWaveStatus').html(`<span style="color: ${waveStatusColor};">${waveStatus}</span>`);

        // 현재 메모리의 카드 상태 업데이트 (스냅샷/저장 없음)
        if (window.ccCurrentData) {
          ccCurrentData = {
            ...ccCurrentData,
            timestamp: new Date().toISOString(),
            current_price: currentPrice,
            current_volume: currentVolume,
            current_turnover: currentTurnover
          };
          window.ccCurrentData = ccCurrentData;
        }
      } catch (e) {
        console.warn('refreshCurrentCardInfo error:', e?.message);
      }
    },

    renderCurrentCard(cardData, interval) {
      try {
        const chart = Array.isArray(cardData?.chart) ? cardData.chart : [];
        if (!cardData?.ok || chart.length === 0) {
          console.warn('⚠️ Current card: No NBverse chart data');
          return;
        }

        const lastCandle = chart[chart.length - 1] || {};
        const currentPrice = Number(cardData.current_price ?? lastCandle.close ?? 0);
        const currentVolume = Number(lastCandle.volume || 0);
        const currentTurnover = currentPrice * currentVolume;

        // Timestamp & timeframe
        const now = new Date();
        $('#ccTimestamp').text(now.toLocaleTimeString('ko-KR'));
        $('#ccInterval').text(interval);
        $('#ccTimeframeDisplay').text(timeframeLabel[interval] || interval);

        // Price/volume/turnover
        const priceText = currentPrice ? currentPrice.toLocaleString() : '-';
        $('#ccPrice').text(priceText);
        $('#ccCurrentPrice').text(priceText);
        $('#ccVolume').text(currentVolume > 0 ? currentVolume.toFixed(8) : '-');
        $('#ccTurnover').text(currentTurnover > 0 ? currentTurnover.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '-');

        // NB stats
        const nb = cardData.nb || {};
        const price = nb.price || {};
        const volume = nb.volume || {};
        const turnover = nb.turnover || {};
        const fmt = (v) => (v == null ? '-' : Number(v).toFixed(10));

        $('#ccPriceMax').text(fmt(price.max));
        $('#ccPriceMin').text(fmt(price.min));
        $('#ccVolMax').text(fmt(volume.max));
        $('#ccVolMin').text(fmt(volume.min));
        $('#ccTurnMax').text(fmt(turnover.max));
        $('#ccTurnMin').text(fmt(turnover.min));

        // Summary chart
        if (price.values && price.values.length > 0) {
          drawSummaryChart(price.values, volume.values, turnover.values);
        }

        // NB zone (server)
        fetchNBZoneStatus(interval);

        // Rating (code/league/group + ML) with N/B bias
        const nbStatsForRating = state.nbStats || {};
        calculateAndDisplayCardRating({
          priceMax: price.max,
          priceMin: price.min,
          volumeMax: volume.max,
          volumeMin: volume.min,
          amountMax: turnover.max,
          amountMin: turnover.min,
          nbBlue: typeof nbStatsForRating.rValue === 'number' ? nbStatsForRating.rValue : null,
          nbOrange: typeof nbStatsForRating.w === 'number' ? nbStatsForRating.w : null,
          nbBlueCount: nbStatsForRating.blueCount,
          nbOrangeCount: nbStatsForRating.orangeCount,
          nbLastZone: nbStatsForRating.lastZone || nbStatsForRating.zone || state.currentZone
        });

        // ML Trust 표시 (Step 2 데이터 재사용)
        const mlStats = state.mlStats || {};
        const mlZone = mlStats.mlZone || 'NONE';
        const mlTrust = Number(mlStats.mlTrust || 0);
        const mlPctBlue = Number(mlStats.pctBlue || 0);
        const mlPctOrange = Number(mlStats.pctOrange || 0);
        $('#ccMLTrust').html(`
          <div style="text-align: center; font-size: 10px; color: #e6eefc;">
            <div style="font-weight: 600; margin-bottom: 2px;">${mlZone} ${mlTrust.toFixed(1)}%</div>
            <div style="font-size: 9px; color: #9aa8c2;">Blue: ${mlPctBlue.toFixed(1)}% | Orange: ${mlPctOrange.toFixed(1)}%</div>
          </div>
        `);

        // N/B Wave Status 표시
        const nbStats = state.nbStats || {};
        const waveR = (typeof nbStats.rValue === 'number') ? nbStats.rValue : 0;
        const waveW = (typeof nbStats.w === 'number') ? nbStats.w : 0;
        const waveStatus = (waveR > 0.7 || waveW > 0.7) ? '강세' : (waveR < 0.3 || waveW < 0.3) ? '약세' : 'Normal';
        const waveStatusColor = (waveStatus === '강세') ? '#2ecc71' : (waveStatus === '약세') ? '#f6465d' : '#2ecc71';
        $('#ccWaveR').html(`<span style="color: #00d1ff;">${waveR.toFixed(3)}</span>`);
        $('#ccWaveW').html(`<span style="color: #ffb703;">${waveW.toFixed(3)}</span>`);
        $('#ccWaveStatus').html(`<span style="color: ${waveStatusColor};">${waveStatus}</span>`);

        // Persist current card payload for save/buy actions
        ccCurrentData = {
          interval,
          timestamp: new Date().toISOString(),
          current_price: currentPrice,
          current_volume: currentVolume,
          current_turnover: currentTurnover,
          market: cardData.market || ccCurrentData?.market || null,
          nb: {
            price: { max: price.max, min: price.min, values: price.values || [] },
            volume: { max: volume.max, min: volume.min, values: volume.values || [] },
            turnover: { max: turnover.max, min: turnover.min, values: turnover.values || [] }
          },
          chart: chart || [],
          // Add zone and wave data for nbverse save
          zone: state.currentZone || 'NONE',
          zone_flag: (state.currentZone === 'BLUE') ? 1 : (state.currentZone === 'ORANGE') ? -1 : 0,
          zone_conf: 0.0,
          dist_high: 0.0,
          dist_low: 0.0,
          r: waveR,
          w: waveW,
          ema_diff: 0.0,
          pct_blue: nbStats.blueCount || 0,
          pct_orange: nbStats.orangeCount || 0
        };
        window.ccCurrentData = ccCurrentData;

        // Save hint
        const saveMeta = cardData.save && cardData.save.paths ? cardData.save.paths : null;
        $('#ccSaveHint').text(saveMeta ? '✅ 완료' : '⏳ 대기');

        // Auto-save to NBverse (nbdatabase)
        if (typeof window.autoSaveCurrentCard === 'function') {
          window.autoSaveCurrentCard();
        }

        // Win% snapshot (카드 등급/존 기록)
        setTimeout(() => {
          try { 
            if (typeof window.addCurrentWinSnapshot === 'function') {
              window.addCurrentWinSnapshot(interval);
            }
          } catch (e) { console.warn('win snapshot err', e?.message); }
        }, 0);

        console.log('✅ Current card rendered from NBverse:', chart.length, 'candles');
      } catch (error) {
        console.error('Current card rendering error:', error);
      }
    }
  };

  // ============================================================================
  // API Module
  // ============================================================================
  const API = {
    async getMLPredict(interval) {
      const url = withApiBase(`/api/ml/predict?interval=${interval}`);
      console.log('🔵 ML API 호출 시작:', url);
      try {
        const resp = await fetchWith410Retry(url, {}, 30, 10000);
        console.log('🔵 ML API 응답 상태:', resp.status, resp.statusText);
        const data = await resp.json();
        console.log('🔵 ML API 응답 데이터:', data);
        const insight = data.insight || {};
        console.log('🔵 ML API insight:', insight.pct_blue, '/', insight.pct_orange, '| zone:', insight.zone, '| action:', data.action);
        return data;
      } catch (error) {
        console.error('🔴 ML API 호출 오류:', error);
        return { ok: false, error: error.message };
      }
    },

    async getZoneData(interval) {
      const url = withApiBase(`/api/nb-wave?timeframe=${interval}`);
      console.log('🟠 N/B Zone API 호출 시작:', url);
      try {
        const resp = await fetchWith410Retry(url, {}, 30, 10000);
        console.log('🟠 N/B Zone API 응답 상태:', resp.status, resp.statusText);
        const data = await resp.json();
        console.log('🟠 N/B Zone API 응답 데이터:', data);
        console.log('🟠 N/B Zone API zones length:', data.zones?.length, '| summary:', data.summary);
        return data;
      } catch (error) {
        console.error('🔴 N/B Zone API 호출 오류:', error);
        return { ok: false, error: error.message };
      }
    },

    async getBuyCards(limit = 5) {
      const resp = await fetch(withApiBase(`/api/cards/buy?limit=${limit}`));
      return await resp.json();
    },

    async getSellCards(limit = 5) {
      const resp = await fetch(withApiBase(`/api/cards/sell?limit=${limit}`));
      return await resp.json();
    },

    async getPreflight() {
      return await (await fetch(withApiBase('/api/trade/preflight'))).json();
    },

    async executeBuy(paper = false) {
      // 현재 카드의 market 정보 가져오기
      const currentMarket = (typeof window.ccCurrentData === 'object' && window.ccCurrentData?.market) 
        ? window.ccCurrentData.market 
        : DEFAULT_MARKET;
      
      // Attach NBverse/price metadata to help server persist useful fields
      const nb = (typeof window.ccCurrentData === 'object') ? (window.ccCurrentData.nb || {}) : {};
      const priceMeta = nb.price || {};
      const volumeMeta = nb.volume || {};
      const turnoverMeta = nb.turnover || {};
      const meta = {
        nb_price_max: Number(priceMeta.max || 0) || null,
        nb_price_min: Number(priceMeta.min || 0) || null,
        nb_price_values: Array.isArray(priceMeta.values) ? priceMeta.values.slice(-30) : [],
        nb_volume_max: Number(volumeMeta.max || 0) || null,
        nb_volume_min: Number(volumeMeta.min || 0) || null,
        nb_volume_values: Array.isArray(volumeMeta.values) ? volumeMeta.values.slice(-30) : [],
        nb_turnover_max: Number(turnoverMeta.max || 0) || null,
        nb_turnover_min: Number(turnoverMeta.min || 0) || null,
        nb_turnover_values: Array.isArray(turnoverMeta.values) ? turnoverMeta.values.slice(-30) : [],
        nb_zone: (window.flowDashboardState?.nbStats?.zone) || null,
        nb_r_value: (window.flowDashboardState?.nbStats?.rValue) ?? null,
        nb_w_value: (window.flowDashboardState?.nbStats?.w) ?? null,
        nbverse_path: window.ccLastNbversePath || null,
        nbverse_interval: window.flowDashboardState?.selectedInterval || null,
        nbverse_timestamp: new Date().toISOString()
      };

      const resp = await fetch(withApiBase('/api/trade/buy'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: currentMarket, paper, ...meta, meta })
      });
      return await resp.json();
    },

    async executeSell(paper = false, size = null, pnlRatio = 100, market = null) {
      // 도른 카드의 market 정보 가져오기
      const sellMarket = market || (typeof window.ccCurrentData === 'object' && window.ccCurrentData?.market) 
        ? (market || window.ccCurrentData.market)
        : DEFAULT_MARKET;
      
      const resp = await fetch(withApiBase('/api/trade/sell'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          market: sellMarket,
          paper,
          size,
          pnl_ratio: pnlRatio
        })
      });
      return await resp.json();
    },

    // Step 4: 그래프 데이터
    async getChartData(interval) {
      const count = 300;
      console.log(`📊 Calling OHLCV API: /api/ohlcv?interval=${interval}&count=${count}`);
      const resp = await fetch(`/api/ohlcv?interval=${interval}&count=${count}`);
      const data = await resp.json();
      const rows = data?.data || [];
      console.log('📊 OHLCV response rows:', rows.length, 'ok:', data?.ok);
      console.log('📊 First row:', rows[0]);
      console.log('📊 Last row:', rows[rows.length - 1]);
      return data;
    },

    // Step 5: NBverse current card (chart + NB stats)
    async getNbverseCard(interval, count = 300, save = true) {
      const url = `/api/nbverse/card?interval=${encodeURIComponent(interval)}&count=${count}&save=${save ? 'true' : 'false'}`;
      console.log('🟢 NBverse card API 호출:', url);
      try {
        const resp = await fetch(url);
        console.log('🟢 NBverse 카드 응답 상태:', resp.status, resp.statusText);
        const data = await resp.json();
        const chartLen = Array.isArray(data?.chart) ? data.chart.length : 0;
        console.log('🟢 NBverse 카드 chart len:', chartLen, 'ok:', data?.ok);
        return data;
      } catch (error) {
        console.error('🔴 NBverse 카드 API 오류:', error);
        return { ok: false, error: error.message };
      }
    },

    // Step 5: 카드 생성
    async getBuyCards() {
      const resp = await fetch('/api/cards/buy');
      return await resp.json();
    },

    async getSellCards() {
      const resp = await fetch('/api/cards/sell');
      return await resp.json();
    },

    // Step 6: Win% (warehouse 데이터)
    async getWarehouseStats(trainerName = 'default') {
      const resp = await fetch(`/api/village/warehouse/${trainerName}`);
      return await resp.json();
    },

    // Step 6: Zone Status (25개 히스토리)
    async getZoneStatus(interval) {
      // zone_status API를 통해 segments 가져오기
      const resp = await fetch(`/api/nb-wave?timeframe=${interval}`);
      return await resp.json();
    },

    // NB Wave OHLCV: 상세 wave 데이터 (차트 baseline에 사용)
    async getNbWaveOhlcv(interval, count = 300, window = 50) {
      const url = withApiBase(`/api/nb-wave-ohlcv?timeframe=${encodeURIComponent(interval)}&count=${count}&window=${window}`);
      console.log('🌊 NB Wave OHLCV API 호출:', url);
      try {
        const resp = await fetch(url);
        const data = await resp.json();
        const len = Array.isArray(data?.wave_data) ? data.wave_data.length : 0;
        console.log('🌊 NB Wave OHLCV 응답:', { ok: data?.ok, base: data?.base, len });
        return data;
      } catch (e) {
        console.error('🔴 NB Wave OHLCV API 오류:', e?.message);
        return { ok: false, error: e?.message };
      }
    },
    
    // 다음 분봉 데이터 미리 계산 요청 (백그라운드, non-blocking)
    prefetchNextTimeframe(currentInterval) {
      const timeframes = ['minute1', 'minute3', 'minute5', 'minute10', 'minute15', 'minute30', 'minute60', 'day'];
      const currentIndex = timeframes.indexOf(currentInterval);
      if (currentIndex === -1 || currentIndex === timeframes.length - 1) return;
      
      const nextInterval = timeframes[currentIndex + 1];
      const url = withApiBase(`/api/nb-wave-ohlcv?timeframe=${encodeURIComponent(nextInterval)}&count=300&window=50&prefetch=true`);
      
      // non-blocking fetch (결과를 기다리지 않음)
      fetch(url).then(() => {
        console.log('✅ Prefetch 완료:', nextInterval);
      }).catch(() => {
        console.log('⚠️ Prefetch 실패:', nextInterval);
      });
      
      console.log('🚀 Prefetch 시작:', nextInterval, '(백그라운드)');
    },

    // NBverse: 특정 N/B 값(max/min)으로 저장 카드 로드
    async loadNbverseByNb(nbValue, type = 'max', eps = 1e-6) {
      const url = withApiBase(`/api/nbverse/load_by_nb?nb_value=${encodeURIComponent(nbValue)}&type=${encodeURIComponent(type)}&eps=${encodeURIComponent(eps)}`);
      console.log('📦 NBverse load_by_nb 호출:', url);
      try {
        const resp = await fetch(url);
        const data = await resp.json();
        if (!resp.ok || data?.ok === false) {
          console.warn('NBverse load_by_nb 실패:', data);
        } else {
          console.log('✅ NBverse load_by_nb 성공:', data);
        }
        return data;
      } catch (e) {
        console.error('NBverse load_by_nb 오류:', e?.message);
        return { ok: false, error: e?.message };
      }
    },

    // NBverse: 저장 경로로 직접 로드 (검색 없이)
    async loadNbverseByPath(path) {
      if (!path) return { ok: false, error: 'path is required' };
      const url = withApiBase(`/api/nbverse/load?path=${encodeURIComponent(path)}`);
      console.log('📦 NBverse load (path) 호출:', url);
      try {
        const resp = await fetch(url);
        const data = await resp.json();
        if (!resp.ok || data?.ok === false) {
          console.warn('NBverse load (path) 실패:', data);
        } else {
          console.log('✅ NBverse load (path) 성공:', data);
        }
        return data;
      } catch (e) {
        console.error('NBverse load (path) 오류:', e?.message);
        return { ok: false, error: e?.message };
      }
    }
  };

  // Expose for global helpers defined outside this IIFE (e.g., loadBuyCards8)
  window.API = API;

  // ============================================================================
  // Data Management Module
  // ============================================================================
  const DataManager = {
    async refreshMarketData() {
      console.log('refreshMarketData called for interval:', state.selectedInterval);
      
      try {
        const mlData = await API.getMLPredict(state.selectedInterval);
        console.log('ML Predict API response:', mlData);
        
        if (mlData && mlData.ok) {
          state.marketData = mlData;
          
          // insight에서 신뢰도 추출 (pct_blue 또는 pct_orange 중 큰 값)
          const insight = mlData.insight || {};
          const pctBlue = insight.pct_blue || 0;
          const pctOrange = insight.pct_orange || 0;
          const mlTrust = Math.max(pctBlue, pctOrange); // 신뢰도 (0~100)
          const mlZone = insight.zone || mlData.action || 'NONE';
          
          console.log('✅ ML Trust 추출됨:', mlTrust, '타입:', typeof mlTrust);
          console.log('   pctBlue:', pctBlue, '| pctOrange:', pctOrange, '| zone:', mlZone);
          
          $('#mlTrust').text(mlTrust.toFixed(1) + '%');
          UI.updateZoneBadge('#mlZone', mlZone);

          // Store ML stats for chart overlay
          state.mlStats = { mlTrust, mlZone, pctBlue, pctOrange };
          
          console.log(`ML data loaded for ${state.selectedInterval}:`, {mlTrust, mlZone});
          return { success: true, mlTrust, mlZone };
        } else {
          console.warn('ML Predict API returned not ok:', mlData);
          console.warn('❌ API ok 값:', mlData?.ok);
          return { success: false, mlTrust: 0 };
        }
      } catch (error) {
        console.error('Market data refresh error:', error);
        return { success: false };
      }
    },

    async loadDashboardStats() {
      console.log('loadDashboardStats called for interval:', state.selectedInterval);
      
      try {
        // Zone data from nb-wave API
        const zoneData = await API.getZoneData(state.selectedInterval);
        console.log('Zone API response:', zoneData);
        console.log('🟠 Zone API - ok:', zoneData?.ok, '| zones:', zoneData?.zones?.length);
        
        if (zoneData && zoneData.ok && zoneData.zones && zoneData.zones.length > 0) {
          // 가장 최근 zone 정보 (마지막 항목)
          const latestZone = zoneData.zones[zoneData.zones.length - 1];
          let currentZone = latestZone.zone || 'NONE';
          const rValue = latestZone.r_value || 0.5;
          
          // Calculate wValue from min_bit if available, normalize to 0-1 range
          // min_bit range is typically 5.5-10, normalize to 0-1 where 5.5->0, 10->1
          let wValue = 0.5;  // default
          if (latestZone.min_bit !== undefined) {
            const minBitVal = latestZone.min_bit;
            // Normalize: (minBit - 5.5) / (10 - 5.5) → (minBit - 5.5) / 4.5
            wValue = Math.max(0, Math.min(1, (minBitVal - 5.5) / 4.5));
          } else if (latestZone.w_value !== undefined) {
            wValue = latestZone.w_value;
          }
          
          const maxBit = latestZone.max_bit || 5.5;
          const minBit = latestZone.min_bit || 5.5;
          
          // summary에서 통계
          const summary = zoneData.summary || {};
          const orangeCount = summary.orange || 0;
          const blueCount = summary.blue || 0;
          const zoneCount = currentZone === 'ORANGE' ? orangeCount : blueCount;
          
          // r 값에서 신뢰도 계산
          const high = zoneData.high_threshold || 0.55;
          const low = zoneData.low_threshold || 0.45;
          const rng = Math.max(1e-9, high - low);
          
          let nbTrust = 0;
          if (currentZone === 'ORANGE') {
            // ORANGE: r이 high에 가까울수록 높음
            nbTrust = Math.max(0, Math.min(100, ((rValue - low) / rng) * 100));
          } else if (currentZone === 'BLUE') {
            // BLUE: r이 low에 가까울수록 높음
            nbTrust = Math.max(0, Math.min(100, ((high - rValue) / rng) * 100));
          }
          
          console.log('✅ N/B Trust 계산됨:', nbTrust, '| zone:', currentZone, '| r:', rValue, '| w:', wValue);
          console.log('   maxBit:', maxBit, '| minBit:', minBit, '| diff:', (maxBit - minBit).toFixed(2));

          // Store current zone for chart badge (will be updated after Step 4 chart rendering)
          state.currentZone = currentZone;
          state.nbStats = { zone: currentZone, nbTrust, rValue, w: wValue, maxBit, minBit };
          state.zoneSeries = zoneData.zones || [];
          
          // Update zone display (counts will be updated after Step 4)
          $('#currentTimeframe').text(state.selectedInterval);
          $('#currentZone').text(currentZone);
          
          // Update N/B Trust
          $('#nbTrust').text(nbTrust.toFixed(1) + '%');
          UI.updateZoneBadge('#nbZone', currentZone);
          
          // Immediately render the visible chart zones using API zones
          try {
            UI.renderZoneChart(zoneData.zones);
            const blueCount = Number(summary.blue || 0);
            const orangeCount = Number(summary.orange || 0);
            $('#zoneCount').text(`${blueCount}B / ${orangeCount}O`);
          } catch (e) {
            console.warn('Zone chart render in Step 3 failed:', e?.message);
          }
          
          // Stop previous polling to prevent memory leak when interval changes
          stopLivePricePolling();
          
          // Chart status
          $('#chartStatus').text(state.selectedInterval);
          $('#chartDetail').text(`차트 데이터 준비 중...`);

          // Fetch NB Wave OHLCV once here and cache for Step 4 reuse
          try {
            const nbWaveDetail = await API.getNbWaveOhlcv(state.selectedInterval, 300, 50);
            if (nbWaveDetail && nbWaveDetail.ok && Array.isArray(nbWaveDetail.wave_data) && nbWaveDetail.wave_data.length > 0) {
              state.nbWaveCached = nbWaveDetail; // { base, wave_data, summary? }
              console.log('💾 Step 3: Cached NB Wave OHLCV for reuse in Step 4:', {
                base: nbWaveDetail.base,
                len: nbWaveDetail.wave_data.length
              });
              
              // 🚀 다음 분봉 미리 계산 요청 (백그라운드)
              API.prefetchNextTimeframe(state.selectedInterval);
            } else {
              console.warn('⚠️ Step 3: NB Wave OHLCV not ok or empty, will fallback in Step 4');
              state.nbWaveCached = null;
            }
          } catch (e) {
            console.warn('⚠️ Step 3: NB Wave OHLCV fetch failed:', e?.message);
            state.nbWaveCached = null;
          }
          
          return { success: true, currentZone, nbTrust };
        } else {
          console.warn('❌ Zone API not ok or no zones:', zoneData?.ok, 'zones:', zoneData?.zones?.length);
          console.warn('❌ Zone API response:', zoneData);
          return { success: false, nbTrust: 0 };
        }
      } catch (error) {
        console.error('Dashboard stats error:', error);
        return { success: false, nbTrust: 0 };
      }
    },

    async refreshCards() {
      try {
        // Buy cards
        const buyData = await API.getBuyCards(5);
        if (buyData.ok && buyData.cards && buyData.cards.length > 0) {
          $('#buyCardCount').text(`(${buyData.cards.length})`);
          
          let buyHtml = '';
          buyData.cards.forEach(card => {
            const timestamp = new Date(card.timestamp || card.created_at).toLocaleString('ko-KR', {
              month: '2-digit', 
              day: '2-digit', 
              hour: '2-digit', 
              minute: '2-digit'
            });
            buyHtml += `
              <div style="padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between;">
                <span style="color: #0ecb81;">${timestamp}</span>
                <span>${(card.price || 0).toLocaleString()} KRW</span>
              </div>
            `;
          });
          $('#buyCardsList').html(buyHtml);
          this.updateTotalCards(buyData.cards.length, null);
        } else {
          $('#buyCardCount').text('(0)');
          $('#buyCardsList').html('<div style="text-align: center; padding: 20px; color: #555555;">카드 없음</div>');
        }

        // Sell cards
        const sellData = await API.getSellCards(5);
        if (sellData.ok && sellData.cards && sellData.cards.length > 0) {
          $('#sellCardCount').text(`(${sellData.cards.length})`);
          
          let sellHtml = '';
          sellData.cards.forEach(card => {
            const timestamp = new Date(card.timestamp || card.created_at).toLocaleString('ko-KR', {
              month: '2-digit', 
              day: '2-digit', 
              hour: '2-digit', 
              minute: '2-digit'
            });
            sellHtml += `
              <div style="padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between;">
                <span style="color: #f6465d;">${timestamp}</span>
                <span>${(card.price || 0).toLocaleString()} KRW</span>
              </div>
            `;
          });
          $('#sellCardsList').html(sellHtml);
          this.updateTotalCards(null, sellData.cards.length);
        } else {
          $('#sellCardCount').text('(0)');
          $('#sellCardsList').html('<div style="text-align: center; padding: 20px; color: #555555;">카드 없음</div>');
        }

      } catch (error) {
        console.error('Cards refresh error:', error);
        $('#buyCardsList').html('<div style="text-align: center; padding: 20px; color: #f6465d;">로드 실패</div>');
        $('#sellCardsList').html('<div style="text-align: center; padding: 20px; color: #f6465d;">로드 실패</div>');
      }
    },

    updateTotalCards(buyCount, sellCount) {
      const currentBuy = buyCount !== null ? buyCount : parseInt($('#buyCardCount').text().match(/\d+/)?.[0] || '0');
      const currentSell = sellCount !== null ? sellCount : parseInt($('#sellCardCount').text().match(/\d+/)?.[0] || '0');
      const total = currentBuy + currentSell;
      
      $('#totalCards').text(total + '장');
      $('#cardDetail').text(`매수: ${currentBuy} | 매도: ${currentSell}`);
    }
  };

  // ============================================================================
  // Step Management Module
  // ============================================================================
  const StepManager = {
    activateStep(stepNum) {
      $('.step-card').removeClass('active').addClass('locked');
      $('.step-status').removeClass('active').addClass('pending').text('대기중');
      
      const stepCard = $('#step' + stepNum);
      stepCard.removeClass('locked').addClass('active');
      stepCard.find('.step-status').removeClass('pending').addClass('active').text('진행중');
      
      for (let i = 1; i < stepNum; i++) {
        const prevCard = $('#step' + i);
        prevCard.removeClass('locked active').addClass('completed');
        prevCard.find('.step-status').removeClass('pending active').addClass('completed').text('완료');
      }
      
      state.currentStep = stepNum;
      UI.updateProgress();
      UI.updateFlowSummary();
    },

    async proceedToStep2() {
      if (!state.marketData) {
        alert('시장 데이터를 먼저 로드해주세요.');
        return;
      }

      this.activateStep(2);
      
      const trustData = state.marketData;
      
      // Information Trust Level
      const trustLevel = trustData.information_trust_level || 0;
      $('#trustLevelBig').text(trustLevel + '%');
      
      // Trust Quality
      let trustQuality = 'Low';
      let trustQualityColor = '#f6465d';
      if (trustLevel >= 80) {
        trustQuality = 'Very High';
        trustQualityColor = '#0ecb81';
      } else if (trustLevel >= 60) {
        trustQuality = 'High';
        trustQualityColor = '#0ecb81';
      } else if (trustLevel >= 40) {
        trustQuality = 'Medium';
        trustQualityColor = '#ffb703';
      }
      $('#trustQuality').text(trustQuality).css('color', trustQualityColor);
      
      // ML Trust
      const mlTrust = trustData.ml_confidence || 0;
      $('#mlTrustBig').text(mlTrust + '%');
      $('#mlTrustBar').css('width', mlTrust + '%');
      
      // N/B Trust
      const nbTrust = trustData.nb_confidence || 0;
      $('#nbTrustBig').text(nbTrust + '%');
      $('#nbTrustBar').css('width', nbTrust + '%');
      
      // N/B Zone Status
      const nbResult = trustData.nb_result || {};
      const currentZone = nbResult.current_zone || 'NONE';
      const zoneCount = nbResult.zone_count || 0;
      
      $('#zoneTimeframe').text(state.selectedInterval);
      $('#zoneCount').text(zoneCount);
      
      // Update current zone display
      const zoneBadge = $('<span></span>')
        .addClass('zone-badge')
        .text(currentZone);
      
      if (currentZone === 'BLUE') {
        zoneBadge.addClass('blue');
      } else if (currentZone === 'ORANGE') {
        zoneBadge.addClass('orange');
      } else {
        zoneBadge.addClass('none');
      }
      $('#currentZoneDisplay').html(zoneBadge);
      
      UI.renderZoneChart(currentZone, zoneCount);
      
      // Recommended action
      const finalZone = trustData.final_zone || 'NONE';
      let action = '-';
      if (finalZone === 'BLUE') {
        action = '💰 매수 추천';
        $('#recommendedAction').addClass('positive').removeClass('negative').text(action);
      } else if (finalZone === 'ORANGE') {
        action = '💸 매도 추천';
        $('#recommendedAction').addClass('negative').removeClass('positive').text(action);
      } else {
        action = '⏸️ 대기 권장';
        $('#recommendedAction').removeClass('positive negative').text(action);
      }
      
      // Zone agreement
      const agreement = trustData.zone_agreement || 'NO';
      $('#zoneAgreement').text(agreement === 'YES' ? '✅ 일치' : '❌ 불일치')
        .css('color', agreement === 'YES' ? '#0ecb81' : '#f6465d');
      
      // Decision reason
      const reason = trustData.decision_reason || '-';
      let reasonText = reason;
      if (reason === 'consensus') reasonText = '🤝 양 모델 합의';
      else if (reason === 'ml_high_confidence') reasonText = '🤖 ML 고신뢰도';
      else if (reason === 'nb_priority') reasonText = '🏛️ N/B 우선';
      else if (reason === 'default_nb') reasonText = '🏛️ N/B 기본';
      $('#decisionReason').text(reasonText);
      
      state.signalData = trustData;
    },

    async proceedToStep3() {
      this.activateStep(3);
      
      try {
        const data = await API.getPreflight();
        
        if (data.ok && data.preflight) {
          const pf = data.preflight;
          $('#availableKRW').text((pf.krw || 0).toLocaleString() + ' KRW');
          $('#coinBalance').text((pf.coin_balance || 0).toFixed(8));
          $('#buyAmount').text((pf.planned_buy_krw || 0).toLocaleString() + ' KRW');
          $('#sellAmount').text((pf.planned_sell_size || 0).toFixed(8));
          
          $('#buyBtn').prop('disabled', !pf.can_buy);
          $('#sellBtn').prop('disabled', !pf.can_sell);
        }
      } catch (error) {
        console.error('Preflight error:', error);
      }
    },

    proceedToStep4(tradeType, order) {
      this.activateStep(4);
      
      $('#tradeType').text(tradeType === 'BUY' ? '💰 매수' : '💸 매도')
        .removeClass('positive negative')
        .addClass(tradeType === 'BUY' ? 'positive' : 'negative');
      $('#tradePrice').text((order.price || 0).toLocaleString() + ' KRW');
      $('#tradeSize').text((order.size || 0).toFixed(8));
      $('#tradeStatus').text(order.paper ? '📄 페이퍼 거래' : '✅ 실제 거래');
    },

    backToStep1() {
      this.activateStep(1);
    },

    backToStep2() {
      this.activateStep(2);
    }
  };

  // ============================================================================
  // Trade Module
  // ============================================================================
  const Trade = {
    async executeBuy() {
      const btn = $('#buyBtn');
      const originalText = btn.text();
      btn.prop('disabled', true).html('<span class="spinner"></span> 매수중...');
      
      try {
        // capture NBverse meta to persist locally regardless of server behavior
        const nb = (typeof window.ccCurrentData === 'object') ? (window.ccCurrentData.nb || {}) : {};
        const priceMeta = nb.price || {};
        const meta = {
          nb_price_max: Number(priceMeta.max || 0) || null,
          nb_price_min: Number(priceMeta.min || 0) || null,
          nbverse_path: window.ccLastNbversePath || null,
          nbverse_interval: window.flowDashboardState?.selectedInterval || null,
          nbverse_timestamp: new Date().toISOString()
        };

        const data = await API.executeBuy(false);
        if (data.ok && data.order) {
          try {
            const uuid = data.order?.uuid || data.order?.id || String(Date.now());
            const map = JSON.parse(localStorage.getItem('buyMetaMap') || '{}');
            map[uuid] = meta;
            localStorage.setItem('buyMetaMap', JSON.stringify(map));
            console.log('💾 Buy meta persisted locally for', uuid, meta);
          } catch(_) {}
          state.tradeData = data.order;
          StepManager.proceedToStep4('BUY', data.order);
        } else {
          const err = String(data.error || '알 수 없는 오류');
          const msg = /nb_coin_limit_exceeded/i.test(err) ? '매수 실패: 코인 수량 제한 초과' : `매수 실패: ${err}`;
          UI.notify(msg, 'error');
          btn.prop('disabled', false).text(originalText);
        }
      } catch (error) {
        console.error('Buy error:', error);
        UI.notify(`매수 오류: ${error.message}`, 'error');
        btn.prop('disabled', false).text(originalText);
      }
    },

    async executeBuyPaper() {
      const btn = $('#ccPaperBuy');
      const originalText = btn.text();
      btn.prop('disabled', true).html('<span class="spinner"></span> 가상 매수중...');

      try {
        const nb = (typeof window.ccCurrentData === 'object') ? (window.ccCurrentData.nb || {}) : {};
        const priceMeta = nb.price || {};
        const meta = {
          nb_price_max: Number(priceMeta.max || 0) || null,
          nb_price_min: Number(priceMeta.min || 0) || null,
          nbverse_path: window.ccLastNbversePath || null,
          nbverse_interval: window.flowDashboardState?.selectedInterval || null,
          nbverse_timestamp: new Date().toISOString(),
          paper: true
        };

        const data = await API.executeBuy(true);
        if (data.ok && data.order) {
          try {
            const uuid = data.order?.uuid || data.order?.id || String(Date.now());
            const map = JSON.parse(localStorage.getItem('buyMetaMap') || '{}');
            map[uuid] = meta;
            localStorage.setItem('buyMetaMap', JSON.stringify(map));
            console.log('💾 Paper buy meta persisted locally for', uuid, meta);
          } catch(_) {}
          state.tradeData = data.order;
          StepManager.proceedToStep4('BUY', data.order);
        } else {
          const err = String(data.error || '알 수 없는 오류');
          const msg = /nb_coin_limit_exceeded/i.test(err) ? '가상 매수 실패: 코인 수량 제한 초과' : `가상 매수 실패: ${err}`;
          UI.notify(msg, 'error');
          btn.prop('disabled', false).text(originalText);
        }
      } catch (error) {
        console.error('Paper buy error:', error);
        UI.notify(`가상 매수 오류: ${error.message}`, 'error');
        btn.prop('disabled', false).text(originalText);
      }
    },

    async executeSell() {
      const btn = $('#sellBtn');
      const originalText = btn.text();
      btn.prop('disabled', true).html('<span class="spinner"></span> 매도중...');
      
      try {
        // 현재 카드의 매수 수량 가져오기
        const buySize = window.ccCurrentData?.size || window.ccCurrentData?.buy_size || 0;
        
        // PnL 비율 (기본 100% - 전체 매도)
        const pnlRatio = 100;  // 매수한 수량 전체 매도
        
        console.log('🔴 매도 수량 계산:', { buySize, pnlRatio, actualSize: buySize * (pnlRatio / 100) });
        
        const data = await API.executeSell(false, buySize, pnlRatio);
        
        if (data.ok && data.order) {
          state.tradeData = data.order;
          console.log('✅ 매도 완료:', data.order.size, '수량 매도됨');
          StepManager.proceedToStep4('SELL', data.order);
        } else {
          alert('매도 실패: ' + (data.error || '알 수 없는 오류'));
          btn.prop('disabled', false).text(originalText);
        }
      } catch (error) {
        console.error('Sell error:', error);
        alert('매도 오류: ' + error.message);
        btn.prop('disabled', false).text(originalText);
      }
    }
  };

  // ============================================================================
  // Auto Buy Module (BLUE-only gating, countdown + progress UI)
  // ============================================================================
  const AutoBuy = {
    running: false,
    timerId: null,
    startTime: null,
    durationMs: 0,
    initialized: false, // 초기화 여부 플래그
    serverStateSynced: false, // 서버 상태 동기화 여부 플래그
    lastCheckedCardId: null, // 마지막으로 체크한 카드 ID (대기 시간 모드 중복 방지)
    
    // ===== 상태 머신 (WAIT -> BUYING -> WAIT) =====
    phase: 'IDLE', // 'IDLE', 'WAIT', 'BUYING'
    waitStartTime: null, // 대기 시간 시작 시간
    waitDurationMs: 0, // 대기 시간 (밀리초)
    buyingIntervalMs: 0, // 매수 시도 간격
    elements: {
      toggleBtn: null,
      statusBadge: null,
      intervalSel: null,
      amountInput: null,
      blueOnlyChk: null,
      progressTrack: null,
      progressBar: null,
      countdownLabel: null,
    },

    bindUI() {
      // 이미 초기화되었으면 건너뜀 (중복 방지)
      if (this.initialized) {
        console.log('⚠️ Auto Buy already initialized, skipping bindUI');
        return;
      }
      
      try {
        this.elements.toggleBtn = document.getElementById('autoBuyToggle');
        this.elements.statusBadge = document.getElementById('autoBuyStatus');
        this.elements.intervalSel = document.getElementById('autoBuyInterval');
        this.elements.amountInput = document.getElementById('autoBuyAmount');
        this.elements.blueOnlyChk = document.getElementById('autoBuyBlueOnly');
        this.elements.noDuplicateChk = document.getElementById('autoBuyNoDuplicate');
        this.elements.higherGradeChk = document.getElementById('autoBuyHigherGrade');
        this.elements.blueCardOnlyChk = document.getElementById('autoBuyBlueCardOnly');
        this.elements.modeIntervalChk = document.getElementById('autoBuyModeInterval');
        this.elements.modeWaitChk = document.getElementById('autoBuyModeWait');
        this.elements.waitTimeInput = document.getElementById('autoBuyWaitTime');
        this.elements.logContainer = document.getElementById('autoBuyLogContainer');
        
        // ===== 새로운 프로그레스바 요소들 =====
        this.elements.waitPhaseEl = document.getElementById('abWaitPhase');
        this.elements.buyingPhaseEl = document.getElementById('abBuyingPhase');
        this.elements.waitProgressBar = document.getElementById('abWaitProgressBar');
        this.elements.progressBar = document.getElementById('abProgressBar');
        this.elements.countdownLabel = document.getElementById('abNextText');

        if (!this.elements.toggleBtn) return;
        
        // 초기화 완료 플래그 설정
        this.initialized = true;
        console.log('✅ Auto Buy UI initialized');
        
        // localStorage에서 설정 복원
        this.loadSettings();
        
        // 매수 이력 저장 (중복 매수 방지용)
        if (!window.autoBuyHistory) {
          window.autoBuyHistory = {}; // { coinName: lastBuyTime }
        }
        if (!window.autoBuyGradeMap) {
          window.autoBuyGradeMap = {}; // { coinName: grade }
        }
        if (!window.autoBuyMaxMap) {
          window.autoBuyMaxMap = {}; // { coinName: nbMax }
        }
        
        // 로그 저장 배열 초기화
        if (!window.autoBuyLogs) {
          window.autoBuyLogs = []; // 최근 로그 저장
        }
        
        // Create progress + countdown UI lazily
        const card = this.elements.toggleBtn.closest('.card');
        if (card) {
          const progWrap = document.createElement('div');
          progWrap.style.marginTop = '8px';
          progWrap.style.display = 'none';
          progWrap.id = 'autoBuyUiWrap';

          const track = document.createElement('div');
          track.id = 'autoBuyProgressTrack';
          track.style.height = '8px';
          track.style.borderRadius = '12px';
          track.style.background = '#0e1424';
          track.style.border = '1px solid rgba(255,255,255,0.12)';
          track.style.overflow = 'hidden';

          const bar = document.createElement('div');
          bar.id = 'autoBuyProgressBar';
          bar.style.height = '100%';
          bar.style.width = '0%';
          bar.style.background = '#00d1ff';
          bar.style.transition = 'width .4s ease';
          track.appendChild(bar);

          const label = document.createElement('div');
          label.id = 'autoBuyCountdownLabel';
          label.style.marginTop = '6px';
          label.style.fontSize = '11px';
          label.style.color = '#9aa8c2';
          label.textContent = '대기';

          progWrap.appendChild(track);
          progWrap.appendChild(label);
          card.appendChild(progWrap);

          this.elements.progressTrack = track;
          this.elements.progressBar = bar;
          this.elements.countdownLabel = label;
        }

        this.elements.toggleBtn.addEventListener('click', () => {
          if (this.running) this.stop(); else this.start();
        });
        
        // 매수 방식 중복 방지 (라디오 버튼처럼 작동)
        this.elements.modeIntervalChk?.addEventListener('change', () => {
          if (this.elements.modeIntervalChk.checked) {
            this.elements.modeWaitChk.checked = false;
          }
          this.saveSettings();
        });
        
        this.elements.modeWaitChk?.addEventListener('change', () => {
          if (this.elements.modeWaitChk.checked) {
            this.elements.modeIntervalChk.checked = false;
          }
          this.saveSettings();
        });
        
        // 설정 변경 시 저장
        this.elements.intervalSel?.addEventListener('change', () => this.saveSettings());
        this.elements.amountInput?.addEventListener('change', () => this.saveSettings());
        this.elements.blueOnlyChk?.addEventListener('change', () => this.saveSettings());
        this.elements.noDuplicateChk?.addEventListener('change', () => this.saveSettings());
        this.elements.higherGradeChk?.addEventListener('change', () => this.saveSettings());
        this.elements.waitTimeInput?.addEventListener('change', () => this.saveSettings());
        
        // 실행 중이었으면 남은 시간으로 자동 시작
        const wasRunning = localStorage.getItem('autoBuy_running') === 'true';
        if (wasRunning) {
          setTimeout(() => this.resume(), 1000); // 1초 후 남은 시간으로 재시작
        }
      } catch (_) {}
    },
    
    loadSettings() {
      try {
        const interval = localStorage.getItem('autoBuy_interval');
        const amount = localStorage.getItem('autoBuy_amount');
        const blueOnly = localStorage.getItem('autoBuy_blueOnly');
        const noDuplicate = localStorage.getItem('autoBuy_noDuplicate');
        const higherGrade = localStorage.getItem('autoBuy_higherGrade');
        const blueCardOnly = localStorage.getItem('autoBuy_blueCardOnly');
        const modeInterval = localStorage.getItem('autoBuy_modeInterval');
        const modeWait = localStorage.getItem('autoBuy_modeWait');
        const waitTime = localStorage.getItem('autoBuy_waitTime');
        
        if (interval && this.elements.intervalSel) {
          this.elements.intervalSel.value = interval;
        }
        if (amount && this.elements.amountInput) {
          this.elements.amountInput.value = amount;
        }
        if (blueOnly !== null && this.elements.blueOnlyChk) {
          this.elements.blueOnlyChk.checked = blueOnly === 'true';
        }
        if (noDuplicate !== null && this.elements.noDuplicateChk) {
          this.elements.noDuplicateChk.checked = noDuplicate !== 'false';
        }
        if (higherGrade !== null && this.elements.higherGradeChk) {
          this.elements.higherGradeChk.checked = higherGrade === 'true';
        }
        if (blueCardOnly !== null && this.elements.blueCardOnlyChk) {
          this.elements.blueCardOnlyChk.checked = blueCardOnly !== 'false';
        }
        if (modeInterval !== null && this.elements.modeIntervalChk) {
          this.elements.modeIntervalChk.checked = modeInterval !== 'false';
        }
        if (modeWait !== null && this.elements.modeWaitChk) {
          this.elements.modeWaitChk.checked = modeWait === 'true';
        }
        if (waitTime && this.elements.waitTimeInput) {
          this.elements.waitTimeInput.value = waitTime;
        }
        
        console.log('✅ Auto Buy 설정 복원:', { interval, amount, blueOnly, noDuplicate, higherGrade, blueCardOnly, modeInterval, modeWait, waitTime });
        
        // 서버에서 실제 상태 가져오기 (최초 1회만)
        if (!this.serverStateSynced) {
          this.serverStateSynced = true;
          this.syncServerState();
        }
      } catch (err) {
        console.warn('Auto Buy 설정 복원 실패:', err);
      }
    },
    
    async syncServerState() {
      try {
        const resp = await fetch('/api/auto-buy/status');
        const data = await resp.json();
        
        if (data && data.ok) {
          console.log('🔄 서버 Auto Buy 상태 동기화:', data);
          
          // 이미 실행 중이면 서버 상태로 덮어쓰지 않음
          if (this.running) {
            console.log('ℹ️ Auto Buy 이미 실행 중 → 서버 상태 동기화 건너뜀');
            return;
          }
          
          // 서버가 ON이면 클라이언트 타이머 복원 또는 시작
          if (data.enabled) {
            console.log('✅ 서버 Auto Buy ON → 타이머 복원/시작');
            const savedStartTime = localStorage.getItem('autoBuy_startTime');
            const savedDurationMs = localStorage.getItem('autoBuy_durationMs');
            
            if (savedStartTime && savedDurationMs) {
              console.log('⏰ 저장된 타이머 존재 → resume()');
              setTimeout(() => { if (!this.running) this.resume(); }, 500);
            } else {
              console.log('🆕 저장된 타이머 없음 → 새 시작');
              localStorage.setItem('autoBuy_running', 'true');
              setTimeout(() => {
                if (this.elements.toggleBtn && !this.running) {
                  this.elements.toggleBtn.click();
                }
              }, 500);
            }
          } else {
            // 서버가 OFF여도 클라이언트는 유지 (사용자 의사 존중)
            console.log('ℹ️ 서버 Auto Buy OFF → 클라이언트 상태 유지');
          }
        }
      } catch (err) {
        console.warn('서버 Auto Buy 상태 동기화 실패:', err);
      }
    },
    
    saveSettings() {
      try {
        const interval = this.elements.intervalSel?.value || '600';
        const amount = this.elements.amountInput?.value || '5000';
        const blueOnly = this.elements.blueOnlyChk?.checked ? 'true' : 'false';
        const noDuplicate = this.elements.noDuplicateChk?.checked ? 'true' : 'false';
        const higherGrade = this.elements.higherGradeChk?.checked ? 'true' : 'false';
        const blueCardOnly = this.elements.blueCardOnlyChk?.checked ? 'true' : 'false';
        const modeInterval = this.elements.modeIntervalChk?.checked ? 'true' : 'false';
        const modeWait = this.elements.modeWaitChk?.checked ? 'true' : 'false';
        const waitTime = this.elements.waitTimeInput?.value || '0';
        
        localStorage.setItem('autoBuy_interval', interval);
        localStorage.setItem('autoBuy_amount', amount);
        localStorage.setItem('autoBuy_blueOnly', blueOnly);
        localStorage.setItem('autoBuy_noDuplicate', noDuplicate);
        localStorage.setItem('autoBuy_higherGrade', higherGrade);
        localStorage.setItem('autoBuy_blueCardOnly', blueCardOnly);
        localStorage.setItem('autoBuy_modeInterval', modeInterval);
        localStorage.setItem('autoBuy_modeWait', modeWait);
        localStorage.setItem('autoBuy_waitTime', waitTime);
        
        console.log('💾 Auto Buy 설정 저장:', { interval, amount, blueOnly, noDuplicate, higherGrade, blueCardOnly, modeInterval, modeWait, waitTime });
      } catch (err) {
        console.warn('Auto Buy 설정 저장 실패:', err);
      }
    },

    getIntervalMs() {
      const val = this.elements.intervalSel?.value || '600';
      // val은 이제 초 단위의 숫자 문자열 (예: "60", "180", "600")
      const seconds = parseInt(val, 10) || 600;
      return seconds * 1000; // 밀리초로 변환
    },

    formatMmSs(ms) {
      const sec = Math.max(0, Math.floor(ms / 1000));
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },

    addLog(message) {
      // 로그 메시지를 배열에 추가 (최대 10개 유지)
      if (!window.autoBuyLogs) window.autoBuyLogs = [];
      window.autoBuyLogs.push(message);
      if (window.autoBuyLogs.length > 10) {
        window.autoBuyLogs.shift();
      }

      // UI에 표시 (로그 컨테이너)
      if (this.elements.logContainer) {
        const lines = message.split('\n');
        const logHTML = lines.map(line => {
          // 로그 라인별 색상 지정
          let color = '#d9e2f3';
          if (line.includes('✅') || line.includes('PASS')) color = '#0ecb81';
          else if (line.includes('❌') || line.includes('FAIL')) color = '#f6465d';
          else if (line.includes('⏭️') || line.includes('스킵')) color = '#ffb703';
          else if (line.includes('⊘') || line.includes('비활성화')) color = '#9aa8c2';
          
          return `<div style="color:${color};">${line}</div>`;
        }).join('');
        
        this.elements.logContainer.innerHTML = logHTML + (this.elements.logContainer.innerHTML || '');
        
        // 로그 컨테이너 스크롤 상단으로 유지
        this.elements.logContainer.scrollTop = 0;
      }

      // 상단 메뉴에 표시 (최근 로그 1줄)
      const statusBar = document.getElementById('autoBuyStatusBar');
      if (statusBar) {
        const lines = message.split('\n').filter(l => l.trim() && !l.startsWith('---'));
        if (lines.length > 0) {
          // 가장 중요한 로그 라인 선택 (매수 성공/실패 우선)
          let displayLine = lines.find(l => l.includes('✅ 매수 성공')) || 
                          lines.find(l => l.includes('❌')) || 
                          lines.find(l => l.includes('⏭️ 매수 스킵')) ||
                          lines[lines.length - 1];
          
          let color = '#d9e2f3';
          if (displayLine.includes('✅')) color = '#0ecb81';
          else if (displayLine.includes('❌')) color = '#f6465d';
          else if (displayLine.includes('⏭️')) color = '#ffb703';
          
          statusBar.style.color = color;
          statusBar.textContent = displayLine;
        }
      }
    },

    tick() {
      const now = Date.now();
      
      // phase가 없으면 IDLE
      if (this.phase === 'IDLE' || !this.running) {
        return;
      }
      
      const intervalSec = parseInt(this.elements.intervalSel?.value || '600', 10);
      const waitTimeSec = parseInt(this.elements.waitTimeInput?.value || '0', 10);
      
      // ===== WAIT 단계: 대기 시간 진행 =====
      if (this.phase === 'WAIT') {
        const elapsed = now - this.waitStartTime;
        const remain = Math.max(0, this.waitDurationMs - elapsed);
        const pct = Math.min(100, (elapsed / this.waitDurationMs) * 100);
        
        // UI 업데이트 (대기 프로그레스바)
        const waitPhaseEl = document.getElementById('abWaitPhase');
        if (waitPhaseEl) {
          waitPhaseEl.style.display = 'block';
          const bar = document.getElementById('abWaitProgressBar');
          if (bar) bar.style.width = `${pct}%`;
          const text = document.getElementById('abWaitProgressText');
          if (text) text.textContent = this.formatMmSs(remain);
        }
        const buyingPhaseEl = document.getElementById('abBuyingPhase');
        if (buyingPhaseEl) buyingPhaseEl.style.display = 'none';
        
        // 대기 시간 완료 → BUYING 단계로 전환
        if (remain <= 0) {
          console.log('✅ 대기 시간 완료 → BUYING 단계로 전환');
          this.phase = 'BUYING';
          this.lastCheckedCardId = null; // 카드 ID 리셋 (중복 체크 초기화)
          this.startTime = now;
          this.checkAndBuy('interval'); // 즉시 한번 체크
        }
      }
      
      // ===== BUYING 단계: 매수 시도 (주기적으로) =====
      if (this.phase === 'BUYING') {
        const elapsed = now - this.startTime;
        const remain = Math.max(0, this.buyingIntervalMs - elapsed);
        const pct = Math.min(100, (elapsed / this.buyingIntervalMs) * 100);
        
        // UI 업데이트 (매수 프로그레스바)
        const buyingPhaseEl = document.getElementById('abBuyingPhase');
        if (buyingPhaseEl) {
          buyingPhaseEl.style.display = 'block';
          const bar = document.getElementById('abProgressBar');
          if (bar) bar.style.width = `${pct}%`;
          const text = document.getElementById('abProgressText');
          if (text) text.textContent = this.formatMmSs(remain);
        }
        const waitPhaseEl = document.getElementById('abWaitPhase');
        if (waitPhaseEl) waitPhaseEl.style.display = 'none';
        
        // 매수 시도 간격 도달
        if (remain <= 0) {
          this.startTime = now; // 타이머 리셋
          this.checkAndBuy('interval');
        }
      }
      
      if (this.elements.statusBadge) this.elements.statusBadge.textContent = 'ON';
    },

    checkAndBuy(mode) {
      const currentCard = window.ccCurrentData;
      const currentCardId = currentCard?.uuid || currentCard?.id || currentCard?.coin;
      
      // 이전 카드와 같으면 스킵 (대기 시간 모드에서 중복 방지)
      if (mode === 'wait' && this.lastCheckedCardId === currentCardId && currentCardId) {
        return;
      }
      
      this.lastCheckedCardId = currentCardId;

      // 매수 조건 체크
      const blueOnly = !!this.elements.blueOnlyChk?.checked;
      const noDuplicate = !!this.elements.noDuplicateChk?.checked;
      const higherGradeOnly = !!this.elements.higherGradeChk?.checked;
      const blueCardOnly = !!this.elements.blueCardOnlyChk?.checked;
      const waitTimeSec = parseInt(this.elements.waitTimeInput?.value || '0', 10);
      const intervalSec = parseInt(this.elements.intervalSel?.value || '600', 10);
      const currentZone = (window.flowDashboardState?.currentZone) || window.ccCurrentZone || 'NONE';
      
      let canBuy = true;
      let reason = '';
      
      // 로그 초기화
      const logMsgs = [];
      logMsgs.push(`⏰ [Auto Buy 체크] ${new Date().toLocaleTimeString()}`);
      logMsgs.push(`📅 주기: ${intervalSec}초 | ⏳ 대기시간: ${waitTimeSec}초`);
      
      // 카드 기본 정보
      const cardCoin = currentCard?.coin || 'NONE';
      const cardGrade = currentCard?.grade || currentCard?.rating || 'N/A';
      const cardEnhance = currentCard?.enhance || 0;
      const cardZone = currentCard?.zone || currentCard?.zoneForSign || currentCard?.nb_zone || 'N/A';
      
      // 가격 N/B Max 값 추출
      const priceNbMax = currentCard?.nbMax || currentCard?.max || currentCard?.nb_price_max || 
                        (currentCard?.card_rating?.priceMax) || 
                        (currentCard?.nb?.price?.max) || 'N/A';
      const priceNbMin = currentCard?.nb_price_min || 
                        (currentCard?.card_rating?.priceMin) || 
                        (currentCard?.nb?.price?.min) || 'N/A';
      
      logMsgs.push(`📋 현재 카드: ${cardCoin} | 등급: ${cardGrade}+${cardEnhance} | Zone: ${cardZone}`);
      logMsgs.push(`📊 가격 N/B: MAX=${priceNbMax} | MIN=${priceNbMin}`);
      logMsgs.push(`💼 보유 카드: ${Object.keys(window.autoBuyMaxMap || {}).length}장`);
      logMsgs.push('---');
      
      // 조건 1: BLUE 카드만 매수 (카드의 zone 정보 기준)
      if (blueOnly && currentCard) {
        const cardZone = String(currentCard.zone || currentCard.zoneForSign || currentCard.nb_zone || 'NONE').toUpperCase();
        if (cardZone !== 'BLUE') {
          canBuy = false;
          reason = '카드가 BLUE 아님, 건너뜀';
          logMsgs.push(`❌ 조건1 (카드 BLUE): FAIL - 카드 zone=${cardZone}`);
        } else {
          logMsgs.push(`✅ 조건1 (카드 BLUE): PASS - 카드 zone=${cardZone}`);
        }
      } else if (blueOnly) {
        logMsgs.push(`⊘ 조건1 (카드 BLUE): 카드 정보 없음`);
      } else {
        logMsgs.push(`⊘ 조건1 (카드 BLUE): 비활성화`);
      }
      
      // 조건 2: 같은 N/B MAX 코인 중복 매수 방지
      if (canBuy && noDuplicate && currentCard) {
        const currentNbMax = currentCard.nbMax || currentCard.max;
        let isDuplicate = false;
        let duplicateCoins = [];
        
        // 보유 중인 카드들 중 같은 N/B max 값이 있으면 매수 불가
        for (const [coin, savedMax] of Object.entries(window.autoBuyMaxMap || {})) {
          if (savedMax === currentNbMax) {
            isDuplicate = true;
            duplicateCoins.push(coin);
            canBuy = false;
            reason = `같은 N/B max=${currentNbMax} 카드 이미 보유중, 건너뜀`;
          }
        }
        
        if (isDuplicate) {
          logMsgs.push(`❌ 조건2 (N/B MAX 중복 방지): FAIL - N/B max=${currentNbMax} 보유중: ${duplicateCoins.join(', ')}`);
        } else if (noDuplicate) {
          logMsgs.push(`✅ 조건2 (N/B MAX 중복 방지): PASS - 같은 N/B MAX 없음`);
        }
      } else if (noDuplicate) {
        logMsgs.push(`⊘ 조건2 (N/B MAX 중복 방지): 카드 정보 없음`);
      } else {
        logMsgs.push(`⊘ 조건2 (N/B MAX 중복 방지): 비활성화`);
      }
      
      // 조건 3: 높은 등급만 매수 (등급 비교 → 같으면 강화 수치 비교)
      if (canBuy && higherGradeOnly && currentCard) {
        const currentGrade = currentCard.grade || currentCard.rating || 'F';
        const currentEnhance = currentCard.enhance || 0;
        const gradeOrder = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F'];
        const currentGradeIdx = gradeOrder.indexOf(currentGrade);
        
        // 보유 중인 최고 등급 + 강화 찾기
        let bestGrade = 'F';
        let bestEnhance = 0;
        
        for (const [coin, gradeData] of Object.entries(window.autoBuyGradeMap || {})) {
          const savedGrade = gradeData.grade || 'F';
          const savedEnhance = gradeData.enhance || 0;
          const savedGradeIdx = gradeOrder.indexOf(savedGrade);
          const bestGradeIdx = gradeOrder.indexOf(bestGrade);
          
          // 등급이 더 높거나, 같은 등급이고 강화가 더 높으면
          if (savedGradeIdx < bestGradeIdx || (savedGradeIdx === bestGradeIdx && savedEnhance > bestEnhance)) {
            bestGrade = savedGrade;
            bestEnhance = savedEnhance;
          }
        }
        
        const bestGradeIdx = gradeOrder.indexOf(bestGrade);
        
        // 신규 카드가 최고 등급보다 낮거나, 같은 등급이고 강화가 낮으면
        if (currentGradeIdx > bestGradeIdx || (currentGradeIdx === bestGradeIdx && currentEnhance <= bestEnhance)) {
          canBuy = false;
          reason = `등급 ${currentGrade}(+${currentEnhance}) <= 보유중 ${bestGrade}(+${bestEnhance}), 건너뜀`;
          logMsgs.push(`❌ 조건3 (높은 등급): FAIL - 신규 ${currentGrade}(+${currentEnhance}) <= 보유중 ${bestGrade}(+${bestEnhance})`);
        } else {
          logMsgs.push(`✅ 조건3 (높은 등급): PASS - 신규 ${currentGrade}(+${currentEnhance}) > 보유중 ${bestGrade}(+${bestEnhance})`);
        }
      } else if (higherGradeOnly) {
        logMsgs.push(`⊘ 조건3 (높은 등급): 카드 정보 없음`);
      } else {
        logMsgs.push(`⊘ 조건3 (높은 등급): 비활성화`);
      }
      
      // 조건 4: Blue Card만 매수 (Orange Card 제외)
      if (canBuy && blueCardOnly && currentCard) {
        const cardZone = (currentCard.zone || currentCard.zoneForSign || 'NONE');
        const isBlueCard = String(cardZone).toUpperCase() === 'BLUE';
        
        if (!isBlueCard) {
          canBuy = false;
          reason = `Orange Card(강화-), 건너뜀`;
          logMsgs.push(`❌ 조건4 (Blue Card만): FAIL - 카드 타입=${cardZone} (Orange 카드)`);
        } else {
          logMsgs.push(`✅ 조건4 (Blue Card만): PASS - Blue Card(강화+)`);
        }
      } else if (blueCardOnly) {
        logMsgs.push(`⊘ 조건4 (Blue Card만): 카드 정보 없음`);
      } else {
        logMsgs.push(`⊘ 조건4 (Blue Card만): 비활성화`);
      }
      
      logMsgs.push('---');
      
      const now = Date.now();
      
      if (canBuy) {
        try {
          // 매수 실행
          FlowDashboard.executeBuy();
          
          // ✅ 매수 성공 → 이력 기록
          if (currentCard?.coin) {
            window.autoBuyHistory[currentCard.coin] = now;
            window.autoBuyMaxMap = window.autoBuyMaxMap || {};
            window.autoBuyMaxMap[currentCard.coin] = currentCard.nbMax || currentCard.max;
            window.autoBuyGradeMap = window.autoBuyGradeMap || {};
            window.autoBuyGradeMap[currentCard.coin] = {
              grade: currentCard.grade || currentCard.rating || 'F',
              enhance: currentCard.enhance || 0
            };
            logMsgs.push(`✅ 매수 성공: ${currentCard.coin} (${currentCard.grade || currentCard.rating || 'F'}+${currentCard.enhance || 0}) - N/B Max: ${currentCard.nbMax || currentCard.max}`);
          }
          
          // ===== 매수 성공 후 다시 WAIT 단계로 복귀 =====
          logMsgs.push(`🔄 매수 성공 → 대기 단계로 복귀 (${waitTimeSec}초 대기)`);
          this.phase = 'WAIT';
          this.waitStartTime = now;
          this.waitDurationMs = waitTimeSec * 1000;
          this.lastCheckedCardId = null; // 중복 체크 초기화
        } catch (e) {
          console.error('Auto Buy 실행 오류:', e);
          logMsgs.push(`❌ 매수 실패: ${e.message}`);
        }
      } else {
        logMsgs.push(`⏭️ 매수 스킵: ${reason}`);
      }
      
      // 로그 출력 (콘솔 + UI)
      const logMessage = logMsgs.join('\n');
      console.log(logMessage);
      this.addLog(logMessage);
    },

    resume() {
      // 저장된 시간 정보 복원
      const savedStartTime = localStorage.getItem('autoBuy_startTime');
      const savedDurationMs = localStorage.getItem('autoBuy_durationMs');
      
      if (!savedStartTime || !savedDurationMs) {
        console.log('⚠️ 저장된 시간 없음, 새로 시작');
        this.start();
        return;
      }
      
      const startTime = Number(savedStartTime);
      const durationMs = Number(savedDurationMs);
      const now = Date.now();
      const elapsed = now - startTime;
      const remain = durationMs - elapsed;
      
      if (remain <= 0) {
        console.log('⚠️ 이미 시간 지남, 새로 시작');
        this.start();
        return;
      }
      
      // 남은 시간으로 재시작
      this.durationMs = durationMs;
      this.startTime = startTime;  // 원래 시작 시간 유지
      this.running = true;
      
      if (this.elements.toggleBtn) this.elements.toggleBtn.textContent = '⏹️ 중지';
      if (this.elements.statusBadge) {
        this.elements.statusBadge.classList.remove('bg-secondary');
        this.elements.statusBadge.classList.add('bg-success');
        this.elements.statusBadge.textContent = 'ON';
      }
      const wrap = document.getElementById('autoBuyUiWrap');
      if (wrap) wrap.style.display = 'block';
      if (this.elements.progressBar) {
        const pct = Math.min(100, Math.max(0, (elapsed / durationMs) * 100));
        this.elements.progressBar.style.width = `${pct}%`;
      }
      if (this.elements.countdownLabel) this.elements.countdownLabel.textContent = `다음 매수까지 ${this.formatMmSs(remain)}`;
      
      // 기존 타이머 정리 후 새로 시작 (중복 방지)
      if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
      this.timerId = setInterval(() => this.tick(), 1000);
      
      console.log('▶️ Auto Buy 재시작 (남은 시간:', this.formatMmSs(remain), ')');
    },
    
    async start() {
      if (this.running) return;
      this.durationMs = this.getIntervalMs();
      this.startTime = Date.now();
      this.running = true;
      
      // 실행 상태 및 시간 저장
      localStorage.setItem('autoBuy_running', 'true');
      localStorage.setItem('autoBuy_startTime', String(this.startTime));
      localStorage.setItem('autoBuy_durationMs', String(this.durationMs));
      
      if (this.elements.toggleBtn) this.elements.toggleBtn.textContent = '⏹️ 중지';
      if (this.elements.statusBadge) {
        this.elements.statusBadge.classList.remove('bg-secondary');
        this.elements.statusBadge.classList.add('bg-success');
        this.elements.statusBadge.textContent = 'ON';
      }
      const wrap = document.getElementById('autoBuyUiWrap');
      if (wrap) wrap.style.display = 'block';
      
      // 모드에 따라 다르게 초기화
      const waitTimeSec = parseInt(this.elements.waitTimeInput?.value || '0', 10);
      const intervalSec = parseInt(this.elements.intervalSel?.value || '600', 10);
      
      // ===== 항상 WAIT 단계로 시작 =====
      this.phase = 'WAIT';
      this.waitStartTime = Date.now();
      this.waitDurationMs = waitTimeSec * 1000;
      this.buyingIntervalMs = intervalSec * 1000;
      console.log(`⏳ WAIT 단계 시작 (${waitTimeSec}초 대기 후 ${intervalSec}초 주기로 매수 시도)`);
      
      // 기존 타이머 정리 후 새로 시작 (중복 방지)
      if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
      this.timerId = setInterval(() => this.tick(), 1000);
      
      console.log('▶️ Auto Buy 시작');
      
      // 서버에 enabled=true 전송
      try {
        const resp = await fetch('/api/auto-buy/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true })
        });
        const data = await resp.json();
        console.log('💾 서버 Auto Buy ON 저장:', data);
      } catch (err) {
        console.warn('서버 Auto Buy 설정 저장 실패:', err);
      }
    },

    async stop() {
      if (!this.running) return;
      this.running = false;
      
      // 실행 상태 저장 및 시간 정보 삭제
      localStorage.setItem('autoBuy_running', 'false');
      localStorage.removeItem('autoBuy_startTime');
      localStorage.removeItem('autoBuy_durationMs');
      
      if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
      if (this.elements.toggleBtn) this.elements.toggleBtn.textContent = '▶️ 시작';
      if (this.elements.statusBadge) {
        this.elements.statusBadge.classList.remove('bg-success');
        this.elements.statusBadge.classList.add('bg-secondary');
        this.elements.statusBadge.textContent = 'OFF';
      }
      const wrap = document.getElementById('autoBuyUiWrap');
      if (wrap) wrap.style.display = 'none';
      
      console.log('⏹️ Auto Buy 중지');
      
      // 서버에 enabled=false 전송
      try {
        const resp = await fetch('/api/auto-buy/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false })
        });
        const data = await resp.json();
        console.log('💾 서버 Auto Buy OFF 저장:', data);
      } catch (err) {
        console.warn('서버 Auto Buy 설정 저장 실패:', err);
      }
    }
  };

  // ============================================================================
  // 자동저장 및 스냅샷 함수 구현 (init에서 공개)
  // ============================================================================
  autoSaveCurrentCardFn = async function() {
    if (!window.ccCurrentData) return;
    try {
      if (window.isAutoSaving) return;
      window.isAutoSaving = true;
      const savePayload = {
        ...window.ccCurrentData,
        market: window.ccCurrentData.market || null,
        coin: window.ccCurrentData.market || null,
        card_rating: window.ccCurrentRating || {},
        nb_zone: {
          zone: window.ccCurrentData.zone || state.currentZone || 'NONE',
          zone_flag: window.ccCurrentData.zone_flag || 0,
          zone_conf: window.ccCurrentData.zone_conf || 0.0,
          dist_high: window.ccCurrentData.dist_high || 0.0,
          dist_low: window.ccCurrentData.dist_low || 0.0
        },
        ml_trust: {
          grade: document.getElementById('ccMlGrade')?.textContent || '-',
          enhancement: document.getElementById('ccMlEnhancement')?.textContent?.replace(/\D/g, '') || '0',
          trust_score: window.ccCurrentData.ml_trust_score
        },
        realized_pnl: {
          avg: parseFloat(document.getElementById('ccRealizedAvg')?.textContent?.replace(/[^0-9.-]/g, '') || '0'),
          max: parseFloat(document.getElementById('ccRealizedMax')?.textContent?.replace(/[^0-9.-]/g, '') || '0')
        },
        nb_wave: {
          r: window.ccCurrentData.r,
          w: window.ccCurrentData.w,
          ema_diff: window.ccCurrentData.ema_diff,
          pct_blue: window.ccCurrentData.pct_blue,
          pct_orange: window.ccCurrentData.pct_orange,
          extreme_gap: window.ccCurrentData.extreme_gap,
          zones_array: window.nbWaveZonesConsole || [],
          current_zone: state.currentZone,
          nb_stats: state.nbStats || {}
        }
      };
      
      const result = await postJson('/api/nbverse/save', savePayload);
      if (result && result.ok) {
        ccLastNbversePath = result.paths?.[0] || result.path || ccLastNbversePath;
        window.ccLastNbversePath = ccLastNbversePath;
        console.log('✅ 자동 저장 완료:', savePayload.interval, `(${result.count || 1}개 경로)`);
        const hint = document.getElementById('ccSaveHint');
        if (hint) hint.textContent = `✅ 저장 완료 (${result.count || 1}개)`;
        window.lastAutoSaveTs = Date.now();
        window.isAutoSaving = false;
        
        if (window.ccCurrentRating && window.ccCurrentRating.enhancement) {
          triggerAutoTraining(window.ccCurrentData, window.ccCurrentRating.enhancement);
        }
      } else {
        console.warn('⚠️ 자동 저장 실패:', result?.error || 'Unknown');
        window.isAutoSaving = false;
      }
    } catch (err) {
      console.warn('⚠️ 자동 저장 에러:', err?.message);
      window.isAutoSaving = false;
    }
  };

  addCurrentWinSnapshotFn = function(interval) {
    try {
      const cc = window.ccCurrentData || window.ccCurrentData;
      const cr = window.ccCurrentRating || window.ccCurrentRating;
      if (!cc || !cr) {
        console.log('⏭️ Skipping snapshot: missing cc or cr', {cc: !!cc, cr: !!cr});
        return;
      }

      const tf = interval || state.selectedInterval || cc.interval || 'minute10';
      const nowIso = new Date().toISOString();
      
      let zone = null;
      if (Array.isArray(window.nbWaveZonesConsole) && window.nbWaveZonesConsole.length > 0) {
        zone = window.nbWaveZonesConsole[window.nbWaveZonesConsole.length - 1];
      }
      if (!zone || zone === 'NONE') {
        const nbStats = state.nbStats || {};
        zone = nbStats.zone || state.currentZone || window.ccCurrentZone || (state.mlStats && state.mlStats.mlZone) || 'NONE';
      }
      if (!zone || zone === 'NONE') {
        console.log('⏭️ Skipping snapshot: no zone detected');
        return;
      }

      const last = winClientHistory[0];
      if (last) {
        const dt = Math.abs(new Date(nowIso).getTime() - new Date(last.ts).getTime());
        if (last.tf === tf && last.code === cr.code && dt < 2000) return;
      }

      const waveR = (state.nbStats && typeof state.nbStats.rValue === 'number') ? state.nbStats.rValue : (cc.r ?? null);
      const waveW = (state.nbStats && typeof state.nbStats.w === 'number') ? state.nbStats.w : (cc.w ?? null);
      
      const zoneArray = window.nbWaveZonesConsole && window.nbWaveZonesConsole.length > 0
        ? window.nbWaveZonesConsole
        : (state.zoneSeries && state.zoneSeries.length > 0 ? state.zoneSeries : []);

      const entry = {
        ts: nowIso,
        tf,
        zone,
        code: cr.code,
        league: cr.league,
        group: cr.group,
        super: !!cr.super,
        avgPts: cr.avgPts,
        enhancement: cr.mlEnhancement || cr.enhancement || 1,
        mlGrade: cr.mlGrade || null,
        mlEnhancement: cr.mlEnhancement || null,
        price: cc.current_price || 0,
        waveR: waveR,
        waveW: waveW,
        spark: Array.isArray(cc?.nb?.price?.values) ? cc.nb.price.values.slice(-30) : [],
        zonesArray: zoneArray
      };

      winClientHistory.unshift(entry);
      winClientHistory = winClientHistory.slice(0, 24);
      window.winClientHistory = winClientHistory;

      try {
        if (typeof ScriptAI !== 'undefined' && ScriptAI && typeof ScriptAI.onSnapshotAdded === 'function') {
          ScriptAI.onSnapshotAdded(entry);
        }
      } catch(_) {}
      renderWinPanel();
    } catch (e) {
      console.warn('addCurrentWinSnapshot error:', e?.message);
    }
  };

  // ============================================================================
  // Public Interface
  // ============================================================================
  return {
    state,
    ProgressCycle, // Export ProgressCycle for external access
    
    init() {
      console.log('Flow Dashboard initialized');
      
      // State 스냅샷 복원 (페이지 로드 시)
      const stateSnapshot = localStorage.getItem('dashboardStateSnapshot');
      if (stateSnapshot) {
        try {
          const snapshot = JSON.parse(stateSnapshot);
          console.log('📦 State snapshot found:', snapshot.timestamp);
          
          // State 데이터 복원
          state.selectedInterval = snapshot.selectedInterval || state.selectedInterval;
          state.currentTfIndex = snapshot.currentTfIndex || state.currentTfIndex;
          state.marketData = snapshot.marketData;
          state.nbStats = snapshot.nbStats;
          window.ccCurrentData = snapshot.currentCard;
          window.ccCurrentRating = snapshot.currentRating;
          
          console.log('✅ State restored - Interval:', state.selectedInterval);
        } catch (err) {
          console.warn('⚠️ State snapshot restore error:', err?.message);
        }
      }
      
      // 데이터 로딩 시작 (Step 1부터 시작, 차트 새로 렌더링)
      this.initializeData();
      // Bind Auto Buy UI
      try { AutoBuy.bindUI(); } catch (_) {}
      
      // ✅ 자동저장 및 스냅샷 함수를 전역 범위로 노출
      window.autoSaveCurrentCard = autoSaveCurrentCardFn;
      window.addCurrentWinSnapshot = addCurrentWinSnapshotFn;
      window.ccLastNbversePath = ccLastNbversePath;
      
      // Auto refresh 비활성화 (10단계 자동 사이클이 있으므로 불필요)
      // setInterval(() => {
      //   DataManager.loadDashboardStats();
      // }, 10000);
    },
    
    async initializeData() {
      try {
        console.log('=== Starting initialization ===');
        
        // 1번: 분봉 선택 (1분봉부터 순차적으로)
        ProgressCycle.startStep(1);
        console.log('Step 1 started: Timeframe selection');
        
        // 분봉 자동 순회
        state.selectedInterval = state.timeframes[state.currentTfIndex];
        $('.timeframe-btn').removeClass('active');
        $(`.timeframe-btn[data-interval="${state.selectedInterval}"]`).addClass('active');
        
        await new Promise(resolve => setTimeout(resolve, 500));
        ProgressCycle.completeStep(1, state.selectedInterval);
        console.log('Step 1 completed: Timeframe selected -', state.selectedInterval);
        
        // 2번: ML Trust 데이터 로딩
        ProgressCycle.startStep(2);
        console.log('Step 2 started: Loading ML trust data');
        const mlResult = await DataManager.refreshMarketData();
        console.log('ML API 전체 응답:', mlResult);
        let step2Success = false;
        
        if (mlResult.success && mlResult.mlTrust > 0) {
          const zoneEmoji = mlResult.mlZone === 'BLUE' ? '🔵' : mlResult.mlZone === 'ORANGE' ? '🟠' : '⚪';
          ProgressCycle.completeStep(2, `${zoneEmoji} ${mlResult.mlZone} ${mlResult.mlTrust.toFixed(1)}%`);
          console.log('Step 2 completed: ML trust data loaded');
          step2Success = true;
          
          // 즉시 다음 단계로 진행 (응답 대기 없음)
          console.log('Step 2 completed, proceeding to Step 3 immediately');
        } else {
          const failReason = !mlResult.success ? '데이터 로드 실패' : 'Trust 값이 0%';
          ProgressCycle.failStep(2, failReason);
          console.warn('Step 2 failed:', failReason);
          console.log('ML API 응답 상세:', mlResult);
        }
        
        // Step 2가 성공한 경우에만 Step 3 실행
        if (step2Success) {
          // 3번: N/B Zone Status 로딩
          ProgressCycle.startStep(3);
          console.log('Step 3 started: Loading N/B zone status');
          const zoneResult = await DataManager.loadDashboardStats();
          console.log('N/B Zone API 전체 응답:', zoneResult);
          
          // Save N/B wave data for later use in Step 5 (current card)
          state.savedNbWaveData = {
            zone: state.nbStats?.zone,
            rValue: state.nbStats?.rValue,
            w: state.nbStats?.w,
            nbTrust: state.nbStats?.nbTrust,
            maxBit: state.nbStats?.maxBit,
            minBit: state.nbStats?.minBit,
            zoneSeries: state.zoneSeries
          };
          window.flowDashboardState = state;  // Update window reference
          console.log('💾 Saved N/B wave data for current card:', state.savedNbWaveData);
          
          if (zoneResult.success && zoneResult.currentZone !== 'NONE') {
            const zoneEmoji = zoneResult.currentZone === 'BLUE' ? '🔵' : zoneResult.currentZone === 'ORANGE' ? '🟠' : '⚪';
            ProgressCycle.completeStep(3, `${zoneEmoji} ${zoneResult.currentZone} ${zoneResult.nbTrust?.toFixed(1) || 0}%`);
            console.log('Step 3 completed: Zone status loaded');
            
            // 즉시 다음 단계로 진행 (응답 대기 없음)
            console.log('Step 3 completed, proceeding to Step 4 immediately');
          } else {
            const failReason = !zoneResult.success ? 'Zone 데이터 로드 실패' : 'Zone이 NONE';
            ProgressCycle.failStep(3, failReason);
            console.warn('Step 3 failed:', failReason);
            console.log('N/B Zone API 응답 상세:', zoneResult);
            return; // Step 3 실패 시 중단
          }
        } else {
          console.log('Step 2 failed, skipping Step 3 and beyond');
          return; // Step 2 실패 시 완전히 중단
        }
        
        // 4번: 차트 렌더링
        ProgressCycle.startStep(4);
        console.log('Step 4 started: Chart rendering');
        try {
          const chartData = await API.getChartData(state.selectedInterval);
          const rows = chartData?.data || [];
          console.log('📊 Step 4 - OHLCV rows:', rows.length, 'ok:', chartData?.ok);
          
          if (chartData && rows.length > 0) {
            // 실제 차트 렌더링 (내부에서 state.nbWave 계산 및 저장)
            // ⚠️ N/B WAVE 완료를 기다립니다
            await UI.renderPriceChart(chartData);
            console.log('✅ 차트 및 N/B WAVE 렌더링 완료');
            
            // 차트 렌더링 후 Step 1 zone status를 차트 wave와 동기화
            if (state.nbWave?.data?.length) {
              const base = Number(state.nbWave.base);
              const targetCount = state.zoneSeries?.length || state.nbWave.data.length;
              const lastN = Math.min(targetCount, state.nbWave.data.length);
              const waveSlice = state.nbWave.data.slice(state.nbWave.data.length - lastN);
              
              let waveBlue = 0, waveOrange = 0;
              waveSlice.forEach(pt => {
                const v = Number(pt.value);
                if (!Number.isFinite(v)) return;
                if (v > base) waveOrange += 1; else waveBlue += 1;
              });
              
              state.waveSegmentCount = lastN;
              
              // Current zone도 wave 기반으로 업데이트
              const lastPt = state.nbWave.data[state.nbWave.data.length - 1];
              const lastVal = Number(lastPt.value);
              if (Number.isFinite(lastVal)) {
                const updatedZone = lastVal > base ? 'ORANGE' : 'BLUE';
                state.currentZone = updatedZone;
                $('#currentZone').text(updatedZone);
                UI.updateZoneBadge('#nbZone', updatedZone);

                // Sync nbStats to chart-computed wave (Step 4 becomes the single source)
                const lastRatio = typeof lastPt.ratio === 'number'
                  ? lastPt.ratio
                  : (lastVal > base ? 0.75 : 0.25);
                state.nbStats = {
                  ...state.nbStats,
                  zone: updatedZone,
                  rValue: lastRatio,
                  w: 1 - lastRatio
                };
              }
              
              // Step 1 zone count와 zone chart 업데이트 (차트 wave와 완전 동일)
              const existingZones = Array.isArray(state.nbWaveZones) && state.nbWaveZones.length === state.nbWave.data.length
                ? state.nbWaveZones
                : null;
              const syncedZoneSeries = state.nbWave.data.map((pt, idx) => {
                const zoneFromArray = existingZones ? existingZones[idx] : null;
                const zone = zoneFromArray || pt.zone || ((Number(pt.value) > base) ? 'ORANGE' : 'BLUE');
                return { zone, r_value: typeof pt.ratio === 'number' ? pt.ratio : null };
              });
              state.zoneSeries = syncedZoneSeries;
              // Also preserve pure zone array for card reuse
              state.nbWaveZones = syncedZoneSeries.map(z => z.zone);

              $('#zoneCount').text(`${waveBlue}B / ${waveOrange}O`);
              UI.renderZoneChart();

              // Persist the synced data for Step 5 (current card) reuse
              state.savedNbWaveData = {
                zone: state.nbStats.zone,
                rValue: state.nbStats.rValue,
                w: state.nbStats.w,
                nbTrust: state.nbStats.nbTrust,
                maxBit: state.nbStats.maxBit,
                minBit: state.nbStats.minBit,
                zoneSeries: syncedZoneSeries
              };
              
              // Chart status 업데이트
              $('#chartDetail').text(`차트 데이터 ${lastN}개 활성`);
              
              console.log('✅ Step 1 zone status synced with chart wave:', { lastN, waveBlue, waveOrange });
            }
            
            ProgressCycle.completeStep(4, `${rows.length}개 캔들`);
            console.log('✅ Step 4 completed: Chart rendered with', rows.length, 'candles');
          } else {
            console.error('❌ Step 4 - Chart data validation failed:', {
              hasData: !!chartData,
              ok: chartData?.ok,
              rowsLength: rows.length
            });
            ProgressCycle.failStep(4, '차트 데이터 없음');
            return;
          }
        } catch (error) {
          console.error('❌ Step 4 error:', error);
          ProgressCycle.failStep(4, error.message);
          return;
        }
        
        // 5번: 현재 카드 생성
        ProgressCycle.startStep(5);
        console.log('Step 5 started: Current card generation');
        try {
          const [buyCardsRes, sellCardsRes, cardData] = await Promise.all([
            API.getBuyCards(),
            API.getSellCards(),
            API.getNbverseCard(state.selectedInterval)
          ]);

          // Use saved N/B wave data from Step 3 (ensures consistency)
          if (state.savedNbWaveData) {
            console.log('✅ Using saved N/B wave data from Step 3 for current card');
            // Override state.nbStats with saved data to ensure consistency
            state.nbStats = {
              zone: state.savedNbWaveData.zone,
              rValue: state.savedNbWaveData.rValue,
              w: state.savedNbWaveData.w,
              nbTrust: state.savedNbWaveData.nbTrust,
              maxBit: state.savedNbWaveData.maxBit,
              minBit: state.savedNbWaveData.minBit
            };
            state.currentZone = state.savedNbWaveData.zone;
            if (state.savedNbWaveData.zoneSeries) {
              state.zoneSeries = state.savedNbWaveData.zoneSeries;
            }
          }

          // 안전한 카운트 추출
          const buyOrders = Array.isArray(buyCardsRes?.cards) ? buyCardsRes.cards : [];
          const sellOrders = Array.isArray(sellCardsRes?.cards) ? sellCardsRes.cards : [];

          const buyCount = typeof buyCardsRes?.count === 'number'
            ? buyCardsRes.count
            : buyOrders.length;
          const sellCount = typeof sellCardsRes?.count === 'number'
            ? sellCardsRes.count
            : sellOrders.length;
          
          // 카드 카운트 표시
          $('#buyCardCount').text(buyCount);
          $('#sellCardCount').text(sellCount);
          
          // NBverse 카드 소스: 기본 NBverse 카드 우선 사용 (buy 카드는 참고만)
          const fallbackCardLen = Array.isArray(cardData?.chart) ? cardData.chart.length : 0;
          
          console.log('📦 Step 5 NBverse card data:', {
            ok: cardData?.ok,
            chartLen: fallbackCardLen,
            hasNb: !!cardData?.nb,
            hasPriceValues: !!cardData?.nb?.price?.values
          });

          if (cardData?.ok && fallbackCardLen > 0) {
            UI.renderCurrentCard(cardData, state.selectedInterval);
            console.log('✅ Current card rendered successfully');
          } else {
            console.warn('⚠️ Current card: No valid NBverse data', { ok: cardData?.ok, length: fallbackCardLen });
          }
          
          ProgressCycle.completeStep(5, `Buy ${buyCount} / Sell ${sellCount}`);
          console.log('Step 5 completed: Current card loaded');
        } catch (error) {
          console.error('Step 5 error:', error);
          ProgressCycle.failStep(5, error.message);
          return;
        }
        
        // 6번: Win% 계산 및 현재 카드 스냅샷 추가
        ProgressCycle.startStep(6);
        console.log('Step 6 started: Win% snapshot and calculation');
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
        try {
          // 현재 카드 스냅샷 추가
          try {
            addCurrentWinSnapshot(state.selectedInterval);
            console.log('✅ Step 6 - Current card snapshot added');
          } catch (e) {
            console.warn('⚠️ Step 6 - Snapshot add failed:', e?.message);
          }
          
          // Win% 계산 (현재 카드 스냅샷 기반)
          // Win% 계산 (현재 카드 스냅샷 기반)
          const client = Array.isArray(winClientHistory) ? winClientHistory : [];
          const blueCount = client.filter(s => s.zone === 'BLUE').length;
          const orangeCount = client.filter(s => s.zone === 'ORANGE').length;
          const totalCount = client.length;
          const winRate = totalCount ? (blueCount / totalCount * 100) : 0;
          
          // Win% 표시
          $('#winFillBar').css('width', `${winRate}%`);
          
          // Major zone 표시
          const majorZone = blueCount >= orangeCount ? 'BLUE' : 'ORANGE';
          $('#winMajor').text(majorZone)
            .removeClass('bg-white text-dark')
            .addClass(majorZone === 'BLUE' ? 'zone-blue' : 'zone-orange');
          
          // Local/Server count badges
          $('#winLocalCount').text(totalCount);
          $('#winServerCount').text(0);
          
          // Zone consistency info
          const nbZoneEmoji = majorZone === 'BLUE' ? '🔵' : '🟠';
          const mlZoneEmoji = majorZone === 'BLUE' ? '🔵' : '🟠';
          $('#nbZoneDisplay').html(`${nbZoneEmoji}${majorZone}`);
          $('#mlZoneDisplay').html(`${mlZoneEmoji}${majorZone}`);
          
          // Win list 렌더링 (클라이언트 스냅샷만)
          UI.renderWinList();
          
          ProgressCycle.completeStep(6, `${winRate.toFixed(1)}% (${totalCount}개)`);
          console.log('Step 6 completed: Win% snapshot added and calculated');
          // Step 6 대기 중 현재 카드 정보 1회 갱신
          try {
            const refreshData = await API.getNbverseCard(state.selectedInterval, 300, false);
            if (refreshData?.ok) {
              UI.refreshCurrentCardInfo(refreshData, state.selectedInterval);
              console.log('🔄 Step 6 - Current card info refreshed');
            }
          } catch (e) {
            console.warn('Step 6 current card refresh failed:', e?.message);
          }

          // Step 6 완료 후 즉시 다음 단계 진행 (대기 제거)
        } catch (error) {
          console.error('Step 6 error:', error);
          ProgressCycle.failStep(6, error.message);
          return;
        }
        
        // 7번: 자산 조회 (Asset Loading)
        ProgressCycle.startStep(7);
        console.log('Step 7 started: Asset loading');
        try {
          await loadAssets7();
          ProgressCycle.completeStep(7, '자산 조회 완료');
        } catch (error) {
          console.error('Step 7 error:', error);
          ProgressCycle.failStep(7, error.message);
        }

        // 8번: 매수 완료 카드 (Buy Cards Loading)
        ProgressCycle.startStep(8);
        console.log('Step 8 started: Buy cards loading');
        try {
          const s8 = await loadBuyCards8();
          const detail8 = s8?.hasBuyCards
            ? (s8.loadedNbverse ? '매수 카드 완료' : '매수 카드 있음')
            : '매수 카드 없음';
          ProgressCycle.completeStep(8, detail8);
        } catch (error) {
          console.error('Step 8 error:', error);
          ProgressCycle.failStep(8, error.message);
          return; // 매수 카드가 있으나 NBverse 렌더 실패 등 치명적 오류 시 중단
        }

        // 9번: 매도 완료 카드 (Sell Cards Loading)
        ProgressCycle.startStep(9);
        console.log('Step 9 started: Sell cards loading');
        try {
          await loadSellCards9();
          ProgressCycle.completeStep(9, '매도 카드 완료');
        } catch (error) {
          console.error('Step 9 error:', error);
          ProgressCycle.failStep(9, error.message);
        }

        // 10번: State 데이터 저장 (차트는 새로 렌더링)
        ProgressCycle.startStep(10);
        console.log('Step 10 started: Saving state data...');
        
        try {
          // 필요한 State 데이터만 저장
          const stateSnapshot = {
            timestamp: new Date().toISOString(),
            selectedInterval: state.selectedInterval,
            currentTfIndex: state.currentTfIndex,
            marketData: state.marketData,
            nbStats: state.nbStats,
            currentCard: window.ccCurrentData,
            currentRating: window.ccCurrentRating
          };
          
          localStorage.setItem('dashboardStateSnapshot', JSON.stringify(stateSnapshot));
          console.log('✅ State snapshot saved at Step 10');
        } catch (err) {
          console.warn('⚠️ State snapshot save error:', err?.message);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
        ProgressCycle.completeStep(10);
        console.log('Step 10 completed: State saved');
        
        console.log('=== Initialization complete, moving to next timeframe ===');
        // 전체 순환 완료 후 다음 분봉으로 이동
        setTimeout(() => {
          state.currentTfIndex = (state.currentTfIndex + 1) % state.timeframes.length;
          state.selectedInterval = state.timeframes[state.currentTfIndex];
          
          console.log('Switching to next timeframe:', state.selectedInterval);
          $('.timeframe-btn').removeClass('active');
          $(`.timeframe-btn[data-interval="${state.selectedInterval}"]`).addClass('active');
          
          // 프로그레스 리셋 후 다시 1번부터 시작
          ProgressCycle.reset();
          this.initializeData();
        }, 1000);
      } catch (error) {
        console.error('Initialization error:', error);
        $('#systemStatus').text('초기화 오류');
      }
    },

    async selectTimeframe(interval) {
      state.selectedInterval = interval;
      
      $('.timeframe-btn').removeClass('active');
      $(`.timeframe-btn[data-interval="${interval}"]`).addClass('active');
      
      console.log('Timeframe changed to:', interval);
      
      // 1번: 분봉 선택
      ProgressCycle.startStep(1);
      await new Promise(resolve => setTimeout(resolve, 300));
      const step1Complete = ProgressCycle.completeStep(1, interval);
      console.log('Step 1 completed: Timeframe selected');
      
      // 1번이 완료되었을 때만 2번으로 진행
      if (step1Complete) {
        // 2번: ML Trust 데이터 재로딩
        ProgressCycle.startStep(2);
        console.log('Step 2 started: Reloading ML trust data');
        const mlResult = await DataManager.refreshMarketData();
        if (mlResult.success) {
          const step2Complete = ProgressCycle.completeStep(2, `${mlResult.mlTrust}% ${mlResult.mlZone}`);
          console.log('Step 2 completed: ML trust data reloaded');
          
          // 2번이 완료되었을 때만 3번으로 진행
          if (step2Complete) {
            // 3번: N/B Zone Status 재로딩
            ProgressCycle.startStep(3);
            console.log('Step 3 started: Reloading zone status');
            const zoneResult = await DataManager.loadDashboardStats();
            if (zoneResult.success) {
              ProgressCycle.completeStep(3, `${zoneResult.currentZone} ${zoneResult.nbTrust}%`);
              console.log('Step 3 completed: Zone status reloaded');
            }
          }
        }
      }
    },

    refreshMarketData() {
      return DataManager.refreshMarketData();
    },

    refreshCards() {
      return DataManager.refreshCards();
    },

    jumpToStep(stepNum) {
      if (stepNum <= state.currentStep) {
        StepManager.activateStep(stepNum);
        
        const stepCard = $('#step' + stepNum);
        if (stepCard.length) {
          $('html, body').animate({
            scrollTop: stepCard.offset().top - 100
          }, 500);
        }
      }
    },

    proceedToStep2() {
      return StepManager.proceedToStep2();
    },

    proceedToStep3() {
      return StepManager.proceedToStep3();
    },

    backToStep1() {
      StepManager.backToStep1();
    },

    backToStep2() {
      StepManager.backToStep2();
    },

    executeBuy() {
      return Trade.executeBuy();
    },

    executeSell() {
      return Trade.executeSell();
    },

    executeBuyPaper() {
      return Trade.executeBuyPaper();
    },

    saveCurrentCard() {
      try { 
        if (typeof window.autoSaveCurrentCard === 'function') {
          window.autoSaveCurrentCard(); 
        }
      } catch(e) { console.warn('manual save error:', e?.message); }
    },

    resetFlow() {
      state.currentStep = 1;
      state.marketData = null;
      state.signalData = null;
      state.tradeData = null;
      state.nbWaveCached = null; // Clear cached NB Wave data
      StepManager.activateStep(1);
      DataManager.refreshMarketData();
    },

    viewTradeHistory() {
      window.open('/api/orders', '_blank');
    },

    // Auto Buy controls
    autoBuyStart() { try { AutoBuy.start(); } catch (_) {} },
    autoBuyStop() { try { AutoBuy.stop(); } catch (_) {} },
    
    // Memory monitoring (logs every 30 seconds if memory available)
    startMemoryMonitoring() {
      if (!window.memoryMonitoringInterval) {
        window.memoryMonitoringInterval = setInterval(() => {
          try {
            if (performance.memory) {
              const used = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
              const limit = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2);
              const pct = ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1);
              console.log(`💾 Memory: ${used}MB / ${limit}MB (${pct}%)`);
              // If memory usage exceeds 80% of limit, trigger cleanup
              if (parseFloat(pct) > 80) {
                console.warn('⚠️ High memory usage detected, clearing caches');
                window.candleDataCache = (window.candleDataCache || []).slice(-200); // Keep only recent
                window.nbWaveZonesConsole = null;
              }
            }
          } catch(e) { /* memory API not available */ }
        }, 30000); // Check every 30 seconds
      }
    }
  };
})();

// Expose globally for inline handlers and external calls
window.FlowDashboard = FlowDashboard;

// ============================================================================
// 수수료 관리 함수 (전역)
// ============================================================================
function getTradingFeeRate() {
  try {
    const input = document.getElementById('tradingFeeRate');
    if (!input) return 0.0005; // 기본값: 0.05%
    const value = parseFloat(input.value) / 100; // %를 소수로 변환
    return isNaN(value) || value < 0 ? 0.0005 : value;
  } catch(_) {
    return 0.0005;
  }
}

function updateTotalFeeDisplay() {
  try {
    const feeRate = getTradingFeeRate();
    const totalFee = (feeRate * 2 * 100).toFixed(2); // 매수+매도 합계 %
    const display = document.getElementById('totalFeeDisplay');
    if (display) {
      display.textContent = totalFee + '%';
    }
  } catch(_) {}
}

window.getTradingFeeRate = getTradingFeeRate;
window.updateTotalFeeDisplay = updateTotalFeeDisplay;

// ===== STATE MANAGER EXPOSED =====
// 페이지 새로고침 전에 상태 저장 (StateManager가 모든 것을 처리)
window.addEventListener('beforeunload', function() {
  console.log('💾 Saving all state before page unload via StateManager...');
  stateManager.save(state);
});

// 콘솔에서 사용 가능: FlowDashboard.saveState(), FlowDashboard.loadState() 등
FlowDashboard.saveState = () => stateManager.save(state);
FlowDashboard.loadState = () => stateManager.load();
FlowDashboard.restoreState = () => stateManager.restore(state);
FlowDashboard.clearState = () => stateManager.clear();
FlowDashboard.getStateSize = () => stateManager.getSize();

// ============================================================================
// Step 7: 자산 조회
// ============================================================================

async function loadAssets7() {
  try {
    const now = new Date().toLocaleTimeString('ko-KR');
    // 서버 API만 사용하여 자산 요약 조회
    const resp = await fetch('/api/assets');
    const data = await resp.json();
    if (!resp.ok || !data || data.ok !== true) {
      throw new Error(data?.error || `HTTP ${resp.status}`);
    }

    const source = data.source || 'local';
    const assetTotal = Number(data.totalKRW || 0);
    const assetBuyable = Number(data.availableKRW || 0);
    const btcAmount = Number(data.btcAmount || 0);
    const currentValue = Number(data.btcValueKRW || 0);
    const lastPrice = Number(data.lastPrice || 0);
    const btcAvgPrice = Number(data.btcAvgPrice || 0);

    const elMeta = document.getElementById('assetsMeta');
    if (elMeta) elMeta.textContent = `업데이트: ${now} • ${source}`;
    const elTotal = document.getElementById('assetTotal');
    const elBuyable = document.getElementById('assetBuyable');
    const elBtcAmt = document.getElementById('assetBtcAmount');
    const elBtcVal = document.getElementById('assetBtcValue');
    const elBtcAvg = document.getElementById('assetBtcAvg');
    // Sticky bar elements
    const elFooterTotal = document.getElementById('assetFooterTotal');
    const elFooterBuyable = document.getElementById('assetFooterBuyable');
    const elFooterAmt = document.getElementById('assetFooterAmt');
    const elFooterAvg = document.getElementById('assetFooterAvg');
    if (elTotal) elTotal.textContent = Math.round(assetTotal).toLocaleString() + ' KRW';
    if (elBuyable) elBuyable.textContent = Math.round(assetBuyable).toLocaleString() + ' KRW';
    if (elBtcAmt) elBtcAmt.textContent = `${btcAmount.toFixed(8)} BTC`;
    if (elBtcVal) elBtcVal.textContent = `${Math.round(currentValue).toLocaleString()} KRW`;
    if (elBtcAvg) elBtcAvg.textContent = btcAvgPrice > 0 ? Math.round(btcAvgPrice).toLocaleString() + ' KRW' : '-';
    if (elFooterTotal) elFooterTotal.textContent = Math.round(assetTotal).toLocaleString() + ' KRW';
    if (elFooterBuyable) elFooterBuyable.textContent = Math.round(assetBuyable).toLocaleString() + ' KRW';
    if (elFooterAmt) elFooterAmt.textContent = `${btcAmount.toFixed(8)} BTC`;
    if (elFooterAvg) elFooterAvg.textContent = btcAvgPrice > 0 ? Math.round(btcAvgPrice).toLocaleString() + ' KRW' : '-';

    // 스티키 바 항상 노출 (상단 메뉴 스타일)
    try {
      const sticky = document.getElementById('assetStickyBar');
      if (sticky) sticky.style.display = '';
    } catch (_) {}

    // 자산 바 렌더링
    renderAssetBars({
      assetTotal: assetTotal,
      assetBuyable: assetBuyable,
      assetSellable: btcAmount.toFixed(8),
      currentValue: currentValue,
      netSize: btcAmount
    });

    console.log('✅ Step 7 - 자산 조회 완료(API):', { source, assetTotal, assetBuyable, btcAmount, currentValue, lastPrice });
  } catch (err) {
    console.error('loadAssets7 error:', err);
  }
}

// Sticky asset bar: always shown
document.addEventListener('DOMContentLoaded', () => {
  const sticky = document.getElementById('assetStickyBar');
  if (sticky) sticky.style.display = '';
});

// ============================================================================
// 헬퍼: Step 8 상세 진행 메시지 업데이트
// ============================================================================
function updateStep8Status(subStep, message) {
  const statusEl = document.getElementById('systemStatus');
  if (statusEl) {
    statusEl.textContent = `Step 8-${subStep}: ${message}`;
  }
  console.log(`📍 Step 8-${subStep}: ${message}`);
}

// ============================================================================
// 요약 바/가격 공통 헬퍼
// ============================================================================
const SummaryState = { buyOrders: [], sellOrders: [], currentPrice: 0 };

// Deduplicate orders by uuid or (ts, price, size), prefer enriched records
function dedupeOrders(orders = []) {
  const map = new Map();
  (Array.isArray(orders) ? orders : []).forEach(o => {
    const key = o.uuid ? `uuid:${o.uuid}` : `ts:${o.ts}|p:${o.price}|s:${o.size}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, o);
    } else {
      // Prefer object with card_rating or nb/chart data
      const scoreExisting = (existing.card_rating ? 2 : 0) + (existing.nb || existing.chart ? 1 : 0);
      const scoreNew = (o.card_rating ? 2 : 0) + (o.nb || o.chart ? 1 : 0);
      if (scoreNew > scoreExisting) map.set(key, o);
    }
  });
  return Array.from(map.values());
}

function formatPriceForSummary(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '-';
  return Math.round(num).toLocaleString();
}

function computePriceStats(orders = []) {
  const list = Array.isArray(orders) ? orders : [];
  const prices = list
    .map(o => Number(o?.price || 0))
    .filter(v => Number.isFinite(v) && v > 0);

  if (!prices.length) return { avg: null, max: null, min: null };

  const sum = prices.reduce((a, b) => a + b, 0);
  return {
    avg: sum / prices.length,
    max: Math.max(...prices),
    min: Math.min(...prices)
  };
}

function computeWeightedPriceStats(orders = []) {
  const list = Array.isArray(orders) ? orders : [];
  const rows = list
    .map(o => ({ p: Number(o?.price || 0), s: Number(o?.size || 0) }))
    .filter(({ p, s }) => Number.isFinite(p) && p > 0 && Number.isFinite(s) && s > 0);

  if (!rows.length) return { avg: null, max: null, min: null };

  const totalNotional = rows.reduce((acc, { p, s }) => acc + p * s, 0);
  const totalSize = rows.reduce((acc, { s }) => acc + s, 0);
  const prices = rows.map(r => r.p);

  return {
    avg: totalSize > 0 ? totalNotional / totalSize : null,
    max: Math.max(...prices),
    min: Math.min(...prices)
  };
}

// Compute realized sell profit per order (KRW) and percentage using FIFO against buys
function computeSellProfitStats(buyOrders = [], sellOrders = []) {
  const sells = [...(Array.isArray(sellOrders) ? sellOrders : [])]
    .sort((a, b) => Number(a.time || a.ts || 0) - Number(b.time || b.ts || 0));
  if (!sells.length) return { avgPct: null, maxPct: null, minPct: null };

  // Prefer standalone sell card data if present
  const percentsFromSellOnly = [];
  const incomplete = [];
  for (const sell of sells) {
    const sellPrice = Number(sell.price || 0);
    const sellSize = Number(sell.size || 0);
    const buyPrice = Number(sell.orig_buy_avg_price || sell.orig_buy_price || 0);
    if (Number.isFinite(sellPrice) && sellPrice > 0 && Number.isFinite(sellSize) && sellSize > 0 && Number.isFinite(buyPrice) && buyPrice > 0) {
      const cost = buyPrice * sellSize;
      const proceeds = sellPrice * sellSize;
      const profit = proceeds - cost;
      const pct = cost > 0 ? (profit / cost) * 100 : 0;
      percentsFromSellOnly.push(pct);
    } else {
      incomplete.push(sell);
    }
  }

  let sellProfitPercents = percentsFromSellOnly;
  if (!sellProfitPercents.length && incomplete.length) {
    // Fallback to FIFO if sell-only data not available
    const sortedBuys = [...(Array.isArray(buyOrders) ? buyOrders : [])]
      .sort((a, b) => Number(a.time || a.ts || 0) - Number(b.time || b.ts || 0));
    const buyQueue = sortedBuys.map(o => ({ size: Number(o.size || 0), price: Number(o.price || 0) }))
      .filter(b => Number.isFinite(b.price) && b.price > 0 && Number.isFinite(b.size) && b.size > 0);
    sellProfitPercents = [];
    incomplete.forEach(sell => {
      let remain = Number(sell.size || 0);
      const sellPrice = Number(sell.price || 0);
      if (!Number.isFinite(sellPrice) || sellPrice <= 0 || !Number.isFinite(remain) || remain <= 0) return;
      let realizedCost = 0;
      let realizedProceeds = 0;
      while (remain > 0 && buyQueue.length > 0) {
        const buy = buyQueue[0];
        const qty = Math.min(remain, buy.size);
        realizedCost += buy.price * qty;
        realizedProceeds += sellPrice * qty;
        buy.size -= qty;
        remain -= qty;
        if (buy.size <= 0.00000001) buyQueue.shift();
      }
      if (remain > 0) {
        realizedProceeds += sellPrice * remain;
        remain = 0;
      }
      const profit = realizedProceeds - realizedCost;
      const pct = realizedCost > 0 ? (profit / realizedCost) * 100 : 0;
      sellProfitPercents.push(pct);
    });
  }

  if (!sellProfitPercents.length) return { avgPct: 0, maxPct: 0, minPct: 0 };

  const avgPct = sellProfitPercents.reduce((a, b) => a + b, 0) / sellProfitPercents.length;
  const maxPct = Math.max(...sellProfitPercents);
  const minPct = Math.min(...sellProfitPercents);

  return { avgPct, maxPct, minPct };
}

function getLatestPriceFromCache() {
  try {
    const lastCandle = (window.candleDataCache || []).slice(-1)[0];
    const val = Number(lastCandle?.close || lastCandle?.value || 0);
    if (Number.isFinite(val) && val > 0) return val;
  } catch (_) {}
  return 0;
}

async function resolveCurrentPrice(interval, fallbackOrders = []) {
  // 1) 캐시된 최신 캔들
  const cached = getLatestPriceFromCache();
  if (cached > 0) return cached;

  // 2) 매수/매도 리스트의 첫 가격 (데이터가 있을 때만)
  const orders = Array.isArray(fallbackOrders) ? fallbackOrders : [];
  const firstPrice = Number(orders[0]?.price || 0);
  if (Number.isFinite(firstPrice) && firstPrice > 0) return firstPrice;

  // 3) 서버 차트 데이터 조회
  try {
    const safeInterval = interval || 'minute10';
    const chartResp = await API.getChartData(safeInterval);
    const rows = Array.isArray(chartResp?.data) ? chartResp.data : [];
    const last = rows[rows.length - 1];
    const apiClose = Number(last?.close || 0);
    if (Number.isFinite(apiClose) && apiClose > 0) return apiClose;
  } catch (e) {
    console.warn('resolveCurrentPrice chart fetch failed:', e?.message);
  }

  return 0;
}

function updateTopSummaryBar({ buyOrders = [], sellOrders = [], currentPrice = 0 } = {}) {
  SummaryState.buyOrders = Array.isArray(buyOrders) ? buyOrders : [];
  SummaryState.sellOrders = Array.isArray(sellOrders) ? sellOrders : [];
  SummaryState.currentPrice = Number.isFinite(Number(currentPrice)) ? Number(currentPrice) : 0;

  // 평균은 체결수량 가중으로 계산하여 계좌 평균가와 일치시키고, max/min은 단순 가격 기준
  const buyStats = computeWeightedPriceStats(SummaryState.buyOrders);
  const sellPriceStats = computeWeightedPriceStats(SummaryState.sellOrders);
  const sellProfitStats = computeSellProfitStats(SummaryState.buyOrders, SummaryState.sellOrders);

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = formatPriceForSummary(val);
  };

  setVal('topAvgBuy', buyStats.avg);
  setVal('topMaxBuy', buyStats.max);
  setVal('topMinBuy', buyStats.min);
  // Show profit % stats for sell summary
  const setPct = (id, pctVal) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (pctVal === null || pctVal === undefined) {
      el.textContent = '-';
      return;
    }
    el.textContent = `${pctVal.toFixed(2)}%`;
  };
  setPct('topAvgSell', Number(sellProfitStats.avgPct || 0));
  setPct('topMaxSell', Number(sellProfitStats.maxPct || 0));
  setPct('topMinSell', Number(sellProfitStats.minPct || 0));
  setVal('topCurrentPrice', SummaryState.currentPrice);
}

function updateBuyCardSummary(buyOrders = []) {
  const stats = computeWeightedPriceStats(buyOrders);
  const setVal = (id, val, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = formatPriceForSummary(val);
    if (color) el.style.color = color;
  };
  setVal('buyCardAvg', stats.avg, '#00d1ff');
  setVal('buyCardMax', stats.max, '#0ecb81');
  setVal('buyCardMin', stats.min, '#9aa8c2');
}

// ============================================================================
// Step 8: 매수 완료 카드
// ============================================================================

async function loadBuyCards8() {
  let buyOrders = [];
  let processStep = 1;
  const UPBIT_FEE = 0.0005; // 업비트 0.05% 수수료 (매수/매도 각각)
  const startTime = Date.now();
  const MIN_DURATION = 1000; // 최소 1초 유지
  const currentInterval = window.FlowDashboard?.state?.selectedInterval || 'minute10';
  
  try {
    const now = new Date().toLocaleTimeString('ko-KR');
    document.getElementById('buyStatsTime').textContent = now;

    // ============================================================================
    // Step 8-1: 매수 된 카드 목록 갱신
    // ============================================================================
    switch (processStep) {
      case 1:
        updateStep8Status(1, '매수 카드 목록 조회 중...');
        try {
          const buyRes = await fetch('/api/cards/buy');
          const buyData = await buyRes.json();
          if (buyData && buyData.ok) {
            buyOrders = buyData.cards || [];
          }
        } catch (e) {
          console.error('Failed to load buy cards:', e);
          // localStorage에서 스냅샷 복원 시도
          try {
            const cachedSnapshot = localStorage.getItem('buyCardsSnapshot');
            if (cachedSnapshot) {
              buyOrders = JSON.parse(cachedSnapshot);
              console.log('💾 localStorage에서 매수 카드 복원:', buyOrders.length, '개');
            }
          } catch (_) {}
        }
        
        document.getElementById('buyCount').textContent = buyOrders.length;
        updateStep8Status(1, `매수 카드 목록 갱신 완료 ✅ (${buyOrders.length}개)`);
        processStep++;
        
        // ============================================================================
        // Step 8-2: 갱신된 카드 정보에서 가장 최근 순서부터 가격 기반 max 값 가져오기
        // ============================================================================
      case 2:
        updateStep8Status(2, '최근 순서로 정렬 중...');
        // 최신 순서로 정렬 (시간 내림차순)
        buyOrders.sort((a, b) => {
          const timeA = new Date(a.time || a.ts || 0).getTime();
          const timeB = new Date(b.time || b.ts || 0).getTime();
          return timeB - timeA;
        });
        updateStep8Status(2, `최근 순서 정렬 완료 ✅ (${buyOrders.length}개)`);
        processStep++;

        // ============================================================================
        // Step 8-3: NBverse API로 max 값 조회 (경로 사용 금지)
        // ============================================================================
      case 3:
        updateStep8Status(3, `NBverse 조회 중 (0/${buyOrders.length})...`);

        let nbSuccessCount = 0;
        buyOrders = await Promise.all(
          buyOrders.map(async (order, idx) => {
            try {
              // nb.price.max → nb_price_max → nb.price.min → price 순으로 사용
              const nbValue = Number(
                (order.nb && order.nb.price && order.nb.price.max)
                ?? order.nb_price_max
                ?? (order.nb && order.nb.price && order.nb.price.min)
                ?? order.price
                ?? 0
              );
              if (!nbValue) {
                order.nbverse_updated = false;
                return order;
              }

              const nbResult = await window.API?.loadNbverseByNb(nbValue, 'max');

              if (nbResult?.ok) {
                const nbData = nbResult;
                order.nbverse_data = nbData;
                order.nb_price = nbData.nb?.price?.max ?? nbData.nb_value ?? order.nb_price_max ?? order.nb_price;
                order.nb_price_max = nbData.nb?.price?.max ?? nbData.nb_value ?? order.nb_price_max;
                order.nb_price_min = nbData.nb?.price?.min ?? order.nb_price_min;
                order.nb_volume = nbData.volume ?? nbData.nb?.volume ?? order.nb_volume;
                order.nb_zone = nbData.nb?.zone ?? nbData.zone ?? order.nb_zone;
                // 카드 등급 정보가 응답에 포함되면 그대로 반영
                if (nbData.card_rating) {
                  order.card_rating = nbData.card_rating;
                } else if (nbData.card?.card_rating) {
                  order.card_rating = nbData.card.card_rating;
                }
                if (nbData.rating_score !== undefined) {
                  order.rating_score = nbData.rating_score;
                } else if (nbData.card?.card_rating?.enhancement !== undefined) {
                  order.rating_score = nbData.card.card_rating.enhancement;
                }
                order.nbverse_updated = true;
                order.nbverse_timestamp = new Date().toISOString();
                nbSuccessCount += 1;
                updateStep8Status(3, `NBverse 조회 중 (${nbSuccessCount}/${buyOrders.length})...`);
                console.log(`  ✓ 카드#${idx+1} NBverse 업데이트 성공:`, { price: nbValue, nb: order.nb_price });
              } else {
                // NBverse 조회 실패 시 기본값으로 대체 (nb_price 없으면 현재 가격 사용)
                if (!order.nb_price) {
                  order.nb_price = nbValue;
                  console.log(`  ⚠ 카드#${idx+1} NBverse 조회 실패, 현재가로 대체 (${nbValue})`);
                } else {
                  console.warn(`  ⚠ 카드#${idx+1} NBverse 조회 실패 (nb_value: ${nbValue}), 기존 nb_price 유지`);
                }
                order.nbverse_updated = false;
              }
            } catch (e) {
              order.nbverse_updated = false;
              console.error(`  ❌ 카드#${idx+1} NBverse 조회 오류:`, e?.message);
            }
            return order;
          })
        );

        const updatedNb = buyOrders.filter(o => o.nbverse_updated === true).length;
        updateStep8Status(3, `NBverse 조회 완료 ✅ (${updatedNb}/${buyOrders.length})`);
        processStep++;

        // ============================================================================
        // Step 8-4: 모든 매수 된 카드의 데이터 업데이트 확인
        // ============================================================================
      case 4:
        updateStep8Status(4, '카드 데이터 검증 중...');
        const updatedCount = buyOrders.filter(o => o.nbverse_updated === true).length;
        const failedCount = buyOrders.filter(o => o.nbverse_updated === false).length;
        
        updateStep8Status(4, `카드 데이터 검증 완료 ✅ (성공: ${updatedCount}개, 실패: ${failedCount}개)`);
        
        if (buyOrders.length > 0 && updatedCount === 0) {
          console.warn('⚠️ 모든 카드 NBverse 업데이트 실패, 기존 데이터 사용');
        }
        processStep++;

        // ============================================================================
        // Step 8-5: 매수 된 카드의 손익 업데이트 (업비트 0.05% 수수료 포함)
        // ============================================================================
      case 5:
        updateStep8Status(5, '손익 계산 중...');
        const currentPrice = await resolveCurrentPrice(currentInterval, buyOrders);
        const feeRate = getTradingFeeRate(); // 사용자 설정 수수료

        let totalPnL = 0;
        buyOrders = buyOrders.map((order, idx) => {
          const buyPrice = Number(order.price || 0);
          const quantity = Number(order.size || 0);
          
          // 수수료 적용 (진입가, 청산가)
          const entryPrice = buyPrice * (1 + feeRate); // 진입 시 수수료 추가
          const exitPrice = currentPrice * (1 - feeRate); // 청산 시 수수료 차감
          
          // 손익 계산
          const purchaseAmount = buyPrice * quantity; // 실제 구매액
          const currentValue = currentPrice * quantity; // 현재가치
          const pnlBeforeFee = currentValue - purchaseAmount; // 수수료 전 손익
          const buyFee = buyPrice * quantity * feeRate; // 매수 수수료
          const sellFee = currentPrice * quantity * feeRate; // 매도 수수료
          const totalFee = buyFee + sellFee; // 총 수수료
          const pnlAfterFee = pnlBeforeFee - totalFee; // 수수료 후 손익
          const pnlRate = purchaseAmount > 0 ? (pnlAfterFee / purchaseAmount) * 100 : 0;
          
          order.current_price = currentPrice;
          order.purchase_amount = purchaseAmount;
          order.current_value = currentValue;
          order.pnl_before_fee = pnlBeforeFee;
          order.buy_fee = buyFee;
          order.sell_fee = sellFee;
          order.total_fee = totalFee;
          order.fee_rate = feeRate;
          order.pnl = pnlAfterFee;
          order.pnl_rate = pnlRate;
          order.pnl_updated = true;
          order.pnl_timestamp = new Date().toISOString();
          
          totalPnL += pnlAfterFee;
          
          if (idx < 3) { // 첫 3개만 로그
            console.log(`  카드#${idx+1} 손익: ${pnlAfterFee.toFixed(0)}원 (${pnlRate.toFixed(2)}%) | 매수수수료: ${buyFee.toFixed(0)}원 | 매도수수료: ${sellFee.toFixed(0)}원`);
          }
          
          return order;
        });
        
        updateTopSummaryBar({ buyOrders, currentPrice });
        updateBuyCardSummary(buyOrders);
        // 수익 높은 순으로 정렬 (동률 시 최신 순)
        buyOrders.sort((a, b) => {
          const pnlA = Number(a.pnl) || 0;
          const pnlB = Number(b.pnl) || 0;
          if (pnlB !== pnlA) return pnlB - pnlA;
          const timeA = new Date(a.time || a.ts || 0).getTime();
          const timeB = new Date(b.time || b.ts || 0).getTime();
          return timeB - timeA;
        });

        updateStep8Status(5, `손익 업데이트 완료 ✅ (총: ${totalPnL.toFixed(0)}원, 정렬: 수익 높은 순)`);
        processStep++;
        break;
    }

    // ============================================================================
    // 최종: 렌더링 및 반환
    // ============================================================================
    const hasBuyCards = Array.isArray(buyOrders) && buyOrders.length > 0;
    
    if (hasBuyCards) {
      await renderBuyOrderList(buyOrders, currentInterval);
    }
    
    // 최소 1초 유지 (진행 상황 시각화)
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime < MIN_DURATION) {
      updateStep8Status('완료', '작업 정리 중...');
      await new Promise(resolve => setTimeout(resolve, MIN_DURATION - elapsedTime));
    }
    
    const loadedNbverse = buyOrders.some(o => o.nbverse_updated === true);
    const totalPnL = buyOrders.reduce((sum, o) => sum + (o.pnl || 0), 0).toFixed(0);
    const finalDuration = Date.now() - startTime;
    
    updateStep8Status('완료', `매수 카드 처리 완료 ✅ (${buyOrders.length}개, ${totalPnL}원, ${finalDuration}ms)`);
    
    console.log('✅ Step 8 - 매수 카드 처리 완료:', { 
      buyCount: buyOrders.length, 
      hasBuyCards, 
      loadedNbverse,
      totalPnL,
      duration: `${finalDuration}ms`
    });
    
    return { hasBuyCards, loadedNbverse };
    
  } catch (err) {
    console.error(`❌ loadBuyCards8 Step ${processStep} error:`, err);
    throw err;
  }
}

// ============================================================================
// Step 9: 매도 완료 카드
// ============================================================================

async function loadSellCards9() {
  try {
    const now = new Date().toLocaleTimeString('ko-KR');
    document.getElementById('sellStatsTime').textContent = now;
    const currentInterval = window.FlowDashboard?.state?.selectedInterval || 'minute10';
    
    // 파일에서 매수/매도 카드 로드
    let buyOrders = [];
    let sellOrders = [];
    
    try {
      const buyRes = await fetch('/api/cards/buy');
      const buyData = await buyRes.json();
      if (buyData && buyData.ok) {
        buyOrders = buyData.cards || [];
      }
    } catch (e) {
      console.error('Failed to load buy cards:', e);
      try {
        const cachedBuyOrders = localStorage.getItem('buyOrdersCache');
        if (cachedBuyOrders) {
          buyOrders = JSON.parse(cachedBuyOrders);
        }
      } catch (_) {}
    }
    
    try {
      const sellRes = await fetch('/api/cards/sell');
      const sellData = await sellRes.json();
      if (sellData && sellData.ok) {
          sellOrders = dedupeOrders(sellData.cards || []);
      }
    } catch (e) {
      console.error('Failed to load sell cards:', e);
    }

    console.log('📊 Step 9 - 매도 카드:', sellOrders.length, '개');

    // ✅ 매도 통계 (각 매도 거래별 수익 계산)
    // 각 sellOrder는 sell_cards 폴더의 1개 파일 = 1개 완전한 매도 거래
    let totalSellAmount = 0;  // 총 매도 금액
    let totalRealizedProfit = 0;  // 총 실현 손익
    let totalRealizedCount = 0;  // 매도 거래 개수
    let totalBuyCost = 0;  // 총 매수 원가
    
    const profitPercentages = [];  // 거래별 수익률
    
    sellOrders.forEach(sell => {
      const sellPrice = Number(sell.price || 0);
      const sellSize = Number(sell.size || 0);
      const origBuyPrice = Number(sell.orig_buy_avg_price || sell.orig_buy_price || 0);
      
      if (!Number.isFinite(sellPrice) || sellPrice <= 0 || !Number.isFinite(sellSize) || sellSize <= 0) {
        return;
      }
      
      const sellAmount = sellPrice * sellSize;
      totalSellAmount += sellAmount;
      
      // ✅ sell_cards에 orig_buy_price가 있는 경우 (매도 시점에 계산된 평균 매수가)
      if (Number.isFinite(origBuyPrice) && origBuyPrice > 0) {
        const buyCost = origBuyPrice * sellSize;
        const profit = sellAmount - buyCost;
        const profitRate = (profit / buyCost) * 100;
        
        totalBuyCost += buyCost;
        totalRealizedProfit += profit;
        profitPercentages.push(profitRate);
        totalRealizedCount += 1;
      }
    });
    
    // ✅ 평균 매도가
    const totalSellSize = sellOrders.reduce((sum, o) => sum + Number(o.size || 0), 0);
    const avgSellPrice = totalSellSize > 0
      ? (totalSellAmount / totalSellSize)
      : 0;

    // 현재가 추출
    const lastPrice = await resolveCurrentPrice(currentInterval, [...buyOrders, ...sellOrders]);

    // ✅ 수익률 계산 (평균, 최대, 최소)
    const avgProfitRate = profitPercentages.length > 0
      ? (profitPercentages.reduce((a, b) => a + b, 0) / profitPercentages.length)
      : 0;
    const maxProfitRate = profitPercentages.length > 0 ? Math.max(...profitPercentages) : 0;
    const minProfitRate = profitPercentages.length > 0 ? Math.min(...profitPercentages) : 0;
    
    // 수수료 계산 (매도 수수료: 0.1%)
    const sellFee = totalSellAmount * 0.001;
    
    // ✅ 총 수익 (수수료 차감)
    const totalProfit = Math.round(totalRealizedProfit - sellFee);
    const profitRate = avgProfitRate;

    // ✅ 평균 수익 및 평균 수익률 계산
    const avgProfit = totalRealizedCount > 0 
      ? Math.round((totalRealizedProfit - sellFee) / totalRealizedCount) 
      : 0;

    // 매도 통계 업데이트
    document.getElementById('sellCount').textContent = sellOrders.length;
    document.getElementById('sellTotalAmount').textContent = Math.round(totalSellAmount).toLocaleString() + ' KRW';
    document.getElementById('sellAvgPrice').textContent = Math.round(avgSellPrice).toLocaleString() + ' KRW';
    
    document.getElementById('totalProfit').textContent = totalProfit.toLocaleString() + ' KRW';
    document.getElementById('totalProfit').style.color = totalProfit >= 0 ? '#0ecb81' : '#f6465d';
    document.getElementById('profitRate').textContent = profitRate.toFixed(2) + '%';
    document.getElementById('profitRate').style.color = profitRate >= 0 ? '#0ecb81' : '#f6465d';
    
    document.getElementById('avgProfit').textContent = avgProfit.toLocaleString() + ' KRW';
    document.getElementById('avgProfit').style.color = avgProfit >= 0 ? '#0ecb81' : '#f6465d';
    document.getElementById('avgProfitRate').textContent = avgProfitRate.toFixed(2) + '%';
    document.getElementById('avgProfitRate').style.color = avgProfitRate >= 0 ? '#0ecb81' : '#f6465d';

    updateTopSummaryBar({ buyOrders, sellOrders, currentPrice: lastPrice });
    
    // 매도 내역 목록 렌더링
    renderSellOrderList(sellOrders, currentInterval);

    console.log('✅ Step 9 - 매도 카드 완료:', { sellCount: sellOrders.length, totalProfit, profitRate });
  } catch (err) {
    console.error('loadSellCards9 error:', err);
  }
}

function renderAssetBars(assets) {
  const container = document.getElementById('assetsBars');
  if (!container) return;

  const total = assets.assetTotal || 0;
  const krwPct = total > 0 ? ((assets.assetBuyable / total) * 100) : 0;
  const assetPct = total > 0 ? ((assets.currentValue / total) * 100) : 0;

  const html = `
    <div style="margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
        <span class="text-muted">사용 가능 KRW</span>
        <span style="color: #4285f4;">${krwPct.toFixed(1)}%</span>
      </div>
      <div class="asset-bar">
        <div class="fill" style="width: ${krwPct}%; background: linear-gradient(90deg, #4285f4, #72a6ff);"></div>
      </div>
    </div>
    <div>
      <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
        <span class="text-muted">코인 가치</span>
        <span style="color: #0ecb81;">${assetPct.toFixed(1)}%</span>
      </div>
      <div class="asset-bar">
        <div class="fill" style="width: ${assetPct}%; background: linear-gradient(90deg, #0ecb81, #2bdab5);"></div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

async function loadNbverseCardFromBuyOrders(buyOrders, interval) {
  if (!Array.isArray(buyOrders) || buyOrders.length === 0) return null;

  const latest = buyOrders[0];
  const path = latest?.nbverse_path || null;
  if (!path) return null; // 경로 없으면 조회 스킵

  try {
    const nbData = await API.loadNbverseByPath(path);
    if (nbData?.ok) {
      const payload = nbData.card || nbData.data || nbData;
      const card = { ...payload };
      if (!card.chart && Array.isArray(payload?.wave_data)) {
        card.chart = payload.wave_data;
      }
      return { card, meta: { path } };
    }
  } catch (e) {
    console.warn('NBverse load (path) error:', e?.message);
  }

  return null;
}

// ============================================================================
// 헬퍼: 최신가 추출
// ============================================================================
// ============================================================================
// BUY-CARD RENDERING HELPERS (Refactored)
// ============================================================================

function getLatestPrice(fallbackOrders = []) {
  // Get latest price from candleDataCache or fallback to order price
  try {
    const lastCandle = (window.candleDataCache || []).slice(-1)[0];
    const price = Number(lastCandle?.close || lastCandle?.value || 0);
    if (price > 0) return price;
  } catch (_) {}
  
  if (fallbackOrders.length > 0) {
    return Number(fallbackOrders[0]?.price || 0) || 0;
  }
  return 0;
}


// ============================================================================
// Card Rating Extraction Helper
// ============================================================================
function extractCardRating(order) {
  // Extract card rating data from order object with nested fallbacks
  const cardRatingObj = (
    order.card_rating || order.cardRating ||
    (order.nbverse_data && (order.nbverse_data.card_rating || order.nbverse_data.card?.card_rating))
  );
  
  let rating = '-';
  let ratingScore = '-';
  let ratingDetail = '-';
  
  if (cardRatingObj && typeof cardRatingObj === 'object') {
    rating = cardRatingObj.code || cardRatingObj.league || rating;
    
    if (cardRatingObj.enhancement !== undefined && cardRatingObj.enhancement !== null) {
      ratingScore = String(cardRatingObj.enhancement);
    } else if (cardRatingObj.bias !== undefined && cardRatingObj.bias !== null) {
      ratingScore = `${(cardRatingObj.bias * 100).toFixed(1)}%`;
    } else if (cardRatingObj.magnitudeBoost !== undefined && cardRatingObj.magnitudeBoost !== null) {
      ratingScore = cardRatingObj.magnitudeBoost.toFixed(1);
    }
    
    if (cardRatingObj.league) {
      ratingDetail = cardRatingObj.league;
      if (cardRatingObj.group) ratingDetail += ` ${cardRatingObj.group}`;
    }
  } else if (order.rating_score || order.ratingScore) {
    ratingScore = order.rating_score || order.ratingScore;
    rating = order.card_rating || order.cardRating || rating;
  }
  
  return { rating, ratingScore, ratingDetail };
}

// ============================================================================
// 헬퍼: Zone 추출 (BLUE/ORANGE)
// ============================================================================
function extractZone(order) {
  let zone = order.nb_zone?.zone || order.nb_zone || order.insight?.zone || '';
  if (!zone && order.insight?.zone_flag) {
    zone = order.insight.zone_flag > 0 ? 'BLUE' : 'ORANGE';
  }
  return zone;
}

// ============================================================================
// 헬퍼: 강화 수치 부호 추가
// ============================================================================
function addEnhancementSign(ratingScore, zone) {
  const parsedScore = Number(ratingScore);
  if (Number.isNaN(parsedScore) || !zone) return ratingScore;
  
  const sign = zone.toUpperCase() === 'BLUE' ? '+' : (zone.toUpperCase() === 'ORANGE' ? '-' : '');
  return `${sign}${parsedScore}`;
}

// ============================================================================
// 헬퍼: 손익 계산 (0.1% 수수료 포함)
// ============================================================================
function calculatePnL(buyPrice, size, currentPrice) {
  const UPBIT_FEE = 0.0005; // 0.05% (매수/매도 각각)
  const feeRate = typeof getTradingFeeRate === 'function' ? getTradingFeeRate() : UPBIT_FEE;
  
  const cost = buyPrice * size;
  const buyFee = cost * feeRate;
  const totalCost = cost + buyFee;
  
  const currentValue = currentPrice * size;
  const sellFee = currentValue * feeRate;
  const totalSellValue = currentValue - sellFee;
  
  const pnl = totalSellValue - totalCost;
  const pnlRate = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
  
  return {
    pnl,
    pnlRate,
    pnlColor: pnl >= 0 ? '#0ecb81' : '#f6465d',
    pnlSign: pnl > 0 ? '+' : '',
    lossAmount: pnl < 0 ? pnl : 0,
    lossRate: pnl < 0 ? pnlRate : 0,
    // 계산 상세 정보 추가
    buyFee,           // 매수 수수료
    sellFee,          // 매도 수수료
    totalFee: buyFee + sellFee, // 총 수수료
    feeRate,          // 적용된 수수료율
    cost,             // 매수 총액 (수수료 제외)
    currentValue,     // 현재 가치 (수수료 제외)
    totalCost,        // 매수 총액 (수수료 포함)
    totalSellValue    // 매도 총액 (수수료 포함)
  };
}

// ============================================================================
// 메인: 매수 카드 렌더링
// ============================================================================
async function renderBuyOrderList(orders, interval) {
  const container = document.getElementById('buyOrderList');
  if (!container) return;

  // 수수료 재계산을 위해 저장
  window.lastBuyOrders = orders;

  if (orders.length === 0) {
    container.innerHTML = '<div class="text-center text-muted py-2">매수 내역이 없습니다</div>';
    return;
  }

  const tfi = interval || 'minute10';
  const tfMap = { minute1: '1m', minute3: '3m', minute5: '5m', minute10: '10m', minute15: '15m', minute30: '30m', minute60: '1h', day: '1D' };
  const tfLabel = tfMap[tfi] || tfi;

  const latestPrice = getLatestPrice(orders);

  // 각 카드의 NBverse 정보를 조회하여 표시 (조회는 상위 10개만, 렌더는 전체)
  const nbverseFetchCount = Math.min(10, orders.length);
  const nbverseInfoMap = new Map(
    (
      await Promise.all(
        orders.slice(0, nbverseFetchCount).map(async (o, idx) => {
          const nbverseInfo = null; // 검색 사용 안 함 (플레이스홀더)
          return { index: idx, nbverseInfo };
        })
      )
    ).map(({ index, nbverseInfo }) => [index, nbverseInfo])
  );

  const cardsWithNbverse = orders.map((o, idx) => ({
    order: o,
    index: idx,
    nbverseInfo: nbverseInfoMap.get(idx) || null,
  }));

  // localStorage에 스냅샷 저장 (새로고침 시 복원용)
  try {
    const snapshotData = cardsWithNbverse.map(c => c.order);
    localStorage.setItem('buyCardsSnapshot', JSON.stringify(snapshotData));
    localStorage.setItem('buyCardsSnapshotTime', new Date().toISOString());
  } catch (e) {
    console.warn('Failed to save snapshot to localStorage:', e);
  }

  container.innerHTML = cardsWithNbverse.map(({ order: o, index: idx, nbverseInfo }) => {
    const price = Number(o.price || 0);
    const size = Number(o.size || 0);
    const totalKrw = (price * size).toFixed(0);
    const time = o.time ? new Date(o.time).toLocaleString('ko-KR') : (o.ts ? new Date(o.ts).toLocaleString('ko-KR') : '-');
    
    // N/B 데이터
    const nbPriceOld = o.nb_price || nbverseInfo?.nbPrice || o.nbPrice || '-';
    const nbVolume = o.nb_volume || nbverseInfo?.currentVolume || o.nbVolume || '-';
    const nbInterval = o.nbverse_interval || nbverseInfo?.interval || tfLabel;
    
    // 카드 등급 추출
    let { rating, ratingScore, ratingDetail } = extractCardRating(o);
    let mlRating = '';

    // Zone 추출
    const zoneForSign = extractZone(o);
    
    // 강화 수치 부호 추가
    ratingScore = addEnhancementSign(ratingScore, zoneForSign);

    // ML 등급 표시 (등급이 "-"가 아니고 유효한 경우만)
    if (o.mlGrade && o.mlGrade !== '-' && o.mlGrade !== '' && typeof zoneForSign === 'string') {
      const mlSign = zoneForSign.toUpperCase() === 'BLUE' ? '+' : (zoneForSign.toUpperCase() === 'ORANGE' ? '-' : '');
      const mlEnh = o.mlEnhancement && o.mlEnhancement !== '0' ? ` ${mlSign}${o.mlEnhancement}강` : '';
      mlRating = `ML ${o.mlGrade}${mlEnh}`;
    }

    // NB 값 기반 보정 (card_rating 없을 때만)
    if (rating === '-' && nbPriceOld !== '-') {
      const nbVal = parseFloat(nbPriceOld);
      let nbScore = '';
      if (nbVal < 0.3) { rating = 'SSS'; nbScore = 95; }
      else if (nbVal < 0.5) { rating = 'SS'; nbScore = 85; }
      else if (nbVal < 0.7) { rating = 'S'; nbScore = 75; }
      else if (nbVal < 1.0) { rating = 'A'; nbScore = 65; }
      else { rating = 'B'; nbScore = 50; }
      
      // NB 값 기반 점수에도 부호 추가
      const sign = zoneForSign.toUpperCase() === 'BLUE' ? '+' : (zoneForSign.toUpperCase() === 'ORANGE' ? '-' : '');
      ratingScore = `${sign}${nbScore}`;
      ratingDetail = 'NBverse 기반';
    }
    
    // Zone & Trust
    // Trust/Zone 표시는 제외
    const zone = '-';
    const nbZone = '-';
    const mlTrust = '-';

    // 손익 계산
    const pnlResult = calculatePnL(price, size, latestPrice);
    const { pnl, pnlRate, pnlColor, pnlSign, buyFee, sellFee, totalFee, feeRate, cost, currentValue } = pnlResult;
    const lossAmount = pnl < 0 ? pnl : 0;
    const lossColor = lossAmount < 0 ? '#f6465d' : '#9aa8c2';

    // 추가 N/B 메트릭 (Step 2와 동일하게 nb 객체에서 추출)
    // NBverse에서 저장한 nb 객체 구조: nb.price.max/min, nb.volume.max/min, nb.turnover.max/min
    const nb = o.nb || {};
    const nbPrice = nb.price || {};
    const volume = nb.volume || {};
    const turnover = nb.turnover || {};
    const fmt = (v) => (v == null ? '-' : Number(v).toFixed(10));

    const priceMax = fmt(nbPrice.max);
    const priceMin = fmt(nbPrice.min);
    const volMax = fmt(volume.max);
    const volMin = fmt(volume.min);
    const turnMax = fmt(turnover.max);
    const turnMin = fmt(turnover.min);

    // NB wave: Live (현재 시장 데이터) & Snapshot (매수 시점)
    const waveBarsLive = (() => {
      try {
        const candles = (window.candleDataCache || []).slice(-80);
        const vals = candles.map(c => Number(c?.close ?? c?.value ?? 0)).filter(v => isFinite(v) && v > 0);
        if (vals.length >= 5) {
          const minV = Math.min(...vals);
          const maxV = Math.max(...vals);
          const denom = (maxV - minV) || 1;
          return vals.map(v => (v - minV) / denom); // 0~1
        }
      } catch(_) {}
      return [];
    })();
    const waveBarsSnap = (() => {
      const snapVals = Array.isArray(nbPrice.values) ? nbPrice.values.slice(-80) : [];
      if (!snapVals.length) return [];
      const smin = Math.min(...snapVals);
      const smax = Math.max(...snapVals);
      const sden = (smax - smin) || 1;
      return snapVals.map(v => (v - smin) / sden);
    })();

    return `<div class="card-generation-box" style="background: linear-gradient(135deg, rgba(30,35,41,0.9), rgba(14,20,36,0.9)); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px;" data-buy-card="${idx}">
      <!-- 헤더 -->
      <div class="d-flex justify-content-between align-items-center mb-1" style="border-bottom: 2px solid rgba(0,209,255,0.3); padding-bottom: 8px;">
        <div>
          <strong class="text-white" style="font-size: 16px;">🛒 매수 #${idx + 1}</strong>
          <div style="font-size: 10px; margin-top: 6px;">
            <div class="text-muted">${time}</div>
            <div style="color: #00d1ff; font-weight: 600; margin-top: 3px;">분봉: <span>${tfLabel}</span> | 코인: <span style="color: #ffd700; font-weight: 700;">${o.market || o.coin || 'N/A'}</span></div>
          </div>
        </div>
        <span class="badge bg-info" style="font-size: 10px; padding: 4px 8px;">${nbInterval}</span>
      </div>

      <!-- 카드 등급 -->
      <div style="background: linear-gradient(135deg, rgba(0, 0, 0, 0.3), rgba(230, 238, 252, 0.133)); border-radius: 8px; padding: 10px; border: 1px solid rgba(230, 238, 252, 0.267);">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <div class="text-muted" style="font-size: 10px; margin-bottom: 4px;">카드 등급</div>
            <div style="font-size: 16px; font-weight: 700;"><span style="color:#e6eefc;">${rating}</span> <span style="color:#ffd700;font-size:12px;">${ratingScore}강</span></div>
          </div>
          <div class="text-end">
            <div class="text-muted" style="font-size: 10px; margin-bottom: 4px;">점수</div>
            <div style="font-size: 13px; font-weight: 600; color: #9aa8c2;">${ratingDetail}${mlRating ? ' | ' + mlRating : ''}</div>
          </div>
        </div>
      </div>

      <!-- 현재 가격 -->
      <div style="background: rgba(0,209,255,0.1); border-radius: 8px; padding: 10px; border: 1px solid rgba(0,209,255,0.3);">
        <div class="zone-display-label" style="margin-bottom: 4px;">현재 가격</div>
        <div style="font-size: 18px; font-weight: 700; color: #00d1ff; word-break: break-all;" data-current-price>${latestPrice.toLocaleString()} KRW</div>
      </div>

      <!-- 매수 가격 -->
      <div style="background: rgba(0,209,255,0.1); border-radius: 8px; padding: 10px; border: 1px solid rgba(0,209,255,0.3);">
        <div class="zone-display-label" style="margin-bottom: 4px;">매수 가격</div>
        <div style="font-size: 18px; font-weight: 700; color: #00d1ff; word-break: break-all;">${price.toLocaleString()} KRW</div>
      </div>

      <!-- 거래량 & 거래대금 -->
      <div class="row g-2">
        <div class="col-6">
          <div style="background: rgba(14,203,129,0.1); border-radius: 6px; padding: 8px; border: 1px solid rgba(14,203,129,0.3);">
            <div class="zone-display-label" style="font-size: 9px; margin-bottom: 2px;">수량</div>
            <div style="font-size: 12px; font-weight: 700; color: #0ecb81; word-break: break-all;">${size.toFixed(8)}</div>
          </div>
        </div>
        <div class="col-6">
          <div style="background: rgba(66,133,244,0.1); border-radius: 6px; padding: 8px; border: 1px solid rgba(66,133,244,0.3);">
            <div class="zone-display-label" style="font-size: 9px; margin-bottom: 2px;">거래대금</div>
            <div style="font-size: 12px; font-weight: 700; color: #4285f4; word-break: break-all;">${Number(totalKrw).toLocaleString()} KRW</div>
          </div>
        </div>
      </div>

      <!-- 가격/거래량/Interval N/B -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;">
        <div style="background: rgba(14,20,36,0.8); border-radius: 6px; padding: 8px; border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 11px; font-weight: 600; color: #ffffff; margin-bottom: 6px;">💰 가격</div>
          <div class="d-flex justify-content-between mb-1"><span class="text-muted" style="font-size: 10px;">MAX</span><span style="font-size: 11px; font-weight: 600; color: #0ecb81;">${priceMax}</span></div>
          <div class="d-flex justify-content-between"><span class="text-muted" style="font-size: 10px;">MIN</span><span style="font-size: 11px; font-weight: 600; color: #f6465d;">${priceMin}</span></div>
        </div>
        <div style="background: rgba(14,20,36,0.8); border-radius: 6px; padding: 8px; border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 11px; font-weight: 600; color: #ffffff; margin-bottom: 6px;">📈 거래량</div>
          <div class="d-flex justify-content-between mb-1"><span class="text-muted" style="font-size: 10px;">MAX</span><span style="font-size: 11px; font-weight: 600; color: #2bdab5;">${volMax}</span></div>
          <div class="d-flex justify-content-between"><span class="text-muted" style="font-size: 10px;">MIN</span><span style="font-size: 11px; font-weight: 600; color: #ffb703;">${volMin}</span></div>
        </div>
        <div style="background: rgba(14,20,36,0.8); border-radius: 6px; padding: 8px; border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 11px; font-weight: 600; color: #ffffff; margin-bottom: 6px;">💵 거래대금</div>
          <div class="d-flex justify-content-between mb-1"><span class="text-muted" style="font-size: 10px;">MAX</span><span style="font-size: 11px; font-weight: 600; color: #4285f4;">${turnMax}</span></div>
          <div class="d-flex justify-content-between"><span class="text-muted" style="font-size: 10px;">MIN</span><span style="font-size: 11px; font-weight: 600; color: #9c27b0;">${turnMin}</span></div>
        </div>
      </div>

      <!-- N/B WAVE (LIVE) -->
      <div style="background: rgba(14,20,36,0.8); border-radius: 8px; padding: 8px; border: 1px solid rgba(255,255,255,0.1);" data-wave-live>
        <div style="font-size: 11px; font-weight: 600; color: #ffffff; margin-bottom: 6px;">📊 N/B WAVE (LIVE)</div>
        <div class="nb-wave-bars" style="display: flex; gap: 1px; height: 24px; border-radius: 4px; overflow: hidden;">
          ${waveBarsLive.map(v => {
            const h = Math.max(6, Math.round(v * 100));
            const isOrange = v >= 0.5;
            return `<div style=\"flex:1; height:${h}%; align-self:flex-end; background: linear-gradient(180deg, ${isOrange ? 'rgba(255,183,3,0.85)' : 'rgba(0,209,255,0.85)'} 0%, ${isOrange ? 'rgba(255,183,3,0.3)' : 'rgba(0,209,255,0.3)'} 100%);\"></div>`;
          }).join('')}
        </div>
      </div>

      <!-- N/B WAVE (SNAPSHOT) -->
      <div style="background: rgba(14,20,36,0.8); border-radius: 8px; padding: 8px; border: 1px solid rgba(255,255,255,0.1);" data-wave-snap>
        <div style="font-size: 11px; font-weight: 600; color: #ffffff; margin-bottom: 6px;">📊 N/B WAVE (SNAPSHOT)</div>
        <div class="nb-wave-bars" style="display: flex; gap: 1px; height: 24px; border-radius: 4px; overflow: hidden;">
          ${waveBarsSnap.map(v => {
            const h = Math.max(6, Math.round(v * 100));
            const isOrange = v >= 0.5;
            return `<div style=\"flex:1; height:${h}%; align-self:flex-end; background: linear-gradient(180deg, ${isOrange ? 'rgba(255,183,3,0.85)' : 'rgba(0,209,255,0.85)'} 0%, ${isOrange ? 'rgba(255,183,3,0.3)' : 'rgba(0,209,255,0.3)'} 100%);\"></div>`;
          }).join('')}
        </div>
      </div>

      <!-- 손익 (강조 표시 + 계산 방법) -->
      <div style="background: linear-gradient(135deg, rgba(${pnl >= 0 ? '46,204,113' : '246,70,93'},0.15), rgba(${pnl >= 0 ? '46,204,113' : '246,70,93'},0.05)); border-radius: 8px; padding: 12px; border: 2px solid rgba(${pnl >= 0 ? '46,204,113' : '246,70,93'},0.4); margin-top: 8px;" data-pnl>
        <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="font-size: 12px; font-weight: 600; color: #ffffff;">💰 현재가 기준 손익</div>
          <div style="font-size: 14px; font-weight: 700; color: ${pnlColor}; text-shadow: 0 0 8px ${pnlColor};">${pnlSign}${Math.round(pnl).toLocaleString()} KRW</div>
        </div>
        <div style="display:flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 6px;">
          <div class="text-muted">수익률</div>
          <div style="font-weight: 700; color: ${pnlColor};">${pnlSign}${pnlRate.toFixed(2)}%</div>
        </div>
        
        <!-- 수수료 계산 상세 -->
        <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; margin-top: 8px;">
          <div style="font-size: 11px; font-weight: 600; color: #9aa8c2; margin-bottom: 6px;">📊 수수료 계산 상세 (${(feeRate * 100).toFixed(2)}%)</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 10px;">
            <div style="background: rgba(0,0,0,0.2); padding: 4px 6px; border-radius: 4px;">
              <div class="text-muted">매수 총액</div>
              <div style="color: #00d1ff; font-weight: 600;">${cost.toLocaleString()} KRW</div>
            </div>
            <div style="background: rgba(0,0,0,0.2); padding: 4px 6px; border-radius: 4px;">
              <div class="text-muted">현재 가치</div>
              <div style="color: #00d1ff; font-weight: 600;">${currentValue.toLocaleString()} KRW</div>
            </div>
            <div style="background: rgba(0,0,0,0.2); padding: 4px 6px; border-radius: 4px;">
              <div class="text-muted">매수 수수료</div>
              <div style="color: #ffb703; font-weight: 600;">${buyFee.toFixed(0)} KRW</div>
            </div>
            <div style="background: rgba(0,0,0,0.2); padding: 4px 6px; border-radius: 4px;">
              <div class="text-muted">매도 수수료</div>
              <div style="color: #ffb703; font-weight: 600;">${sellFee.toFixed(0)} KRW</div>
            </div>
          </div>
          <div style="margin-top: 6px; padding: 4px 6px; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 9px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="text-muted">총 수수료</div>
              <div style="color: #f6465d; font-weight: 700;">${totalFee.toFixed(0)} KRW</div>
            </div>
          </div>
          
          <!-- 손익 계산 공식 -->
          <div style="margin-top: 10px; padding: 8px; background: rgba(0,0,0,0.4); border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);">
            <div style="font-size: 11px; font-weight: 700; color: #ffd700; margin-bottom: 6px;">🧮 손익 계산 공식</div>
            
            <!-- 1단계: 매수 시 비용 -->
            <div style="font-size: 9px; line-height: 1.6; color: #e6eefc; margin-bottom: 4px;">
              <div style="color: #9aa8c2; margin-bottom: 2px;">① 매수 시 총 비용:</div>
              <div style="padding-left: 8px; color: #00d1ff; font-family: 'Courier New', monospace;">
                ${price.toLocaleString()} × ${size.toFixed(8)} + ${buyFee.toFixed(0)} = <span style="color: #0ecb81; font-weight: 700;">${(cost + buyFee).toFixed(0)} KRW</span>
              </div>
              <div style="padding-left: 8px; color: #6c757d; font-size: 8px;">
                (매수가 × 수량 + 매수수수료 ${(feeRate * 100).toFixed(2)}%)
              </div>
            </div>
            
            <!-- 2단계: 매도 시 수령액 -->
            <div style="font-size: 9px; line-height: 1.6; color: #e6eefc; margin-bottom: 4px;">
              <div style="color: #9aa8c2; margin-bottom: 2px;">② 매도 시 수령액:</div>
              <div style="padding-left: 8px; color: #00d1ff; font-family: 'Courier New', monospace;">
                ${latestPrice.toLocaleString()} × ${size.toFixed(8)} - ${sellFee.toFixed(0)} = <span style="color: #0ecb81; font-weight: 700;">${(currentValue - sellFee).toFixed(0)} KRW</span>
              </div>
              <div style="padding-left: 8px; color: #6c757d; font-size: 8px;">
                (현재가 × 수량 - 매도수수료 ${(feeRate * 100).toFixed(2)}%)
              </div>
            </div>
            
            <!-- 3단계: 최종 손익 -->
            <div style="font-size: 9px; line-height: 1.6; color: #e6eefc; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px; margin-top: 4px;">
              <div style="color: #ffd700; margin-bottom: 2px;">③ 최종 손익:</div>
              <div style="padding-left: 8px; color: #00d1ff; font-family: 'Courier New', monospace;">
                ${(currentValue - sellFee).toFixed(0)} - ${(cost + buyFee).toFixed(0)} = <span style="color: ${pnlColor}; font-weight: 700; font-size: 11px;">${pnlSign}${Math.round(pnl).toLocaleString()} KRW</span>
              </div>
              <div style="padding-left: 8px; color: #6c757d; font-size: 8px;">
                (수령액 - 총비용 = ${pnl >= 0 ? '수익' : '손실'})
              </div>
            </div>
            
            <!-- 4단계: 수익률 -->
            <div style="font-size: 9px; line-height: 1.6; color: #e6eefc; margin-top: 6px; padding: 4px; background: rgba(255,255,255,0.05); border-radius: 4px;">
              <div style="color: #ffd700; margin-bottom: 2px;">④ 수익률:</div>
              <div style="padding-left: 8px; color: #00d1ff; font-family: 'Courier New', monospace;">
                (${Math.round(pnl).toLocaleString()} ÷ ${(cost + buyFee).toFixed(0)}) × 100 = <span style="color: ${pnlColor}; font-weight: 700; font-size: 11px;">${pnlSign}${pnlRate.toFixed(2)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 매도 버튼 -->
      <button id="sellBtn_${idx}" onclick="executeSellForCard('${idx}', ${price}, ${size}, '${o.market || DEFAULT_MARKET}', '${o.timestamp || o.ts || Date.now()}', '${o.uuid || ""}', ${priceMax}, ${priceMin})" 
        style="width: 100%; background: linear-gradient(135deg, #f6465d 0%, #e63946 100%); border: none; border-radius: 8px; padding: 12px; margin-top: 10px; font-size: 13px; font-weight: 700; color: #ffffff; cursor: pointer; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(246,70,93,0.3);"
        onmouseover="if (!this.disabled) { this.style.boxShadow='0 6px 16px rgba(246,70,93,0.5)'; this.style.transform='translateY(-2px)'; }"
        onmouseout="if (!this.disabled) { this.style.boxShadow='0 4px 12px rgba(246,70,93,0.3)'; this.style.transform='translateY(0)'; }">
        🛍️ 매도 (${pnl >= 0 ? '수익' : '손실'})
      </button>
    </div>`;
  }).join('');

  // 실시간 현재가 업데이트 시작
  if (orders.length > 0) {
    window.buyCardRefreshInterval && clearInterval(window.buyCardRefreshInterval);
    window.buyCardRefreshInterval = setInterval(() => {
      try {
        const updatedPrice = (() => {
          let p = 0;
          try {
            const lastCandle = (window.candleDataCache || []).slice(-1)[0];
            p = Number(lastCandle?.close || lastCandle?.value || 0) || 0;
          } catch (_) { p = 0; }
          if (!p && orders.length > 0) {
            p = Number(orders[0]?.price || 0) || 0;
          }
          return p;
        })();
        
        // 매수 카드의 현재가를 업데이트
        document.querySelectorAll('[data-current-price]').forEach((el) => {
          el.textContent = updatedPrice.toLocaleString() + ' KRW';
        });

        // 각 카드의 손익을 업데이트 (상세 공식 유지하며 숫자만 업데이트)
        orders.forEach((o, idx) => {
          const cardEl = document.querySelector(`[data-buy-card="${idx}"]`);
          if (!cardEl) return;
          
          const buyPrice = Number(o.price || 0);
          const size = Number(o.size || 0);
          
          // 수수료 계산 (getTradingFeeRate 사용)
          const feeRate = typeof getTradingFeeRate === 'function' ? getTradingFeeRate() : 0.0005;
          const cost = buyPrice * size;
          const buyFee = cost * feeRate;
          const totalCost = cost + buyFee;
          
          const currentValue = updatedPrice * size;
          const sellFee = currentValue * feeRate;
          const totalSellValue = currentValue - sellFee;
          
          const pnl = totalSellValue - totalCost;
          const pnlRate = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
          const pnlColor = pnl >= 0 ? '#0ecb81' : '#f6465d';
          const pnlSign = pnl > 0 ? '+' : '';
          
          const pnlEl = cardEl.querySelector('[data-pnl]');
          if (!pnlEl) return;
          
          // 상세 HTML 구조 확인
          const hasDetailedView = pnlEl.querySelector('.text-muted') !== null;
          
          if (hasDetailedView) {
            // ✅ 상세 HTML이 있으면 전체 재생성 (현재가 반영)
            pnlEl.style.background = `linear-gradient(135deg, rgba(${pnl >= 0 ? '46,204,113' : '246,70,93'},0.15), rgba(${pnl >= 0 ? '46,204,113' : '246,70,93'},0.05))`;
            pnlEl.style.borderColor = `rgba(${pnl >= 0 ? '46,204,113' : '246,70,93'},0.4)`;
            
            pnlEl.innerHTML = `
              <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="font-size: 13px; font-weight: 600; color: #ffffff;">💰 현재가 기준 손익</div>
                <div style="font-size: 16px; font-weight: 700; color: ${pnlColor}; text-shadow: 0 0 8px ${pnlColor};">${pnlSign}${Math.round(pnl).toLocaleString()} KRW</div>
              </div>
              <div style="display:flex; justify-content: space-between; align-items: center; font-size: 12px; margin-bottom: 6px;">
                <div class="text-muted">수익률</div>
                <div style="font-weight: 700; color: ${pnlColor};">${pnlSign}${pnlRate.toFixed(2)}%</div>
              </div>
              
              <!-- 수수료 계산 상세 -->
              <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; margin-top: 8px;">
                <div style="font-size: 11px; font-weight: 600; color: #9aa8c2; margin-bottom: 6px;">📊 수수료 계산 상세 (${(feeRate * 100).toFixed(2)}%)</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 10px;">
                  <div style="background: rgba(0,0,0,0.2); padding: 4px 6px; border-radius: 4px;">
                    <div class="text-muted">매수 총액</div>
                    <div style="color: #00d1ff; font-weight: 600;">${cost.toLocaleString()} KRW</div>
                  </div>
                  <div style="background: rgba(0,0,0,0.2); padding: 4px 6px; border-radius: 4px;">
                    <div class="text-muted">현재 가치</div>
                    <div style="color: #00d1ff; font-weight: 600;">${currentValue.toLocaleString()} KRW</div>
                  </div>
                  <div style="background: rgba(0,0,0,0.2); padding: 4px 6px; border-radius: 4px;">
                    <div class="text-muted">매수 수수료</div>
                    <div style="color: #ffb703; font-weight: 600;">${buyFee.toFixed(0)} KRW</div>
                  </div>
                  <div style="background: rgba(0,0,0,0.2); padding: 4px 6px; border-radius: 4px;">
                    <div class="text-muted">매도 수수료</div>
                    <div style="color: #ffb703; font-weight: 600;">${sellFee.toFixed(0)} KRW</div>
                  </div>
                </div>
                <div style="margin-top: 6px; padding: 4px 6px; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 9px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div class="text-muted">총 수수료</div>
                    <div style="color: #f6465d; font-weight: 700;">${(buyFee + sellFee).toFixed(0)} KRW</div>
                  </div>
                </div>
                
                <!-- 손익 계산 공식 -->
                <div style="margin-top: 10px; padding: 8px; background: rgba(0,0,0,0.4); border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);">
                  <div style="font-size: 11px; font-weight: 700; color: #ffd700; margin-bottom: 6px;">🧮 손익 계산 공식</div>
                  
                  <!-- 1단계: 매수 시 비용 -->
                  <div style="font-size: 9px; line-height: 1.6; color: #e6eefc; margin-bottom: 4px;">
                    <div style="color: #9aa8c2; margin-bottom: 2px;">① 매수 시 총 비용:</div>
                    <div style="padding-left: 8px; color: #00d1ff; font-family: 'Courier New', monospace;">
                      ${buyPrice.toLocaleString()} × ${size.toFixed(8)} + ${buyFee.toFixed(0)} = <span style="color: #0ecb81; font-weight: 700;">${totalCost.toFixed(0)} KRW</span>
                    </div>
                    <div style="padding-left: 8px; color: #6c757d; font-size: 8px;">
                      (매수가 × 수량 + 매수수수료 ${(feeRate * 100).toFixed(2)}%)
                    </div>
                  </div>
                  
                  <!-- 2단계: 매도 시 수령액 -->
                  <div style="font-size: 9px; line-height: 1.6; color: #e6eefc; margin-bottom: 4px;">
                    <div style="color: #9aa8c2; margin-bottom: 2px;">② 매도 시 수령액:</div>
                    <div style="padding-left: 8px; color: #00d1ff; font-family: 'Courier New', monospace;">
                      ${updatedPrice.toLocaleString()} × ${size.toFixed(8)} - ${sellFee.toFixed(0)} = <span style="color: #0ecb81; font-weight: 700;">${totalSellValue.toFixed(0)} KRW</span>
                    </div>
                    <div style="padding-left: 8px; color: #6c757d; font-size: 8px;">
                      (현재가 × 수량 - 매도수수료 ${(feeRate * 100).toFixed(2)}%)
                    </div>
                  </div>
                  
                  <!-- 3단계: 최종 손익 -->
                  <div style="font-size: 9px; line-height: 1.6; color: #e6eefc; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px; margin-top: 4px;">
                    <div style="color: #ffd700; margin-bottom: 2px;">③ 최종 손익:</div>
                    <div style="padding-left: 8px; color: #00d1ff; font-family: 'Courier New', monospace;">
                      ${totalSellValue.toFixed(0)} - ${totalCost.toFixed(0)} = <span style="color: ${pnlColor}; font-weight: 700; font-size: 11px;">${pnlSign}${Math.round(pnl).toLocaleString()} KRW</span>
                    </div>
                    <div style="padding-left: 8px; color: #6c757d; font-size: 8px;">
                      (수령액 - 총비용 = ${pnl >= 0 ? '수익' : '손실'})
                    </div>
                  </div>
                  
                  <!-- 4단계: 수익률 -->
                  <div style="font-size: 9px; line-height: 1.6; color: #e6eefc; margin-top: 6px; padding: 4px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="color: #ffd700; margin-bottom: 2px;">④ 수익률:</div>
                    <div style="padding-left: 8px; color: #00d1ff; font-family: 'Courier New', monospace;">
                      (${Math.round(pnl).toLocaleString()} ÷ ${totalCost.toFixed(0)}) × 100 = <span style="color: ${pnlColor}; font-weight: 700; font-size: 11px;">${pnlSign}${pnlRate.toFixed(2)}%</span>
                    </div>
                  </div>
                </div>
              </div>
            `;
          } else {
            // 간단한 버전만 있을 때
            pnlEl.innerHTML = `
              <div style="font-size: 14px; font-weight: 700; color: ${pnlColor};">
                ${pnlSign}${Math.round(pnl).toLocaleString()} KRW
              </div>
              <div style="font-size: 11px; color: ${pnlColor}; margin-top: 2px;">
                ${pnlSign}${pnlRate.toFixed(2)}%
              </div>
            `;
          }
        });
        // 각 카드의 N/B WAVE를 현재 데이터로 업데이트
        const waveBarsLive = (() => {
          try {
            const candles = (window.candleDataCache || []).slice(-80);
            const vals = candles.map(c => Number(c?.close ?? c?.value ?? 0)).filter(v => isFinite(v) && v > 0);
            if (vals.length >= 5) {
              const minV = Math.min(...vals);
              const maxV = Math.max(...vals);
              const denom = (maxV - minV) || 1;
              return vals.map(v => (v - minV) / denom);
            }
          } catch(_) {}
          return [];
        })();
        if (waveBarsLive.length) {
          document.querySelectorAll('[data-wave-live] .nb-wave-bars').forEach(container => {
            const html = waveBarsLive.map(v => {
              const h = Math.max(6, Math.round(v * 100));
              const isOrange = v >= 0.5;
              return `<div style="flex:1; height:${h}%; align-self:flex-end; background: linear-gradient(180deg, ${isOrange ? 'rgba(255,183,3,0.85)' : 'rgba(0,209,255,0.85)'} 0%, ${isOrange ? 'rgba(255,183,3,0.3)' : 'rgba(0,209,255,0.3)'} 100%);"></div>`;
            }).join('');
            container.innerHTML = html;
          });
        }
      } catch (e) {
        console.debug('Buy card update error:', e?.message);
      }
    }, 1000); // 1초마다 업데이트
  }
}

function renderSellOrderList(orders, interval) {
  const container = document.getElementById('sellOrderList');
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = '<div class="text-center text-muted py-2">매도 내역이 없습니다</div>';
    return;
  }

  const tfi = interval || 'minute10';
  const tfMap = { minute1: '1m', minute3: '3m', minute5: '5m', minute10: '10m', minute15: '15m', minute30: '30m', minute60: '1h', day: '1D' };
  const tfLabel = tfMap[tfi] || tfi;

  container.innerHTML = orders.slice(0, 20).map((o, idx) => {
    const price = Number(o.price || 0);
    const size = Number(o.size || 0);
    const totalKrw = (price * size).toFixed(0);
    const time = o.time ? new Date(o.time).toLocaleString('ko-KR') : (o.ts ? new Date(o.ts).toLocaleString('ko-KR') : '-');
    // per-card realized profit (uses embedded buy info if available)
    const buyPrice = Number(o.orig_buy_avg_price || o.orig_buy_price || 0);
    const profitKrw = (Number.isFinite(buyPrice) && buyPrice > 0 && size > 0)
      ? (price - buyPrice) * size
      : null;
    const profitPct = (Number.isFinite(buyPrice) && buyPrice > 0)
      ? ((price - buyPrice) / buyPrice) * 100
      : null;
    
    // N/B 데이터
    // Show current snapshot values if available
    const nbPrice = (o.current_price != null) ? Number(o.current_price).toLocaleString() : '-';
    const nbVolume = (o.current_volume != null) ? Number(o.current_volume).toLocaleString() : '-';
    const nbTurnover = (o.current_turnover != null) ? Number(o.current_turnover).toLocaleString() : '-';
    
    // 카드 등급
    const ratingObj = o.card_rating || o.cardRating || null;
    const rating = ratingObj && typeof ratingObj === 'object'
      ? [ratingObj.code, ratingObj.league].filter(Boolean).join(' / ')
      : (ratingObj || '-');
    const ratingScore = (o.rating_score || o.ratingScore || ratingObj?.avgDiff || '-')
    
    // Zone & Trust
    const nbZoneObj = o.nb_zone || o.nbZone || null;
    const nbZone = nbZoneObj && typeof nbZoneObj === 'object' ? (nbZoneObj.zone || '-') : (nbZoneObj || '-');
    const mlTrustObj = o.ml_trust || o.mlTrust || null;
    let mlTrust = '-';
    if (mlTrustObj && typeof mlTrustObj === 'object') {
      if (mlTrustObj.pct != null) mlTrust = `${Number(mlTrustObj.pct).toFixed(1)}%`;
      else if (mlTrustObj.value != null) mlTrust = `${Number(mlTrustObj.value).toFixed(1)}%`;
      else if (mlTrustObj.grade) mlTrust = mlTrustObj.grade;
      else if (mlTrustObj.enhancement) mlTrust = String(mlTrustObj.enhancement);
    } else if (mlTrustObj) {
      mlTrust = String(mlTrustObj);
    }
    if (mlTrust === '-') {
      const nbTrust = o.nb_wave && o.nb_wave.nb_stats && o.nb_wave.nb_stats.nbTrust;
      if (nbTrust != null) mlTrust = `${Number(nbTrust).toFixed(1)}%`;
    }

    return `<div style="background: linear-gradient(135deg, rgba(246,70,93,0.15), rgba(246,70,93,0.05)); border: 2px solid rgba(246,70,93,0.3); border-radius: 12px; padding: 12px; margin-bottom: 14px; box-shadow: 0 4px 8px rgba(0,0,0,0.3);">
      <!-- 헤더 -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div>
          <div style="font-weight: 700; font-size: 14px; color: #f6465d;">💰 매도 #${idx + 1}</div>
          <div style="font-size: 10px; color: #888; margin-top: 4px;">${time} | 코인: <span style="color: #ffd700; font-weight: 700;">${o.market || o.coin || 'N/A'}</span></div>
        </div>
      </div>
      
      <!-- 카드 등급 -->
      <div style="background: rgba(14,20,36,0.8); border-radius: 8px; padding: 8px; margin-bottom: 8px; border: 1px solid rgba(246,70,93,0.2);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div class="text-muted" style="font-size: 9px; margin-bottom: 2px;">카드 등급</div>
            <div style="font-size: 13px; font-weight: 700;">${rating}</div>
          </div>
          <div class="text-end">
            <div class="text-muted" style="font-size: 9px; margin-bottom: 2px;">점수</div>
            <div style="font-size: 11px; font-weight: 600; color: #f6465d;">${ratingScore}</div>
          </div>
        </div>
      </div>
      
      <!-- 매도 가격 -->
      <div style="background: rgba(246,70,93,0.1); border-radius: 8px; padding: 8px; border: 1px solid rgba(246,70,93,0.3); margin-bottom: 8px;">
        <div style="font-size: 9px; color: #888; margin-bottom: 2px;">매도 가격</div>
        <div style="font-size: 14px; font-weight: 700; color: #f6465d;">${price.toLocaleString()} KRW</div>
      </div>

      <!-- 실현 손익 -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
        <div style="background: rgba(14,20,36,0.8); border-radius: 6px; padding: 6px; border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 8px; color: #888; margin-bottom: 2px;">실현 손익</div>
          <div style="font-size: 11px; font-weight: 700; color: ${profitKrw != null && profitKrw >= 0 ? '#0ecb81' : '#f6465d'};">
            ${profitKrw != null ? Math.round(profitKrw).toLocaleString() + ' KRW' : '-'}
          </div>
        </div>
        <div style="background: rgba(14,20,36,0.8); border-radius: 6px; padding: 6px; border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 8px; color: #888; margin-bottom: 2px;">손익률</div>
          <div style="font-size: 11px; font-weight: 700; color: ${profitPct != null && profitPct >= 0 ? '#0ecb81' : '#f6465d'};">
            ${profitPct != null ? profitPct.toFixed(2) + '%' : '-'}
          </div>
        </div>
      </div>
      
      <!-- 수량 & 총액 -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
        <div style="background: rgba(230,238,252,0.05); border-radius: 6px; padding: 6px; border: 1px solid rgba(230,238,252,0.1);">
          <div style="font-size: 8px; color: #888; margin-bottom: 2px;">수량</div>
          <div style="font-size: 11px; font-weight: 700; color: #e6eefc;">${size.toFixed(8)}</div>
        </div>
        <div style="background: rgba(66,133,244,0.1); border-radius: 6px; padding: 6px; border: 1px solid rgba(66,133,244,0.3);">
          <div style="font-size: 8px; color: #888; margin-bottom: 2px;">총액</div>
          <div style="font-size: 11px; font-weight: 700; color: #4285f4;">${totalKrw} KRW</div>
        </div>
      </div>
      
      <!-- N/B 정보 -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 8px;">
        <div style="background: rgba(14,20,36,0.8); border-radius: 4px; padding: 4px; border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 9px; font-weight: 600; color: #ffffff; margin-bottom: 2px;">💰 가격</div>
          <div style="font-size: 9px; font-weight: 600; color: #f6465d;">${nbPrice}</div>
        </div>
        <div style="background: rgba(14,20,36,0.8); border-radius: 4px; padding: 4px; border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 9px; font-weight: 600; color: #ffffff; margin-bottom: 2px;">📈 거래량</div>
          <div style="font-size: 9px; font-weight: 600; color: #ffb703;">${nbVolume}</div>
        </div>
        <div style="background: rgba(14,20,36,0.8); border-radius: 4px; padding: 4px; border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 9px; font-weight: 600; color: #ffffff; margin-bottom: 2px;">💵 거래대금</div>
          <div style="font-size: 9px; font-weight: 600; color: #9c27b0;">${nbTurnover}</div>
        </div>
      </div>
      
      <!-- Zone & Trust -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
        <div>
          <div style="font-size: 9px; font-weight: 600; color: #ffffff; margin-bottom: 2px;">🗺️ N/B Zone</div>
          <div style="background: rgba(14,20,36,0.8); border-radius: 4px; padding: 4px; border: 1px solid rgba(255,255,255,0.1); font-size: 9px; color: #e6eefc;">${nbZone}</div>
        </div>
        <div>
          <div style="font-size: 9px; font-weight: 600; color: #ffffff; margin-bottom: 2px;">🤖 ML Trust</div>
          <div style="background: rgba(14,20,36,0.8); border-radius: 4px; padding: 4px; border: 1px solid rgba(255,255,255,0.1); font-size: 9px; color: #e6eefc;">${mlTrust}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ============================================================================
function selectTimeframe(interval) {
  FlowDashboard.selectTimeframe(interval);
}

function refreshMarketData() {
  FlowDashboard.refreshMarketData();
}

function refreshCards() {
  FlowDashboard.refreshCards();
}

function jumpToStep(stepNum) {
  FlowDashboard.jumpToStep(stepNum);
}

function proceedToStep2() {
  FlowDashboard.proceedToStep2();
}

function proceedToStep3() {
  FlowDashboard.proceedToStep3();
}

function backToStep1() {
  FlowDashboard.backToStep1();
}

function backToStep2() {
  FlowDashboard.backToStep2();
}

function executeBuy() {
  FlowDashboard.executeBuy();
}

function executeSell() {
  FlowDashboard.executeSell();
}

function resetFlow() {
  FlowDashboard.resetFlow();
}

function viewTradeHistory() {
  FlowDashboard.viewTradeHistory();
}

// ============================================================================
// 매수 카드에서 직접 매도 실행
// ============================================================================
async function executeSellForCard(cardIdx, price, size, market, timestamp, uuid, nbPriceMax, nbPriceMin) {
  try {
    // 매도 버튼 비활성화
    const sellBtn = document.getElementById(`sellBtn_${cardIdx}`);
    if (sellBtn) {
      sellBtn.disabled = true;
      sellBtn.style.opacity = '0.5';
      sellBtn.style.cursor = 'not-allowed';
      sellBtn.textContent = '⏳ 매도 중...';
    }

    const sellPayload = {
      market: market || DEFAULT_MARKET,
      price: price,
      size: size,
      paper: false,
      interval: FlowDashboard.state?.timeframe || 'minute10',
      card_timestamp: timestamp,
      card_uuid: uuid,
      nb_price_max: nbPriceMax,
      nb_price_min: nbPriceMin
    };

    const res = await fetch(withApiBase('/api/trade/sell'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sellPayload)
    });

    if (res.ok) {
      const result = await res.json();
      if (result.success || result.ok) {
        const statusEl = document.getElementById('systemStatus');
        if (statusEl) statusEl.textContent = '✅ 매도 요청 완료';
        if (FlowDashboard.loadBuyOrders) await FlowDashboard.loadBuyOrders();
        if (typeof loadSellCards9 === 'function') {
          // 매도 완료 카드 갱신
          await loadSellCards9();
        }
      } else {
        const statusEl = document.getElementById('systemStatus');
        if (statusEl) statusEl.textContent = `⚠️ 매도 실패: ${result.message || result.error || '알 수 없는 오류'}`;
        // 실패 시 버튼 다시 활성화
        const sellBtn = document.getElementById(`sellBtn_${cardIdx}`);
        if (sellBtn) {
          sellBtn.disabled = false;
          sellBtn.style.opacity = '1';
          sellBtn.style.cursor = 'pointer';
          sellBtn.textContent = '🛍️ 매도 (수익)';
        }
      }
    } else {
      const statusEl = document.getElementById('systemStatus');
      if (statusEl) statusEl.textContent = `❌ 매도 요청 실패 (HTTP ${res.status})`;
      // 실패 시 버튼 다시 활성화
      const sellBtn = document.getElementById(`sellBtn_${cardIdx}`);
      if (sellBtn) {
        sellBtn.disabled = false;
        sellBtn.style.opacity = '1';
        sellBtn.style.cursor = 'pointer';
        sellBtn.textContent = '🛍️ 매도 (수익)';
      }
    }
  } catch (e) {
    const statusEl = document.getElementById('systemStatus');
    if (statusEl) statusEl.textContent = `❌ 매도 중 오류: ${e?.message}`;
    // 오류 시 버튼 다시 활성화
    const sellBtn = document.getElementById(`sellBtn_${cardIdx}`);
    if (sellBtn) {
      sellBtn.disabled = false;
      sellBtn.style.opacity = '1';
      sellBtn.style.cursor = 'pointer';
      sellBtn.textContent = '🛍️ 매도 (수익)';
    }
  }
}

// ============================================================================
// Initialize on DOM Ready
// ============================================================================
$(document).ready(function() {
  // 1단계: localStorage에서 상태 복원
  const savedState = stateManager.load();
  if (savedState) {
    console.log('📥 이전 상태 복원 중...');
    Object.assign(state, savedState);
  }

  FlowDashboard.init();
  FlowDashboard.startMemoryMonitoring(); // Start memory monitoring to prevent leaks
  
  // 수수료 입력란 이벤트 리스너
  try {
    const feeInput = document.getElementById('tradingFeeRate');
    if (feeInput) {
      // 초기값 표시
      updateTotalFeeDisplay();
      
      // 입력 시 총 수수료 업데이트
      feeInput.addEventListener('input', () => {
        updateTotalFeeDisplay();
        // 매수 카드 목록이 있다면 손익 재계산
        const currentInterval = window.flowDashboardState?.selectedInterval || 'minute10';
        if (window.lastBuyOrders && window.lastBuyOrders.length > 0) {
          setTimeout(() => {
            renderBuyOrderList(window.lastBuyOrders, currentInterval);
          }, 300);
        }
      });
    }
  } catch(e) {
    console.warn('수수료 입력란 초기화 실패:', e);
  }
  
  // N/B Wave 예측 항상 활성화
  window.nbPredictionEnabled = true;
  
  // 자동 재훈련 시작 (30분마다)
  setInterval(async () => {
    try {
      console.log('[Auto-Train] 📚 LSTM 딥러닝 재훈련 시작...');
      const response = await fetch('/api/ml/rating/v3/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intervals: ['10m', '30m', '1h'],
          window: 120
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.ok) {
          console.log(`[Auto-Train] ✓ LSTM 재훈련 완료: ${result.sample_count}개 샘플`);
          console.log(`[Auto-Train] Train Loss: ${(result.train_loss || 0).toFixed(4)}`);
          console.log(`[Auto-Train] Test Loss: ${(result.test_loss || 0).toFixed(4)}`);
          console.log(`[Auto-Train] Test MAE: ${(result.test_mae || 0).toFixed(4)}`);
          
          // 재훈련 후 예측 업데이트
          if (window.updateNBPrediction) {
            setTimeout(() => window.updateNBPrediction(), 1000);
          }
        } else {
          console.warn('[Auto-Train] 재훈련 실패:', result.error);
        }
      }
    } catch (err) {
      console.error('[Auto-Train] 오류:', err);
    }
  }, 30 * 60 * 1000);  // 30분마다
  
  // 버튼 이벤트 바인딩
  try {
    $('#ccBuy').on('click', () => FlowDashboard.executeBuy());
  } catch(_) {}
  
  try {
    $('#ccPaperBuy').on('click', () => FlowDashboard.executeBuyPaper());
  } catch(_) {}
  
  try {
    $('#ccRefresh').on('click', async () => {
      const res = await FlowDashboard.refreshMarketData();
      const msg = res?.success ? '시장 데이터 새로고침 완료' : '새로고침 실패';
      $('#systemStatus').text(msg);
    });
  } catch(_) {}
  
  try {
    $('#ccSave').on('click', () => FlowDashboard.saveCurrentCard && FlowDashboard.saveCurrentCard());
  } catch(_) {}

  // Real-time periodic autosave loop (every 30s, throttled to 60s)
  try {
    if (!window.autoSaveIntervalId) {
      window.autoSaveIntervalId = setInterval(() => {
        try {
          const now = Date.now();
          const last = Number(window.lastAutoSaveTs || 0);
          const elapsed = now - last;
          if (elapsed < 60000) return; // min 60s between saves
          if (!window.ccCurrentData) return; // need current card
          if (typeof window.autoSaveCurrentCard === 'function') {
            window.autoSaveCurrentCard();
          }
        } catch(e) { console.debug('Autosave loop error:', e?.message); }
      }, 30000);
    }
  } catch(_) {}
  
  // ============================================================================
  // Performance Monitor (FPS Style) + Data Management + Step Timing
  // ============================================================================
  (function initPerformanceMonitor() {
    let frameCount = 0;
    let lastTime = performance.now();
    let lastCpuCheck = 0;
    let lastCleanupCheck = 0;
    
    // Step timing tracker
    window.stepTimings = window.stepTimings || Array(10).fill(0);
    window.stepStartTime = null;
    
    // Track step timing
    window.trackStepStart = function(step) {
      window.stepStartTime = performance.now();
      console.log(`⏱️ Step ${step} started`);
    };
    
    window.trackStepEnd = function(step) {
      if (window.stepStartTime) {
        const duration = performance.now() - window.stepStartTime;
        window.stepTimings[step - 1] = duration;
        console.log(`✅ Step ${step} completed in ${duration.toFixed(2)}ms`);
        window.stepStartTime = null;
        updateTimingChart();
      }
    };
    
    // Render step timing chart
    function updateTimingChart() {
      const canvas = document.getElementById('perfTimingChart');
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;
      const barWidth = width / 10;
      const maxTime = Math.max(...window.stepTimings, 100);
      const padding = 2;
      
      // Clear canvas
      ctx.clearRect(0, 0, width, height);
      
      // Draw bars with gradient
      window.stepTimings.forEach((time, index) => {
        const barHeight = Math.max(2, (time / maxTime) * (height - padding));
        const x = index * barWidth;
        const y = height - barHeight;
        
        // Color based on time
        let color, shadowColor;
        if (time < 100) {
          color = '#0ecb81'; // green
          shadowColor = 'rgba(14, 203, 129, 0.6)';
        } else if (time < 500) {
          color = '#ffb703'; // yellow
          shadowColor = 'rgba(255, 183, 3, 0.6)';
        } else {
          color = '#f6465d'; // red
          shadowColor = 'rgba(246, 70, 93, 0.6)';
        }
        
        // Create gradient for bar
        const gradient = ctx.createLinearGradient(x, y, x, height);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, shadowColor);
        
        // Draw bar with rounded top
        ctx.fillStyle = gradient;
        ctx.beginPath();
        const barWidthActual = barWidth - 4;
        const radius = 2;
        ctx.moveTo(x + 2, height);
        ctx.lineTo(x + 2, y + radius);
        ctx.arcTo(x + 2, y, x + 2 + radius, y, radius);
        ctx.lineTo(x + barWidthActual - radius, y);
        ctx.arcTo(x + barWidthActual, y, x + barWidthActual, y + radius, radius);
        ctx.lineTo(x + barWidthActual, height);
        ctx.closePath();
        ctx.fill();
        
        // Add glow effect for high values
        if (time > 0) {
          ctx.shadowColor = shadowColor;
          ctx.shadowBlur = time > 500 ? 8 : 4;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });
      
      // Update average time
      const validTimings = window.stepTimings.filter(t => t > 0);
      if (validTimings.length > 0) {
        const avgTime = validTimings.reduce((a, b) => a + b, 0) / validTimings.length;
        const avgEl = document.getElementById('perfAvgTime');
        if (avgEl) {
          avgEl.textContent = `Avg: ${avgTime.toFixed(0)}ms`;
          avgEl.style.color = avgTime < 200 ? '#0ecb81' : avgTime < 500 ? '#ffb703' : '#f6465d';
        }
      }
    }
    
    // Data cleanup configuration
    const DATA_LIMITS = {
      candleCache: 500,      // 최대 캔들 데이터 수
      winHistory: 100,       // 최대 win 히스토리
      buyOrders: 50,         // 최대 매수 주문 수
      sellOrders: 50,        // 최대 매도 주문 수
      consoleLogLimit: 1000  // 콘솔 로그 제한
    };
    
    // Clean up accumulated data
    function cleanupData() {
      let cleaned = 0;
      
      try {
        // 1. Limit candle cache
        if (window.candleDataCache && window.candleDataCache.length > DATA_LIMITS.candleCache) {
          const excess = window.candleDataCache.length - DATA_LIMITS.candleCache;
          window.candleDataCache = window.candleDataCache.slice(-DATA_LIMITS.candleCache);
          cleaned += excess;
          console.log(`🧹 Cleaned ${excess} old candles`);
        }
        
        // 2. Limit buy orders
        if (window.buyOrdersCache && window.buyOrdersCache.length > DATA_LIMITS.buyOrders) {
          const excess = window.buyOrdersCache.length - DATA_LIMITS.buyOrders;
          window.buyOrdersCache = window.buyOrdersCache.slice(-DATA_LIMITS.buyOrders);
          cleaned += excess;
          console.log(`🧹 Cleaned ${excess} old buy orders`);
        }
        
        // 3. Limit sell orders
        if (window.sellOrdersCache && window.sellOrdersCache.length > DATA_LIMITS.sellOrders) {
          const excess = window.sellOrdersCache.length - DATA_LIMITS.sellOrders;
          window.sellOrdersCache = window.sellOrdersCache.slice(-DATA_LIMITS.sellOrders);
          cleaned += excess;
          console.log(`🧹 Cleaned ${excess} old sell orders`);
        }
        
        // 4. Clear old localStorage entries (older than 7 days)
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('flow_')) {
            try {
              const item = JSON.parse(localStorage.getItem(key));
              if (item.timestamp && item.timestamp < sevenDaysAgo) {
                localStorage.removeItem(key);
                cleaned++;
              }
            } catch (_) {}
          }
        }
        
        // 5. Force garbage collection hint (if available)
        if (window.gc) {
          window.gc();
        }
        
      } catch (err) {
        console.error('Cleanup error:', err);
      }
      
      return cleaned;
    }
    
    // Get cache size
    function getCacheSize() {
      let size = 0;
      try {
        size += (window.candleDataCache || []).length;
        size += (window.buyOrdersCache || []).length;
        size += (window.sellOrdersCache || []).length;
        size += (window.winHistoryCache || []).length;
      } catch (_) {}
      return size;
    }
    
    // Get localStorage size in KB
    function getStorageSize() {
      let size = 0;
      try {
        for (let key in localStorage) {
          if (localStorage.hasOwnProperty(key)) {
            size += localStorage[key].length + key.length;
          }
        }
      } catch (_) {}
      return (size / 1024).toFixed(1);
    }
    
    function updatePerfMonitor() {
      const currentTime = performance.now();
      frameCount++;
      
      // Update FPS (every 1 second)
      if (currentTime >= lastTime + 1000) {
        const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
        const fpsEl = document.getElementById('perfFPS');
        if (fpsEl) {
          fpsEl.textContent = fps;
          fpsEl.classList.remove('good', 'warning', 'critical');
          if (fps >= 50) {
            fpsEl.classList.add('good');
          } else if (fps >= 30) {
            fpsEl.classList.add('warning');
          } else {
            fpsEl.classList.add('critical');
          }
        }
        frameCount = 0;
        lastTime = currentTime;
      }
      
      // Update Memory, Cache, Storage (every 2 seconds)
      if (performance.memory && currentTime >= lastCpuCheck + 2000) {
        // Memory
        const memoryEl = document.getElementById('perfMemory');
        if (memoryEl) {
          const usedMB = (performance.memory.usedJSHeapSize / 1048576).toFixed(1);
          memoryEl.textContent = `${usedMB} MB`;
          
          const memPercent = (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100;
          memoryEl.classList.remove('good', 'warning', 'critical');
          if (memPercent < 60) {
            memoryEl.classList.add('good');
          } else if (memPercent < 80) {
            memoryEl.classList.add('warning');
          } else {
            memoryEl.classList.add('critical');
          }
        }
        
        // Cache size
        const cacheEl = document.getElementById('perfCache');
        if (cacheEl) {
          const cacheSize = getCacheSize();
          cacheEl.textContent = cacheSize;
          cacheEl.classList.remove('good', 'warning', 'critical');
          if (cacheSize < 300) {
            cacheEl.classList.add('good');
          } else if (cacheSize < 600) {
            cacheEl.classList.add('warning');
          } else {
            cacheEl.classList.add('critical');
          }
        }
        
        // Storage size
        const storageEl = document.getElementById('perfStorage');
        if (storageEl) {
          const storageSize = getStorageSize();
          storageEl.textContent = `${storageSize} KB`;
          storageEl.classList.remove('good', 'warning', 'critical');
          if (parseFloat(storageSize) < 500) {
            storageEl.classList.add('good');
          } else if (parseFloat(storageSize) < 1000) {
            storageEl.classList.add('warning');
          } else {
            storageEl.classList.add('critical');
          }
        }
        
        lastCpuCheck = currentTime;
      }
      
      // Update CPU (frame time estimate)
      const cpuEl = document.getElementById('perfCPU');
      if (cpuEl) {
        const frameTime = currentTime - (window.lastFrameTime || currentTime);
        window.lastFrameTime = currentTime;
        
        const cpuLoad = Math.min(100, Math.round((frameTime / 16.67) * 100));
        cpuEl.textContent = `${cpuLoad}%`;
        
        cpuEl.classList.remove('good', 'warning', 'critical');
        if (cpuLoad < 70) {
          cpuEl.classList.add('good');
        } else if (cpuLoad < 90) {
          cpuEl.classList.add('warning');
        } else {
          cpuEl.classList.add('critical');
        }
      }
      
      // Auto cleanup (every 5 minutes)
      if (currentTime >= lastCleanupCheck + 300000) {
        const cacheSize = getCacheSize();
        if (cacheSize > 500) {
          console.log('🧹 Auto cleanup triggered (cache size:', cacheSize, ')');
          cleanupData();
        }
        lastCleanupCheck = currentTime;
      }
      
      // Update timing chart periodically
      if (currentTime % 5000 < 100) { // every ~5 seconds
        updateTimingChart();
      }
      
      // Continue monitoring
      requestAnimationFrame(updatePerfMonitor);
    }
    
    // Manual cleanup button
    const cleanBtn = document.getElementById('perfCleanBtn');
    if (cleanBtn) {
      cleanBtn.addEventListener('click', () => {
        const cleaned = cleanupData();
        const statusEl = document.getElementById('systemStatus');
        if (statusEl) {
          statusEl.textContent = `🧹 정리 완료: ${cleaned}개 항목 삭제됨`;
        }
        console.log(`✅ Manual cleanup: ${cleaned} items removed`);
        
        // Visual feedback
        cleanBtn.style.transform = 'rotate(360deg)';
        cleanBtn.style.transition = 'transform 0.5s ease';
        setTimeout(() => {
          cleanBtn.style.transform = '';
        }, 500);
      });
    }
    
    // Start monitoring
    requestAnimationFrame(updatePerfMonitor);
    
    // Initialize caches if not exist
    window.candleDataCache = window.candleDataCache || [];
    window.buyOrdersCache = window.buyOrdersCache || [];
    window.sellOrdersCache = window.sellOrdersCache || [];
    window.winHistoryCache = window.winHistoryCache || [];
    
    // Initial chart render
    updateTimingChart();
    
    console.log('✅ Performance Monitor initialized (FPS style + Data Management + Step Timing)');
  })();
});
