const FlowDashboard = (() => {
  /**
   * Flow Dashboard Module
   * 8BIT Trading Bot - Flow-based Trading Interface
   */
  const state = window.flowDashboardState || {
    currentStep: 1,
    marketData: null,
    signalData: null,
    tradeData: null,
    selectedInterval: 'minute10',
    // 기본 타임프레임 순회 목록 (1분~60분)
    timeframes: ['minute1', 'minute3', 'minute5', 'minute10', 'minute15', 'minute30', 'minute60'],
    currentTfIndex: 3, // minute10
    nbWave: null,
    nbWaveZones: [],
    nbWaveZonesConsole: [],
    zoneSeries: [],
    nbStats: {},
    mlStats: {},
    waveSegmentCount: null,
    savedNbWaveData: null
  };

  // Timeframe label helper (UI-friendly labels)
  const timeframeLabel = {
    minute1: '1m',
    minute3: '3m',
    minute5: '5m',
    minute10: '10m',
    minute15: '15m',
    minute30: '30m',
    minute60: '1h',
    day: '1D'
  };

  // Client-side win snapshot history store
  let winClientHistory = Array.isArray(window.winClientHistory) ? window.winClientHistory : [];
  // Charts (instances)
  let winGradeTrendChart = null;
  let ccSummaryChart = null;

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
        // keep recent window to avoid unbounded growth
        if (window.candleDataCache.length > 600) {
          window.candleDataCache = window.candleDataCache.slice(-600);
        }
      } catch(_) {}
    }, 3000); // poll every 3s to keep UI fresh without overloading API
  }

  // Prefix API paths with optional base (for proxy/local usage)
  function withApiBase(path) {
    const base = window.API_BASE || '';
    if (!path) return base;
    if (/^https?:\/\//i.test(path)) return path;
    return `${base}${path}`;
  }

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

  function computeCardCodeFS(params) {
    const { priceMax, priceMin, volumeMax, volumeMin, amountMax, amountMin, nbBlue, nbOrange, nbBlueCount, nbOrangeCount, nbLastZone } = params || {};
    if ([priceMax, priceMin, volumeMax, volumeMin, amountMax, amountMin].some(v => v == null || isNaN(Number(v)))) {
      throw new Error('invalid params');
    }

    const toDiff = (max, min) => Number(max) - Number(min);

    const spreadPrice = toDiff(priceMax, priceMin);
    const spreadVol = toDiff(volumeMax, volumeMin);
    const spreadAmt = toDiff(amountMax, amountMin);

    // Guard: MAX must be greater than MIN for all metrics
    if (spreadPrice <= 0 || spreadVol <= 0 || spreadAmt <= 0) {
      return {
        code: 'INVALID_RANGE',
        league: '-',
        group: 'AUTO',
        super: false,
        avgDiff: 0,
        color: '#e6eefc',
        enhancement: 1,
        priceMax, priceMin, volumeMax, volumeMin, amountMax, amountMin,
        diffPrice: spreadPrice, diffVol: spreadVol, diffAmt: spreadAmt
      };
    }

    const diffPrice = Math.abs(spreadPrice);
    const diffVol = Math.abs(spreadVol);
    const diffAmt = Math.abs(spreadAmt);

    // Normalize within current card range (0~1) for grading letters
    const rPrice = Math.min(1, diffPrice / spreadPrice);
    const rVol = Math.min(1, diffVol / spreadVol);
    const rAmt = Math.min(1, diffAmt / spreadAmt);

    const rToLetter = (r) => {
      if (r >= 0.80) return 'S';
      if (r >= 0.70) return 'A';
      if (r >= 0.60) return 'B';
      if (r >= 0.50) return 'C';
      if (r >= 0.40) return 'D';
      if (r >= 0.30) return 'E';
      return 'F';
    };

    const pL = rToLetter(rPrice);
    const vL = rToLetter(rVol);
    const aL = rToLetter(rAmt);

    const avgR = (rPrice + rVol + rAmt) / 3; // 0~1

    // N/B bias: 오렌지 많으면 ↑, 블루 많으면 ↓, 최근 존 가중 포함
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const nbBlueRatio = Number.isFinite(nbBlue) ? clamp01(nbBlue) : 0.5;
    const nbOrangeRatio = Number.isFinite(nbOrange) ? clamp01(nbOrange) : (1 - nbBlueRatio);
    const ratioBias = 1 + (nbOrangeRatio - nbBlueRatio) * 0.6; // -0.6~+0.6

    const totalCnt = (Number.isFinite(nbBlueCount) ? nbBlueCount : 0) + (Number.isFinite(nbOrangeCount) ? nbOrangeCount : 0);
    const countBias = totalCnt > 0 ? 1 + ((nbOrangeCount - nbBlueCount) / totalCnt) * 0.4 : 1; // -0.4~+0.4

    const lastZoneBias = nbLastZone === 'ORANGE' ? 1.1 : (nbLastZone === 'BLUE' ? 0.9 : 1);

    const rawBias = ratioBias * countBias * lastZoneBias;
    const bias = Math.max(0.5, Math.min(1.5, rawBias));
    const biasedAvgR = Math.max(0, Math.min(1, avgR * bias));

    const sign = biasedAvgR >= 0.65 ? '+' : (biasedAvgR <= 0.45 ? '-' : '');
    const code = `${pL}${vL}${aL}${sign}`;

    const letterPts = { F:0, E:1, D:2, C:3, B:4, A:5, S:6 };
    const avgPtsRaw = (letterPts[pL] + letterPts[vL] + letterPts[aL]) / 3;
    const avgPts = (avgPtsRaw + (sign === '+' ? 0.25 : (sign === '-' ? -0.25 : 0))) * bias;

    const league = (() => {
      if (avgPts < 2.0) return '브론즈';
      if (avgPts < 3.0) return '실버';
      if (avgPts < 4.0) return '골드';
      if (avgPts < 5.0) return '플래티넘';
      if (avgPts < 5.75) return '다이아';
      return '첼린저';
    })();

    const group = avgPts < 2.5 ? 'EASY' : (avgPts < 4.5 ? 'NORMAL' : 'HARD');
    const countAS = [pL, vL, aL].filter(ch => ch === 'A' || ch === 'S').length;
    const countS = [pL, vL, aL].filter(ch => ch === 'S').length;
    const isSuper = (countS >= 2) || (avgPts >= 5.5) || (sign === '+' && countAS >= 2);

    // Magnitude boost: higher absolute levels -> higher enhancement (log scaled)
    const meanMax = (Number(priceMax) + Number(volumeMax) + Number(amountMax)) / 3;
    const magnitudeBoost = Math.log10(Math.max(1, meanMax) + 1);
    const magnitudeFactor = 0.7 + 0.3 * Math.min(2, magnitudeBoost) / 2;

    const enhancement = Math.min(99, Math.max(1, Math.round((biasedAvgR * 100) * magnitudeFactor)));
    const color = sign === '+' ? '#00d1ff' : (sign === '-' ? '#ffb703' : '#e6eefc');

    return {
      code,
      league,
      group,
      super: isSuper,
      avgDiff: (diffPrice + diffVol + diffAmt) / 3,
      color,
      enhancement,
      // Raw values to feed AI
      priceMax, priceMin, volumeMax, volumeMin, amountMax, amountMin,
      diffPrice, diffVol, diffAmt,
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

    if (ccSummaryChart) {
      try { ccSummaryChart.destroy(); } catch (_) {}
    }

    ccSummaryChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
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

  function updateWinGradeTrendChart(entries) {
    try {
      const list = Array.isArray(entries) ? entries.slice(0, 60) : [];
      const ordered = list.slice().reverse();
      const labels = [];
      const data = [];
      ordered.forEach(item => {
        const ts = item.ts ? new Date(item.ts) : new Date();
        labels.push(ts.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
        const val = Number(item.avgPts != null ? item.avgPts : 0);
        data.push(Number(val.toFixed(2)));
      });

      const labelEl = document.getElementById('winGradeTrendLabel');
      if (labelEl) {
        labelEl.textContent = data.length ? `${data[data.length - 1].toFixed(2)} pts` : '-';
      }

      const ctx = document.getElementById('winGradeTrendChart');
      if (!ctx || typeof Chart === 'undefined') return;

      if (winGradeTrendChart) {
        winGradeTrendChart.data.labels = labels;
        winGradeTrendChart.data.datasets[0].data = data;
        winGradeTrendChart.update();
        return;
      }

      winGradeTrendChart = new Chart(ctx, {
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
              ticks: { color: '#d9e2f3', font: { size: 10 } },
              grid: { color: 'rgba(255,255,255,0.08)' }
            },
            x: {
              ticks: { color: '#9aa8c2', font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
              grid: { display: false }
            }
          },
          plugins: { legend: { display: false }, tooltip: { enabled: true } }
        }
      });
    } catch (e) {
      console.warn('win grade trend error:', e?.message);
    }
  }

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
      const cc = ccCurrentData;
      const cr = ccCurrentRating;
      if (!cc || !cr) return;

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
      if (!zone || zone === 'NONE') return;

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
      winClientHistory = winClientHistory.slice(0, 200);
      window.winClientHistory = winClientHistory;
      renderWinPanel();
    } catch (e) {
      console.warn('addCurrentWinSnapshot error:', e?.message);
    }
  }

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
        
        // 온라인 학습 트리거: 카드 등급 + 강화도 저장
        if (ccCurrentRating && ccCurrentRating.enhancement) {
          triggerAutoTraining(ccCurrentData, ccCurrentRating.enhancement);
        }
      } else {
        console.warn('⚠️ 자동 저장 실패:', result?.error || 'Unknown');
      }
    } catch (err) {
      console.warn('⚠️ 자동 저장 에러:', err?.message);
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
        
        // Create baseline series (chart stays unchanged)
        const nbWaveSeries = chart.addBaselineSeries({
          baseValue: { type: 'price', price: data.base },
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
        
        // Set wave data
        nbWaveSeries.setData(data.wave_data);
        
        // Persist for reuse (Step 1 zone status, current card)
        state.nbWave = { 
          data: data.wave_data, 
          base: data.base,
          summary: data.summary || null,
          fromAPI: true
        };
        // Keep a simple zone series & zone array for current card mini strip
        try {
          const base = Number(data.base || 0);
          // Generate zone array using BaselineSeries rule: value > base = ORANGE, else BLUE
          const zoneArrayBaseline = data.wave_data.map(pt => (Number(pt.value) > base ? 'ORANGE' : 'BLUE'));
          const zoneSeries = data.wave_data.map(pt => ({ value: Number(pt.value), base, zone: pt.zone || (Number(pt.value) > base ? 'ORANGE' : 'BLUE') }));
          
          state.zoneSeries = zoneSeries;
          state.nbWaveZones = zoneArrayBaseline; // pure ORANGE/BLUE array by baseline rule for reuse
          state.nbWaveZonesConsole = zoneArrayBaseline; // expose to console
          window.nbWaveZonesConsole = zoneArrayBaseline; // also attach to window for direct console access
          // Update current zone to the last zone from array
          state.currentZone = zoneArrayBaseline[zoneArrayBaseline.length - 1] || 'BLUE';
          console.log('📊 N/B Wave zones (baseline rule):', zoneArrayBaseline);
          console.log('📊 Current zone (last):', state.currentZone);
        } catch(_){ }
        
        console.log('✅ N/B Wave rendered from API');
      } catch (error) {
        console.error('❌ N/B Wave API error:', error);
        throw error;
      }
    },

    renderNBWaveClientSide(chart, validRows, sortedCandles) {
      try {
        console.log('🌊 Rendering N/B Wave (client-side fallback)');
        
        const clamp = (v, lo=0, hi=100) => Math.min(hi, Math.max(lo, v));
        const nbWaveSeries = chart.addBaselineSeries({
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

    renderPriceChart(chartData) {
      const container = document.getElementById('step2Graph');
      if (!container) {
        console.error('Chart container not found');
        return;
      }
      
      // Cleanup existing chart
      if (container._chartInstance) {
        try {
          container._chartInstance.remove();
        } catch (e) {
          console.warn('Chart cleanup warning:', e);
        }
      }
      if (container._resizeObserver) {
        container._resizeObserver.disconnect();
      }
      
      // Clear existing content
      container.innerHTML = '';
      // Ensure positioning for overlays
      if (!container.style.position || container.style.position === 'static') {
        container.style.position = 'relative';
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
        // Create chart - index.html과 동일한 옵션
        const chart = LightweightCharts.createChart(container, {
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
            fixLeftEdge: true,
            fixRightEdge: true
          },
          crosshair: { mode: LightweightCharts.CrosshairMode.Magnet },
          handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
          handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: false }
        });
        
        // Add candlestick series - index.html과 동일한 색상
        const candleSeries = chart.addCandlestickSeries({ 
          upColor: '#0ecb81', 
          downColor: '#f6465d', 
          wickUpColor: '#0ecb81', 
          wickDownColor: '#f6465d', 
          borderVisible: false 
        });
        
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

        // 거래량 히스토그램 시리즈 추가 (상승/하락 색상 분리)
        const volumeSeries = chart.addHistogramSeries({
          color: '#26a69a',
          lineWidth: 1,
          priceFormat: { type: 'volume' },
          priceScaleId: 'left',
          overlay: true,
          scaleMargins: { top: 0.8, bottom: 0 }
        });

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
        volumeSeries.setData(volumeData);

        // Initialize global candle cache for live UI updates
        try {
          window.candleDataCache = Array.isArray(sortedCandles) ? sortedCandles.slice() : [];
        } catch(_) {}

        // Start live polling for latest candle to keep current price moving
        try { startLivePricePolling(state.selectedInterval); } catch(_) {}

        // --- N/B wave overlay using server API ---
        this.renderNBWaveFromAPI(chart, state.selectedInterval).catch(err => {
          console.warn('N/B Wave API failed, falling back to client calculation:', err);
          // Fallback to client-side calculation
          this.renderNBWaveClientSide(chart, validRows, sortedCandles);
        });

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

        const emaFastSeries = chart.addLineSeries({ color: 'rgba(14,203,129,0.9)', lineWidth: 2, priceLineVisible: false });
        const emaSlowSeries = chart.addLineSeries({ color: 'rgba(246,70,93,0.9)', lineWidth: 2, priceLineVisible: false });
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
        const sma50Series = chart.addLineSeries({ color: '#9aa0a6', lineWidth: 1, priceLineVisible: false });
        const sma100Series = chart.addLineSeries({ color: '#c7cbd1', lineWidth: 1, priceLineVisible: false });
        const sma200Series = chart.addLineSeries({ color: '#e0e3e7', lineWidth: 1, priceLineVisible: false });
        sma50Series.setData(sma50);
        sma100Series.setData(sma100);
        sma200Series.setData(sma200);

        // --- EMA 9/12/26 overlays ---
        const ema9 = ema(closes, 9).map((v, i) => ({ time: times[i], value: v })).filter(p => p.value !== undefined);
        const ema12 = ema(closes, 12).map((v, i) => ({ time: times[i], value: v })).filter(p => p.value !== undefined);
        const ema26 = ema(closes, 26).map((v, i) => ({ time: times[i], value: v })).filter(p => p.value !== undefined);
        const ema9Series = chart.addLineSeries({ color: '#ffd166', lineWidth: 1, priceLineVisible: false });
        const ema12Series = chart.addLineSeries({ color: '#fca311', lineWidth: 1, priceLineVisible: false });
        const ema26Series = chart.addLineSeries({ color: '#fb8500', lineWidth: 1, priceLineVisible: false });
        ema9Series.setData(ema9);
        ema12Series.setData(ema12);
        ema26Series.setData(ema26);

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
        legend.innerHTML = `
          <div style="display:flex; gap:8px; align-items:center;">
            <span style="display:inline-flex; align-items:center; gap:4px;"><span style="width:10px;height:2px;background:rgba(14,203,129,0.9);"></span>EMA10</span>
            <span style="display:inline-flex; align-items:center; gap:4px;"><span style="width:10px;height:2px;background:rgba(246,70,93,0.9);"></span>EMA30</span>
          </div>
          <div style="margin-top:4px;">NB Trust: ${nbTrustTxt}</div>
          <div>ML Trust: ${mlTrustTxt}</div>
        `;

        chart.timeScale().fitContent();

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
        
        // Store chart instance for cleanup
        container._chartInstance = chart;
        
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
        autoSaveCurrentCard();

        // Win% snapshot (카드 등급/존 기록)
        setTimeout(() => {
          try { addCurrentWinSnapshot(interval); } catch (e) { console.warn('win snapshot err', e?.message); }
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
        console.log('🔵 ML API ml_trust:', data.ml_trust, '| zone:', data.zone, '| insight:', data.insight);
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
        body: JSON.stringify({ paper, ...meta, meta })
      });
      return await resp.json();
    },

    async executeSell(paper = false) {
      const resp = await fetch(withApiBase('/api/trade/sell'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper })
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
          
          // Chart status
          $('#chartStatus').text(state.selectedInterval);
          $('#chartDetail').text(`차트 데이터 준비 중...`);
          
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
        const data = await API.executeSell(false);
        
        if (data.ok && data.order) {
          state.tradeData = data.order;
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
  // Public Interface
  // ============================================================================
  return {
    state,
    ProgressCycle, // Export ProgressCycle for external access
    
    init() {
      console.log('Flow Dashboard initialized');
      
      // 데이터 로딩 시작 (Step 1부터 시작)
      this.initializeData();
      
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
            UI.renderPriceChart(chartData);
            
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

        // 10번: 추가 기능 (현재는 대기)
        ProgressCycle.startStep(10);
        console.log('Step 10 started');
        await new Promise(resolve => setTimeout(resolve, 3000)); // 3초 대기
        ProgressCycle.completeStep(10);
        console.log('Step 10 completed');
        
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
      try { autoSaveCurrentCard(); } catch(e) { console.warn('manual save error:', e?.message); }
    },

    resetFlow() {
      state.currentStep = 1;
      state.marketData = null;
      state.signalData = null;
      state.tradeData = null;
      StepManager.activateStep(1);
      DataManager.refreshMarketData();
    },

    viewTradeHistory() {
      window.open('/api/orders', '_blank');
    }
  };
})();

// Expose globally for inline handlers and external calls
window.FlowDashboard = FlowDashboard;

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

    const elMeta = document.getElementById('assetsMeta');
    if (elMeta) elMeta.textContent = `업데이트: ${now} • ${source}`;
    const elTotal = document.getElementById('assetTotal');
    const elBuyable = document.getElementById('assetBuyable');
    const elBtcAmt = document.getElementById('assetBtcAmount');
    const elBtcVal = document.getElementById('assetBtcValue');
    if (elTotal) elTotal.textContent = Math.round(assetTotal).toLocaleString() + ' KRW';
    if (elBuyable) elBuyable.textContent = Math.round(assetBuyable).toLocaleString() + ' KRW';
    if (elBtcAmt) elBtcAmt.textContent = `${btcAmount.toFixed(8)} BTC`;
    if (elBtcVal) elBtcVal.textContent = `${Math.round(currentValue).toLocaleString()} KRW`;

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
// Step 8: 매수 완료 카드
// ============================================================================

async function loadBuyCards8() {
  let buyOrders = [];
  let processStep = 1;
  const UPBIT_FEE = 0.001; // 업비트 0.1% 수수료
  const startTime = Date.now();
  const MIN_DURATION = 1000; // 최소 1초 유지
  
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
          try {
            const cachedBuyOrders = localStorage.getItem('buyOrdersCache');
            if (cachedBuyOrders) {
              buyOrders = JSON.parse(cachedBuyOrders);
              console.log('💾 캐시에서 매수 카드 복원:', buyOrders.length, '개');
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
              // nb_price_max를 우선, 없으면 price 사용
              const nbValue = Number(order.nb_price_max || order.price || 0);
              if (!nbValue) {
                order.nbverse_updated = false;
                return order;
              }

              const nbResult = await window.API?.loadNbverseByNb(nbValue, 'max');

              if (nbResult?.ok && nbResult.data) {
                const nbData = nbResult.data;
                order.nbverse_data = nbData;
                order.nb_price = nbData.nb_value ?? nbData.nb ?? order.nb_price_max ?? order.nb_price;
                order.nb_price_max = nbData.nb_value ?? order.nb_price_max;
                order.nb_price_min = nbData.nb_price_min ?? order.nb_price_min;
                order.nb_volume = nbData.volume ?? order.nb_volume;
                order.nb_zone = nbData.zone ?? order.nb_zone;
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
        // Step 8-5: 매수 된 카드의 손익 업데이트 (업비트 0.1% 수수료 포함)
        // ============================================================================
      case 5:
        updateStep8Status(5, '손익 계산 중...');
        // 현재가(최신 캔들의 종가) 추출
        let currentPrice = 0;
        try {
          const lastCandle = (window.candleDataCache || []).slice(-1)[0];
          currentPrice = Number(lastCandle?.close || lastCandle?.value || 0) || 0;
        } catch (_) { }
        
        if (currentPrice <= 0 && buyOrders.length > 0) {
          currentPrice = Number(buyOrders[0]?.price || 0) || 0;
        }

        // 여전히 0이면 서버에서 최신가 한 번 더 조회 (보안상 API 경유)
        if (currentPrice <= 0) {
          try {
            const interval = window.FlowDashboard?.state?.selectedInterval || 'minute10';
            const chartResp = await API.getChartData(interval);
            const rows = Array.isArray(chartResp?.data) ? chartResp.data : [];
            const last = rows[rows.length - 1];
            const apiClose = Number(last?.close || 0) || 0;
            if (apiClose > 0) currentPrice = apiClose;
          } catch (e) {
            console.warn('최신가 API 조회 실패:', e?.message);
          }
        }

        let totalPnL = 0;
        buyOrders = buyOrders.map((order, idx) => {
          const buyPrice = Number(order.price || 0);
          const quantity = Number(order.size || 0);
          
          // 수수료 적용 (진입가, 청산가)
          const entryPrice = buyPrice * (1 + UPBIT_FEE); // 진입 시 수수료 추가
          const exitPrice = currentPrice * (1 - UPBIT_FEE); // 청산 시 수수료 차감
          
          // 손익 계산
          const purchaseAmount = buyPrice * quantity; // 실제 구매액
          const currentValue = currentPrice * quantity; // 현재가치
          const pnlBeforeFee = currentValue - purchaseAmount; // 수수료 전 손익
          const totalFee = (buyPrice * quantity * UPBIT_FEE) + (currentPrice * quantity * UPBIT_FEE);
          const pnlAfterFee = pnlBeforeFee - totalFee; // 수수료 후 손익
          const pnlRate = purchaseAmount > 0 ? (pnlAfterFee / purchaseAmount) * 100 : 0;
          
          order.current_price = currentPrice;
          order.purchase_amount = purchaseAmount;
          order.current_value = currentValue;
          order.pnl_before_fee = pnlBeforeFee;
          order.total_fee = totalFee;
          order.pnl = pnlAfterFee;
          order.pnl_rate = pnlRate;
          order.pnl_updated = true;
          order.pnl_timestamp = new Date().toISOString();
          
          totalPnL += pnlAfterFee;
          
          if (idx < 3) { // 첫 3개만 로그
            console.log(`  카드#${idx+1} 손익: ${pnlAfterFee.toFixed(0)}원 (${pnlRate.toFixed(2)}%) | 수수료: ${totalFee.toFixed(0)}원`);
          }
          
          return order;
        });
        
        updateStep8Status(5, `손익 업데이트 완료 ✅ (총: ${totalPnL.toFixed(0)}원)`);
        processStep++;
        break;
    }

    // ============================================================================
    // 최종: 렌더링 및 반환
    // ============================================================================
    const hasBuyCards = Array.isArray(buyOrders) && buyOrders.length > 0;
    const currentInterval = window.FlowDashboard?.state?.selectedInterval || 'minute10';
    
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
        sellOrders = sellData.cards || [];
      }
    } catch (e) {
      console.error('Failed to load sell cards:', e);
    }

    console.log('📊 Step 9 - 매도 카드:', sellOrders.length, '개');

    // 판매 실현 손익 계산 (FIFO 매칭)
    const sortedBuys = [...buyOrders].sort((a, b) => Number(a.time || a.ts || 0) - Number(b.time || b.ts || 0));
    const sortedSells = [...sellOrders].sort((a, b) => Number(a.time || a.ts || 0) - Number(b.time || b.ts || 0));
    const buyQueue = sortedBuys.map(o => ({
      size: Number(o.size || 0),
      price: Number(o.price || 0)
    }));
    let realizedTotal = 0;
    let realizedMax = 0;
    let realizedCount = 0;
    sortedSells.forEach(sell => {
      let remain = Number(sell.size || 0);
      const sellPrice = Number(sell.price || 0);
      let sellProfit = 0;
      while (remain > 0 && buyQueue.length > 0) {
        const buy = buyQueue[0];
        const qty = Math.min(remain, buy.size);
        sellProfit += (sellPrice - buy.price) * qty;
        buy.size -= qty;
        remain -= qty;
        if (buy.size <= 0.00000001) buyQueue.shift();
      }
      if (remain > 0) {
        sellProfit += (sellPrice * remain);
        remain = 0;
      }
      realizedTotal += sellProfit;
      realizedMax = Math.max(realizedMax, sellProfit);
      realizedCount += 1;
    });
    const realizedAvg = realizedCount > 0 ? (realizedTotal / realizedCount) : 0;

    // 매도 통계
    const sellTotal = sellOrders.reduce((sum, o) => sum + (Number(o.price || 0) * Number(o.size || 0)), 0);
    const sellAvg = sellOrders.length > 0 ? sellTotal / sellOrders.length : 0;

    // 현재가 추출
    let lastPrice = 0;
    try {
      const lastCandle = (window.candleDataCache || []).slice(-1)[0];
      lastPrice = Number(lastCandle?.close || lastCandle?.value || 0) || 0;
    } catch (_) { lastPrice = 0; }
    if (!lastPrice && (buyOrders.length + sellOrders.length) > 0) {
      lastPrice = Number(buyOrders[0]?.price || sellOrders[0]?.price || 0) || 0;
    }

    // 보유 수량/잔존 원가/현재 손익 계산
    const buyTotal = buyOrders.reduce((sum, o) => sum + (Number(o.price || 0) * Number(o.size || 0)), 0);
    const buySizeTotal = buyOrders.reduce((sum, o) => sum + Number(o.size || 0), 0);
    const sellSizeTotal = sellOrders.reduce((sum, o) => sum + Number(o.size || 0), 0);
    const netSize = buySizeTotal - sellSizeTotal;
    const remainingCost = Math.max(0, buyTotal - sellTotal);
    const currentValue = netSize > 0 ? (lastPrice * netSize) : 0;
    
    // 수수료 계산
    const buyFee = buyTotal * 0.001;
    const sellFee = sellTotal * 0.001;
    const totalFees = buyFee + sellFee;
    
    // 미실현 손익
    const unrealizedFeeAdjustment = netSize > 0 ? (currentValue * 0.001) : 0;
    const unrealized = currentValue - remainingCost - buyFee - unrealizedFeeAdjustment;
    const unrealizedRate = remainingCost > 0 ? (unrealized / remainingCost) * 100 : 0;

    // 매도 통계 업데이트
    document.getElementById('sellCount').textContent = sellOrders.length;
    document.getElementById('sellTotalAmount').textContent = Math.round(sellTotal).toLocaleString() + ' KRW';
    document.getElementById('sellAvgPrice').textContent = Math.round(sellAvg).toLocaleString() + ' KRW';
    
    // 총 수익 & 수익률
    const totalProfit = Math.round(realizedTotal + unrealized);
    const profitRate = remainingCost > 0 ? ((totalProfit / remainingCost) * 100) : 0;
    
    document.getElementById('totalProfit').textContent = totalProfit.toLocaleString() + ' KRW';
    document.getElementById('totalProfit').style.color = totalProfit >= 0 ? '#0ecb81' : '#f6465d';
    document.getElementById('profitRate').textContent = profitRate.toFixed(2) + '%';
    document.getElementById('profitRate').style.color = profitRate >= 0 ? '#0ecb81' : '#f6465d';

    // 현재 interval 가져오기
    const currentInterval = window.FlowDashboard?.state?.selectedInterval || 'minute10';
    
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

async function renderBuyOrderList(orders, interval) {
  const container = document.getElementById('buyOrderList');
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = '<div class="text-center text-muted py-2">매수 내역이 없습니다</div>';
    return;
  }

  const tfi = interval || 'minute10';
  const tfMap = { minute1: '1m', minute3: '3m', minute5: '5m', minute10: '10m', minute15: '15m', minute30: '30m', minute60: '1h', day: '1D' };
  const tfLabel = tfMap[tfi] || tfi;

  // 최신가(현재가) 추출: 차트 캐시 → 첫 매수 가격
  let latestPrice = (() => {
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

  // 각 카드의 NBverse 정보를 조회하여 표시
  const cardsWithNbverse = await Promise.all(
    orders.slice(0, 50).map(async (o, idx) => {
      const price = Number(o.price || 0);
      let nbverseInfo = null; // 검색 사용 안 함

      return { order: o, index: idx, nbverseInfo };
    })
  );

  container.innerHTML = cardsWithNbverse.map(({ order: o, index: idx, nbverseInfo }) => {
    const price = Number(o.price || 0);
    const size = Number(o.size || 0);
    const totalKrw = (price * size).toFixed(0);
    const time = o.time ? new Date(o.time).toLocaleString('ko-KR') : (o.ts ? new Date(o.ts).toLocaleString('ko-KR') : '-');
    
    // N/B 데이터 (조회된 NBverse 정보 우선 사용)
    const nbPriceOld = o.nb_price || nbverseInfo?.nbPrice || o.nbPrice || '-';
    const nbVolume = o.nb_volume || nbverseInfo?.currentVolume || o.nbVolume || '-';
    const nbInterval = o.nbverse_interval || nbverseInfo?.interval || tfLabel;
    
    // 카드 등급: 우선 card_rating 객체의 code/league/enhancement 사용, 없으면 NB값으로 산정
    let rating = '-';
    let ratingScore = '-';
    let ratingDetail = '-';
    let mlRating = '';

    const cardRatingObj = (
      o.card_rating || o.cardRating ||
      (o.nbverse_data && (o.nbverse_data.card_rating || o.nbverse_data.card?.card_rating))
    );
    if (cardRatingObj && typeof cardRatingObj === 'object') {
      rating = cardRatingObj.code || cardRatingObj.league || rating;
      if (cardRatingObj.enhancement !== undefined && cardRatingObj.enhancement !== null) {
        ratingScore = String(cardRatingObj.enhancement);
      } else if (cardRatingObj.bias !== undefined && cardRatingObj.bias !== null) {
        ratingScore = `${(cardRatingObj.bias * 100).toFixed(1)}%`;
      } else if (cardRatingObj.magnitudeBoost !== undefined && cardRatingObj.magnitudeBoost !== null) {
        ratingScore = cardRatingObj.magnitudeBoost.toFixed(1);
      }
      // 리그/그룹 정보
      if (cardRatingObj.league) {
        ratingDetail = cardRatingObj.league;
        if (cardRatingObj.group) ratingDetail += ` ${cardRatingObj.group}`;
      }
    } else if (o.rating_score || o.ratingScore) {
      ratingScore = o.rating_score || o.ratingScore;
      rating = o.card_rating || o.cardRating || rating;
    }

    // 강화 수치 부호: BLUE(+1) → +, ORANGE(-1) → -
    // 우선순위: 현재 zone > zone_flag > nb_zone
    let zoneForSign = o.nb_zone?.zone || o.nb_zone || o.insight?.zone || '';
    if (!zoneForSign && o.insight?.zone_flag) {
      zoneForSign = o.insight.zone_flag > 0 ? 'BLUE' : 'ORANGE';
    }
    const parsedScore = Number(ratingScore);
    if (!Number.isNaN(parsedScore) && typeof zoneForSign === 'string') {
      const sign = zoneForSign.toUpperCase() === 'BLUE' ? '+' : (zoneForSign.toUpperCase() === 'ORANGE' ? '-' : '');
      ratingScore = `${sign}${parsedScore}`;
    }

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

    // 손익 계산 (0.1% 수수료 포함)
    const cost = price * size;
    const buyFee = cost * 0.001; // 매수 수수료 0.1%
    const totalCost = cost + buyFee;
    
    const currentValue = latestPrice * size;
    const sellFee = currentValue * 0.001; // 매도 수수료 0.1%
    const totalSellValue = currentValue - sellFee;
    
    const pnl = totalSellValue - totalCost;
    const pnlRate = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
    const pnlColor = pnl >= 0 ? '#0ecb81' : '#f6465d';
    const pnlSign = pnl > 0 ? '+' : '';
    const lossAmount = pnl < 0 ? pnl : 0;
    const lossRate = pnl < 0 ? pnlRate : 0;
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
            <div style="color: #00d1ff; font-weight: 600; margin-top: 3px;">분봉: <span>${tfLabel}</span></div>
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

      <!-- 손익 (강조 표시) -->
      <div style="background: linear-gradient(135deg, rgba(${pnl >= 0 ? '46,204,113' : '246,70,93'},0.15), rgba(${pnl >= 0 ? '46,204,113' : '246,70,93'},0.05)); border-radius: 8px; padding: 12px; border: 2px solid rgba(${pnl >= 0 ? '46,204,113' : '246,70,93'},0.4); margin-top: 8px;" data-pnl>
        <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="font-size: 12px; font-weight: 600; color: #ffffff;">💰 현재가 기준 손익</div>
          <div style="font-size: 14px; font-weight: 700; color: ${pnlColor}; text-shadow: 0 0 8px ${pnlColor};">${pnlSign}${Math.round(pnl).toLocaleString()} KRW</div>
        </div>
        <div style="display:flex; justify-content: space-between; align-items: center; font-size: 11px;">
          <div class="text-muted">수익률</div>
          <div style="font-weight: 700; color: ${pnlColor};">${pnlSign}${pnlRate.toFixed(2)}%</div>
        </div>
      </div>

      <!-- 매도 버튼 -->
      <button onclick="executeSellForCard('${idx}', ${price}, ${size}, '${o.market || 'KRW-BTC'}')" 
        style="width: 100%; background: linear-gradient(135deg, #f6465d 0%, #e63946 100%); border: none; border-radius: 8px; padding: 12px; margin-top: 10px; font-size: 13px; font-weight: 700; color: #ffffff; cursor: pointer; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(246,70,93,0.3);"
        onmouseover="this.style.boxShadow='0 6px 16px rgba(246,70,93,0.5)'; this.style.transform='translateY(-2px)';"
        onmouseout="this.style.boxShadow='0 4px 12px rgba(246,70,93,0.3)'; this.style.transform='translateY(0)';">
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

        // 각 카드의 손익을 업데이트
        orders.forEach((o, idx) => {
          const cardEl = document.querySelector(`[data-buy-card="${idx}"]`);
          if (cardEl) {
            const buyPrice = Number(o.price || 0);
            const size = Number(o.size || 0);
            
            // 수수료 계산 (0.1%)
            const buyCost = buyPrice * size;
            const buyFee = buyCost * 0.001;
            const totalCost = buyCost + buyFee;
            
            const currentValue = updatedPrice * size;
            const sellFee = currentValue * 0.001;
            const totalValue = currentValue - sellFee;
            
            const pnl = totalValue - totalCost;
            const pnlRate = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
            const pnlColor = pnl >= 0 ? '#0ecb81' : '#f6465d';
            
            const pnlEl = cardEl.querySelector('[data-pnl]');
            if (pnlEl) {
              pnlEl.innerHTML = `
                <div style="font-size: 14px; font-weight: 700; color: ${pnlColor};">
                  ${pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString()} KRW
                </div>
                <div style="font-size: 11px; color: ${pnlColor}; margin-top: 2px;">
                  ${pnlRate.toFixed(2)}%
                </div>
              `;
            }
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
    
    // N/B 데이터
    const nbPrice = o.nb_price || o.nbPrice || '-';
    const nbVolume = o.nb_volume || o.nbVolume || '-';
    const nbTurnover = o.nb_turnover || o.nbTurnover || '-';
    
    // 카드 등급
    const rating = o.card_rating || o.cardRating || '-';
    const ratingScore = o.rating_score || o.ratingScore || '-';
    
    // Zone & Trust
    const nbZone = o.nb_zone || o.nbZone || '-';
    const mlTrust = o.ml_trust || o.mlTrust || '-';

    return `<div style="background: linear-gradient(135deg, rgba(246,70,93,0.15), rgba(246,70,93,0.05)); border: 2px solid rgba(246,70,93,0.3); border-radius: 12px; padding: 12px; margin-bottom: 14px; box-shadow: 0 4px 8px rgba(0,0,0,0.3);">
      <!-- 헤더 -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div style="font-weight: 700; font-size: 14px; color: #f6465d;">💰 매도 #${idx + 1}</div>
        <div style="font-size: 10px; color: #888;">${time}</div>
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
async function executeSellForCard(cardIdx, price, size, market) {
  try {
    const confirmSell = confirm(`매도 확인\n\n가격: ${price.toLocaleString()} KRW\n수량: ${size.toFixed(8)}\n거래대금: ${(price * size).toLocaleString()} KRW\n\n매도 하시겠습니까?`);
    if (!confirmSell) return;

    const sellPayload = {
      market: market || 'KRW-BTC',
      price: price,
      size: size,
      paper: false,
      interval: FlowDashboard.state?.timeframe || 'minute10'
    };

    const res = await fetch('http://127.0.0.1:5057/api/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sellPayload)
    });

    if (res.ok) {
      const result = await res.json();
      if (result.success || result.ok) {
        alert('✅ 매도 주문이 접수되었습니다');
        // 매도 내역 새로고침
        if (FlowDashboard.loadBuyOrders) {
          await FlowDashboard.loadBuyOrders();
        }
      } else {
        alert(`⚠️ 매도 실패: ${result.message || result.error || '알 수 없는 오류'}`);
      }
    } else {
      alert(`❌ 매도 요청 실패 (HTTP ${res.status})`);
    }
  } catch (e) {
    alert(`❌ 매도 중 오류: ${e?.message}`);
  }
}

// ============================================================================
// Initialize on DOM Ready
// ============================================================================
$(document).ready(function() {
  FlowDashboard.init();
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
});
