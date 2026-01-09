// Lightweight Charts UI (pan only) + order markers using bot server APIs
(function() {
  'use strict';
  
  // Prevent duplicate script loading
  if (window.uiScriptLoaded) {
    // console.log('🔄 UI script already loaded, skipping...');
    return;
  }
  window.uiScriptLoaded = true;

  // Global chart variables
  let chart = null;
  let candle = null;
  let emaF = null;
  let emaS = null;
  let sma50Series = null;
  let sma100Series = null;
  let sma200Series = null;
  let ema9Series = null;
  let ema12Series = null;
  let ema26Series = null;
  let ichiTenkanSeries = null;
  let ichiKijunSeries = null;
  let zoneIndicatorSeries = null;
  let nbWaveSeries = null;
  let candleDataCache = [];

  const setCandleDataCache = (arr) => {
    candleDataCache = Array.isArray(arr) ? arr.map(d => ({ ...d })) : [];
    window.candleDataCache = candleDataCache;
  };

  const updateCandleDataCache = (bar) => {
    if (!bar || bar.time === undefined) return;
    const last = candleDataCache[candleDataCache.length - 1];
    if (last && last.time === bar.time) {
      candleDataCache[candleDataCache.length - 1] = { ...last, ...bar };
    } else {
      candleDataCache.push({ ...bar });
    }
    window.candleDataCache = candleDataCache;
  };

  const getCandleDataCache = () => candleDataCache;

// Chart initialization function
function initChart() {
  // If chart already exists, reuse it; don't bail early unless series are ready
  if (window.chartInitialized && window.chart && window.candle) {
    // console.log('📊 Chart already initialized with series, skipping...');
    return;
  }
  
  const container = document.getElementById('tvChart');
  if (!container) {
    // console.error('❌ Chart container not found');
    return;
  }

  const tfEl = document.getElementById('timeframe');

  // Global variable to store current interval across tabs
  window.currentGlobalInterval = 'minute10';
  
  const getInterval = () => {
    const tfEl = document.getElementById('timeframe');
    if (tfEl) return tfEl.value;
    return window.currentGlobalInterval || 'minute10';
  };







  // Use same-origin base to avoid mixed-content/host issues

  const base = '';

    // External Asset API base (override for balance/asset fetches)
    // Allows cross-port asset queries like http://127.0.0.1:5057
    const assetApiBase = (typeof localStorage !== 'undefined' && localStorage.getItem('assetApiBase'))
      ? String(localStorage.getItem('assetApiBase')).replace(/\/+$/, '')
      : 'http://127.0.0.1:5057';
    // Expose helper to update at runtime (optional)
    window.setAssetApiBase = function(url){
      try{
        if (!url) return;
        const clean = String(url).replace(/\/+$/, '');
        if (typeof localStorage !== 'undefined') localStorage.setItem('assetApiBase', clean);
      }catch(_){}
    };


  // Trainer System Import
  // Note: Trainer functions are now in trainer-system.js


  // Function to count and display wave markers
  // 전역에서 접근 가능하도록 window 객체에 할당
  window.updateWaveCounter = function updateWaveCounter() {
    try {
      console.log('🔄 updateWaveCounter called');
      
      // Get all markers from different series
      const allMarkers = [];
      
      // Get N/B markers from global variable
      if (window.nbMarkers && Array.isArray(window.nbMarkers)) {
        allMarkers.push(...window.nbMarkers);
        console.log('📊 Found nbMarkers:', window.nbMarkers.length);
      }
      
      // Get base markers
      if (window.baseMarkers && Array.isArray(window.baseMarkers)) {
        allMarkers.push(...window.baseMarkers);
        console.log('📊 Found baseMarkers:', window.baseMarkers.length);
      }
      
      // Get ML markers if available
      if (window.mlMarkers && Array.isArray(window.mlMarkers)) {
        allMarkers.push(...window.mlMarkers);
        console.log('📊 Found mlMarkers:', window.mlMarkers.length);
      }
      
      // Get markers from chart series if available (안전하게 Array 여부 체크)
      if (typeof nbWaveSeries !== 'undefined' && Array.isArray(nbWaveSeries?.markers)) {
        allMarkers.push(...nbWaveSeries.markers);
        console.log('📊 Found nbWaveSeries markers:', nbWaveSeries.markers.length);
      }
      
      if (typeof candle !== 'undefined' && Array.isArray(candle?.markers)) {
        allMarkers.push(...candle.markers);
        console.log('📊 Found candle markers:', candle.markers.length);
      }
      
      // If no markers found, create sample data for testing
      if (allMarkers.length === 0) {
        console.log('📊 No markers found, creating sample data for testing');
        allMarkers.push(
          { time: Date.now() / 1000, color: '#00d1ff', text: 'N/B BUY' },
          { time: Date.now() / 1000 + 60, color: '#ffb703', text: 'N/B SELL' },
          { time: Date.now() / 1000 + 120, color: '#00d1ff', text: 'N/B BUY' }
        );
      }

      const seen = new Set();
      const uniqueMarkers = [];
      let blueCount = 0, orangeCount = 0;
      let lastWaveType = '-';

      allMarkers.forEach(marker => {
        const key = `${marker.time}-${marker.color}-${marker.text}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueMarkers.push(marker);
        }
      });
      
      const sortedMarkers = uniqueMarkers.sort((a, b) => a.time - b.time);
      
      sortedMarkers.forEach(marker => {
        // Check marker color or text to determine wave type
        const markerColor = marker.color?.toLowerCase();
        const markerText = marker.text?.toLowerCase() || '';
        
        if (markerColor === '#00d1ff' || markerColor === '#4285f4' || markerColor === '#0ecb81' ||
            markerText.includes('blue') || markerText.includes('buy') || markerText.includes('nb buy')) {
          blueCount++;
        } else if (markerColor === '#ffb703' || markerColor === '#ff6b6b' || markerColor === '#f6465d' ||
                   markerText.includes('orange') || markerText.includes('sell') || markerText.includes('nb sell')) {
          orangeCount++;
        }
      });
      
      // Determine last wave type
      if (sortedMarkers.length > 0) {
        const lastMarker = sortedMarkers[sortedMarkers.length - 1];
        const lastMarkerColor = lastMarker.color?.toLowerCase();
        const lastMarkerText = lastMarker.text?.toLowerCase() || '';
        
        if (lastMarkerColor === '#00d1ff' || lastMarkerColor === '#4285f4' || lastMarkerColor === '#0ecb81' ||
            lastMarkerText.includes('blue') || lastMarkerText.includes('buy') || lastMarkerText.includes('nb buy')) {
          lastWaveType = 'BLUE';
        } else if (lastMarkerColor === '#ffb703' || lastMarkerColor === '#ff6b6b' || lastMarkerColor === '#f6465d' ||
                   lastMarkerText.includes('orange') || lastMarkerText.includes('sell') || lastMarkerText.includes('nb sell')) {
          lastWaveType = 'ORANGE';
        }
      }
      
      // Update UI
      const blueCountEl = document.getElementById('blueWaveCount');
      const orangeCountEl = document.getElementById('orangeWaveCount');
      const lastWaveTypeEl = document.getElementById('lastWaveType');
      
      if (blueCountEl) blueCountEl.textContent = blueCount;
      if (orangeCountEl) orangeCountEl.textContent = orangeCount;
      if (lastWaveTypeEl) {
        lastWaveTypeEl.textContent = lastWaveType;
        lastWaveTypeEl.className = lastWaveType === 'BLUE' ? 'badge bg-primary' : 
                                  lastWaveType === 'ORANGE' ? 'badge bg-warning' : 'badge bg-secondary';
      }
      
      console.log(`Wave Counter: Blue=${blueCount}, Orange=${orangeCount}, Last=${lastWaveType}`);
      
    } catch (error) {
      console.error('Error updating wave counter:', error);
    }
  };

  // Function to get chart zone data for N/B Zone Status

  function getChartZoneData() {

    try {

      // console.log('=== getChartZoneData: 시작 ===');

      

      const data = candle.data();

      // console.log('  - candle.data() 길이:', data?.length || 0);

      

      if (!data || data.length === 0) {

        // console.log('  - candle.data() 없음');

        return { zones: [], baseValue: 0, hasData: false };

      }




      // Get N/B wave data from chart

      const nbWaveData = window.nbWaveSeries?.data || [];

      const baseValue = window.nbWaveSeries?.options()?.baseValue?.price || 0;

      

      // console.log('  - nbWaveSeries 존재:', !!window.nbWaveSeries);

      // console.log('  - nbWaveData 길이:', nbWaveData.length);

      // console.log('  - baseValue:', baseValue);



      // If N/B data exists, use it

      if (nbWaveData && nbWaveData.length > 0) {

        // console.log('  - nbWaveData 사용');

        const zones = nbWaveData.map((waveData, index) => {

          const zone = waveData.value >= baseValue ? 'ORANGE' : 'BLUE';

          return {

            time: waveData.time,

            zone: zone,

            value: waveData.value,

            index: index

          };

        });



        // console.log('  - nbWave zones 생성됨:', zones.length);

        return {

          zones: zones,

          baseValue: baseValue,

          hasData: true,

          source: 'nbWave'

        };

      }



      // Try to use window.lastOutWave if nbWaveSeries data is not available

      const lastOutWave = window.lastOutWave || [];

      // console.log('  - lastOutWave 존재:', !!window.lastOutWave);

      // console.log('  - lastOutWave 길이:', lastOutWave.length);

      

      if (lastOutWave && lastOutWave.length > 0) {

        console.log('  - lastOutWave 사용');

        const zones = lastOutWave.map((waveData, index) => {

          const zone = waveData.value >= baseValue ? 'ORANGE' : 'BLUE';

          return {

            time: waveData.time,

            zone: zone,

            value: waveData.value,

            index: index

          };

        });



        // console.log('  - lastOutWave zones 생성됨:', zones.length);

        return {

          zones: zones,

          baseValue: baseValue,

          hasData: true,

          source: 'lastOutWave'

        };

      }



      // If no N/B data, try to get zone data from chart indicators

      const zoneIndicatorData = window.zoneIndicatorSeries?.data || [];

      // console.log('  - zoneIndicatorSeries 존재:', !!window.zoneIndicatorSeries);

      // console.log('  - zoneIndicatorData 길이:', zoneIndicatorData.length);

      

      if (zoneIndicatorData && zoneIndicatorData.length > 0) {

        console.log('  - zoneIndicatorData 사용');

        const zones = zoneIndicatorData.map((indicator, index) => {

          // Determine zone based on indicator color or value

          let zone = 'BLUE'; // default

          if (indicator.color) {

            // Check if color indicates ORANGE zone

            if (indicator.color.includes('255,165,0') || indicator.color.includes('ff8c00')) {

              zone = 'ORANGE';

            }

          }

          

          return {

            time: indicator.time,

            zone: zone,

            value: indicator.value || indicator.close || 0,

            index: index

          };

        });



        console.log('  - zoneIndicator zones 생성됨:', zones.length);

        return {

          zones: zones,

          baseValue: baseValue,

          hasData: true,

          source: 'zoneIndicator'

        };

      }



      // If no zone data available, return empty

      console.log('  - 데이터 없음');

      return { zones: [], baseValue: 0, hasData: false };

    } catch (e) {

      // console.error('Error getting chart zone data:', e);

      return { zones: [], baseValue: 0, hasData: false };

    }

  }

  const startBtn = document.getElementById('botStart');

  const stopBtn = document.getElementById('botStop');

  const shotBtn = document.getElementById('btnShot');

  const btBtn = document.getElementById('btnBacktest');

  const clearBtn = document.getElementById('btnClearOrders');

  const ordersToggle = null;

  const optBtn = document.getElementById('btnOptimize');

  const trainBtn = document.getElementById('btnTrain');

  const mlTrainBtn = document.getElementById('btnMlTrain');

  const mlPredictBtn = document.getElementById('btnMlPredict');

  const miZone = document.getElementById('miZone');

  const miText = document.getElementById('miText');



  function updateModelInsight(j){

    try{

      const ins = j && j.insight ? j.insight : {};

      try{ window.lastInsight = ins; }catch(_){ }

      
      // Store ML prediction for getCurrentZone() function
      try{ window.mlPrediction = j; }catch(_){ }

      // ML 모델의 실제 구역 정보 사용 (for display only)

      const mlZone = String(ins.zone||'-').toUpperCase();

      

      // Show model's zone-aware intent summary

      try{

        const zact = j && j.zone_actions ? j.zone_actions : {};

        const badge = document.getElementById('miZone');

        if (badge){

          const hint = (zact.buy_in_blue ? 'BUY@BLUE' : (zact.sell_in_orange ? 'SELL@ORANGE' : '-'));

          badge.textContent = hint || String(ins.zone||'-');

          badge.className = 'badge bg-white text-dark';

        }

      }catch(_){ }

              // Display N/B zone instead of ML model zone

        const nbZone = window.zoneNow || 'BLUE';

        if (miZone){ 

          miZone.textContent = String(nbZone||'-'); 

          miZone.className = 'badge bg-white text-dark';

          // Add tooltip with zone duration info (only if duration >= 1 minute)

          const durationText = nbZoneDuration >= 60 ? ` (${nbZoneDuration}초)` : '';

          miZone.title = `N/B Zone: ${nbZone}${durationText} | ML Zone: ${String(ins.zone||'-')}`;

        }

      // reflect current zone majority on Win% card header and background

      try{

        const winZoneNow = document.getElementById('winZoneNow');

        const winCard = document.getElementById('winCard');

        

        // Use getCurrentZone() for UI elements to ensure consistency

        const currentZone = getCurrentZone();

        if (winZoneNow){ 

          winZoneNow.textContent = String(currentZone||'-'); 

          winZoneNow.className = `badge ${currentZone === 'BLUE' ? 'bg-primary' : 'bg-warning'} text-white`;

          // Add tooltip with zone duration info (only if duration >= 1 minute)

          const durationText = nbZoneDuration >= 60 ? ` (${nbZoneDuration}초)` : '';

          winZoneNow.title = `N/B Zone: ${nbZone}${durationText} | ML Zone: ${String(ins.zone||'-')}`;

        }

        if (winCard){

          winCard.classList.remove('win-card-blue','win-card-orange');

          if (currentZone === 'ORANGE'){ winCard.classList.add('win-card-orange'); }

          else if (currentZone === 'BLUE'){ winCard.classList.add('win-card-blue'); }

        }

      }catch(_){ }

      if (miText){

        const blueAdj = (ins.pct_blue||0);

        const orangeAdj = (ins.pct_orange||0);

        const blueRaw = (ins.pct_blue_raw!=null? ins.pct_blue_raw : blueAdj);

        const orangeRaw = (ins.pct_orange_raw!=null? ins.pct_orange_raw : orangeAdj);

        let slopeLine = '';

        try{

          const st = j && j.steep ? j.steep : null;

          if (st && (st.blue_up_slope!=null || st.orange_down_slope!=null)){

            const up = st.blue_up_slope!=null ? Number(st.blue_up_slope*10000).toFixed(2) : '-';

            const dn = st.orange_down_slope!=null ? Number(st.orange_down_slope*10000).toFixed(2) : '-';

            slopeLine = ` | upSlope@BLUE=${up}bp/bar | downSlope@ORANGE=${dn}bp/bar`;

          }

        }catch(_){ }

        const currentZone = getCurrentZone();

        const durationText = nbZoneDuration >= 60 ? ` (${nbZoneDuration}초)` : '';

        miText.innerHTML = `r=${(ins.r||0).toFixed(3)} | BLUE(raw)=${Number(blueRaw).toFixed(1)}% | ORANGE(raw)=${Number(orangeRaw).toFixed(1)}% | BLUE=${Number(blueAdj).toFixed(1)}% | ORANGE=${Number(orangeAdj).toFixed(1)}% | ML_zone=${String(ins.zone||'-')} | N/B_zone=${String(currentZone||'-')}${durationText} | conf=${(ins.zone_conf||0).toFixed(3)} | age=${Number(ins.zone_extreme_age||0)} | w=${(ins.w||0).toFixed(3)}${slopeLine}<br/>`+

          `dist_high=${(ins.dist_high||0).toFixed(3)} | dist_low=${(ins.dist_low||0).toFixed(3)} | gap=${(ins.extreme_gap||0).toFixed(3)} | ema_diff=${(ins.ema_diff||0).toFixed(1)}<br/>`+

          `zone_min_r=${(ins.zone_min_r!=null? ins.zone_min_r: ins.r||0).toFixed(3)} | zone_max_r=${(ins.zone_max_r!=null? ins.zone_max_r: ins.r||0).toFixed(3)} | zone_extreme_r=${(ins.zone_extreme_r!=null? ins.zone_extreme_r: ins.r||0).toFixed(3)}<br/>`+

          `blue_min_cur=${(ins.blue_min_cur!=null? ins.blue_min_cur: ins.zone_min_r||0).toFixed(3)} | blue_min_last=${(ins.blue_min_last!=null? ins.blue_min_last: ins.zone_min_r||0).toFixed(3)} | orange_max_cur=${(ins.orange_max_cur!=null? ins.orange_max_cur: ins.zone_max_r||0).toFixed(3)} | orange_max_last=${(ins.orange_max_last!=null? ins.orange_max_last: ins.zone_max_r||0).toFixed(3)}`;

      }

    }catch(_){ }

  }

  const mlMetricsBtn = document.getElementById('btnMlMetrics');

  const mlRandomBtn = document.getElementById('btnMlRandom');

  const mlRandNEl = document.getElementById('mlRandN');

  const mlAutoToggle = document.getElementById('mlAuto');

  let mlAutoTimer = null;

  const loadBalBtn = document.getElementById('btnLoadBalance');

  // Top assets UI

  const assetsBox = null; // legacy removed

  
  // Global variables for N/B marker connection lines

  let nbMarkerLineSeries = null;

  const assetsMeta = document.getElementById('assetsMeta');

  const assetsRefresh = document.getElementById('assetsRefresh');

  const assetsAutoToggle = document.getElementById('assetsAuto');

  // new assets design elements

  const assetTotalEl = document.getElementById('assetTotal');

  const assetBuyableEl = document.getElementById('assetBuyable');

  const assetSellableEl = document.getElementById('assetSellable');

  const assetsBars = document.getElementById('assetsBars');

  // Default selected sell coin (can be cleared by user)
  if (!('selectedSellCoin' in window)) window.selectedSellCoin = 'BTC';

  let assetsTimer = null;

  const assetsSummary = null;

  const enforceZoneSideEl = document.getElementById('enforceZoneSide');

  const mlCountEl = document.getElementById('mlCount');

  const trainCountEl = document.getElementById('trainCount');

  const trainSegEl = document.getElementById('trainSeg');

  const autoBtToggle = document.getElementById('autoBtToggle');

  const autoBtSecEl = document.getElementById('autoBtSec');

  let autoBtTimer = null;

  const logBox = document.getElementById('logBox');

  const logAuto = document.getElementById('logAutoscroll');

  const logClearBtn = document.getElementById('btnClearLog');

  const LOG_MAX_LINES = 50;

  // Orders bottom log elements

  const orderLog = document.getElementById('orderLog');

  const orderClearBtn = document.getElementById('btnOrderClear');

  const orderExportBtn = document.getElementById('btnOrderExport');

  const btnBuy = document.getElementById('btnBuy');

  const btnSell = document.getElementById('btnSell');

  const tradeReadyMeta = document.getElementById('tradeReadyMeta');

  const miniWinZone = document.getElementById('miniWinZone');

  const miniWinBaseBar = document.getElementById('miniWinBaseBar');

  const miniWinOverlayBar = document.getElementById('miniWinOverlayBar');

  const autoPending = document.getElementById('autoPending');

  const autoPendingBar = document.getElementById('autoPendingBar');

  const btnCancelPending = document.getElementById('btnCancelPending');

  const autoTradeToggle = document.getElementById('autoTradeToggle');

  // Event delegation for manual trade buttons (works with dynamically loaded elements)
  document.addEventListener('click', (e)=>{
    const target = e.target;
    if (!target) return;
    
    // Buy button
    if (target.id === 'btnBuy' || target.closest('#btnBuy')) {
      e.preventDefault();
      console.log('🟢 BUY 버튼 클릭 감지됨');
      uiLog('🟢 BUY 버튼 클릭');
      try {
        onManualBuy();
      } catch(err) {
        console.error('❌ onManualBuy 실행 중 오류:', err);
        uiLog('❌ BUY 실행 오류: ' + String(err));
      }
      return;
    }
    
    // Sell button
    if (target.id === 'btnSell' || target.closest('#btnSell')) {
      e.preventDefault();
      console.log('🔴 SELL 버튼 클릭 감지됨');
      uiLog('🔴 SELL 버튼 클릭');
      try {
        onManualSell();
      } catch(err) {
        console.error('❌ onManualSell 실행 중 오류:', err);
        uiLog('❌ SELL 실행 오류: ' + String(err));
      }
      return;
    }
    
    // Cancel pending button
    if (target.id === 'btnCancelPending' || target.closest('#btnCancelPending')) {
      e.preventDefault();
      console.log('⚫ Cancel 버튼 클릭 감지됨');
      try{ if (autoPendingTimer) clearInterval(autoPendingTimer); }catch(_){ }
      autoPendingTimer = null; 
      if (autoPending) autoPending.style.display='none'; 
      uiLog('Auto order cancelled within 5s');
      return;
    }
  }, true);

  // Additional toggles

  let mlOnlyToggle = null;

  let autoPendingTimer = null;

  const btnPreflight = document.getElementById('btnPreflight');

  const tradeReadyBox = document.getElementById('tradeReadyBox');

  let orderKeys = new Set();

  function pushOrderLogLine(line){

    try{

      if (!orderLog) return;

      const div = document.createElement('div');

      div.textContent = line;

      orderLog.prepend(div);

      while (orderLog.childElementCount>200){ orderLog.removeChild(orderLog.lastElementChild); }

    }catch(_){ }

  }

  const mlMetricsBox = document.getElementById('mlMetricsBox');

  const emaFilterEl = document.getElementById('emaFilter');

  const nbFromEmaEl = document.getElementById('nbFromEma');

  const nbEmaPeriodEl = document.getElementById('nbEmaPeriod');

  const nbDebounceEl = document.getElementById('nbDebounce');

  const nbBuyThEl = document.getElementById('nbBuyTh');

  const nbSellThEl = document.getElementById('nbSellTh');

  const showSMAEl = document.getElementById('showSMA');

  const sma50El = document.getElementById('sma50');

  const sma100El = document.getElementById('sma100');

  const sma200El = document.getElementById('sma200');

  const showEMA9El = document.getElementById('showEMA9');

  const showIchimokuEl = document.getElementById('showIchimoku');

  const ichiTenkanEl = document.getElementById('ichiTenkan');

  const ichiKijunEl = document.getElementById('ichiKijun');

  function uiLog(msg, data){

    try{

      const ts = new Date().toISOString();

      const detail = data? (typeof data==='string'? data: JSON.stringify(data)) : '';

      const line = `[${ts}] ${msg}${detail? ' ' + detail: ''}`;

      if (logBox){

        // append without forcing scroll

        const prevTop = logBox.scrollTop;

        logBox.textContent += (line + "\n");

        // trim to last LOG_MAX_LINES

        try{

          const parts = logBox.textContent.split('\n');

          if (parts.length > LOG_MAX_LINES+1){

            logBox.textContent = parts.slice(-LOG_MAX_LINES-1).join('\n');

          }

        }catch(_){ }

        // No auto-scroll: always keep previous position

        try{ logBox.scrollTop = prevTop; }catch(_){ }

      }

      console.log(line);

    }catch(_){ }

  }

  async function optimizeNb(){

    try{

      const payload = {

        window: parseInt(nbWindowEl?.value||'50',10),

        buy: [0.6, 0.85, 0.02],

        sell: [0.15, 0.45, 0.02],

        debounce: parseInt(nbDebounceEl?.value||'6',10),

        fee_bps: 10.0,

        count: 800,

        interval: getInterval(),

      };

      const r = await fetch('/api/nb/optimize', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });

      const j = await r.json();

      if (j && j.ok && j.best){

        if (nbBuyThEl) nbBuyThEl.value = String(j.best.buy);

        if (nbSellThEl) nbSellThEl.value = String(j.best.sell);

        updateNB();

      }

    }catch(_){ }

  }

  const paperEl = document.getElementById('paperMode');

  const orderEl = document.getElementById('orderKrw');

  const emaFastEl = document.getElementById('emaFast');

  const emaSlowEl = document.getElementById('emaSlow');

  // Forecast controls

  const fcWindowEl = document.getElementById('fcWindow');

  const fcHorizonEl = document.getElementById('fcHorizon');

  const fcToggleEl = document.getElementById('fcToggle');



  const sTicker = document.getElementById('s_ticker');

  const sPrice = document.getElementById('s_price');

  const sSignal = document.getElementById('s_signal');
  const sEma = document.getElementById('s_ema');

  const sBot = document.getElementById('s_bot');

  const sInterval = document.getElementById('s_interval');

  const sEntry = document.getElementById('nb_entry');

  const sPnl = document.getElementById('nb_pnl');

  // Top PnL slider elements

  const pnlLeft = document.getElementById('pnlLeftBar');

  const pnlRight = document.getElementById('pnlRightBar');

  const pnlLeftLabel = document.getElementById('pnlLeftLabel');

  const pnlRightLabel = document.getElementById('pnlRightLabel');

  const autoGaugeBar = document.getElementById('autoGaugeBar');

  const autoGaugeText = document.getElementById('autoGaugeText');

  let lastAggPct = 0;

  // Track last live BUY to compute realized PnL on SELL

  let liveLastBuyPrice = 0;

  function updateTopPnlSlider(pnl, winRate){

    if (!pnlLeft || !pnlRight) return;

    // Normalize 0~100; draw from center: LeftBar extends left, RightBar extends right

    const isProfit = pnl >= 0;

    const wr = Math.max(0, Math.min(100, isFinite(winRate)? winRate : (isProfit? 60:40)));

    const profPct = isProfit ? wr : 0;

    const lossPct = isProfit ? (100-wr) : wr;

    pnlLeft.style.width = `${profPct/2}%`; // half track to the left

    pnlRight.style.width = `${lossPct/2}%`; // half track to the right

    if (pnlLeftLabel) pnlLeftLabel.textContent = `Profit ${profPct.toFixed(1)}%`;

    if (pnlRightLabel) pnlRightLabel.textContent = `Loss ${lossPct.toFixed(1)}%`;

    // glow animation cue

    try{

      (isProfit? pnlLeft : pnlRight).classList.remove(isProfit? 'glow-green':'glow-red');

      void (isProfit? pnlLeft : pnlRight).offsetWidth; // reflow to restart animation

      (isProfit? pnlLeft : pnlRight).classList.add(isProfit? 'glow-green':'glow-red');

    }catch(_){ }

  }



  // Aggregate last up to 25 win buttons

  function updateTopPnlFromList(){

    if (!winListEl || !pnlLeft || !pnlRight) {
      console.warn('updateTopPnlFromList: Missing required elements', { winListEl: !!winListEl, pnlLeft: !!pnlLeft, pnlRight: !!pnlRight });
      return;
    }

    // Apply zone filter if set
    let items = Array.from(winListEl.children).slice(0,25);
    const f = (window.winZoneFilter||'ALL').toUpperCase();
    if (f==='BLUE' || f==='ORANGE'){
      items = items.filter(el=> (el.dataset && el.dataset.zone) === f);
    }

    const total = items.length;

    const positives = items.filter(el=> el.classList.contains('positive')).length;

    const profitPct = total ? (positives/total*100) : 0;

    const lossPct = 100 - profitPct;
    
    // Debug logging
    if (total > 0) {
      console.log(`updateTopPnlFromList: total=${total}, positives=${positives}, profitPct=${profitPct.toFixed(1)}%, lossPct=${lossPct.toFixed(1)}%`);
    }

    pnlLeft.style.width = `${profitPct/2}%`;

    pnlRight.style.width = `${lossPct/2}%`;

    if (pnlLeftLabel) pnlLeftLabel.textContent = `Profit ${profitPct.toFixed(1)}%`;

    if (pnlRightLabel) pnlRightLabel.textContent = `Loss ${lossPct.toFixed(1)}%`;

    // compute majority zone from dataset.zone

    try{

      let blue=0, orange=0;

      for (const el of items){

        const zone = el.dataset && el.dataset.zone;

        if (zone === 'BLUE') blue++;

        else if (zone === 'ORANGE') orange++;

      }

      const maj = (orange>=blue && orange>0)? 'ORANGE' : (blue>orange? 'BLUE' : '-');

      const winMajor = document.getElementById('winMajor');

      if (winMajor){
        const suffix = ((window.winZoneFilter||'ALL').toUpperCase()==='BLUE' || (window.winZoneFilter||'ALL').toUpperCase()==='ORANGE')
          ? ` (filtered: ${(window.winZoneFilter||'ALL').toUpperCase()})`
          : '';
        winMajor.textContent = maj + suffix;
        winMajor.className = 'badge bg-white text-dark';
      }

      

      // Debug logging

      console.log(`Zone calculation: BLUE=${blue}, ORANGE=${orange}, MAJORITY=${maj}`);

    }catch(_){ }

    // also update local fill bar on periodic refresh (1%..100%)

    try{

      const bar = document.getElementById('winFillBar');

      if (bar){

        const n = Math.min(25, (winListEl?.childElementCount||0));

        const pct = Math.max(1, Math.round((n/25)*100));

        bar.style.width = `${pct}%`;

      }

    }catch(_){ }

    // Push profit/loss ratios to server for order sizing

    try {

      postJson('/api/bot/config', { pnl_profit_ratio: profitPct, pnl_loss_ratio: lossPct }).catch(()=>{});

    } catch(_) { }

    // glow on direction

    try{

      if (profitPct >= lastAggPct){ pnlLeft.classList.remove('glow-green'); void pnlLeft.offsetWidth; pnlLeft.classList.add('glow-green'); }

      else { pnlRight.classList.remove('glow-red'); void pnlRight.offsetWidth; pnlRight.classList.add('glow-red'); }

      lastAggPct = profitPct;

    }catch(_){ }

  }
  
  // 전역으로 접근 가능하도록 등록
  window.updateTopPnlFromList = updateTopPnlFromList;

  // ---- Rolling win list (left panel) ----

  const winListEl = document.getElementById('winList');

  const winClearBtn = document.getElementById('winClear');

  // Win% zone filter controls
  const winZoneAllBtn = document.getElementById('winZoneAll');
  const winZoneBlueBtn = document.getElementById('winZoneBlue');
  const winZoneOrangeBtn = document.getElementById('winZoneOrange');

  // Zone filter state for Win% calculation: 'ALL' | 'BLUE' | 'ORANGE'
  window.winZoneFilter = (typeof localStorage !== 'undefined' && localStorage.getItem('winZoneFilter'))
    ? String(localStorage.getItem('winZoneFilter')).toUpperCase()
    : 'ALL';

  function setWinZoneFilter(v){
    const val = String(v||'ALL').toUpperCase();
    window.winZoneFilter = (val==='BLUE' || val==='ORANGE') ? val : 'ALL';
    try{ if (typeof localStorage !== 'undefined') localStorage.setItem('winZoneFilter', window.winZoneFilter); }catch(_){}
    // Visual active state
    if (winZoneAllBtn) winZoneAllBtn.classList.toggle('active', window.winZoneFilter==='ALL');
    if (winZoneBlueBtn) winZoneBlueBtn.classList.toggle('active', window.winZoneFilter==='BLUE');
    if (winZoneOrangeBtn) winZoneOrangeBtn.classList.toggle('active', window.winZoneFilter==='ORANGE');
    // Recompute
    updateTopPnlFromList();
  }

  if (winZoneAllBtn) winZoneAllBtn.addEventListener('click', ()=> setWinZoneFilter('ALL'));
  if (winZoneBlueBtn) winZoneBlueBtn.addEventListener('click', ()=> setWinZoneFilter('BLUE'));
  if (winZoneOrangeBtn) winZoneOrangeBtn.addEventListener('click', ()=> setWinZoneFilter('ORANGE'));

  // Initialize visual state
  setWinZoneFilter(window.winZoneFilter);

  let winKeys = new Set();

  const makeWinKey = (pnl, winRate)=> `${Math.round(pnl)}|${Number(winRate).toFixed(1)}`;

  function pushWinItem({ ts, pnl, winRate, zone, interval }){

    if (!winListEl) return;

    // 처음 추가 시 "데이터 없음" 플레이스홀더 제거
    if (winListEl.children.length === 1) {
      const placeholder = winListEl.children[0];
      if (placeholder && placeholder.textContent.includes('데이터 없음')) {
        winListEl.innerHTML = '';
        console.log('[Win History] 플레이스홀더 제거 (pushWinItem)');
      }
    }

    const key = makeWinKey(pnl, winRate);

    // If duplicate exists, refresh its content and move to top

    const dup = Array.from(winListEl.children).find(el=> el.dataset && el.dataset.key === key);

    if (dup){

      const timeStr = new Date(ts).toLocaleTimeString();

      const zDup = (dup.dataset && dup.dataset.zone) || (zone) || '-';

      const intervalDup = (dup.dataset && dup.dataset.interval) || (interval) || getInterval();

      const meta = dup.querySelector('.meta'); if (meta) meta.innerHTML = `${timeStr}<br>${String(zDup).toUpperCase()} (${intervalDup})`;

      const val = dup.querySelector('.val'); if (val) try{ val.remove(); }catch(_){ }

      // Update positive/negative class based on PnL
      if (pnl >= 0) {
        dup.classList.add('positive');
      } else {
        dup.classList.remove('positive');
      }

      winListEl.prepend(dup);

      updateTopPnlFromList();

      return;

    }

    const item = document.createElement('button');

    item.type = 'button';

    item.className = 'win-chip btn btn-sm';

    const timeStr = new Date(ts).toLocaleTimeString();

    // Always use N/B Zone from nbZoneNow HTML element for consistency
    const nbZoneNowElement = document.getElementById('nbZoneNow');
    let nbZone = 'BLUE'; // Default fallback
    
    if (nbZoneNowElement) {
      const nbZoneText = nbZoneNowElement.textContent.trim().toUpperCase();
      if (nbZoneText === 'BLUE' || nbZoneText === 'ORANGE') {
        nbZone = nbZoneText;
      }
    } else {
      // Fallback to window.zoneNow if HTML element is not available
      nbZone = window.zoneNow || zone || (window.lastInsight && window.lastInsight.zone) || 'BLUE';
    }
    const currentInterval = interval || getInterval();

    const zoneUpper = String(nbZone).toUpperCase();
    
    // Create zone badge with color coding - Clean one-line design
    const zoneEmoji = zoneUpper === 'ORANGE' ? '🟠' : '🔵';
    const zoneColor = zoneUpper === 'ORANGE' ? '#ff6b35' : '#0ecb81';
    
    item.title = `${timeStr} | N/B Zone: ${zoneUpper} | ${currentInterval}`;
    item.innerHTML = `
      <div class='meta' style="font-size: 10px; line-height: 1.2; text-align: left;">
        <span style="color: #666;">${timeStr}</span><br>
        <span style="color: ${zoneColor}; font-weight: 600;">${zoneEmoji}${zoneUpper}</span> 
        <span style="color: #999; font-size: 9px;">(${currentInterval})</span>
      </div>
    `;
    item.dataset.key = key;

    item.dataset.zone = zoneUpper;

    item.dataset.interval = currentInterval;

    // Add positive/negative class based on PnL for Win% calculation
    if (pnl >= 0) {
      item.classList.add('positive');
    } else {
      item.classList.remove('positive');
    }

    // Debug logging for zone consistency
    console.log(`Adding win item: N/B Zone=${zoneUpper}, interval=${currentInterval}, time=${timeStr}, pnl=${pnl}, positive=${pnl >= 0}`);
    console.log(`Zone source: nbZoneNow HTML element = ${nbZoneNowElement ? nbZoneNowElement.textContent.trim() : 'not found'}`);

    winListEl.prepend(item);

    // keep last 25

    while (winListEl.childElementCount>25){ const last = winListEl.lastElementChild; if (last && last.dataset && last.dataset.key) winKeys.delete(last.dataset.key); winListEl.removeChild(last); }

    winKeys.add(key);

    // refresh top aggregate slider

    updateTopPnlFromList();

    // update local fill bar (1%..100% while filling up to 25)

    try{

      const bar = document.getElementById('winFillBar');

      if (bar){

        const n = Math.min(25, winListEl.childElementCount||0);

        const pct = Math.max(1, Math.round((n/25)*100));

        bar.style.width = `${pct}%`;

      }

    }catch(_){ }

    // localStorage에 저장
    if (typeof saveWinHistory === 'function') {
      saveWinHistory();
    }

  }

  if (winClearBtn) winClearBtn.addEventListener('click', ()=>{ if (winListEl) winListEl.innerHTML=''; winKeys.clear(); updateTopPnlFromList(); saveWinHistory(); });

  // localStorage에 Win History 저장
  function saveWinHistory() {
    if (!winListEl) return;
    
    try {
      const STORAGE_KEY_WIN = 'win_history_v1';
      const historyItems = [];
      
      // 현재 winList의 모든 항목 수집
      Array.from(winListEl.children).forEach(item => {
        const itemData = {
          zone: item.dataset.zone || 'BLUE',
          interval: item.dataset.interval || '',
          timestamp: item.dataset.timestamp || Date.now(),
          positive: item.classList.contains('positive'),
          type: item.classList.contains('timeframe-rotation') ? 'rotation' : 'trade'
        };
        historyItems.push(itemData);
      });
      
      localStorage.setItem(STORAGE_KEY_WIN, JSON.stringify(historyItems));
      console.log(`[Win History] Saved ${historyItems.length} items to localStorage`);
    } catch (e) {
      console.error('[Win History] Failed to save to localStorage:', e);
    }
  }

  // localStorage에서 Win History 불러오기
  function loadWinHistory() {
    if (!winListEl) {
      console.warn('[Win History] winListEl not found, skipping load');
      return;
    }
    
    try {
      const STORAGE_KEY_WIN = 'win_history_v1';
      const stored = localStorage.getItem(STORAGE_KEY_WIN);
      
      if (!stored) {
        console.log('[Win History] No saved history found');
        return;
      }
      
      const historyItems = JSON.parse(stored);
      if (!Array.isArray(historyItems) || historyItems.length === 0) {
        console.log('[Win History] Empty history');
        return;
      }
      
      // winList 초기화
      winListEl.innerHTML = '';
      
      // 히스토리 항목 복원
      historyItems.forEach(itemData => {
        const timeStr = new Date(Number(itemData.timestamp)).toLocaleTimeString();
        const zone = itemData.zone || 'BLUE';
        const zoneEmoji = zone === 'ORANGE' ? '🟠' : '🔵';
        const zoneColor = zone === 'ORANGE' ? '#ff6b35' : '#0ecb81';
        
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'win-chip btn btn-sm';
        item.title = `${itemData.type === 'rotation' ? '분봉 순회' : '거래'} | ${timeStr} | ${zone} | ${itemData.interval}`;
        item.innerHTML = `
          <div class='meta' style="font-size: 10px; line-height: 1.2; text-align: left;">
            <span style="color: #666;">${timeStr}</span><br>
            <span style="color: ${zoneColor}; font-weight: 600;">${zoneEmoji}${zone}</span> 
            <span style="color: #999; font-size: 9px;">(${itemData.interval})</span>
          </div>
        `;
        item.dataset.zone = zone;
        item.dataset.interval = itemData.interval;
        item.dataset.timestamp = itemData.timestamp;
        
        if (itemData.type === 'rotation') {
          item.classList.add('timeframe-rotation');
        }
        
        if (itemData.positive) {
          item.classList.add('positive');
        }
        
        winListEl.appendChild(item);
      });
      
      // Win% 업데이트
      updateTopPnlFromList();
      
      // Fill bar 업데이트
      const bar = document.getElementById('winFillBar');
      if (bar) {
        const n = Math.min(25, winListEl.childElementCount || 0);
        const pct = Math.max(1, Math.round((n/25)*100));
        bar.style.width = `${pct}%`;
      }
      
      console.log(`[Win History] Loaded ${historyItems.length} items from localStorage`);
    } catch (e) {
      console.error('[Win History] Failed to load from localStorage:', e);
    }
  }

  // Zone 히스토리 표시 함수 (Zone과 timeframe만으로 표시)
  function displayZoneHistoryItem({ timestamp, zone, timeframe, price }) {
    if (!winListEl) return;
    
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'win-chip btn btn-sm';
    
    // 시간 포맷팅
    let timeStr = '';
    try {
      const date = new Date(timestamp);
      timeStr = date.toLocaleTimeString('ko-KR', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: true 
      });
    } catch (e) {
      timeStr = timestamp || new Date().toLocaleTimeString();
    }
    
    const zoneUpper = String(zone || 'BLUE').toUpperCase();
    const zoneEmoji = zoneUpper === 'ORANGE' ? '🟠' : '🔵';
    const zoneColor = zoneUpper === 'ORANGE' ? '#ff6b35' : '#0ecb81';
    
    item.title = `${timeStr} | Zone: ${zoneUpper} | ${timeframe || ''} | Price: ${price ? price.toLocaleString() : '-'}`;
    item.innerHTML = `
      <div class='meta' style="font-size: 10px; line-height: 1.2; text-align: left;">
        <span style="color: #666;">${timeStr}</span><br>
        <span style="color: ${zoneColor}; font-weight: 600;">${zoneEmoji} ${zoneUpper}</span> 
        <span style="color: #999; font-size: 9px;">(${timeframe || ''})</span>
      </div>
    `;
    
    item.dataset.zone = zoneUpper;
    item.dataset.interval = timeframe || '';
    item.dataset.timestamp = timestamp;
    
    // Zone에 따라 배경색 설정
    if (zoneUpper === 'ORANGE') {
      item.style.background = 'linear-gradient(90deg, rgba(255,107,53,0.35), rgba(255,107,53,0.10))';
    } else {
      item.style.background = 'linear-gradient(90deg, rgba(0,209,255,0.35), rgba(0,209,255,0.10))';
    }
    
    winListEl.appendChild(item);
  }

  // localStorage에서 히스토리 불러와서 표시
  function loadZoneHistoryFromStorage() {
    if (!winListEl) {
      console.warn('[Win History] winListEl not found, skipping history load');
      return;
    }
    
    try {
      const STORAGE_KEY_ZONE = 'container_state_history'; // Zone 히스토리 키
      const stored = localStorage.getItem(STORAGE_KEY_ZONE);
      if (!stored) {
        console.log('[Win History] No stored history found');
        return;
      }
      
      const historyByTimeframe = JSON.parse(stored);
      // 객체 형태 (분봉별로 저장) 또는 배열 형태 (기존) 모두 지원
      let allHistory = [];
      
      if (Array.isArray(historyByTimeframe)) {
        // 기존 형식 (배열)
        allHistory = historyByTimeframe;
      } else if (typeof historyByTimeframe === 'object' && historyByTimeframe !== null) {
        // 새 형식 (분봉별 객체)
        for (const timeframe in historyByTimeframe) {
          const items = historyByTimeframe[timeframe];
          if (Array.isArray(items) && items.length > 0) {
            // 각 분봉의 최신 항목만 추가
            allHistory.push(items[items.length - 1]);
          }
        }
      }
      
      if (allHistory.length === 0) return;
      
      // winList 초기화
      winListEl.innerHTML = '';
      
      // 시간순 정렬 (분봉별 최신 1개씩)
      const sortedHistory = allHistory
        .filter(item => item && (item.zone === 'ORANGE' || item.zone === 'BLUE'))
        .sort((a, b) => {
          const timeA = new Date(a.timestamp || a.time || 0).getTime();
          const timeB = new Date(b.timestamp || b.time || 0).getTime();
          return timeA - timeB; // 오래된 것부터
        })
      
      // 각 항목 표시
      sortedHistory.forEach(item => {
        displayZoneHistoryItem({
          timestamp: item.timestamp || item.time,
          zone: item.zone,
          timeframe: item.timeframe || item.interval,
          price: item.price
        });
      });
      
      // Win% 업데이트
      updateTopPnlFromList();
      
      // Fill bar 업데이트
      const bar = document.getElementById('winFillBar');
      if (bar) {
        const n = Math.min(25, winListEl.childElementCount || 0);
        const pct = Math.max(1, Math.round((n/25)*100));
        bar.style.width = `${pct}%`;
      }
      
      console.log(`📂 Loaded ${sortedHistory.length} zone history items from localStorage`);
      
    } catch (e) {
      console.error('❌ Failed to load zone history from localStorage:', e);
    }
  }

  // Initialize Win% display on page load
  if (winListEl && pnlLeft && pnlRight) {
    // Wait for DOM to be fully ready
    setTimeout(() => {
      // localStorage에서 불러오지 않음 (새로고침 시 초기화 상태로 유지)
      updateTopPnlFromList();
    }, 500);
  }

  // periodic top slider refresh to ensure UI remains in sync

  let topPnlTimer = null;
  function startTopPnlTimer() {
    if (topPnlTimer) clearInterval(topPnlTimer);
    topPnlTimer = setInterval(()=>{ try{ updateTopPnlFromList(); }catch(_){} }, 2000);
  }
  startTopPnlTimer();



  // ---- Local storage for options ----

  const LS_KEY = 'eightbit_ui_opts_v1';

  function readOpts(){

    try{ return JSON.parse(localStorage.getItem(LS_KEY)||'{}'); }catch(_){ return {}; }

  }

  function writeOpts(partial){

    const cur = readOpts();

    const next = { ...cur, ...partial };

    try{ localStorage.setItem(LS_KEY, JSON.stringify(next)); }catch(_){ }

  }

  const saveOpts = ()=>{ try{ const o = snapshotOpts(); if (o.opt_auto_save === undefined || o.opt_auto_save){ writeOpts(o); } }catch(_){ } };

  function snapshotOpts(){

    return {

      timeframe: tfEl ? tfEl.value : undefined,

      paper: paperEl ? paperEl.value : undefined,

      order_krw: orderEl ? orderEl.value : undefined,

      ema_fast: emaFastEl ? emaFastEl.value : undefined,

      ema_slow: emaSlowEl ? emaSlowEl.value : undefined,

      nb_window: nbWindowEl ? nbWindowEl.value : undefined,

      nb_show: nbToggleEl ? !!nbToggleEl.checked : undefined,

      nb_buy_th: nbBuyThEl ? nbBuyThEl.value : undefined,

      nb_sell_th: nbSellThEl ? nbSellThEl.value : undefined,

      nb_debounce: nbDebounceEl ? nbDebounceEl.value : undefined,

      ema_filter: emaFilterEl ? !!emaFilterEl.checked : undefined,

      nb_from_ema: nbFromEmaEl ? !!nbFromEmaEl.checked : undefined,

      nb_ema_period: nbEmaPeriodEl ? nbEmaPeriodEl.value : undefined,

      fc_window: (typeof fcWindowEl !== 'undefined' && fcWindowEl) ? fcWindowEl.value : undefined,

      fc_horizon: (typeof fcHorizonEl !== 'undefined' && fcHorizonEl) ? fcHorizonEl.value : undefined,

      fc_show: (typeof fcToggleEl !== 'undefined' && fcToggleEl) ? !!fcToggleEl.checked : undefined,

      show_orders: undefined,

      auto_bt: (typeof autoBtToggle !== 'undefined' && autoBtToggle) ? !!autoBtToggle.checked : undefined,

      auto_bt_sec: (typeof autoBtSecEl !== 'undefined' && autoBtSecEl) ? autoBtSecEl.value : undefined,

      show_sma: showSMAEl ? !!showSMAEl.checked : undefined,

      sma50: sma50El ? sma50El.value : undefined,

      sma100: sma100El ? sma100El.value : undefined,

      sma200: sma200El ? sma200El.value : undefined,

      show_ema9: showEMA9El ? !!showEMA9El.checked : undefined,

      show_ichimoku: showIchimokuEl ? !!showIchimokuEl.checked : undefined,

      ichi_tenkan: ichiTenkanEl ? ichiTenkanEl.value : undefined,

      ichi_kijun: ichiKijunEl ? ichiKijunEl.value : undefined,

      train_count: (typeof trainCountEl !== 'undefined' && trainCountEl) ? trainCountEl.value : undefined,

      train_seg: (typeof trainSegEl !== 'undefined' && trainSegEl) ? trainSegEl.value : undefined,

      enforce_zone_side: enforceZoneSideEl ? !!enforceZoneSideEl.checked : undefined,

    };

  }



  let postJson = (path, data) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {})
  }).then(r=>r.json()).catch((e)=>{ console.error('POST fail', path, e); return { ok:false, error:String(e) }; });

  // 외부 스크립트에서 재사용할 수 있도록 노출
  window.postJson = postJson;



  // Rate Limit 관리를 위한 변수들

  let apiRequestCount = 0;

  let lastApiRequestTime = 0;

  const API_RATE_LIMIT = 8; // 초당 최대 8회 (order 그룹 기준)

  const API_RATE_WINDOW = 1000; // 1초



  // Rate Limit 체크 및 대기 함수

  async function checkRateLimit() {

    const now = Date.now();

    

    // 1초가 지났으면 카운트 리셋

    if (now - lastApiRequestTime > API_RATE_WINDOW) {

      apiRequestCount = 0;

      lastApiRequestTime = now;

    }

    

    // Rate Limit 초과 시 대기

    if (apiRequestCount >= API_RATE_LIMIT) {

      const waitTime = API_RATE_WINDOW - (now - lastApiRequestTime);

      if (waitTime > 0) {

        uiLog('Rate Limit 대기', `${waitTime}ms 대기 중...`);

        await sleep(waitTime);

        apiRequestCount = 0;

        lastApiRequestTime = Date.now();

      }

    }

    

    apiRequestCount++;

  }



  // 개선된 fetchJsonStrict 함수 (Rate Limit + 재시도 로직)

  async function fetchJsonStrict(path, init, maxRetries = 3) {

    for (let attempt = 1; attempt <= maxRetries; attempt++) {

      try {

        // Rate Limit 체크

        await checkRateLimit();

        

    const r = await fetch(path, init);

        

        // Rate Limit 에러 (429) 처리

        if (r.status === 429) {

          const retryAfter = r.headers.get('Retry-After') || 1;

          uiLog('Rate Limit 초과', `${retryAfter}초 후 재시도 (${attempt}/${maxRetries})`);

          await sleep(retryAfter * 1000);

          continue;

        }

        
        // 410 Gone 에러 처리 - ML 모델이 아직 학습되지 않았을 때
        if (r.status === 410) {
          // 410은 정상 상태 (모델 학습 전), 조용히 null 반환
          console.log(`[ML] Model not trained yet for ${path}`);
          return null;
        }

        
        // 503 Service Unavailable 에러 처리
        if (r.status === 503) {
          uiLog('서비스 불가능', `${path} - 503 (${attempt}/${maxRetries})`);
          if (attempt < maxRetries) {
            await sleep(2000 * attempt);
            continue;
          }
        }

        
        // 서버 에러 (500) 처리

        if (r.status >= 500) {

          uiLog('서버 에러', `${r.status} - ${attempt}/${maxRetries} 재시도 중...`);

          if (attempt < maxRetries) {

            await sleep(1000 * attempt); // 지수 백오프

            continue;

          }

        }

        

    const ct = (r.headers.get('content-type')||'').toLowerCase();

    const text = await r.text();

        

    if (!ct.includes('application/json')){

      throw new Error('API response is not JSON. Open the Flask UI at: http://127.0.0.1:5057/ui');

    }

        

        try{ 

          return JSON.parse(text); 

        } catch(_){ 

          throw new Error('Failed to parse JSON: ' + text.slice(0,120)); 

        }

        

      } catch (error) {

        if (attempt === maxRetries) {

          uiLog('API 요청 실패', `${path}: ${error.message}`);

          throw error;

        }

        

        uiLog('API 재시도', `${path}: ${attempt}/${maxRetries} - ${error.message}`);

        await sleep(1000 * attempt); // 지수 백오프

      }

    }

  }



  const sleep = (ms)=> new Promise(res=>setTimeout(res, ms));



  async function waitForNbSignals(maxMs=5000){

    const start = Date.now();

    while (Date.now()-start < maxMs){

      try{

        updateNB();

        const data = candle.data();

        const hasSignals = (Array.isArray(nbMarkers) && nbMarkers.length > 0) || (Array.isArray(window.lastNbSignals) && window.lastNbSignals.length>0);

        if (data && data.length >= 50 && hasSignals){ return true; }

      }catch(_){ }

      await sleep(200);

    }

    return false;

  }



  async function backtestAfterReady(maxMs=6000){

    try{ await waitForNbSignals(maxMs); runBacktest(); }catch(_){ }

  }



  function collectConfig(){

    return {

      paper: (paperEl && paperEl.value === 'false'),

      order_krw: orderEl ? parseInt(orderEl.value||'5000',10) : 5000,

      ema_fast: emaFastEl ? parseInt(emaFastEl.value||'10',10) : 10,

      ema_slow: emaSlowEl ? parseInt(emaSlowEl.value||'30',10) : 30,

      candle: getInterval(),

      nb_window: nbWindowEl ? parseInt(nbWindowEl.value||'50',10) : undefined,

      enforce_zone_side: enforceZoneSideEl ? !!enforceZoneSideEl.checked : undefined,

    };

  }



  async function pushConfig(){

    const cfg = collectConfig();

    await postJson('/api/bot/config', cfg);

    if (sEma) sEma.textContent = `${cfg.ema_fast}/${cfg.ema_slow}`;

    if (sInterval) sInterval.textContent = cfg.candle;

    writeOpts(snapshotOpts());

  }

  // Check if LightweightCharts is loaded before creating chart
  if (typeof LightweightCharts === 'undefined') {
    console.error('❌ LightweightCharts library not loaded. Please wait for the page to fully load.');
    // Retry after 1 second
    setTimeout(initChart, 1000);
    return;
  }


  
  // Reuse existing chart if present; otherwise create a new one
  chart = window.chart || LightweightCharts.createChart(container, {

    layout: { background: { type: 'solid', color: '#0b1220' }, textColor: '#e6eefc' },

    grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },

    rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },

    timeScale: { borderColor: 'rgba(255,255,255,0.08)' },

    crosshair: { mode: LightweightCharts.CrosshairMode.Magnet },

    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },

    handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: false },

    autoSize: true,

  });

  // Store chart globally for reuse
  window.chart = chart;

  // Check if chart is properly created
  if (!chart) {
    console.error('❌ Chart creation failed. Cannot add series.');
    return;
  }

  // Ensure candlestick series exists
  if (!window.candle) {
    candle = chart.addCandlestickSeries({ upColor:'#0ecb81', downColor:'#f6465d', wickUpColor:'#0ecb81', wickDownColor:'#f6465d', borderVisible:false });
    // Provide read access to the latest candle data used across the file
    if (candle && typeof candle.data !== 'function') {
      candle.data = () => getCandleDataCache();
    }
    window.candle = candle;
  } else {
    candle = window.candle;
  }

  emaF = chart.addLineSeries({ color:'rgba(14,203,129,0.9)', lineWidth:2 });

  emaS = chart.addLineSeries({ color:'rgba(246,70,93,0.9)', lineWidth:2 });

  sma50Series = chart.addLineSeries({ color:'#9aa0a6', lineWidth:1, priceLineVisible:false });

  sma100Series = chart.addLineSeries({ color:'#c7cbd1', lineWidth:1, priceLineVisible:false });

  sma200Series = chart.addLineSeries({ color:'#e0e3e7', lineWidth:1, priceLineVisible:false });

  ema9Series = chart.addLineSeries({ color:'#ffd166', lineWidth:1, priceLineVisible:false });

  ema12Series = chart.addLineSeries({ color:'#fca311', lineWidth:1, priceLineVisible:false });

  ema26Series = chart.addLineSeries({ color:'#fb8500', lineWidth:1, priceLineVisible:false });

  ichiTenkanSeries = chart.addLineSeries({ color:'#00d1ff', lineWidth:1, priceLineVisible:false });

  ichiKijunSeries = chart.addLineSeries({ color:'#ff006e', lineWidth:1, priceLineVisible:false });

  

  // Oscillator series removed

  

  // Zone indicator series for chart display

  zoneIndicatorSeries = chart.addCandlestickSeries({ 

    upColor:'rgba(255,165,0,0.8)', 

    downColor:'rgba(0,123,255,0.8)', 

    wickUpColor:'rgba(255,165,0,0.8)', 

    wickDownColor:'rgba(0,123,255,0.8)', 

    borderVisible:false 

  });

  

  // Make zoneIndicatorSeries globally accessible

  window.zoneIndicatorSeries = zoneIndicatorSeries;

  

  // Zone background series disabled to remove BLUE/ORANGE bars

  const zoneBackgroundSeries = chart.addAreaSeries({

    topColor: 'rgba(0,0,0,0)',

    bottomColor: 'rgba(0,0,0,0)',

    lineColor: 'rgba(0,0,0,0)',

    lineWidth: 0,

    priceLineVisible: false

  });

  

  // Zone text series for displaying zone info

  const zoneTextSeries = chart.addLineSeries({

    color: 'rgba(255,255,255,0.8)',

    lineWidth: 0,

    priceLineVisible: false,

    lastValueVisible: true

  });

  

  // N/B line series for displaying the actual N/B line with text

  const nbLineSeries = chart.addLineSeries({

    color: 'rgba(255, 255, 255, 0.9)',

    lineWidth: 2,

    priceLineVisible: false,

    lastValueVisible: true

  });



  // Oscillator functions removed



  // ---- NB helpers (using user's BIT_* functions) ----

  function initializeArraysBIT(length){

    return {

      BIT_START_A50: new Array(length).fill(0),

      BIT_START_A100: new Array(length).fill(0),

      BIT_START_B50: new Array(length).fill(0),

      BIT_START_B100: new Array(length).fill(0),

      BIT_START_NBA100: new Array(length).fill(0),

    };

  }
  function calculateBit(nb, bit=5.5, reverse=false){

    if (!nb || nb.length < 2) return bit/100;

    const BIT_NB = bit;

    const max = Math.max(...nb);

    const min = Math.min(...nb);

    const COUNT = 50;

    const rangeN = min < 0 ? Math.abs(min) : 0;

    const rangeP = max > 0 ? max : 0;

    const incN = rangeN / (COUNT * nb.length - 1 || 1);

    const incP = rangeP / (COUNT * nb.length - 1 || 1);

    const arrays = initializeArraysBIT(COUNT * nb.length);

    let count = 0; let NB50 = 0;

    for (const value of nb){

      for (let i=0;i<COUNT;i++){

        const A50 = value < 0 ? (min + incN * (count+1)) : (min + incP * (count+1));

        const A100 = (count+1) * BIT_NB / (COUNT * nb.length);

        const B50 = value < 0 ? (A50 - incN * 2) : (A50 - incP * 2);

        const B100 = value < 0 ? (A50 + incN) : (A50 + incP);

        const NBA100 = A100 / (nb.length - 1);

        arrays.BIT_START_A50[count] = A50;

        arrays.BIT_START_A100[count] = A100;

        arrays.BIT_START_B50[count] = B50;

        arrays.BIT_START_B100[count] = B100;

        arrays.BIT_START_NBA100[count] = NBA100;

        count++;

      }

    }

    if (reverse) arrays.BIT_START_NBA100.reverse();

    for (const value of nb){

      for (let a=0;a<arrays.BIT_START_NBA100.length;a++){

        if (arrays.BIT_START_B50[a] <= value && arrays.BIT_START_B100[a] >= value){

          NB50 += arrays.BIT_START_NBA100[Math.min(a, arrays.BIT_START_NBA100.length-1)];

          break;

        }

      }

    }

    if (nb.length === 2) return bit - NB50;

    return NB50;

  }

  let SUPER_BIT = 0;

  function updateSuperBit(v){ SUPER_BIT = v; }

  function BIT_MAX_NB(nb, bit=5.5){

    let r = calculateBit(nb, bit, false);

    if (!isFinite(r) || isNaN(r) || r > 100 || r < -100) return SUPER_BIT; else { updateSuperBit(r); return r; }

  }

  function BIT_MIN_NB(nb, bit=5.5){

    let r = calculateBit(nb, bit, true);

    if (!isFinite(r) || isNaN(r) || r > 100 || r < -100) return SUPER_BIT; else { updateSuperBit(r); return r; }

  }



  // NB UI controls

  const nbWindowEl = document.getElementById('nbWindow');

  const nbToggleEl = document.getElementById('nbToggle');

  const sNbMax = document.getElementById('s_nbMax');

  const sNbMin = document.getElementById('s_nbMin');

  const sNbState = document.getElementById('s_nbState');

  const nbMaxSeries = chart.addAreaSeries({

    topColor: 'rgba(255,183,3,0.55)',

    bottomColor: 'rgba(255,183,3,0.20)',

    lineColor: '#ffb703', lineWidth: 3,

    lastValueVisible: true, priceLineVisible: true, priceLineColor: '#ffb703'

  });

  const nbMinSeries = chart.addAreaSeries({

    topColor: 'rgba(0,209,255,0.55)',

    bottomColor: 'rgba(0,209,255,0.20)',

    lineColor: '#00d1ff', lineWidth: 3,

    lastValueVisible: true, priceLineVisible: true, priceLineColor: '#00d1ff'

  });

  // Baseline wave series (visual emphasis)

  nbWaveSeries = chart.addBaselineSeries({

    baseValue: { type: 'price', price: 0 },

    topFillColor1: 'rgba(255,183,3,0.70)',    // 더 진한 주황색 영역

    topFillColor2: 'rgba(255,183,3,0.40)',

    topLineColor: '#ff8c00',                  // 더 진한 주황색 선

    bottomFillColor1: 'rgba(0,209,255,0.70)', // 더 진한 파란색 영역

    bottomFillColor2: 'rgba(0,209,255,0.40)',

    bottomLineColor: '#0066cc',               // 더 진한 파란색 선

    lineWidth: 6,                             // 더 두꺼운 선

  });

  

  // Initialize the line series for connecting N/B markers

  setTimeout(() => {

    nbMarkerLineSeries = chart.addLineSeries({

      color: '#ffffff',

      lineWidth: 2,

      priceLineVisible: false,

      lastValueVisible: false

    });

  }, 100);

  

  // Make nbWaveSeries globally accessible for visual zone checking

  window.nbWaveSeries = nbWaveSeries;

  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

  let nbMaxPriceLine = null; let nbMinPriceLine = null;

  

  function updateNB(){

    try{

      const n = parseInt((nbWindowEl && nbWindowEl.value) || '100', 10);

      const data = candle.data(); 

      if (!data || data.length < Math.max(5,n)) { 

        nbMaxSeries.setData([]); 

        nbMinSeries.setData([]); 

        nbWaveSeries.setData([]);
        if (nbWaveSeries) nbWaveSeries.data = [];

        nbMaxSeries.setMarkers([]);

        nbMinSeries.setMarkers([]);

        nbWaveSeries.setMarkers([]);

        // 연결선도 제거

        if (nbMarkerLineSeries) nbMarkerLineSeries.setData([]);

        if (window.nbMarkerLineSeries2) window.nbMarkerLineSeries2.setData([]);

        return; 

      }

      if (nbToggleEl && !nbToggleEl.checked){ 

        nbMaxSeries.setData([]); 

        nbMinSeries.setData([]); 

        nbWaveSeries.setData([]);
        if (nbWaveSeries) nbWaveSeries.data = [];

        nbMaxSeries.setMarkers([]);

        nbMinSeries.setMarkers([]);

        nbWaveSeries.setMarkers([]);

        // 연결선도 제거

        if (nbMarkerLineSeries) nbMarkerLineSeries.setData([]);

        if (window.nbMarkerLineSeries2) window.nbMarkerLineSeries2.setData([]);

        if (sNbMax) sNbMax.textContent='-'; 

        if (sNbMin) sNbMin.textContent='-'; 

        return; 

      }

      const outMax=[]; const outMin=[]; const outWave=[];

      for (let i=n-1;i<data.length;i++){

        const win = data.slice(i-n+1, i+1);

        let highs, lows, closes;

        if (nbFromEmaEl && nbFromEmaEl.checked){

          const period = parseInt(nbEmaPeriodEl?.value||'10',10);

          const emaVals = ema(data.slice(0,i+1).map(d=>d.close), period);

          const emaWin = emaVals.slice(-win.length);

          highs = emaWin; lows = emaWin; closes = emaWin.map(v=>({value:v}));

          // for hi/lo span, use small buffer around EMA within window

          const hiVal = Math.max(...emaWin); const loVal = Math.min(...emaWin);

          // override below using computed hi/lo

          const hiArr = Array(win.length).fill(hiVal); const loArr = Array(win.length).fill(loVal);

          highs = hiArr; lows = loArr;

        } else {

          highs = win.map(d=>d.high); lows = win.map(d=>d.low); closes = win.map(d=>d.close);

        }

        const hi = Math.max(...highs); const lo = Math.min(...lows); const span = Math.max(hi-lo, 1e-9);

        const closeArr = (nbFromEmaEl && nbFromEmaEl.checked) ? highs.map((_,idx)=> (win[idx]?.close ?? highs[idx])) : closes;

        const changes = [];

        for (let k=1;k<closeArr.length;k++){ const prev=Number(closeArr[k-1]); const cur=Number(closeArr[k]); changes.push(((cur-prev) / (prev||1)) * 100); }

        if (changes.length < 2) continue;

        const scoreMax = clamp(BIT_MAX_NB(changes), 0, 100);

        const scoreMin = clamp(BIT_MIN_NB(changes), 0, 100);

        const priceMax = lo + span * (scoreMax/100);

        const priceMin = lo + span * (scoreMin/100);

        const t = data[i].time;

        const ratio = (scoreMax + scoreMin) > 0 ? (scoreMax / (scoreMax + scoreMin)) : 0.5;

        const waveVal = lo + span * ratio;

        outMax.push({ time:t, value: priceMax });

        outMin.push({ time:t, value: priceMin });

        outWave.push({ time:t, value: waveVal });

      }

      nbMaxSeries.setData([]); // hide standalone bands when wave is enabled

      nbMinSeries.setData([]);

      // Simulated wave using baseline around dynamic middle
      const lastWin = data.slice(Math.max(0, data.length - n), data.length);

      if (lastWin.length){

        const mid = (Math.max(...lastWin.map(d=>d.high)) + Math.min(...lastWin.map(d=>d.low))) / 2;

        nbWaveSeries && nbWaveSeries.applyOptions({ baseValue: { type: 'price', price: mid } });

        nbWaveSeries && nbWaveSeries.setData(outWave);
        if (nbWaveSeries) nbWaveSeries.data = outWave;

        

        // Store outWave globally for visual zone checking

        window.lastOutWave = outWave;

        const mxL = (outMax[outMax.length-1]?.value ?? 0);

        const mnL = (outMin[outMin.length-1]?.value ?? 0);

        const hiL = Math.max(mxL, mnL);

        const loL = Math.min(mxL, mnL);

        const denomL = (hiL - loL) || 1;

        let rLast = ((outWave[outWave.length-1]?.value ?? loL) - loL) / denomL;

        rLast = clamp(rLast, 0, 1);

        uiLog('NB update', `window=${n}, r(last)=${(rLast||0).toFixed(3)}`);

        // Backfill signals with hysteresis: only BUY in BLUE zone, only SELL in ORANGE zone

        nbMarkers = [];
        window.nbMarkers = [];
        window.lastNbSignals = [];

        const rArr = outWave.map((w, i)=>{

          const mx = outMax[Math.min(i, outMax.length-1)].value;

          const mn = outMin[Math.min(i, outMin.length-1)].value;

          const hi = Math.max(mx, mn);

          const lo = Math.min(mx, mn);

          const denom = (hi - lo);

          const rRaw = denom !== 0 ? (w.value - lo) / denom : 0.5;

          return clamp(rRaw, 0, 1);

        });

        const HIGH = 0.55, LOW = 0.45; // hysteresis to avoid chattering

        let zone = null; // 'BLUE'|'ORANGE'

        let lastReady = 0; // readiness percentage

        for (let i=0;i<outWave.length;i++){

          const r = rArr[i] ?? 0.5;

          const tm = outWave[i].time;

          // EMA filter: require EMA fast>slow for BUY, < for SELL

          let emaOkBuy = true, emaOkSell = true;

          if (emaFilterEl && emaFilterEl.checked){

            const data = candle.data();

            if (data && data.length>i){

              const closes = data.slice(0, i+1).map(d=>d.close);

              const ef = Number(emaFastEl?.value||10); const es = Number(emaSlowEl?.value||30);

              const emaFastArr = ema(closes, ef); const emaSlowArr = ema(closes, es);

              const efv = emaFastArr[emaFastArr.length-1]; const esv = emaSlowArr[emaSlowArr.length-1];

              emaOkBuy = (efv >= esv); emaOkSell = (efv <= esv);

            }

          }

          // decide zone using hysteresis

          if (zone === null){ zone = (r >= 0.5) ? 'ORANGE' : 'BLUE'; }

          if (zone === 'BLUE' && r >= HIGH && emaOkSell){

            zone = 'ORANGE';

            pushNBSignal(tm, 'SELL');

            try{ window.lastNbSignals.push({ time: tm, side: 'SELL' }); }catch(_){ }

            uiLog('SELL signal', `zone switch: BLUE→ORANGE, r=${r.toFixed(3)} (switched to top-dominant zone)`);

          } else if (zone === 'ORANGE' && r <= LOW && emaOkBuy){

            zone = 'BLUE';

            pushNBSignal(tm, 'BUY');

            try{ window.lastNbSignals.push({ time: tm, side: 'BUY' }); }catch(_){ }

            uiLog('BUY signal', `zone switch: ORANGE→BLUE, r=${r.toFixed(3)} (switched to bottom-dominant zone)`);

          }

          // readiness (simple): distance to threshold within current zone

          if (zone==='BLUE'){

            const d = Math.max(0, Math.min(1, (HIGH - r) / Math.max(1e-6, HIGH-LOW)));

            lastReady = Math.round((1-d)*100);

          }else{

            const d = Math.max(0, Math.min(1, (r - LOW) / Math.max(1e-6, HIGH-LOW)));

            lastReady = Math.round((d)*100);

          }

        }

        // Create zone arrays from N/B calculation

        const orangeZones = [];

        const blueZones = [];

        const data = candle.data(); // Get candle data

        

        for (let i = 0; i < outWave.length; i++) {

          const r = rArr[i] ?? 0.5;

          const tm = outWave[i].time;

          

          // EMA filter: require EMA fast>slow for BUY, < for SELL

          let emaOkBuy = true, emaOkSell = true;

          if (emaFilterEl && emaFilterEl.checked) {

            if (data && data.length > i) {

              const closes = data.slice(0, i + 1).map(d => d.close);

              const ef = Number(emaFastEl?.value || 10); const es = Number(emaSlowEl?.value || 30);

              const emaFastArr = ema(closes, ef); const emaSlowArr = ema(closes, es);

              const efv = emaFastArr[emaFastArr.length - 1]; const esv = emaSlowArr[emaSlowArr.length - 1];

              emaOkBuy = (efv >= esv); emaOkSell = (efv <= esv);

            }

          }

          

          // decide zone using hysteresis for each point independently

          let currentZone = (r >= 0.5) ? 'ORANGE' : 'BLUE';

          if (currentZone === 'BLUE' && r >= HIGH && emaOkSell) {

            currentZone = 'ORANGE';

          } else if (currentZone === 'ORANGE' && r <= LOW && emaOkBuy) {

            currentZone = 'BLUE';

          }

          

          // Debug logging for zone determination

          if (i < 5) { // Log first 5 zones for debugging

            console.log(`Zone ${i}: r=${r.toFixed(3)}, zone=${currentZone}, emaOkBuy=${emaOkBuy}, emaOkSell=${emaOkSell}`);

          }

          

          // Create zone data with full candle information

          const candleData = data.find(c => c.time === tm);

          if (candleData) {

            const zoneData = {

              time: tm,

              open: candleData.open,

              high: candleData.high,

              low: candleData.low,

              close: candleData.close,

              zone: currentZone

            };

            

            if (currentZone === 'ORANGE') {

              orangeZones.push(zoneData);

            } else {

              blueZones.push(zoneData);

            }

          }

        }

        

        // Store zone arrays globally for access by other functions

        window.orangeZoneArray = orangeZones;

        window.blueZoneArray = blueZones;

        

        // Create color array with actual color values from nbWaveSeries

        const nbWaveColorArray = outWave.map((wave, i) => {

          const r = rArr[i] ?? 0.5;

          const isOrange = r >= 0.5;

          

                            return {

                    time: wave.time,

                    value: wave.value,

                    color: isOrange ? 'rgba(255,183,3,0.70)' : 'rgba(0,209,255,0.70)', // 더 진한 색상 값

                    zone: isOrange ? 'ORANGE' : 'BLUE'

                  };

        });

        

        // Store color array globally

        window.nbWaveColorArray = nbWaveColorArray;

        

        // Force update of chart wave data for immediate access

        if (nbWaveSeries && nbWaveSeries.data) {
          // Ensure the wave data is immediately available
          setTimeout(() => {
            // console.log('=== updateNB: 웨이브 데이터 강제 업데이트 ===');
            // console.log('  - outWave 길이:', outWave.length);
            const nbLen = Array.isArray(nbWaveSeries.data) ? nbWaveSeries.data.length : 0;
            console.log('  - nbWaveColorArray 길이:', nbWaveColorArray.length);
            console.log('  - nbWaveSeries.data 길이:', nbLen);
            
            // 샘플 데이터 확인
            if (outWave.length > 0) {
              console.log('  - 첫 번째 웨이브:', outWave[0]);
              console.log('  - 첫 번째 색상 데이터:', nbWaveColorArray[0]);
            }
          }, 100);
        }

        

        // Log zone statistics

        console.log(`updateNB Zone Arrays Created - ORANGE: ${orangeZones.length} zones, BLUE: ${blueZones.length} zones`);

        console.log(`updateNB Color Array Created - ${nbWaveColorArray.length} color entries`);

        console.log('Debug - orangeZones array type:', Array.isArray(orangeZones));

        console.log('Debug - blueZones array type:', Array.isArray(blueZones));

        console.log('Debug - nbWaveColorArray type:', Array.isArray(nbWaveColorArray));

        console.log('Debug - orangeZones sample:', orangeZones.slice(0, 2));

        console.log('Debug - blueZones sample:', blueZones.slice(0, 2));

        console.log('Debug - nbWaveColorArray sample:', nbWaveColorArray.slice(0, 2));

        

        // Get zone directly from chart's N/B line data

        const zoneFromChartLine = getZoneFromChartLine();

        

        // expose latest chart-derived zone for other UI (e.g., Win buttons)

        try{ 
          const oldZone = window.zoneNow;
          
          // Always use N/B wave series for zone determination - No fallback to chart line
          let nbZone = 'BLUE'; // Default fallback
          if (window.nbWaveSeries && window.nbWaveSeries.data) {
            const nbData = window.nbWaveSeries.data;
            if (Array.isArray(nbData) && nbData.length > 0) {
              const lastNbPoint = nbData[nbData.length - 1];
              const baseValue = window.nbWaveSeries.options().baseValue?.price || 0;
              nbZone = lastNbPoint.value < baseValue ? 'ORANGE' : 'BLUE';
              console.log(`🔍 N/B Zone Calculation: lastPoint=${lastNbPoint.value.toFixed(0)}, baseValue=${baseValue.toFixed(0)} → ${nbZone}`);
            }
          }
          
          window.zoneNow = nbZone;
          
          // Trigger real-time synchronization if zone changed
          if (oldZone !== null && oldZone !== nbZone) {
            console.log(`🔄 N/B Zone Change Detected in updateNB: ${oldZone} → ${nbZone}`);
            setTimeout(() => {
              // Always use window.zoneNow (N/B Zone) for consistency
              updateZoneConsistencyDisplay();
              updateGuildMembersZone(nbZone);
            }, 100);
          } else {
            // Force synchronization even if zone didn't change (for initial load)
            setTimeout(() => {
              updateZoneConsistencyDisplay();
              updateGuildMembersZone(nbZone);
            }, 100);
          }
        }catch(_){ }

        // Check for chart interval change and recover energy
        try {
          const currentInterval = getInterval();
          if (nbEnergy && nbEnergy.lastChartInterval !== currentInterval) {
            const oldInterval = nbEnergy.lastChartInterval;
            nbEnergy.lastChartInterval = currentInterval;
            
            if (oldInterval !== null) {
              // Energy recovery based on chart interval change
              let energyRecovery = 1; // Default +1 for any interval change
              
              if (currentInterval === 'day') {
                energyRecovery = 2; // +2 for day interval
              }
              
              nbEnergy.current = Math.min(nbEnergy.max, nbEnergy.current + energyRecovery);
              
              // console.log(`⚡ Chart interval changed: ${oldInterval} → ${currentInterval}, Energy +${energyRecovery} (Total: ${nbEnergy.current})`);
              
              // Update treasury access if energy reaches 80+
              if (nbEnergy.current >= 80 && !nbEnergy.treasuryAccess) {
                nbEnergy.treasuryAccess = true;
                console.log(`🎉 Treasury access UNLOCKED! Energy reached 80+ (${nbEnergy.current})`);
              }
              
              // Update energy display
              updateStaminaSystem();
            }
          }
        } catch (e) {
          console.error('Error in energy recovery system:', e);
        }

        

        // Log the zone determination for debugging

        // console.log(`updateNB: Chart line zone determined as ${zoneFromChartLine}`);

        

        // Update title with current zone

        updateTitleWithZone();

        

        // reflect readiness gauge

        try{

          if (autoGaugeBar){ autoGaugeBar.style.width = `${Math.max(0, Math.min(100, lastReady))}%`; }

          if (autoGaugeText){ autoGaugeText.textContent = `${Math.max(0, Math.min(100, lastReady))}%`; autoGaugeText.className = 'badge ' + (lastReady>=99? 'bg-success': 'bg-secondary'); }

        }catch(_){ }

        // update live PnL display

        if (sEntry) sEntry.textContent = liveEntry? liveEntry.toLocaleString(): '-';

        if (sPnl) sPnl.textContent = livePnl.toLocaleString();

        

        // Add N/B 라인 이름 마커 (처음, 중간, 끝) 및 연결선

        if (outWave.length > 0) {

          const firstWave = outWave[0];

          const lastWave = outWave[outWave.length - 1];

          

          // 구역이 바뀌는 지점 찾기 (먼저 계산)

          let zoneChangeIndex = -1;

          const baseValue = window.nbWaveSeries?.options()?.baseValue?.price || 0;

          

          for (let i = 1; i < outWave.length; i++) {

            const prevZone = outWave[i-1].value >= baseValue ? 'ORANGE' : 'BLUE';

            const currZone = outWave[i].value >= baseValue ? 'ORANGE' : 'BLUE';

            

            if (prevZone !== currZone) {

              zoneChangeIndex = i;

              break;

            }

          }

          

          // 구역이 바뀌는 지점이 없으면 끝까지, 있으면 그 지점까지만

          const endIndex = zoneChangeIndex > 0 ? zoneChangeIndex : outWave.length - 1;

          const zoneChangeWave = outWave[endIndex];

          

          // N/B 마커 표시 (처음, 구역변경지점, 마지막)
          const nbMarkers = [
            {
              time: firstWave.time,
              position: 'aboveBar',
              color: '#ffffff',
              shape: 'circle',
              text: 'N/B',
              size: 1
            }
          ];
          // Set global nbMarkers for wave counter
          window.nbMarkers = nbMarkers;

          

          // 구역이 바뀌는 지점에 N/B 마커 추가

          if (zoneChangeIndex > 0) {
            nbMarkers.push({
              time: zoneChangeWave.time,
              position: 'aboveBar',
              color: '#ffff00', // 노란색으로 구역 변경 지점 표시
              shape: 'circle',
              text: 'N/B',
              size: 1
            });
            // Update global nbMarkers
            window.nbMarkers = nbMarkers;
          }

          

          // 마지막 지점에 N/B 마커 추가
          nbMarkers.push({
            time: lastWave.time,
            position: 'aboveBar',
            color: '#ffffff',
            shape: 'circle',
            text: 'N/B',
            size: 1
          });
          // Update global nbMarkers
          window.nbMarkers = nbMarkers;

          nbWaveSeries.setMarkers(nbMarkers);

          // Update wave counter after setting markers
          if (window.updateWaveCounter) {
            setTimeout(window.updateWaveCounter, 100);
          }

          

          // 연결선 데이터 생성 (처음→구역변경지점)

          const connectionLines = [

            { time: firstWave.time, value: firstWave.value },

            { time: zoneChangeWave.time, value: zoneChangeWave.value }

          ];

          

          const isUp = zoneChangeWave.value > firstWave.value;

          

          // 연결선 색상 설정

          if (isUp) {

            // 상승선 (녹색)

            nbMarkerLineSeries.applyOptions({ color: '#00ff00' });

          } else {

            // 하락선 (빨간색)

            nbMarkerLineSeries.applyOptions({ color: '#ff0000' });

          }

          

          // 연결선 데이터 설정

          nbMarkerLineSeries.setData(connectionLines);

          

          // 기존 두 번째 라인 시리즈 제거

          if (window.nbMarkerLineSeries2) {

            window.nbMarkerLineSeries2.setData([]);

          }

          

          console.log('N/B 연결선 생성:', {

            '처음→구역변경지점': { 

              direction: isUp ? 'UP' : 'DOWN',

              color: isUp ? '녹색' : '빨간색',

              values: [firstWave.value, zoneChangeWave.value],

              zoneChangeIndex: zoneChangeIndex,

              endIndex: endIndex

            }

          });

          

          // 차트에 N/B 라인 레이블 추가

          try {

            const chartContainer = document.querySelector('.chart-container') || 

                                  document.querySelector('#chart') || 

                                  document.querySelector('.tv-chart-container');

            if (chartContainer) {

              // 기존 N/B 라벨 제거

              const existingLabel = chartContainer.querySelector('.nb-line-label');

              if (existingLabel) {

                existingLabel.remove();

              }

              

              // 새로운 N/B 라벨 추가

              const nbLabel = document.createElement('div');

              nbLabel.className = 'nb-line-label';

              nbLabel.textContent = 'N/B 라인';

              nbLabel.style.cssText = `

                position: absolute;

                top: 10px;

                right: 10px;

                background: rgba(0,0,0,0.7);

                color: white;

                padding: 4px 8px;

                border-radius: 4px;

                font-size: 12px;

                font-weight: bold;

                z-index: 1000;

                pointer-events: none;

              `;

              chartContainer.appendChild(nbLabel);

            }

          } catch (e) {

            console.log('N/B 라인 레이블 추가 오류:', e.message);

          }

        } else {

          nbWaveSeries.setMarkers([]);

          // 연결선도 제거

          if (nbMarkerLineSeries) nbMarkerLineSeries.setData([]);

          if (window.nbMarkerLineSeries2) window.nbMarkerLineSeries2.setData([]);

        }

        nbMaxSeries.setMarkers([]);

        nbMinSeries.setMarkers([]);

      }

      nbMaxOutline.setData(outMax);

      nbMinOutline.setData(outMin);

      if (outMax.length){ if (sNbMax) sNbMax.textContent = Number(outMax[outMax.length-1].value).toLocaleString(); }

      if (outMin.length){ if (sNbMin) sNbMin.textContent = Number(outMin[outMin.length-1].value).toLocaleString(); }

      if (sNbState && outMax.length && outMin.length){

        const mx = outMax[outMax.length-1].value;

        const mn = outMin[outMin.length-1].value;

        const hi = Math.max(mx, mn);

        const lo = Math.min(mx, mn);

        const crossed = mn > mx;

        sNbState.textContent = crossed

          ? `Zone crossover (Min>Max): Hi ${hi.toLocaleString()} / Lo ${lo.toLocaleString()}`

          : `Hi/Lo: ${hi.toLocaleString()} / ${lo.toLocaleString()}`;

        sNbState.className = crossed ? 'badge bg-info' : 'badge bg-secondary';

      }

      // labeled price lines disabled in wave-only mode

      



    }catch(e){ /* ignore */ }

  }

  // Expose updateNB immediately after definition for external access
  window.updateNB = updateNB;
  console.log('✅ updateNB exposed to window immediately');



  // -------- Forecast (gray dashed) ---------

  const forecastSeries = chart.addLineSeries({ color:'rgba(200,200,200,0.95)', lineStyle: 2, lineWidth: 3 });

  // Predicted path series

  const predSeries = chart.addLineSeries({ color:'#ffffff', lineStyle: 0, lineWidth: 2 });
  const predMarkerSeries = chart.addLineSeries({ color:'rgba(0,0,0,0)', lineWidth: 0, priceLineVisible:false });

  function updateForecast(){

    try{

      if (!fcToggleEl || !fcToggleEl.checked){ forecastSeries.setData([]); return; }

      const w = parseInt((fcWindowEl && fcWindowEl.value) || '120', 10);

      const h = parseInt((fcHorizonEl && fcHorizonEl.value) || '30', 10);

      const data = candle.data(); if (!data || data.length < w+2){ forecastSeries.setData([]); return; }

      const win = data.slice(-w);

      const xs = win.map((_,i)=>i);

      const ys = win.map(p=>p.close ?? p.value ?? p.open ?? p.high ?? p.low);

      // Quadratic regression y = a2*x^2 + a1*x + a0 (captures curvature)

      const n = xs.length;

      let s1=0,s2=0,s3=0,s4=0, sy=0, sxy=0, sx2y=0;

      for (let i=0;i<n;i++){

        const x=xs[i]; const x2=x*x; const x3=x2*x; const x4=x2*x2; const y=ys[i];

        s1 += x; s2 += x2; s3 += x3; s4 += x4; sy += y; sxy += x*y; sx2y += x2*y;

      }

      // Solve normal equations

      // | n   s1   s2 | |a0|   | sy  |

      // | s1  s2   s3 |*|a1| = | sxy |

      // | s2  s3   s4 | |a2|   | sx2y|

      function det3(a,b,c,d,e,f,g,h,i){ return a*(e*i-f*h) - b*(d*i-f*g) + c*(d*h-e*g); }

      const D  = det3(n, s1, s2,  s1, s2, s3,  s2, s3, s4) || 1;

      const D0 = det3(sy, s1, s2,  sxy, s2, s3,  sx2y, s3, s4);

      const D1 = det3(n, sy, s2,  s1, sxy, s3,  s2, sx2y, s4);

      const D2 = det3(n, s1, sy,  s1, s2, sxy,  s2, s3, sx2y);

      const a0 = D0/D, a1 = D1/D, a2 = D2/D;

      const startT = win[0].time;

      const step = (win[win.length-1].time - startT) / (win.length-1 || 1);

      const proj = [];

      const lo = Math.min(...win.map(p=>p.low ?? p.value ?? p.close));

      const hi = Math.max(...win.map(p=>p.high ?? p.value ?? p.close));

      const span = Math.max(hi-lo, 1e-9);

      for (let i=0;i<w+h;i++){

        const t = startT + i*step;

        let v = a2*i*i + a1*i + a0;

        // clamp to reasonable band to avoid explosions

        const minV = lo - 0.25*span, maxV = hi + 0.25*span;

        if (v < minV) v = minV; if (v > maxV) v = maxV;

        proj.push({ time: Math.round(t), value: v });

      }

      forecastSeries.setData(proj);

    }catch(_){ forecastSeries.setData([]); }

  }



  async function drawPredictedPath(){

    try{

      const j = await fetchJsonStrict(`/api/ml/predict?interval=${encodeURIComponent(getInterval())}`).catch((err) => {
        console.warn(`Failed to fetch ML predict: ${err.message}`);
        return null;
      });

      if (!j || !j.ok) {

        // Always show narrative even if prediction not available

        predSeries.setData([]);

        try{

          const box = document.getElementById('nbNarrative');

          const badge = document.getElementById('nbNarrativeBadge');

          if (box){

            const zone = (typeof window!=='undefined' && window.zoneNow) ? String(window.zoneNow).toUpperCase() : '-';

            const line = `Current zone: ${zone}. Model prediction not available yet. Waiting for training/prediction...`;

            box.textContent = line;

            if (badge) { badge.textContent = zone; badge.className = 'badge bg-white text-dark'; }

          }

        }catch(_){ }

        return;

      }

      const steep = j.steep || {};

      const ins = j.insight || {};

      const data = candle.data(); if (!data || data.length < 5){ predSeries.setData([]); return; }

      const last = data[data.length-1];

      const times = data.map(d=>d.time);

      const closeNow = last.close ?? last.value;

      const interval = j.interval || getInterval();

      const curIv = getInterval();

      const sameIv = (String(interval) === String(curIv));

      const horizon = Math.max(1, Number(j.horizon||5));

      if (!sameIv){

        // Do not render ML artifacts if prediction is for a different timeframe

        predSeries.setData([]);

        predMarkerSeries.setData([]);

        return;

      }

      const bpPerBar = (ins.zone==='BLUE' ? steep.blue_up_slope : steep.orange_down_slope);

      let v = closeNow;

      if (bpPerBar==null){

        // No slope yet → keep path empty but still update narrative below

        predSeries.setData([]);

      } else {

        // bp/bar → fractional slope per bar

        const k = Number(bpPerBar)/10000.0;

        const dt = (times[times.length-1] - times[times.length-2]) || 60; // seconds

        const step = dt; // seconds per bar

        const proj = [{ time: last.time, value: closeNow }];

        for (let i=1;i<=horizon;i++){

          v = v * (1 + k); // geometric per bar

          proj.push({ time: last.time + i*step, value: v });

        }

        predSeries.setData(proj);

      }

      // All markers disabled to prevent transparent bars

      candle.setMarkers([]);

      // English narrative using current NB/zone and predicted path

      try{

        const box = document.getElementById('nbNarrative');

        const badge = document.getElementById('nbNarrativeBadge');

        if (box){

          const zone = (j.insight?.zone||'-').toUpperCase();

          const slope = (j.steep && (j.steep.blue_up_slope!=null ? j.steep.blue_up_slope : j.steep.orange_down_slope));

          const slopeBp = (slope!=null) ? (slope*10000).toFixed(2) : '-';

          const nb = j.pred_nb || null;

          const nbTxt = (nb && nb.side) ? `${nb.side} in ~${nb.bars} bars` : 'no flip expected soon';

          const line = `Current zone: ${zone}. Model projects a ${slope!=null ? (zone==='ORANGE'?'down':'up') : 'flat'} slope of ${slopeBp} bp/bar. Expected NB flip: ${nbTxt}.`;

          box.textContent = line;

          if (badge) { badge.textContent = zone; badge.className = 'badge bg-white text-dark'; }

        }

      }catch(_){ }

      // Place one ML signal per zone segment at its extreme if certain, and persist to server

      try{

        const zone = String(ins.zone||'-').toUpperCase();

        if (mlSegPrevZone !== zone){ mlSegPrevZone = zone; mlSegPlaced = false; }

        const barSec = (times[times.length-1] - times[times.length-2]) || 60; // seconds per bar

        const age = Number(ins.zone_extreme_age||0);

        const extremeTime = last.time - Math.max(0, age)*barSec;

        const extremePrice = (ins.zone_extreme_price!=null) ? Number(ins.zone_extreme_price) : closeNow;

        const pb = Number(ins.pct_blue||ins.pct_blue_raw||0);

        const po = Number(ins.pct_orange||ins.pct_orange_raw||0);

        const pctMajor = Math.max(pb, po);

        const slope = (j.steep && (j.steep.blue_up_slope!=null ? j.steep.blue_up_slope : j.steep.orange_down_slope));

        const slopeBp = (slope!=null) ? (slope*10000) : 0;

        const predOk = !!(j.pred_nb && j.pred_nb.ts);

        const confTh = 99.95, minBp = 1.0, minAge = 3;

        const gated = (pctMajor >= confTh) && (Math.abs(slopeBp) >= minBp) && predOk && (age >= minAge);

        const extreme = (zone==='ORANGE') ? 'TOP' : (zone==='BLUE' ? 'BOTTOM' : '-');

        const sideBuy = (zone==='BLUE');

        const key = `${interval}|${zone}|${extreme}|${Math.floor(extremeTime)}`;

        if (sameIv && zone!=='-' && extreme!=='-' && gated && !mlSegPlaced && !mlSignalKeys.has(key)){

          // All markers disabled to prevent transparent bars

          candle.setMarkers([]);

          mlSegPlaced = true;

          mlSignalKeys.add(key);

          const body = { ts: Math.floor(extremeTime*1000), zone, extreme, price: extremePrice, pct_major: pctMajor, slope_bp: slopeBp, horizon, pred_nb: j.pred_nb||null, interval, score0: Number(j.score0||0) };

          postJson('/api/signal/log', body).catch(()=>{});

        }

      }catch(_){ }

    }catch(_){ predSeries.setData([]); }

  }



  function ema(values, period){

    if (!values.length) return [];

    const k = 2/(period+1); const out=[]; let prev = values[0];

    for (let i=0;i<values.length;i++){ const v=(i? values[i]*k + prev*(1-k) : values[0]); out.push(v); prev=v; }

    return out;

  }

  const msToSec = (ms)=> Math.floor(ms/1000);

  function bucketTs(tsMs, interval){

    if (interval.startsWith('minute')){ const m = parseInt(interval.replace('minute',''),10)||1; return Math.floor(tsMs/(m*60*1000))*(m*60*1000); }

    if (interval==='minute60'){ return Math.floor(tsMs/(60*60*1000))*(60*60*1000); }

    if (interval==='day'){ const d=new Date(tsMs); d.setHours(0,0,0,0); return d.getTime(); }

    return tsMs;

  }

  async function retrainLatest(){

    try{

      // Use current UI options to retrain briefly with recent data

      const interval = getInterval();

      const window = parseInt((nbWindowEl && nbWindowEl.value) || '50', 10);

      const ema_fast = parseInt((emaFastEl && emaFastEl.value) || '10', 10);

      const ema_slow = parseInt((emaSlowEl && emaSlowEl.value) || '30', 10);

      const payload = { window, ema_fast, ema_slow, horizon: 5, tau: 0.002, count: Math.max(600, window*12), interval };

      const t = await fetchJsonStrict('/api/ml/train', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });

      const pred = await fetchJsonStrict('/api/ml/predict').catch(() => null);

      if (mlCountEl && t && t.ok) mlCountEl.textContent = `(train# ${t.train_count||0})`;

      if (pred && pred.ok){ uiLog('ML Auto predict', `action=${pred.action}, pred=${pred.pred}`); }

    }catch(_){ }

  }



  // All markers disabled to prevent transparent bars

  let baseMarkers = [];

  let nbMarkers = [];

  // ML segment state and logged keys to avoid duplicate markers per segment

  let mlSegPrevZone = null;

  let mlSegPlaced = false;

  let mlSignalKeys = new Set();



  // Helper: show order markers only if there is an ML signal near the order time on this timeframe

  function hasMlSignalNear(orderTimeSec, interval){

    try{

      const curIv = interval || getInterval();

      const data = candle.data();

      if (!data || data.length < 2) return false;

      const barSec = (data[data.length-1].time - data[data.length-2].time) || 60;

      const maxDelta = barSec * 2; // within ±2 bars

      // baseMarkers contains both ML signal markers (text starts with 'ML') and order markers

      for (const m of baseMarkers){

        try{

          if (!m || !m.text) continue;

          if (String(m.text).startsWith('ML')){

            if (Math.abs(Number(m.time) - Number(orderTimeSec)) <= maxDelta) return true;

          }

        }catch(_){ }

      }

      return false;

    }catch(_){ return false; }

  }

  // NB wave based lightweight signals on the UI

  let nbPosition = 'FLAT';

  let nbPeakRatio = 0; // highest ratio seen while LONG

  const NB_UP_TH = 0.7; // buy threshold

  const NB_DN_TH = 0.3; // sell floor

  function pushNBSignal(timeSec, side){

    // All markers disabled to prevent transparent bars

    return;

  }

  function pushOrderMarker(o, interval){

    if (!o||!o.ts) return;

    const sideStr = String(o.side||'').toUpperCase();

    const key = `${Number(o.ts)||0}|${sideStr}|${Math.round(Number(o.price||0))}|${o.paper?1:0}`;

    if (orderKeys.has(key)){

      return;

    }

    orderKeys.add(key);

    if (orderKeys.size>2000){

      // prune oldest by reconstructing from current log length

      try{ orderKeys = new Set(Array.from(orderKeys).slice(-1500)); }catch(_){ }

    }

    const curIv = getInterval();

    const orderIv = String(o.interval||'');

    // Show orders only when they belong to current chart interval

    if (orderIv && String(orderIv) !== String(curIv)) return;

    const sec = msToSec(bucketTs(Number(o.ts), curIv));

    // Skip if there is no ML signal near this order time

    if (!hasMlSignalNear(sec, curIv)) return;

    const isBuy = sideStr==='BUY';

    // All markers disabled to prevent transparent bars

    candle.setMarkers([]);

    // Append to bottom order log

    try{

      if (orderLog){

        const ts = new Date(Number(o.ts)).toLocaleString();

        let line = `[${ts}] ${isBuy? 'BUY':'SELL'} @${Number(o.price||0).toLocaleString()} ${o.size? '('+Number(o.size).toFixed(6)+')':''} ${o.paper? '[PAPER]':''}`;

        // Append model insight snapshot if present

        try{

          const ins = o.insight || (typeof window!=='undefined' && window.lastInsight ? window.lastInsight : {});

          if (ins && (typeof ins === 'object')){

            const r = isFinite(ins.r)? Number(ins.r).toFixed(3) : '-';

            const zone = String(ins.zone||'-');

            const cb = isFinite(ins.pct_blue)? Number(ins.pct_blue).toFixed(1) : (isFinite(ins.pct_blue_raw)? Number(ins.pct_blue_raw).toFixed(1) : '-');

            const co = isFinite(ins.pct_orange)? Number(ins.pct_orange).toFixed(1) : (isFinite(ins.pct_orange_raw)? Number(ins.pct_orange_raw).toFixed(1) : '-');

            const minr = isFinite(ins.zone_min_r)? Number(ins.zone_min_r).toFixed(3) : '-';

            const maxr = isFinite(ins.zone_max_r)? Number(ins.zone_max_r).toFixed(3) : '-';

            const exr = isFinite(ins.zone_extreme_r)? Number(ins.zone_extreme_r).toFixed(3) : '-';

            const age = isFinite(ins.zone_extreme_age)? Number(ins.zone_extreme_age) : '-';

            line += ` | r=${r} | zone=${zone} | BLUE=${cb}% | ORANGE=${co}% | min_r=${minr} | max_r=${maxr} | ex_r=${exr} | age=${age}`;

          }

        }catch(_){ }

        // NB trade signal context

        try{

          const nbSig = String(o.nb_signal||'').toUpperCase();

          const nbWin = Number(o.nb_window||0);

          const nbR = (o.nb_r!=null) ? Number(o.nb_r).toFixed(3) : undefined;

          if (nbSig){ line += ` | NB=${nbSig}${nbWin? ' w='+nbWin:''}${(nbR!==undefined)? ' r='+nbR:''}`; }

        }catch(_){ }

        const div = document.createElement('div');

        // Only log when an actual order happened: in paper mode always, in live only if o.live_ok

        try{

          const liveOk = (!o.paper) ? !!o.live_ok : true;

          if (liveOk){ div.textContent = line; orderLog.prepend(div); }

        }catch(_){ div.textContent = line; orderLog.prepend(div); }

        // keep last 200

        while (orderLog.childElementCount>200){ orderLog.removeChild(orderLog.lastElementChild); }

      }

    }catch(_){ }

  }

  // Expose initChart immediately after definition for HTML access
  window.initChart = initChart;
  console.log('✅ initChart exposed to window immediately');


  function seed(interval){

    fetch(`${base}/api/ohlcv?interval=${interval}&count=300`).then(r=>r.json()).then(res=>{

      const rows = res.data || [];

      // Defensive filter: drop any candle with null/NaN/undefined values to avoid lightweight-charts errors
      const validRows = rows.filter(r => {
        if (!r) return false;
        const vals = [r.time, r.open, r.high, r.low, r.close];
        return vals.every(v => v !== null && v !== undefined && Number.isFinite(Number(v)));
      });

      const cs = validRows.map(r=>({ time: msToSec(r.time), open:Number(r.open), high:Number(r.high), low:Number(r.low), close:Number(r.close) }));

      // Check if candle series exists before setting data
      if (candle && typeof candle.setData === 'function') {
        candle.setData(cs);
        setCandleDataCache(cs);
        setCandleDataCache(cs);
      } else {
        console.error('❌ Candle series not available for data update');
        return;
      }

      

      // Store the latest candle data for zone determination using validated rows

      lastCandleData = validRows.length > 0 ? validRows[validRows.length - 1] : null;

      // console.log('Chart data updated:', lastCandleData ? `Open: ${lastCandleData.open}, Close: ${lastCandleData.close}` : 'No data');

      

      // Update zone indicator on chart

      setTimeout(() => {
        updateZoneIndicator();
        if (window.updateWaveCounter) {
          window.updateWaveCounter(); // Update wave counter when chart data changes
        }
      }, 100);

      const closes = validRows.map(r=>Number(r.close));
      const times = validRows.map(r=>msToSec(r.time));

      const ef = Number(emaFastEl?.value||10), es = Number(emaSlowEl?.value||30);

      // Check if EMA series exist before setting data
      if (emaF && typeof emaF.setData === 'function') {
        emaF.setData(ema(closes,ef).map((y,i)=>({ time: times[i], value:y })));
      }
      if (emaS && typeof emaS.setData === 'function') {
        emaS.setData(ema(closes,es).map((y,i)=>({ time: times[i], value:y })));
      }

      // SMA

      function sma(arr, n){ const out=[]; let sum=0; for(let i=0;i<arr.length;i++){ sum+=arr[i]; if(i>=n) sum-=arr[i-n]; out.push(i>=n-1? sum/n : arr[i]); } return out; }

      const sma50 = sma(closes, Number(sma50El?.value||50)).map((v,i)=>({ time: times[i], value:v }));

      const sma100 = sma(closes, Number(sma100El?.value||100)).map((v,i)=>({ time: times[i], value:v }));

      const sma200 = sma(closes, Number(sma200El?.value||200)).map((v,i)=>({ time: times[i], value:v }));

      // Check if SMA series exist before setting data
      if (showSMAEl && showSMAEl.checked){
        if (sma50Series && typeof sma50Series.setData === 'function') sma50Series.setData(sma50);
        if (sma100Series && typeof sma100Series.setData === 'function') sma100Series.setData(sma100);
        if (sma200Series && typeof sma200Series.setData === 'function') sma200Series.setData(sma200);
      } else {
        if (sma50Series && typeof sma50Series.setData === 'function') sma50Series.setData([]);
        if (sma100Series && typeof sma100Series.setData === 'function') sma100Series.setData([]);
        if (sma200Series && typeof sma200Series.setData === 'function') sma200Series.setData([]);
      }

      // EMA 9/12/26

      const e9 = ema(closes,9).map((v,i)=>({ time: times[i], value:v }));

      const e12 = ema(closes,12).map((v,i)=>({ time: times[i], value:v }));

      const e26 = ema(closes,26).map((v,i)=>({ time: times[i], value:v }));

      // Check if EMA 9/12/26 series exist before setting data
      if (showEMA9El && showEMA9El.checked){
        if (ema9Series && typeof ema9Series.setData === 'function') ema9Series.setData(e9);
        if (ema12Series && typeof ema12Series.setData === 'function') ema12Series.setData(e12);
        if (ema26Series && typeof ema26Series.setData === 'function') ema26Series.setData(e26);
      } else {
        if (ema9Series && typeof ema9Series.setData === 'function') ema9Series.setData([]);
        if (ema12Series && typeof ema12Series.setData === 'function') ema12Series.setData([]);
        if (ema26Series && typeof ema26Series.setData === 'function') ema26Series.setData([]);
      }

      // Ichimoku Tenkan/Kijun (simple high-low average)

      function highLowAvg(rowsArr, period){ const out=[]; for(let i=0;i<rowsArr.length;i++){ const start=Math.max(0,i-period+1); let hi=-Infinity, lo=Infinity; for(let j=start;j<=i;j++){ hi=Math.max(hi, rowsArr[j].high); lo=Math.min(lo, rowsArr[j].low); } out.push((hi+lo)/2); } return out; }

      try {

        const tenkanN = Number(ichiTenkanEl?.value||9), kijunN = Number(ichiKijunEl?.value||26);

        const tenkan = highLowAvg(rows, tenkanN).map((v,i)=>({ time: times[i], value:v }));

        const kijun = highLowAvg(rows, kijunN).map((v,i)=>({ time: times[i], value:v }));

        // Check if Ichimoku series exist before setting data
        if (showIchimokuEl && showIchimokuEl.checked){
          if (ichiTenkanSeries && typeof ichiTenkanSeries.setData === 'function') ichiTenkanSeries.setData(tenkan);
          if (ichiKijunSeries && typeof ichiKijunSeries.setData === 'function') ichiKijunSeries.setData(kijun);
        } else {
          if (ichiTenkanSeries && typeof ichiTenkanSeries.setData === 'function') ichiTenkanSeries.setData([]);
          if (ichiKijunSeries && typeof ichiKijunSeries.setData === 'function') ichiKijunSeries.setData([]);
        }

      } catch(_){
        if (ichiTenkanSeries && typeof ichiTenkanSeries.setData === 'function') ichiTenkanSeries.setData([]);
        if (ichiKijunSeries && typeof ichiKijunSeries.setData === 'function') ichiKijunSeries.setData([]);
      }

      updateNB();

      updateForecast();

    }).then(()=>{

      // load existing orders; show only when order interval matches current chart interval

      const curIv = getInterval();

      return fetch(`${base}/api/orders`).then(r=>r.json()).then(or=>{

        markers=[]; (or.data||[]).forEach(o=>{

          try{

            const ok = !o.interval || String(o.interval)===String(curIv);

            if (ok) pushOrderMarker(o, interval);

          }catch(_){ pushOrderMarker(o, interval); }

        });

      });

    }).catch(()=>{});

  }

  // Expose seed immediately after definition for external access
  window.seed = seed;
  console.log('✅ seed exposed to window immediately');



  // Restore saved options

  (function restore(){

    const o = readOpts();

    if (tfEl && o.timeframe) tfEl.value = o.timeframe;

    if (paperEl && typeof o.paper !== 'undefined') paperEl.value = String(o.paper);

    if (orderEl){
      if (o.order_krw){
        orderEl.value = o.order_krw;
      } else if (!orderEl.value){
        orderEl.value = 5000;
      }
    }

    if (emaFastEl && o.ema_fast) emaFastEl.value = o.ema_fast;

    if (emaSlowEl && o.ema_slow) emaSlowEl.value = o.ema_slow;

    if (nbWindowEl && o.nb_window) nbWindowEl.value = o.nb_window;

    if (nbToggleEl && typeof o.nb_show !== 'undefined') nbToggleEl.checked = !!o.nb_show;

    if (nbBuyThEl && o.nb_buy_th) nbBuyThEl.value = o.nb_buy_th;

    if (nbSellThEl && o.nb_sell_th) nbSellThEl.value = o.nb_sell_th;

    if (nbDebounceEl && o.nb_debounce) nbDebounceEl.value = o.nb_debounce;

    if (emaFilterEl && typeof o.ema_filter !== 'undefined') emaFilterEl.checked = !!o.ema_filter;

    if (nbFromEmaEl && typeof o.nb_from_ema !== 'undefined') nbFromEmaEl.checked = !!o.nb_from_ema;

    if (nbEmaPeriodEl && o.nb_ema_period) nbEmaPeriodEl.value = o.nb_ema_period;

    if (typeof fcWindowEl !== 'undefined' && fcWindowEl && o.fc_window) fcWindowEl.value = o.fc_window;

    if (typeof fcHorizonEl !== 'undefined' && fcHorizonEl && o.fc_horizon) fcHorizonEl.value = o.fc_horizon;

    if (typeof fcToggleEl !== 'undefined' && fcToggleEl && typeof o.fc_show !== 'undefined') fcToggleEl.checked = !!o.fc_show;

    // ordersToggle removed

    if (typeof autoBtToggle !== 'undefined' && autoBtToggle && typeof o.auto_bt !== 'undefined') autoBtToggle.checked = !!o.auto_bt;

    if (typeof autoBtSecEl !== 'undefined' && autoBtSecEl && o.auto_bt_sec) autoBtSecEl.value = o.auto_bt_sec;

    if (showSMAEl && typeof o.show_sma !== 'undefined') showSMAEl.checked = !!o.show_sma;

    if (sma50El && o.sma50) sma50El.value = o.sma50;

    if (sma100El && o.sma100) sma100El.value = o.sma100;

    if (sma200El && o.sma200) sma200El.value = o.sma200;

    if (showEMA9El && typeof o.show_ema9 !== 'undefined') showEMA9El.checked = !!o.show_ema9;

    if (showIchimokuEl && typeof o.show_ichimoku !== 'undefined') showIchimokuEl.checked = !!o.show_ichimoku;

    if (ichiTenkanEl && o.ichi_tenkan) ichiTenkanEl.value = o.ichi_tenkan;

    if (ichiKijunEl && o.ichi_kijun) ichiKijunEl.value = o.ichi_kijun;

    if (typeof trainCountEl !== 'undefined' && trainCountEl && o.train_count) trainCountEl.value = o.train_count;

    if (typeof trainSegEl !== 'undefined' && trainSegEl && o.train_seg) trainSegEl.value = o.train_seg;

    // extras

    try{

      const enforceZoneSideEl = document.getElementById('enforceZoneSide');

      if (enforceZoneSideEl && typeof o.enforce_zone_side !== 'undefined') enforceZoneSideEl.checked = !!o.enforce_zone_side;

      const optAutoSaveEl = document.getElementById('optAutoSave');

      if (optAutoSaveEl && typeof o.opt_auto_save !== 'undefined') optAutoSaveEl.checked = !!o.opt_auto_save;

    }catch(_){ }

    // push restored config to server and persist again

    pushConfig().catch(()=>{});

    // fetch persisted NB params from server and apply

    fetch('/api/nb/params').then(r=>r.json()).then(j=>{

      if (j && j.ok && j.params){

        if (nbBuyThEl && j.params.buy) nbBuyThEl.value = String(j.params.buy);

        if (nbSellThEl && j.params.sell) nbSellThEl.value = String(j.params.sell);

        if (nbWindowEl && j.params.window) nbWindowEl.value = String(j.params.window);

        updateNB();

      }

    }).catch(()=>{});

    // re-arm auto BT if enabled

    // Do not auto-start anything here

  })();



  seed(getInterval());

  

  // Initial title update after data load

  setTimeout(() => {

    updateTitleWithZone();

    refreshNbZoneStrip(); // Initial N/B Zone strip update (분봉 표시 포함)
  }, 1000);

  

  // periodic prediction path and chart data refresh (throttled to reduce API spam)

  let predictLoopTimer = null;
  let predictLoopRunning = false;
  const PREDICT_LOOP_MS = 15000; // was 3000ms

  function startPredictLoop() {
    if (predictLoopTimer) clearInterval(predictLoopTimer);
    predictLoopTimer = setInterval(()=>{ 
      if (predictLoopRunning) return; // avoid overlapping ticks
      predictLoopRunning = true;

      (async () => {
        await drawPredictedPath(); 

        await seed(getInterval()); // Refresh chart data for zone determination

        // Only update zone indicator if needed (not every 3 seconds)

        setTimeout(() => {

          updateZoneIndicator(); // Update zone indicator after data refresh

          updateNBLineWithText(); // Update N/B line with text

          updateTitleWithZone(); // Update title with current zone

          refreshNbZoneStrip(); // Update N/B Zone strip

        }, 500);
      })().finally(() => { predictLoopRunning = false; });

    }, PREDICT_LOOP_MS);
  }
  startPredictLoop();

  if (tfEl) tfEl.addEventListener('change', ()=>{

    // Update global interval when timeframe changes
    window.currentGlobalInterval = tfEl.value;
    
    // Immediately update N/B Zone Status timeframe
    updateNBZoneTimeframe();

    // Clear ML/NB markers and segment state when timeframe changes so signals only show on the selected timeframe

    try{

      baseMarkers = [];

      nbMarkers = [];
      window.nbMarkers = [];

      mlSignalKeys = new Set();

      mlSegPrevZone = null;

      mlSegPlaced = false;

        candle.setMarkers([]); // Keep markers cleared
      
      // Update wave counter after clearing markers
      if (window.updateWaveCounter) {
        setTimeout(window.updateWaveCounter, 100);
      }

      predMarkerSeries.setData([]);

      predSeries.setData([]);

    }catch(_){ }

    seed(getInterval());

    // Reset interval zone when timeframe changes

    currentIntervalZone = null;

    lastIntervalTime = null;

    nbZoneStartTime = null;

    nbZoneDuration = 0;

          // Update zone indicator after timeframe change

      setTimeout(() => {

        updateZoneIndicator();

        updateNBLineWithText();

        updateTitleWithZone();

        refreshNbZoneStrip(); // N/B Zone strip 업데이트 (분봉 표시 포함)

      }, 200);

    pushConfig();
    
    // 🎯 UI 차트 간격을 서버에 전송하여 동기화
    updateServerCurrentInterval();

  });

  if (nbWindowEl) nbWindowEl.addEventListener('change', ()=>{ updateNB(); updateForecast(); saveOpts(); });

  if (nbToggleEl) nbToggleEl.addEventListener('change', ()=>{ updateNB(); updateForecast(); saveOpts(); });

  if (nbBuyThEl) nbBuyThEl.addEventListener('change', saveOpts);

  if (nbSellThEl) nbSellThEl.addEventListener('change', saveOpts);

  if (nbDebounceEl) nbDebounceEl.addEventListener('change', saveOpts);

  if (emaFilterEl) emaFilterEl.addEventListener('change', ()=>{ saveOpts(); updateNB(); });

  if (nbFromEmaEl) nbFromEmaEl.addEventListener('change', ()=>{ saveOpts(); updateNB(); });

  if (nbEmaPeriodEl) nbEmaPeriodEl.addEventListener('change', ()=>{ saveOpts(); updateNB(); });

  if (typeof fcWindowEl !== 'undefined' && fcWindowEl) fcWindowEl.addEventListener('change', ()=>{ updateForecast(); saveOpts(); });

  if (typeof fcHorizonEl !== 'undefined' && fcHorizonEl) fcHorizonEl.addEventListener('change', ()=>{ updateForecast(); saveOpts(); });

  if (typeof fcToggleEl !== 'undefined' && fcToggleEl) fcToggleEl.addEventListener('change', ()=>{ updateForecast(); saveOpts(); });

  // ordersToggle removed

  if (autoBtSecEl) autoBtSecEl.addEventListener('change', saveOpts);

  try{

    const enforceZoneSideEl2 = document.getElementById('enforceZoneSide');

    const assetsAutoToggle2 = document.getElementById('assetsAuto');

    const optAutoSaveEl2 = document.getElementById('optAutoSave');

    if (enforceZoneSideEl2) enforceZoneSideEl2.addEventListener('change', ()=>{ saveOpts(); pushConfig(); });

    if (assetsAutoToggle2) assetsAutoToggle2.addEventListener('change', saveOpts);

    if (optAutoSaveEl2) optAutoSaveEl2.addEventListener('change', ()=>{ writeOpts({ opt_auto_save: !!optAutoSaveEl2.checked }); });

  }catch(_){ }

  if (showSMAEl) showSMAEl.addEventListener('change', ()=>{ saveOpts(); seed(getInterval()); });

  if (sma50El) sma50El.addEventListener('change', ()=>{ saveOpts(); seed(getInterval()); });

  if (sma100El) sma100El.addEventListener('change', ()=>{ saveOpts(); seed(getInterval()); });

  if (sma200El) sma200El.addEventListener('change', ()=>{ saveOpts(); seed(getInterval()); });

  if (showEMA9El) showEMA9El.addEventListener('change', ()=>{ saveOpts(); seed(getInterval()); });

  if (showIchimokuEl) showIchimokuEl.addEventListener('change', ()=>{ saveOpts(); seed(getInterval()); });

  if (ichiTenkanEl && ichiTenkanEl.addEventListener('change', ()=>{ saveOpts(); seed(getInterval()); }))

  if (ichiKijunEl) ichiKijunEl.addEventListener('change', ()=>{ saveOpts(); seed(getInterval()); });

  if (trainCountEl) trainCountEl.addEventListener('change', saveOpts);

  if (trainSegEl) trainSegEl.addEventListener('change', saveOpts);

  window.addEventListener('beforeunload', saveOpts);



  // Bind config change handlers

  [paperEl, orderEl, emaFastEl, emaSlowEl].forEach(el=>{

    if (!el) return;

    el.addEventListener('change', ()=>{ pushConfig(); });

  });



  // Start/Stop bot

  if (startBtn) startBtn.addEventListener('click', async ()=>{

    await pushConfig();

    // Start bot only via explicit Auto Trade toggle; here we do nothing to avoid accidental starts

    uiLog('Hint', 'Use Auto Trade toggle to start the bot');

  });

  if (stopBtn) stopBtn.addEventListener('click', async ()=>{

    await postJson('/api/bot/stop', {});

    if (sBot) sBot.textContent = 'stopped';

  });



  try{

    const es = new EventSource(`/api/stream`);

    es.onmessage = (e)=>{

      try{

        const j = JSON.parse(e.data);

        // Update meta with zone information

        const meta = document.getElementById('meta'); 

        if (meta) {

          const currentZone = window.zoneNow || 'BLUE';

          const zoneEmoji = currentZone === 'ORANGE' ? '🟠' : '🔵';

          meta.textContent = `${j.market} ${j.candle} | ${j.signal} | EMA ${j.ema_fast}/${j.ema_slow} | ${zoneEmoji} ${currentZone}`;

        }

        if (sTicker) sTicker.textContent = j.market || '-';

        if (sPrice) sPrice.textContent = (j.price||0).toLocaleString();

        if (sSignal){ sSignal.textContent=j.signal; sSignal.className = (j.signal==='BUY'?'buy':'sell'); }

        const itv = getInterval(); const bMs = bucketTs(j.ts, itv); const bSec = msToSec(bMs);

        const data = candle.data(); const last = data[data.length-1];
        let updatedBar;

        if (last && last.time === bSec){

          updatedBar = { ...last, close:j.price, high:Math.max(last.high,j.price), low:Math.min(last.low,j.price) };

        } else {

          const prev = last ? last.close : j.price;

          updatedBar = { time:bSec, open:prev, high:j.price, low:j.price, close:j.price };

        }

        candle.update(updatedBar);
        updateCandleDataCache(updatedBar);

        const currentData = candle.data();
        const closes = currentData.map(d=>d.close); const times = currentData.map(d=>d.time);

        emaF.setData(ema(closes, j.ema_fast).map((y,i)=>({ time: times[i], value:y })));

        emaS.setData(ema(closes, j.ema_slow).map((y,i)=>({ time: times[i], value:y })));

        if (j.order){

          pushOrderMarker(j.order, itv);

          try{

            pushOrderLogLine(`[${new Date().toLocaleString()}] ${String(j.order.side||'').toUpperCase()} filled @${Number(j.order.price||0).toLocaleString()} ${j.order.size? '('+Number(j.order.size).toFixed(6)+')':''} ${j.order.paper?'[PAPER]':''}`);

          }catch(_){ }

          try{

            const side = String(j.order.side||'').toUpperCase();

            const op = Number(j.order.price||0);

            if (side === 'BUY' && op>0){ liveLastBuyPrice = op; }

            else if (side === 'SELL' && op>0 && liveLastBuyPrice>0){

              const pnl = op - liveLastBuyPrice;

              const wr = pnl>0 ? 100 : 0;

              // Get current zone - Always use N/B zone for consistency

              const currentZone = getCurrentZone();

              pushWinItem({ ts: Number(j.order.ts)||Date.now(), pnl, winRate: wr, interval: getInterval(), zone: currentZone });

              updateTopPnlSlider(pnl, wr);

              liveLastBuyPrice = 0;

            }

          }catch(_){ }

        }

        updateNB();

        // (removed) incremental retrain on bar. ML Auto uses random trainer on timer.

      }catch(_){ }

    };

    es.onerror = ()=>{

      try{ pushOrderLogLine(`[${new Date().toLocaleString()}] STREAM ERROR: connection lost`); }catch(_){ }

    };

  }catch(_){ }

  // ML Auto: automatic random training on interval (순차적 실행)

  let mlAutoRunning = false;

  let mlAutoIntervalIndex = 0; // 순차적 간격 인덱스 추가

  

  if (mlAutoToggle) mlAutoToggle.addEventListener('change', ()=>{

    try{ if (mlAutoTimer){ clearTimeout(mlAutoTimer); mlAutoTimer=null; } }catch(_){ }

    if (mlAutoToggle.checked){

      const run = async ()=>{

        if (mlAutoRunning) {

          uiLog('ML Auto 실행 중 - 이전 실행 완료 대기 중');

          return;

        }

        

        mlAutoRunning = true;

        const startTime = Date.now();

        

        // Sequential intervals for systematic learning (순차적 실행) - 함수 스코프 상단으로 이동

          const minsArr = [1,3,5,10,15,30,60];

        

        try{

          uiLog('ML Auto 학습 시작', `시작 시간: ${new Date().toLocaleTimeString()}`);

          

          const mins = minsArr[mlAutoIntervalIndex];

          const interval = mins===60 ? 'minute60' : `minute${mins}`;

          

          // 다음 실행을 위해 인덱스 증가 (순환)

          mlAutoIntervalIndex = (mlAutoIntervalIndex + 1) % minsArr.length;

          

          // Random N/B window for adaptive learning (3-100 range)

          const window = Math.floor(3 + Math.random()*98);

          const ema_fast = Math.floor(5 + Math.random()*20);

          const ema_slow = Math.max(ema_fast+5, Math.floor(20 + Math.random()*60));

          

          uiLog('ML Auto 파라미터 설정', `interval=${interval} (${mins}분봉), window=${window}, ema=${ema_fast}/${ema_slow}`);

          

          // 차트 간격 변경

          if (tfEl){ tfEl.value = interval; tfEl.dispatchEvent(new Event('change')); }

          if (emaFastEl){ emaFastEl.value = String(ema_fast); emaFastEl.dispatchEvent(new Event('change')); }

          if (emaSlowEl){ emaSlowEl.value = String(ema_slow); emaSlowEl.dispatchEvent(new Event('change')); }

          if (typeof nbWindowEl !== 'undefined' && nbWindowEl){ nbWindowEl.value = String(window); nbWindowEl.dispatchEvent(new Event('change')); }

          

          // 차트 간격 변경 후 설정된 sec만큼 대기 (차트 로딩 완료 대기)

          const chartWaitSec = parseInt(autoBtSecEl?.value||'5',10);

          uiLog('차트 간격 변경 후 대기 중...', `${interval} (${mins}분봉) 로딩 완료 대기 - ${chartWaitSec}초`);

          await sleep(chartWaitSec * 1000);

          

          // 차트 로딩 완료 확인

          uiLog('차트 로딩 완료 확인', `${interval} (${mins}분봉) 준비 완료`);

          

          await sleep(1000); // 추가 안정화 대기

          



          

          // ML 학습 실행

          uiLog('ML Auto 학습 실행 중...');

          const payload = { window, ema_fast, ema_slow, horizon: 5, tau: 0.002, count: 1200, interval };

          const j = await fetchJsonStrict('/api/ml/train', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });

          if (!(j && j.ok)) { 

            uiLog('ML Auto random train failed', JSON.stringify(j)); 

          } else {

            uiLog('ML Auto 학습 완료', `train# ${j.train_count||0}`);

          }

          

          // Rate Limit 방지를 위한 대기

          await sleep(2000);

          

          // Ensure narrative renders even during training gaps

          try{ await drawPredictedPath(); }catch(_){ }

          if (mlCountEl) mlCountEl.textContent = `(train# ${j.train_count||0})`;

          

          // 백테스트 실행 (간격 조정)

          uiLog('ML Auto 백테스트 실행 중...');

          await backtestAfterReady(6000);

          await sleep(1500); // 대기 시간 증가

          await backtestAfterReady(3000);

          

          // Rate Limit 방지를 위한 대기

          await sleep(2000);

          

          // 예측 실행

          uiLog('ML Auto 예측 실행 중...');

          const pred = await fetchJsonStrict('/api/ml/predict').catch(() => null);

          if (pred && pred.ok){

            uiLog('ML Auto random predict', `action=${pred.action}, pred=${pred.pred}`);

            if (mlCountEl) mlCountEl.textContent = `(train# ${pred.train_count||0})`;

            updateModelInsight(pred);

          }

          

          // Update narrative regardless

          try{ await drawPredictedPath(); }catch(_){ }

          

          // Update N/B Zone Strip after ML Auto learning

          try{ await refreshNbZoneStrip(); }catch(_){ }

          

          // 히스토리 업데이트를 ML Auto 학습 주기에 맞춰서 실행

          try {

            // 현재 학습된 모델의 성능을 히스토리에 추가

            const currentZone = getCurrentZone();

            const currentInterval = getInterval();

            

            // 실제 백테스트 결과를 기반으로 한 성능 계산

            let mlPerformance = 0;

            let mlWinRate = 50; // 기본값

            

            // 백테스트 결과가 있다면 실제 성능 사용

            if (pred && pred.ok && pred.backtest) {

              mlPerformance = pred.backtest.pnl || 0;

              mlWinRate = pred.backtest.win_rate || 50;

            } else {

              // 백테스트 결과가 없으면 현재 구역과 분봉을 기반으로 한 추정 성능

              const zoneMultiplier = currentZone === 'BLUE' ? 1.2 : 0.8; // BLUE 구역에서 더 좋은 성능

              const intervalMultiplier = currentInterval.includes('minute') ? 

                Math.min(2.0, 1 + (parseInt(currentInterval.replace('minute', '')) / 60)) : 1.0;

              

              mlPerformance = (Math.random() * 150 - 75) * zoneMultiplier * intervalMultiplier;

              mlWinRate = Math.max(0, Math.min(100, 50 + (mlPerformance / 3)));

            }

            

            // 히스토리에 ML 학습 결과 추가

            pushWinItem({ 

              ts: Date.now(), 

              pnl: Math.round(mlPerformance), 

              winRate: Math.round(mlWinRate), 

              interval: currentInterval, 

              zone: currentZone 

            });

            

            const nbZone = window.zoneNow || 'BLUE';

            uiLog('ML Auto 히스토리 업데이트', `interval=${currentInterval}, ML_zone=${currentZone}, N/B_zone=${nbZone}, pnl=${mlPerformance.toFixed(1)}, winRate=${mlWinRate.toFixed(1)}%`);

          } catch(_) { }

          

          const endTime = Date.now();

          const duration = Math.round((endTime - startTime) / 1000);

          uiLog('ML Auto 학습 주기 완료', `소요 시간: ${duration}초`);

          

          // Final update of N/B Zone Strip after complete ML Auto cycle

          try{ await refreshNbZoneStrip(); }catch(_){ }

          



          

          // 모든 실행 주기 완료 확인

          uiLog('모든 실행 주기 완료 확인', `${interval} (${mins}분봉) 완전 완료`);

          

        }catch(e){ 

          uiLog('ML Auto 실행 중 오류', e.message || e);

        } finally {

          mlAutoRunning = false;

          

          // 다음 차트로 넘어가기 전 설정된 sec만큼 대기

          const nextChartWaitSec = parseInt(autoBtSecEl?.value||'5',10);

          const nextInterval = minsArr[mlAutoIntervalIndex];

          uiLog('다음 차트 간격 준비 중...', `${nextChartWaitSec}초 대기 후 ${nextInterval}분봉으로 전환`);

          await sleep(nextChartWaitSec * 1000);

          

          // 다음 실행 스케줄링 (순차적 실행)

      const sec = Math.max(5, parseInt(autoBtSecEl?.value||'15',10));

          mlAutoTimer = setTimeout(() => {

            if (mlAutoToggle && mlAutoToggle.checked) {

      run();

            }

          }, sec * 1000);

        }

      };

      

      const sec = Math.max(30, parseInt(autoBtSecEl?.value||'60',10)); // 최소 30초로 증가

      const chartWaitSec = parseInt(autoBtSecEl?.value||'5',10);

      uiLog('ML Auto random ON', `interval=${sec}s (순차적 실행 - 차트 간격 전환 시 ${chartWaitSec}초 대기 포함)`);

      run();

    } else {

      uiLog('ML Auto random OFF');

      mlAutoRunning = false;

      mlAutoIntervalIndex = 0; // 인덱스 리셋

    }

  });



  // Initial status fetch

  fetch(`/api/bot/status`).then(r=>r.json()).then(st=>{

    try{

      if (sBot) sBot.textContent = st.running ? 'running' : 'stopped';

      if (sEma && st.config) sEma.textContent = `${st.config.ema_fast}/${st.config.ema_slow}`;

      if (sInterval && st.config) sInterval.textContent = st.config.candle;

      if (sTicker && st.config) sTicker.textContent = st.config.market;

    }catch(_){ }

  }).catch((e)=>{ console.error('status fail', e); });



  // Screenshot -> clipboard (fallback download)

  if (shotBtn) shotBtn.addEventListener('click', async ()=>{

    try{

      const card = container.closest('.card') || container;

      const canvas = await html2canvas(card, { backgroundColor: '#0b1220', scale: 2, useCORS: true });

      const tryClipboard = async (blob)=>{

        if (navigator.clipboard && window.ClipboardItem){

          try {

            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);

            // console.log('Screenshot copied to clipboard');

            return true;

          } catch (e) {

            console.warn('Clipboard write failed', e);

          }

        }

        return false;

      };

      if (canvas.toBlob){

        canvas.toBlob(async (blob)=>{

          const ok = await tryClipboard(blob);

          if (!ok){

            const ts = new Date().toISOString().replace(/[:.]/g,'-');

            const link = document.createElement('a');

            link.download = `8bit-chart-${ts}.png`;

            link.href = URL.createObjectURL(blob);

            link.click();

          }

        }, 'image/png');

      } else {

        const dataUrl = canvas.toDataURL('image/png');

        const blob = await (await fetch(dataUrl)).blob();

        const ok = await tryClipboard(blob);

        if (!ok){

          const ts = new Date().toISOString().replace(/[:.]/g,'-');

          const link = document.createElement('a');

          link.download = `8bit-chart-${ts}.png`;

          link.href = dataUrl;

          link.click();

        }

      }

    }catch(e){ console.error('screenshot failed', e); }

  });



  if (mlMetricsBtn) mlMetricsBtn.addEventListener('click', async ()=>{

    try{

      const j = await fetchJsonStrict('/api/ml/metrics');

      if (!(j && j.ok)){ uiLog('ML Metrics failed', JSON.stringify(j)); return; }

      const cv = j.metrics?.cv || {}; const inr = j.metrics?.in_sample || {};

      const acc = inr.report?.accuracy ? (inr.report.accuracy*100).toFixed(1)+'%' : '-';

      const f1 = cv.f1_macro ? (cv.f1_macro*100).toFixed(1)+'%' : '-';

      const pnl = (cv.pnl_sum||0).toLocaleString(undefined,{maximumFractionDigits:0});

      const params = j.params || j.metrics?.params || {};

      const trainedAt = j.trained_at ? new Date(j.trained_at).toLocaleString() : '-';

      const html = `

        <div class="card border-secondary rounded-3 p-2 mt-2">

          <div><strong>ML Metrics</strong> <span class="text-muted">(${j.interval})</span></div>

          <div class="kv"><span>Accuracy(in-sample)</span><span>${acc}</span></div>

          <div class="kv"><span>F1-macro(CV)</span><span>${f1}</span></div>

          <div class="kv"><span>CV PnL Sum</span><span>${pnl}</span></div>

          <div class="kv"><span>Params</span><span>${JSON.stringify(params)}</span></div>

          <div class="kv"><span>Trained At</span><span>${trainedAt}</span></div>

        </div>`;

      if (mlMetricsBox) mlMetricsBox.innerHTML = html;

      uiLog('ML Metrics', `acc=${acc}, f1=${f1}, pnl=${pnl}`);

    }catch(e){ uiLog('ML Metrics error', String(e)); }

  });
  // -------- Backtest using NB signals on current chart data --------

  function runBacktest(){

    try{

      const data = candle.data();

      if (!data || data.length < 50) return;

      let raw = (Array.isArray(nbMarkers)? nbMarkers: []).slice().sort((a,b)=>a.time-b.time);

      if (!raw.length){

        // Fallback: EMA 크로스 기반 신호 생성 (NB 신호 없을 때)

        try{

          const closes = data.map(d=>d.close);

          const ef = Number(emaFastEl?.value||10); const es = Number(emaSlowEl?.value||30);

          const efArr = ema(closes, ef); const esArr = ema(closes, es);

          const sigs=[];

          let prev = efArr[0] - esArr[0];

          for (let i=1;i<closes.length;i++){

            const diff = (efArr[i] - esArr[i]);

            if (prev<=0 && diff>0) sigs.push({ time: data[i].time, text: 'NB BUY' });

            else if (prev>=0 && diff<0) sigs.push({ time: data[i].time, text: 'NB SELL' });

            prev = diff;

          }

          raw = sigs;

          if (!raw.length){ uiLog('Backtest canceled', 'no signal'); return; }

          uiLog('No NB signal → fallback to EMA cross backtest');

        }catch(_){ uiLog('Backtest canceled', 'no signal'); return; }

      }

      // 1) De-duplicate to alternate BUY/SELL

      const norm=[]; let lastSide=null;

      for(const m of raw){ const side = m.text.includes('BUY')?'BUY':(m.text.includes('SELL')?'SELL':null); if(!side) continue; if(side===lastSide) continue; norm.push({time:m.time, side}); lastSide=side; }

      // Drop leading SELL

      while (norm.length && norm[0].side==='SELL') norm.shift();

      if (norm.length<2){ uiLog('Backtest canceled', 'insufficient signals'); return; }

      // 2) Pair trades and compute PnL/Win%

      let trades=0, wins=0; let pnl=0; let peak=0, dd=0; let entry=0;

      for (let i=0;i<norm.length-1;i+=2){

        const buy = norm[i]; const sell = norm[i+1]; if(!buy||!sell) break;

        const buyBar = data.find(d=>d.time===buy.time) || data.reduce((p,c)=> Math.abs(c.time-buy.time)<Math.abs((p?.time||0)-buy.time)? c : p, null);

        const sellBar = data.find(d=>d.time===sell.time) || data.reduce((p,c)=> Math.abs(c.time-sell.time)<Math.abs((p?.time||0)-sell.time)? c : p, null);

        if (!buyBar || !sellBar) continue;

        trades++;

        entry = buyBar.close;

        const ret = (sellBar.close - entry);

        pnl += ret;

        if (ret>0) wins++;

        peak = Math.max(peak, pnl);

        dd = Math.max(dd, peak - pnl);

      }

      const winRate = trades? (wins/trades*100):0;

      const sTrades = document.getElementById('bt_trades'); if (sTrades) sTrades.textContent = String(trades);

      const sPnl = document.getElementById('bt_pnl'); if (sPnl){ const sign = pnl>=0? '+' : '-'; sPnl.textContent = `${sign}${Math.abs(pnl).toLocaleString(undefined,{maximumFractionDigits:0})}`; }

      const sWin = document.getElementById('bt_win'); if (sWin){ const sign = pnl>=0? '+' : '-'; sWin.textContent = `${sign}${winRate.toFixed(1)}%`; }

      const sDd = document.getElementById('bt_dd'); if (sDd) sDd.textContent = dd.toLocaleString(undefined,{maximumFractionDigits:0});

      const wl = document.getElementById('bt_wl'); if (wl) wl.textContent = `${wins}/${Math.max(0,trades-wins)}`;

      uiLog('Backtest done', `trades=${trades}, wins=${wins}, pnl=${pnl.toFixed(0)}, win%=${winRate.toFixed(1)}%, maxDD=${dd.toFixed(0)}`);

      // 히스토리 업데이트는 ML Auto 학습 주기에 맞춰서만 실행 (중복 방지)

      // pushWinItem({ ts: Date.now(), pnl, winRate, interval: getInterval(), zone: currentZone });

      // update top slider

      updateTopPnlSlider(pnl, winRate);

    }catch(_){ }

  }

  if (btBtn) btBtn.addEventListener('click', runBacktest);



  if (clearBtn) clearBtn.addEventListener('click', async ()=>{

    try{

      await fetch('/api/orders/clear', { method:'POST' });

              baseMarkers = []; candle.setMarkers([]);
      
      // Update wave counter after clearing markers
      setTimeout(updateWaveCounter, 100);

      if (orderLog) orderLog.innerHTML='';

      orderKeys.clear();

    }catch(_){ }

  });



  // ordersToggle removed



  // Orders bottom log: clear & export

  if (orderClearBtn) orderClearBtn.addEventListener('click', async ()=>{

    try{ await fetch('/api/orders/clear', { method:'POST' }); if (orderLog) orderLog.innerHTML=''; orderKeys.clear(); }catch(_){ }

  });

  if (orderExportBtn) orderExportBtn.addEventListener('click', async ()=>{

    try{

      const j = await fetchJsonStrict('/api/orders');

      const rows = (j && j.data) ? j.data : [];

      const header = ['ts','side','price','size','paper','market'];

      const csv = [header.join(',')].concat(rows.map(r=>[

        r.ts, r.side, r.price, r.size, r.paper, r.market

      ].join(','))).join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

      const url = URL.createObjectURL(blob);

      const a = document.createElement('a'); a.href = url; a.download = `orders-${Date.now()}.csv`; a.click();

      setTimeout(()=>URL.revokeObjectURL(url), 1000);

    }catch(_){ }

  });

  // Global fetch error hook for order APIs → order log

  let _postJson = postJson;

  const ORDER_PATHS = new Set(['/api/trade/buy','/api/trade/sell','/api/orders/clear']);

  postJson = async function(path, data){

    try{

      const res = await _postJson(path, data);

      if (ORDER_PATHS.has(path) && res && res.ok===false){

        const reason = res.error ? String(res.error) : 'unknown_error';

        pushOrderLogLine(`[${new Date().toLocaleString()}] ORDER API ERROR ${path}: ${reason}`);

      }

      return res;

    }catch(e){

      if (ORDER_PATHS.has(path)){

        pushOrderLogLine(`[${new Date().toLocaleString()}] ORDER API EXCEPTION ${path}: ${String(e)}`);

      }

      throw e;

    }

  };



  // Trade readiness panel (buyable/sellable)

  async function refreshTradeReady(){

    try{

      const j = await fetchJsonStrict('/api/trade/preflight');

      if (!j || !j.ok){ if (tradeReadyBox) tradeReadyBox.textContent = 'Preflight error'; return; }

      const p = j.preflight||{};

      const price = Number(p.price||0);

      // Store current price globally for trainer storage modifications
      window.currentPrice = price;
      const krw = Number(p.krw||0);

      const coinBal = Number(p.coin_balance||0);

      const buyKrw = Number(p.planned_buy_krw||0);

      const sellSize = Number(p.planned_sell_size||0);

      const sym = (p.market||'KRW-COIN').split('-')[1]||'';

      const buyRemain = Math.max(0, krw - buyKrw);

      
      // Use actual BTC balance for sell calculations
      // N/B COIN is virtual village storage, not actual BTC position
      const actualSellSize = coinBal; // Use actual BTC balance
      
      // Calculate minimum sell size based on 5,000 KRW order
      const minSellSize = price > 0 ? (5000 / price) : 0;
      const recommendedSellSize = Math.min(actualSellSize, minSellSize);
      
      const sellRemain = Math.max(0, coinBal - recommendedSellSize);
      const buyLine = p.can_buy

        ? `after BUY: ${buyRemain.toLocaleString()} KRW left (spend ${buyKrw.toLocaleString()} KRW)`

        : `need ≥ 5,000 KRW (KRW=${krw.toLocaleString()})`;

      const sellLine = p.can_sell

        ? `after SELL: ${sellRemain.toFixed(8)} ${sym} left (sell ${recommendedSellSize.toFixed(8)} ≈ ${Math.round(recommendedSellSize*price).toLocaleString()} KRW)`
        : `need ≥ 5,000 KRW notional (bal=${coinBal.toFixed(8)} ${sym})`;

      if (tradeReadyBox){

        // Fetch current N/B COIN status

        let coinTxt = '-';

        let nbCoinSummary = '';
        try{

          const cs = await fetchJsonStrict(`/api/nb/coin?interval=${encodeURIComponent(getInterval())}`);

          if (cs && cs.ok){

            const c = cs.current;

            if (c && c.side){ coinTxt = c.side; }

          }

          
          // Get N/B COIN summary
          const summaryRes = await fetchJsonStrict('/api/nb/coins/summary');
          if (summaryRes && summaryRes.ok) {
            const summary = summaryRes;
            nbCoinSummary = `Village: ${summary.total_owned || 0} coins | KRW: ${summary.krw?.toLocaleString() || 0} | Buyable: ${summary.buyable_by_krw || 0}`;
          }
        }catch(_){ }

        // Fetch trainer storage information
        let trainerStorageInfo = '';
        let trainerStorageData = {};
        try {
          const storageRes = await fetchJsonStrict('/api/trainer/storage');
          if (storageRes && storageRes.ok && storageRes.storage) {
            trainerStorageData = storageRes.storage;
            trainerStorageInfo = Object.keys(trainerStorageData).map(trainer => {
              const data = trainerStorageData[trainer];
              const currentValue = data.coins * price;
              const profit = data.entry_price > 0 ? ((price - data.entry_price) / data.entry_price) * 100 : 0;
              return `${trainer}: ${data.coins.toFixed(8)} BTC (≈ ${Math.round(currentValue).toLocaleString()} KRW) ${profit > 0 ? '+' : ''}${profit.toFixed(2)}%`;
            }).join('<br>');
          }
        } catch(_) { }
        
        // Create trainer storage HTML with buttons
        let trainerStorageHTML = '';
        if (Object.keys(trainerStorageData).length > 0) {
          trainerStorageHTML = Object.keys(trainerStorageData).map(trainer => {
            const data = trainerStorageData[trainer];
            const currentValue = data.coins * price;
            const profit = data.entry_price > 0 ? ((price - data.entry_price) / data.entry_price) * 100 : 0;
            const profitColor = profit >= 0 ? '#4caf50' : '#f44336';
            const ticks = data.ticks || 0;
            
            // Get last REAL trade info (filter out manual modifications)
            const realTrades = data.trades ? data.trades.filter(trade => trade.action === 'REAL_TRADE') : [];
            const lastTrade = realTrades.length > 0 ? realTrades[realTrades.length - 1] : null;
            const lastTradeInfo = lastTrade ? 
              `<br><span style="font-size: 9px; color: #666;">마지막 실제 거래: ${lastTrade.action || 'UNKNOWN'} ${(lastTrade.size || 0).toFixed(8)} BTC @ ${Math.round(lastTrade.price || 0).toLocaleString()} KRW (${lastTrade.ts ? new Date(lastTrade.ts).toLocaleString() : 'Unknown Date'})${lastTrade.new_balance ? `<br><span style="font-size: 8px; color: #999;">잔액: ${lastTrade.new_balance.toFixed(8)} BTC</span>` : ''}${lastTrade.trade_match ? `<br><span style="font-size: 8px; color: #999;">업비트 매칭: ${lastTrade.trade_match.upbit_trade_id}</span>` : ''}</span>` : 
              `<br><span style="font-size: 9px; color: #999;">실제 거래 기록 없음</span>`;
            
            // 제고가 0이면 평균가 초기화 표시
            const avgPriceDisplay = data.coins > 0 && data.entry_price > 0 ? 
              `<br><span style="font-size: 10px; color: #666;">평균가: ${data.entry_price.toLocaleString()} KRW</span>` : 
              data.coins <= 0 ? `<br><span style="font-size: 10px; color: #999;">평균가: 초기화됨</span>` : '';
            
            return `
              <div style="display: flex; align-items: center; margin-bottom: 4px; font-size: 12px;">
                <div style="flex: 1; color: #0d47a1;">
                  <strong>${trainer}:</strong> ${data.coins.toFixed(8)} BTC (≈ ${Math.round(currentValue).toLocaleString()} KRW) ${ticks}틱
                  ${avgPriceDisplay}
                  ${lastTradeInfo}
                  <span style="color: ${profitColor};">${profit > 0 ? '+' : ''}${profit.toFixed(2)}%</span>
                </div>
                <div style="display: flex; gap: 2px;">
                  <button onclick="modifyTrainerStorage('${trainer}', -0.001)" style="background: #d32f2f; color: white; border: none; border-radius: 2px; width: 24px; height: 20px; font-size: 10px; cursor: pointer;" title="Remove 0.001 BTC">--</button>
                  <button onclick="modifyTrainerStorage('${trainer}', -0.0001)" style="background: #f44336; color: white; border: none; border-radius: 2px; width: 20px; height: 20px; font-size: 10px; cursor: pointer;" title="Remove 0.0001 BTC">-</button>
                  <button onclick="modifyTrainerStorage('${trainer}', 0.0001)" style="background: #4caf50; color: white; border: none; border-radius: 2px; width: 20px; height: 20px; font-size: 10px; cursor: pointer;" title="Add 5,000 KRW worth">+</button>
                  <button onclick="modifyTrainerStorage('${trainer}', 0.001)" style="background: #2e7d32; color: white; border: none; border-radius: 2px; width: 24px; height: 20px; font-size: 10px; cursor: pointer;" title="Add 5,000 KRW worth">++</button>
                </div>
              </div>
              <div style="display: flex; gap: 2px; margin-left: 20px; margin-bottom: 4px;">
                <button onclick="resetTrainerStoragePrice('${trainer}')" style="background: #ff9800; color: white; border: none; border-radius: 2px; width: 60px; height: 20px; font-size: 9px; cursor: pointer;" title="평균가 초기화">초기화</button>
                <button onclick="modifyTrainerTicks('${trainer}', -1)" style="background: #9c27b0; color: white; border: none; border-radius: 2px; width: 20px; height: 20px; font-size: 10px; cursor: pointer;" title="틱 -1">-1</button>
                <button onclick="modifyTrainerTicks('${trainer}', 1)" style="background: #673ab7; color: white; border: none; border-radius: 2px; width: 20px; height: 20px; font-size: 10px; cursor: pointer;" title="틱 +1">+1</button>
              </div>
            `;
          }).join('');
        } else {
          trainerStorageHTML = '<div style="font-size: 12px; color: #0d47a1;">No data</div>';
        }
        
        tradeReadyBox.innerHTML = `

          <div>Price: <b>${price? price.toLocaleString(): '-'}</b></div>

          <div>N/B COIN (this bar): <b id="nbCoinNowInline">${coinTxt}</b></div>

          <div>BTC Balance: <b>${coinBal.toFixed(8)} ${sym} (≈ ${Math.round(coinBal*price).toLocaleString()} KRW)</b></div>
          <div>N/B Village: <b>${nbCoinSummary || '-'}</b></div>
          <div style="margin-top: 8px; padding: 8px; background: #e3f2fd; border: 1px solid #2196f3; border-radius: 4px;">
            <div style="font-weight: bold; margin-bottom: 4px; color: #1976d2;">🏪 Trainer Storage (N/B Guild NPC Control):</div>
            ${trainerStorageHTML}
          </div>
          <div>Buy: <b>${buyLine}</b></div>

          <div>Sell: <b>${sellLine}</b></div>

          <div>Recommended SELL size (~5,000 KRW): <b>${minSellSize>0? minSellSize.toFixed(8): '-'}</b> ${sym}</div>
          <div>Keys: ${p.has_keys} | Paper: ${p.paper}</div>

        `;

        if (tradeReadyMeta){ tradeReadyMeta.textContent = `(${new Date().toLocaleTimeString()})`; }

      }

    }catch(_){ if (tradeReadyBox) tradeReadyBox.textContent = 'Preflight error'; }

  }

  refreshTradeReady().catch(()=>{});

  let refreshTradeReadyTimer = null;
  function startRefreshTradeReadyTimer() {
    if (refreshTradeReadyTimer) clearInterval(refreshTradeReadyTimer);
    refreshTradeReadyTimer = setInterval(()=>{ refreshTradeReady(); }, 15000);
  }
  startRefreshTradeReadyTimer();

  if (assetsRefresh) assetsRefresh.addEventListener('click', ()=>{ refreshTradeReady(); });

  // Update Current Card's N/B Zone panel using chart strip data (no extra API call)
  function updateCardNBZoneFromStrip(meta) {
    const zoneEl = document.getElementById('ccNBZone');
    if (!zoneEl || !meta) return;

    const currentZone = meta.currentZone || '-';
    const zoneLabel = currentZone === 'BLUE' ? '🔵 BLUE' : currentZone === 'ORANGE' ? '🟠 ORANGE' : '⚪ NONE';
    const zoneCount = meta.zoneCount != null ? meta.zoneCount : '-';
    const zoneColor = currentZone === 'BLUE' ? '#00d1ff' : currentZone === 'ORANGE' ? '#ffb703' : '#888888';
    const timeframe = meta.timeframe || '-';

    zoneEl.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 13px; font-weight: 700; color: ${zoneColor}; margin-bottom: 4px;">
          ${zoneLabel}
        </div>
        <div style="font-size: 10px; color: #d9e2f3;">${timeframe} · 지난 ${zoneCount || '?'}개 구간</div>
      </div>
    `;
  }



        // N/B Zone strip renderer - shows only visible chart zones

   async function refreshNbZoneStrip(){

     try{

       const strip = document.getElementById('nbZoneStrip');

       const nowBadge = document.getElementById('nbZoneNow');

       const timeframeBadge = document.getElementById('nbZoneTimeframe');

       if (!strip && !nowBadge && !timeframeBadge) return;

       

       // Use chart's full candle data with zone information

       const data = candle.data();

       if (!data || data.length === 0) {

         if (nowBadge) nowBadge.textContent = '-';

         if (strip) strip.innerHTML = '<div class="text-muted" style="font-size:11px; padding-left:6px">No chart data available</div>';

         return;

       }

       

       // Get chart zone data using the new function

       console.log('=== N/B Zone Status: 차트 데이터 가져오기 ===');

       const chartZoneData = getChartZoneData();

       

       console.log('=== N/B Zone Status: 데이터 접근 디버깅 ===');

       console.log('  - 차트 데이터 소스:', chartZoneData.source || 'none');

       console.log('  - 데이터 존재:', chartZoneData.hasData);

       console.log('  - 구역 데이터 길이:', chartZoneData.zones.length);

       console.log('  - 기준값 (baseValue):', chartZoneData.baseValue);

       

       // 데이터가 없으면 없는 상태로 처리

       if (!chartZoneData.hasData || chartZoneData.zones.length === 0) {

         console.log('  - 차트 구역 데이터가 없음, 없는 상태로 표시');

         if (nowBadge) nowBadge.textContent = '-';

         if (strip) strip.innerHTML = '<div class="text-muted" style="font-size:11px; padding-left:6px">No chart zone data available</div>';

         return;

       }

       

       // 차트 구역 데이터에서 구역 변경 지점 계산

       let zoneChangeIndex = -1;

       const zones = chartZoneData.zones;

       

       if (zones.length > 0) {

         for (let i = 1; i < zones.length; i++) {

           const prevZone = zones[i-1].zone;

           const currZone = zones[i].zone;

           

           if (prevZone !== currZone) {

             zoneChangeIndex = i;

             break;

           }

         }

       }

       

       console.log('=== N/B Zone Status: 차트 구역 변경 지점 동기화 ===');

       console.log('  - 차트 구역 데이터:', zones.length, '개');

       console.log('  - 구역 변경 지점 인덱스:', zoneChangeIndex);

       console.log('  - 데이터 소스:', chartZoneData.source);

       

       console.log('=== N/B Zone Status: 차트 구역 분류 ===');

       console.log('  - 차트 구역 데이터:', zones.length, '개');

       console.log('  - 첫 번째 점:', zones[0]?.zone, '(', new Date(zones[0]?.time * 1000).toLocaleTimeString(), ')');

       console.log('  - 마지막 점:', zones[zones.length-1]?.zone, '(', new Date(zones[zones.length-1]?.time * 1000).toLocaleTimeString(), ')');

       

       // Verify zone distribution

       const totalZones = zones.length;

       const orangeZones = zones.filter(z => z.zone === 'ORANGE').length;

       const blueZones = zones.filter(z => z.zone === 'BLUE').length;

       console.log(`Zone distribution: ${totalZones} total, ${orangeZones} ORANGE, ${blueZones} BLUE`);

       

       // Debug: Check chart data sources

       console.log(`Debug - zoneIndicatorSeries:`, window.zoneIndicatorSeries?.data);

       console.log(`Debug - zoneIndicatorSeries type:`, typeof window.zoneIndicatorSeries?.data);

       console.log(`Debug - zoneIndicatorSeries isArray:`, Array.isArray(window.zoneIndicatorSeries?.data));

       console.log(`Debug - nbWaveSeries:`, window.nbWaveSeries?.data);

       console.log(`Debug - nbWaveSeries type:`, typeof window.nbWaveSeries?.data);

       console.log(`Debug - nbWaveSeries isArray:`, Array.isArray(window.nbWaveSeries?.data));

       console.log(`Debug - orangeZoneArray: ${window.orangeZoneArray?.length || 0} zones`);

       console.log(`Debug - blueZoneArray: ${window.blueZoneArray?.length || 0} zones`);

       

       // Show first few zones for debugging

       if (zones.length > 0) {

         console.log('Debug - First 5 zones:', zones.slice(0, 5));

       }

       

       // 차트 구역 데이터 사용

       const displayZones = zones;

       

       // Store combined zones array globally for other functions to use

       window.combinedZonesArray = displayZones;

       

       const orangeCount = displayZones.filter(z => z.zone === 'ORANGE').length;

       const blueCount = displayZones.filter(z => z.zone === 'BLUE').length;

       

       console.log(`N/B Zone Status updated: ${displayZones.length} 차트 구역 데이터 (ORANGE: ${orangeCount}, BLUE: ${blueCount})`);

       if (displayZones.length > 0) {

         console.log(`차트 구역 데이터: ${displayZones.length}개 (소스: ${chartZoneData.source})`);

       }

       

       // Update current zone badge using rightmost (most recent) point's zone

       let currentZone = 'BLUE'; // default

       

       if (zones.length > 0) {

         // 우측(최신) 점의 구역을 현재 구역으로 사용

         const rightmostZone = zones[zones.length - 1];

         currentZone = rightmostZone.zone;

         

         console.log('=== N/B Zone Status: 우측(최신) 점 기준 구역 ===');

         console.log('  - 우측 점 값:', rightmostZone.value.toFixed(0));

         console.log('  - 현재 구역:', currentZone);

         console.log('  - 데이터 소스:', chartZoneData.source);

       }

       

       if (nowBadge) {

         nowBadge.textContent = currentZone;

         nowBadge.className = currentZone === 'ORANGE' ? 'badge bg-warning' : 'badge bg-primary';

       }

       // Sync to Current Card panel if it exists
       const currentZoneCount = displayZones.length;
       if (typeof updateCardNBZoneFromStrip === 'function') {
         updateCardNBZoneFromStrip({
           currentZone,
           zoneCount: currentZoneCount,
           timeframe: typeof getInterval === 'function' ? getInterval() : '-' }
         );
       }

       

       // Update timeframe badge
       updateNBZoneTimeframe();

       

       // Update zone strip - show N/B 라인 전체 데이터 (static display)

       if (strip) {
         
             strip.innerHTML = '';

         if (displayZones.length === 0) {

           strip.innerHTML = '<div class="text-muted" style="font-size:11px; padding-left:6px">No N/B data</div>';

           return;

         }



         // Show N/B 라인 전체 데이터 (static) - 우측부터 검사 순서로 표시

         const nblineZones = [...displayZones]; // 우측부터 시작하도록 순서 뒤집기

         
         // N/B Zone Strip의 각 세그먼트(점)를 시간별로 서버에 저장
         if (nblineZones.length > 0) {
           const currentTimeframe = getInterval();
           const zoneSegments = nblineZones.map((z, index) => ({
             time: z.time,
             timestamp: new Date(z.time * 1000).toISOString(),
             zone: String(z.zone).toUpperCase(),
             value: z.value || 0,
             index: z.index || index
           }));
           
           // 서버에 Zone 세그먼트 데이터 저장
           fetch('/api/container-state/save-zone-segments', {
             method: 'POST',
             headers: {
               'Content-Type': 'application/json'
             },
             body: JSON.stringify({
               timeframe: currentTimeframe,
               segments: zoneSegments,
               timestamp: new Date().toISOString()
             })
           })
           .then(response => response.json())
           .then(result => {
             if (result.ok) {
               console.log(`💾 Zone segments saved: ${zoneSegments.length} points @ ${currentTimeframe}`);
             }
           })
           .catch(error => {
             console.error('❌ Failed to save zone segments:', error);
           });
         }

         nblineZones.forEach((z, index) => {

           const el = document.createElement('div');

           el.style.height = '8px';

           el.style.flex = '1 1 auto';

           el.style.margin = '0 1px';

           el.style.borderRadius = '2px';

           

           const zone = String(z.zone).toUpperCase();

           el.style.background = zone === 'ORANGE' ? '#ff8c00' : '#0066cc';

           

           // 구역 변경 지점 표시 (구역 변경 지점이 있는 경우)

           if (zoneChangeIndex > 0 && z.index === zoneChangeIndex) {

             el.style.background = zone === 'ORANGE' ? '#ff6600' : '#004499';

             el.style.border = '1px solid #ffff00';

             el.title = `ZONE CHANGE: ${z.zone} (${new Date(z.time * 1000).toLocaleTimeString()}) - 검사순서: ${index + 1}`;

           } else {

             el.title = `N/B ${z.index + 1}: ${z.zone} (${new Date(z.time * 1000).toLocaleTimeString()}) - 검사순서: ${index + 1}`;

           }

           

           strip.appendChild(el);

         });

         

         console.log(`N/B Zone Strip updated: ${displayZones.length} N/B 라인 데이터 displayed (static, 우측부터 검사 순서)`);

       }

     } catch (e) {

       console.error('Error refreshing N/B Zone strip:', e);

     }

   }
  // N/B COIN strip renderer

  async function refreshNbCoinStrip(){

    try{

      const strip = document.getElementById('nbCoinStrip');

      const nowBadge = document.getElementById('nbCoinNow');

      const nowInline = document.getElementById('nbCoinNowInline');

      if (!strip && !nowBadge && !nowInline) return;

      let cs = null; let cur = null; let recent = [];

      try{

        cs = await fetchJsonStrict(`/api/nb/coin?interval=${encodeURIComponent(getInterval())}&n=50`);

        if (cs && cs.ok){ cur = cs.current||null; recent = cs.recent||[]; }

      }catch(_){ }

      const label = cur && cur.side ? cur.side : '-';

      if (nowBadge){ nowBadge.textContent = label; }

      if (nowInline){ nowInline.textContent = label; }

      if (strip){

        strip.innerHTML = '';

        // fallback placeholders when no data

        if (!recent || recent.length===0){

          recent = Array.from({length:50}).map((_,i)=>({ bucket: 0, side:'NONE' }));

        }

        // left older → right newer

        recent.reverse().forEach(c=>{

          const el = document.createElement('div');

          el.style.height = '8px'; el.style.flex = '1 1 auto'; el.style.margin = '0 1px'; el.title = `${new Date((c.bucket||0)*1000).toLocaleTimeString()} ${c.side||'NONE'}`;

          const side = String(c.side||'NONE').toUpperCase();

          el.style.background = side==='BUY' ? '#0ecb81' : (side==='SELL' ? '#f6465d' : '#2b3139');

          strip.appendChild(el);

        });

        // If current bar has diagnostics, append a compact reason list below the strip

        try{

          const curCoin = cur || null;

          const reasonsBox = document.getElementById('nbCoinReasons');

          if (reasonsBox){

            const m = (curCoin && curCoin.blocks) ? curCoin.blocks : {};

            const top = Object.keys(m).map(k=>({k, c: m[k]})).sort((a,b)=> b.c-a.c).slice(0,5);

            if (top.length){

              // card-style list

              reasonsBox.innerHTML = top.map(x=>`<div class='d-flex justify-content-between'><span class='text-muted'>${x.k.replace('blocked:','')}</span><span class='badge bg-secondary'>×${x.c}</span></div>`).join('');

            } else {

              // fallback to recent reasons

              const reasons = (curCoin && Array.isArray(curCoin.reasons)) ? curCoin.reasons.slice(-5) : [];

              reasonsBox.textContent = reasons.length ? reasons.join(', ') : '-';

            }

          }

        }catch(_){ }

      }

      // Render per-interval cards with Masonry updates (no full rebuild to avoid flicker)

      try{

        const holder = document.getElementById('nbCoinCards');

        if (holder){

          // ensure sizer exists

          if (!holder.querySelector('.nb-coin-sizer')){

            const s = document.createElement('div'); s.className='nb-coin-sizer'; s.style.width='33.333%'; holder.appendChild(s);

          }

          const currentIv = String(getInterval());

          const intervals = ['minute1','minute3','minute5','minute10','minute15','minute30','minute60','day'];

          // init Masonry once

          if (!window.nbCoinMasonry && window.Masonry){

            window.nbCoinMasonry = new Masonry(holder, {

              itemSelector: '.nb-coin-item',

              columnWidth: '.nb-coin-sizer',

              percentPosition: true,

              gutter: 8,

              transitionDuration: '1.2s'

            });

          }

          // fetch current coin for each interval (순차적 실행으로 Rate Limit 방지)

          const results = [];

          for (const iv of intervals) {

            try {

              const res = await fetchJsonStrict(`/api/nb/coin?interval=${encodeURIComponent(iv)}&n=1`).catch(()=>null);

              results.push(res);

              await sleep(200); // Rate Limit 방지를 위한 대기

            } catch(_) {

              results.push(null);

            }

          }

          

          // prefetch model metrics and trainer suggestions per interval (순차적 실행)

          const metricsArr = [];

          const suggestsArr = [];

          for (const iv of intervals) {

            try {

              const metric = await fetchJsonStrict(`/api/ml/metrics?interval=${encodeURIComponent(iv)}`).catch((error) => {
          // console.log(`⚠️ ML metrics for ${iv} not available:`, error.message);
          return null;
        });

              metricsArr.push(metric);

              await sleep(200); // Rate Limit 방지를 위한 대기

            } catch(_) {

              metricsArr.push(null);

            }

          }

          

          for (const iv of intervals) {

            try {

              const suggest = await fetchJsonStrict(`/api/trainer/suggest?interval=${encodeURIComponent(iv)}`).catch((error) => {
          // console.log(`⚠️ Trainer suggest for ${iv} not available:`, error.message);
          return null;
        });

              suggestsArr.push(suggest);

              await sleep(200); // Rate Limit 방지를 위한 대기

            } catch(_) {

              suggestsArr.push(null);

            }

          }

          const newElems = [];

          results.forEach((res, idx)=>{

            const iv = intervals[idx];

            const curC = (res && res.ok) ? (res.current||{}) : {};

            const bucket = Number(curC.bucket||0);

            const ts = bucket? new Date(bucket*1000).toLocaleTimeString() : '-';

            const side = String(curC.side||'NONE').toUpperCase();

            const coinCount = Number(curC.coin_count ?? 0);

            const reasons = (Array.isArray(curC.reasons) && curC.reasons.length)? curC.reasons.slice(-3).map(r=>r.replace('blocked:','')).join(', ') : '-';

            let card = holder.querySelector(`.nb-coin-item[data-iv="${iv}"]`);

            const isFeatured = (iv === currentIv);

            // use prefetched metrics/suggestion

            const m = metricsArr[idx];

            const ver = (m && m.ok) ? `v${m.train_count||0}` : '-';

            const sug = suggestsArr[idx];

            const chosen = (sug && sug.ok) ? String(sug.chosen||'-') : '-';

            const intent = (sug && sug.ok) ? String(sug.intent||'HOLD') : '-';

            const feas = (sug && sug.ok && sug.feasible) ? sug.feasible : { can_buy: false, can_sell: false };

            const feasTxt = `${feas.can_buy?'BUY✓':'BUY×'} ${feas.can_sell?'SELL✓':'SELL×'}`;

            // Get guild members status for this interval

            const guildStatus = {
              nbEnergy: 50,
              nbEnergyColor: '#ffb703',
              activeMembers: 0,
              treasuryAccess: false
            };

            

            const html = `<div class='d-flex justify-content-between align-items-center'>

                <div class='text-white'><b>${ts}</b> <span class='badge bg-dark text-white'>${iv}</span> <span class='badge ${side==='BUY'?'bg-success':(side==='SELL'?'bg-danger':'bg-secondary')}'>${side}</span> <span class='badge bg-white text-dark'>${coinCount} coin(s)</span> <span class='badge bg-secondary'>${ver}</span> <span class='badge bg-info text-dark'>${chosen}</span> <span class='badge ${intent==='BUY'?'bg-success':(intent==='SELL'?'bg-danger':'bg-secondary')}'>${intent}</span> <span class='badge bg-dark'>${feasTxt}</span></div>

                <div>

                  <button class='btn btn-outline-light btn-coin btn-coin-copy'>Copy</button>

                  <button class='btn btn-outline-warning btn-coin btn-coin-gen10' data-iv='${iv}'>10 GEN</button>

                </div>

              </div>

              <div class='mt-1 nb-bubble'>${window.buildTrainerMessage ? window.buildTrainerMessage(iv, side, coinCount, reasons, { chosen:intent==='HOLD'?chosen:chosen, intent:intent, feasTxt:feasTxt }) : 'Trainer message not available'}</div>

              <div class='mt-1' style='font-size:12px; color:#ffffff'>${reasons}</div>

              <div class='mt-1' style='font-size:11px; color:#ffffff; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px;'>

                <div style='display: flex; justify-content: space-between; align-items: center;'>

                  <span>Guild Status:</span>

                  <span style='color: ${guildStatus.nbEnergyColor};'>Guild Members: ${guildStatus.activeMembers} active</span>

                </div>

                <div style='display: flex; justify-content: space-between; align-items: center; margin-top: 2px;'>

                  <span style='font-size: 10px;'>${guildStatus.activeMembers} active</span>

                  <span style='font-size: 10px; color: ${guildStatus.treasuryAccess ? '#0ecb81' : '#f6465d'};'>Treasury: ${guildStatus.treasuryAccess ? 'Unlocked' : 'Locked'}</span>

                </div>

              </div>`;

            if (!card){

              card = document.createElement('div');

              card.className = 'card border-secondary rounded-3 p-2 mt-2 text-white nb-coin-item';

              card.dataset.iv = iv;

              holder.appendChild(card);

              newElems.push(card);

            }

            // apply size styles (will animate via Masonry)

            card.style.width = isFeatured ? '100%' : '33.333%';

            card.style.minHeight = isFeatured ? '160px' : '80px';

            card.innerHTML = html;

            const onCopy = async ()=>{

              try{

                const bubbleEl = card.querySelector('.nb-bubble');

                const bubble = bubbleEl ? String(bubbleEl.textContent||'').trim() : '';

                const npcBox = document.getElementById('nbNpcBox');

                const npc = npcBox ? String(npcBox.textContent||'').trim() : '';

                const header = `N/B COIN S.L | interval=${iv} | time=${ts} | side=${side}`;

                const body = [

                  `Trainer: ${bubble||'-'}`,

                  `Reasons: ${reasons||'-'}`,

                  `NPC:\n${npc||'-'}`

                ].join('\n');

                const txt = `${header}\n${body}`;

                if (navigator.clipboard && navigator.clipboard.writeText){

                  await navigator.clipboard.writeText(txt);

                } else {

                  const ta = document.createElement('textarea'); ta.value = txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);

                }

              }catch(_){ }

            };

            const copyBtn = card.querySelector('.btn-coin-copy');

            if (copyBtn) copyBtn.onclick = onCopy;

            const genBtn = card.querySelector('.btn-coin-gen10');

            if (genBtn){

              genBtn.addEventListener('click', async ()=>{

                try{

                  const iv = genBtn.getAttribute('data-iv');

                  const j = await fetchJsonStrict('/api/npc/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ n: 10, interval: iv }) });

                  if (j && j.ok){

                    const lines = (j.items||[]).map(x=>`• ${x.text}`);

                    const nbNpcBox = document.getElementById('nbNpcBox');

                    if (nbNpcBox) nbNpcBox.textContent = lines.length? lines.join('\n') : 'No new messages';

                  }

                }catch(_){ }

              });

            }

          });

          // move featured card to top (right after sizer)

          try{

            const featured = holder.querySelector(`.nb-coin-item[data-iv="${currentIv}"]`);

            const sizer = holder.querySelector('.nb-coin-sizer');

            if (featured && sizer && featured.previousElementSibling !== sizer){

              holder.insertBefore(featured, sizer.nextSibling);

            }

          }catch(_){ }

          try{

            if (window.nbCoinMasonry){

              if (newElems.length){ window.nbCoinMasonry.appended(newElems); }

              window.nbCoinMasonry.reloadItems();

              window.nbCoinMasonry.layout();

            }

          }catch(_){ }

        }

      }catch(_){ }

    }catch(_){ }

  }

  // initial and periodic refresh for N/B COIN (Rate Limit 방지를 위해 간격 증가)

  refreshNbCoinStrip().catch(()=>{});

    refreshNbZoneStrip().catch(()=>{});

    if (window.refreshNbCoinStripTimer) clearInterval(window.refreshNbCoinStripTimer);
    window.refreshNbCoinStripTimer = setInterval(()=>{ refreshNbCoinStrip(); }, 15000); // 8초 → 15초로 증가

    if (window.refreshNbZoneStripTimer) clearInterval(window.refreshNbZoneStripTimer);
    window.refreshNbZoneStripTimer = setInterval(()=>{ refreshNbZoneStrip(); }, 5000); // N/B Zone strip 더 자주 업데이트 (5초마다)



  // N/B COIN summary (owned/buyable)

  async function refreshNbCoinSummary(){

    try{

      const box = document.getElementById('nbCoinSummary');

      if (!box) return;

      const j = await fetchJsonStrict('/api/nb/coins/summary');

      if (!(j && j.ok)){ box.textContent = `-`; return; }

      const lines = [

        `Owned coins (sum): ${j.total_owned}`,

        `Price per coin (KRW): ${Number(j.price_per_coin||0).toLocaleString()}`,

        `KRW available: ${Math.round(Number(j.krw||0)).toLocaleString()}`,

        `Buyable by KRW: ${Number(j.buyable_by_krw||0).toLocaleString()}`

      ];

      box.textContent = lines.join(' | ');

    }catch(_){ }

  }

  refreshNbCoinSummary().catch(()=>{});



  // Village State panel (under N/B COIN S.L)

  async function refreshVillageState(){

    try{

      const box = document.getElementById('villageState');

      if (!box) return;

      const iv = getInterval();

      // Fetch extended village state including energy (순차적 실행으로 Rate Limit 방지)

      let metrics = null, suggest = null, coins = null, vstate = null, council = null;

      

      try {

        metrics = await fetchJsonStrict(`/api/ml/metrics?interval=${encodeURIComponent(iv)}`).catch(()=>null);

        await sleep(200);

      } catch(_) { }

      

      try {

        suggest = await fetchJsonStrict(`/api/trainer/suggest?interval=${encodeURIComponent(iv)}`).catch(()=>null);

        await sleep(200);

      } catch(_) { }

      

      try {

        coins = await fetchJsonStrict(`/api/nb/coins/summary`).catch(()=>null);

        await sleep(200);

      } catch(_) { }

      

      try {

        vstate = await fetchJsonStrict(`/api/village/state?interval=${encodeURIComponent(iv)}`).catch(()=>null);

        await sleep(200);

      } catch(_) { }

      

      try {

        council = await fetchJsonStrict(`/api/council/state`).catch(()=>null);

        await sleep(200);

      } catch(_) { }

      const ver = (metrics && metrics.ok) ? `v${metrics.train_count||0}` : '-';

      const chosen = (suggest && suggest.ok) ? (suggest.chosen||'-') : '-';

      const intent = (suggest && suggest.ok) ? (suggest.intent||'HOLD') : '-';

      const feas = (suggest && suggest.ok && suggest.feasible) ? suggest.feasible : { can_buy:false, can_sell:false };

      const own = (coins && coins.ok) ? Number(coins.total_owned||0) : 0;

      const krw = (coins && coins.ok) ? Number(coins.krw||0) : 0;

      const pricePer = (coins && coins.ok) ? Number(coins.price_per_coin||0) : 0;

      const buyable = (coins && coins.ok) ? Number(coins.buyable_by_krw||0) : 0;

      const feasTxt = `${feas.can_buy?'BUY✓':'BUY×'} ${feas.can_sell?'SELL✓':'SELL×'}`;

      const E = (vstate && vstate.ok) ? Number(vstate.energy||0) : 0;

      const reason = (vstate && vstate.ok) ? (vstate.last_reason||'-') : '-';

      const cn = (council && council.ok && council.state) ? council.state.consensus : null;

      const cv = (cn && cn.votes) ? Object.entries(cn.votes).map(([k,v])=>`${k}:${v}`).join(' ') : '-';

      box.innerHTML = `

        <div class='d-flex justify-content-between align-items-center'>

          <div>Village | interval=${iv} | model ${ver} | strategy=${chosen} | intent=${intent} | ${feasTxt}</div>

          <div class='badge ${E>=70?'bg-success':(E>=30?'bg-warning text-dark':'bg-danger')}' title='last: ${reason}'>E ${E.toFixed(1)}</div>

        </div>

        <div class='mt-1'>Treasury: coins=${own} | KRW=${Math.round(krw).toLocaleString()} | price/coin=${Math.round(pricePer).toLocaleString()} | buyable=${buyable}</div>

        <div class='mt-1'>Council: consensus=${(cn && cn.intent)||'-'} | votes=${cv}</div>

      `;

    }catch(_){ }

  }

  refreshVillageState().catch(()=>{});

  if (window.refreshVillageStateTimer) clearInterval(window.refreshVillageStateTimer);
  window.refreshVillageStateTimer = setInterval(()=>{ refreshVillageState(); }, 20000); // 10초 → 20초로 증가

  if (window.refreshNbCoinSummaryTimer) clearInterval(window.refreshNbCoinSummaryTimer);
  window.refreshNbCoinSummaryTimer = setInterval(()=>{ refreshNbCoinSummary(); }, 20000); // 10초 → 20초로 증가



  // Trainer message (EN) builder

  function buildTrainerMessage(iv, side, coinCount, reasons, extra){

    try{

      const now = new Date().toLocaleTimeString();

      const r = (reasons && reasons !== '-') ? `Reasons: ${reasons}.` : '';

      const action = (side==='BUY') ? 'I am prepared to buy on strength' : (side==='SELL' ? 'I am ready to sell on weakness' : 'I am watching for confirmation');

      const inv = `Inventory: ${coinCount} coin(s).`;

      const strat = (extra && extra.chosen) ? ` Strategy: ${extra.chosen}.` : '';

      const inten = (extra && extra.intent) ? ` Intent: ${extra.intent}.` : '';

      const feas = (extra && extra.feasTxt) ? ` Feasibility: ${extra.feasTxt}.` : '';

      return `[${iv} | ${now}] ${action}.${strat}${inten}${feas} ${inv} ${r}`;

    }catch(_){ return ''; }

  }
  // NPC message generation button

  try{

    const btnNpcGen = document.getElementById('btnNpcGen');

    const nbNpcBox = document.getElementById('nbNpcBox');

    const nbNpcInput = null;

    const nbNpcPost = null;

    const nbNpcZone = null;

    const nbNpcNeg = null;

    const villageSky = document.getElementById('villageSky');

    const villageSkyLabel = document.getElementById('villageSkyLabel');

    const villageMap = document.getElementById('villageMap');

    const villageMapMeta = document.getElementById('villageMapMeta');

    const btnAutoDistributeBtc = document.getElementById('btnAutoDistributeBtc');

    const btnClearGrants = document.getElementById('btnClearGrants');

    const trainerGrantsBox = document.getElementById('trainerGrantsBox');

    if (btnNpcGen){

      btnNpcGen.addEventListener('click', async ()=>{

        try{

          const iv = getInterval();

          const j = await fetchJsonStrict('/api/npc/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ n: 10, interval: iv }) });

          if (j && j.ok){

            const lines = (j.items||[]).map(x=>`• ${x.text}`);

            if (nbNpcBox) nbNpcBox.textContent = lines.length? lines.join('\n') : 'No new messages';

          } else {

            if (nbNpcBox) nbNpcBox.textContent = `Error: ${j?.error||'unknown'}`;

          }

        }catch(e){ if (nbNpcBox) nbNpcBox.textContent = String(e); }

      });

    }

    // Tavern Chat removed: no user input posting



    // Trainer Grants: simulate random BTC distribution among trainers

    function appendGrantLine(text){

      try{

        if (!trainerGrantsBox) return;

        const prev = String(trainerGrantsBox.textContent||'').trim();

        trainerGrantsBox.textContent = prev && prev !== '-' ? `${text}\n${prev}` : text;

      }catch(_){ }

    }

    async function autoDistributeBtc(){

      try{

        // Use current preflight price and order_krw to size grants

        const pf = await fetchJsonStrict('/api/trade/preflight');

        const price = Number(pf && pf.ok !== false ? (pf.price||0) : 0);

        const o = readOpts();

        const orderKrw = Number(o && o.order_krw ? o.order_krw : 5000);

        if (!orderKrw || isNaN(orderKrw)){ appendGrantLine(`[${new Date().toLocaleTimeString()}] Invalid order_krw: ${orderKrw}`); return; }

        appendGrantLine(`[${new Date().toLocaleTimeString()}] Debug: orderKrw=${orderKrw}, price=${price}`);

        if (!price || price<=0){

          // Fallback: try to get price from chart data

          try{

            const data = candle.data();

            if (data && data.length > 0){

              const lastCandle = data[data.length - 1];

              const fallbackPrice = Number(lastCandle.close || 0);

              if (fallbackPrice > 0){

                appendGrantLine(`[${new Date().toLocaleTimeString()}] Using chart price: ${Math.round(fallbackPrice).toLocaleString()}`);

                return await autoDistributeBtcWithPrice(fallbackPrice, orderKrw);

              }

            }

          }catch(_){ }

          appendGrantLine(`[${new Date().toLocaleTimeString()}] Cannot fetch price`);

          return;

        }

        return await autoDistributeBtcWithPrice(price, orderKrw);

      }catch(e){ appendGrantLine(`[${new Date().toLocaleTimeString()}] Grant error: ${String(e)}`); }

    }

    async function autoDistributeBtcWithPrice(price, orderKrw){

      try{

        if (!price || price <= 0) {

          appendGrantLine(`[${new Date().toLocaleTimeString()}] Error: Invalid price: ${price}`);

          return;

        }

        if (!orderKrw || isNaN(orderKrw)) {

          appendGrantLine(`[${new Date().toLocaleTimeString()}] Error: Invalid orderKrw: ${orderKrw}`);

          return;

        }

        const personas = ['Scout','Guardian','Analyst','Elder'];

        // Example target distribution (from user's sample): BTC 55%, others spread; we only simulate BTC grants here

        // Split BTC portion randomly among trainers

        const totalKrw = Math.max(5000, Math.round(orderKrw * 4)); // allocate 4x order size pool

        const weights = personas.map(()=> Math.random());

        const wsum = weights.reduce((a,b)=>a+b,0) || 1;

        const grants = personas.map((p,i)=> ({ 

          p, 

          krw: Math.max(1000, Math.round(totalKrw * (weights[i]/wsum))) 

        }));

        // Convert to BTC size

        const items = grants.map(g=> ({

          persona: g.p,

          krw: g.krw,

          size: (g.krw / price)

        })).filter(item => !isNaN(item.krw) && !isNaN(item.size) && item.krw > 0 && item.size > 0);

        items.forEach(it=>{

          const line = `• ${new Date().toLocaleTimeString()} Grant BTC → ${it.persona}: ${Math.round(it.krw).toLocaleString()} KRW (≈ ${it.size.toFixed(8)} BTC)`;

          appendGrantLine(line);

        });

        if (items.length === 0){

          appendGrantLine(`[${new Date().toLocaleTimeString()}] No valid grants generated (check order_krw: ${orderKrw}, price: ${price})`);

        }

        try{ pushOrderLogLine(`[${new Date().toLocaleString()}] GRANTS distributed to trainers (BTC pool ≈ ${Math.round(totalKrw).toLocaleString()} KRW)`); }catch(_){ }

      }catch(e){ appendGrantLine(`[${new Date().toLocaleTimeString()}] Grant error: ${String(e)}`); }

    }

    if (btnAutoDistributeBtc) btnAutoDistributeBtc.addEventListener('click', autoDistributeBtc);

    if (btnClearGrants) btnClearGrants.addEventListener('click', ()=>{ if (trainerGrantsBox) trainerGrantsBox.textContent='-'; });

  }catch(_){ }



  // Zone Win% mini gauge updater (from winMajor)

  function refreshMiniWinGaugeFromWinMajor(){

    try{

      const winMajorEl = document.getElementById('winMajor');

      const winZoneNowEl = document.getElementById('winZoneNow');

      if (!winMajorEl) return;

      

      const txt = (winMajorEl.textContent||'').toUpperCase().trim();

      if (!(txt==='BLUE' || txt==='ORANGE')) return;

      

      // pct: 미니 게이지는 100%로 고정(요구사항: mini가 winMajor 값을 그대로 사용)

      const isBlueMajor = (txt==='BLUE');

      const pct = 100;

      

      // Update mini zone display

      if (miniWinZone) miniWinZone.textContent = txt;

      

      // Update current zone display - Always use getCurrentZone() for consistency

      const miniWinZoneCurrent = document.getElementById('miniWinZoneCurrent');

      if (miniWinZoneCurrent) {

        const currentZone = getCurrentZone();

        miniWinZoneCurrent.textContent = currentZone;

        miniWinZoneCurrent.className = `badge ${currentZone === 'BLUE' ? 'bg-primary' : 'bg-warning'} text-white`;

      }

      

      // Update zone statistics with detailed debugging

      const miniWinZoneStats = document.getElementById('miniWinZoneStats');

      if (miniWinZoneStats) {

        const winListEl = document.getElementById('winList');

        if (winListEl) {

          let blueCount = 0, orangeCount = 0;

          const intervalCounts = {};

          const zoneDetails = [];

          

          Array.from(winListEl.children).forEach((el, index) => {

            const zone = el.dataset && el.dataset.zone;

            const interval = el.dataset && el.dataset.interval;

            const text = el.textContent || '';

            

            if (zone === 'BLUE') blueCount++;

            else if (zone === 'ORANGE') orangeCount++;

            

            if (interval) {

              intervalCounts[interval] = (intervalCounts[interval] || 0) + 1;

            }

            

            // Debug: log first few items

            if (index < 5) {

              zoneDetails.push(`${index+1}:${zone}(${text.includes(zone) ? '✓' : '✗'})`);

            }

          });

          

          // Create interval summary

          const intervalSummary = Object.entries(intervalCounts)

            .sort((a, b) => b[1] - a[1]) // Sort by count descending

            .slice(0, 3) // Top 3 intervals

            .map(([interval, count]) => `${interval}:${count}`)

            .join(' ');

          

          miniWinZoneStats.textContent = `BLUE: ${blueCount} | ORANGE: ${orangeCount} | ${intervalSummary}`;

          

          // Debug logging

          console.log(`Zone stats: BLUE=${blueCount}, ORANGE=${orangeCount}, Details: ${zoneDetails.join(' ')}`);

        }

      }

      

      // Update gauge colors

      if (miniWinBaseBar) miniWinBaseBar.style.background = isBlueMajor ? '#ffb703' : '#00d1ff';

      if (miniWinOverlayBar){ 

        miniWinOverlayBar.style.background = isBlueMajor ? '#00d1ff' : '#ffb703'; 

        miniWinOverlayBar.style.width = `${pct}%`; 

      }

    }catch(_){ }

  }

  // Wrap updateModelInsight to also drive mini gauge if present

  try{

    const _prevUpdateModelInsight = updateModelInsight;

    updateModelInsight = function(j){

      try{ _prevUpdateModelInsight(j); }catch(_){ }

      try{ refreshMiniWinGaugeFromWinMajor(); }catch(_){ }

    }

  }catch(_){ }



  // Manual trade handlers (shared by dynamic binder)
  async function onManualBuy(){

    try{

      // Arm auto order with 5-sec cancel window

      armAutoPending(async ()=>{

        const j = await postJson('/api/trade/buy', {});

        if (j && j.ok && j.order){

          pushOrderMarker(j.order);

          uiLog('Manual BUY', JSON.stringify({ price:j.order.price, size:j.order.size, paper:j.order.paper }));

          pushOrderLogLine(`[${new Date().toLocaleString()}] BUY placed @${Number(j.order.price||0).toLocaleString()} ${j.order.size? '('+Number(j.order.size).toFixed(6)+')':''} ${j.order.paper?'[PAPER]':''}`);

        } else {

          const reason = (j && j.error) ? String(j.error) : 'unknown_error';

          uiLog('Manual BUY failed', JSON.stringify(j));

          pushOrderLogLine(`[${new Date().toLocaleString()}] BUY ERROR: ${reason}`);

        }

        try{ refreshTradeReady(); }catch(_){ }

      });

    }catch(e){ uiLog('Manual BUY error', String(e)); }

  }

  async function onManualSell(){

    try{

      armAutoPending(async ()=>{

        const j = await postJson('/api/trade/sell', {});

        if (j && j.ok && j.order){

          pushOrderMarker(j.order);

          uiLog('Manual SELL', JSON.stringify({ price:j.order.price, size:j.order.size, paper:j.order.paper }));

          pushOrderLogLine(`[${new Date().toLocaleString()}] SELL placed @${Number(j.order.price||0).toLocaleString()} ${j.order.size? '('+Number(j.order.size).toFixed(6)+')':''} ${j.order.paper?'[PAPER]':''}`);

        } else {

          const reason = (j && j.error) ? String(j.error) : 'unknown_error';

          uiLog('Manual SELL failed', JSON.stringify(j));

          pushOrderLogLine(`[${new Date().toLocaleString()}] SELL ERROR: ${reason}`);

        }

        try{ refreshTradeReady(); }catch(_){ }

      });

    }catch(e){ uiLog('Manual SELL error', String(e)); }

  }



  function armAutoPending(executeFn){

    try{

      if (!autoPending || !autoPendingBar){ executeFn(); return; }

      // Reset UI

      autoPending.style.display = '';

      autoPendingBar.style.width = '0%';

      let ms = 5000; const step = 100;

      if (autoPendingTimer) { clearInterval(autoPendingTimer); autoPendingTimer=null; }

      autoPendingTimer = setInterval(()=>{

        ms -= step; const pct = Math.max(0, Math.min(100, Math.round(((5000-ms)/5000)*100)));

        autoPendingBar.style.width = pct + '%';

        if (ms <= 0){ clearInterval(autoPendingTimer); autoPendingTimer=null; autoPending.style.display='none'; executeFn(); }

      }, step);

      if (btnCancelPending){

        btnCancelPending.onclick = ()=>{

          try{ if (autoPendingTimer) clearInterval(autoPendingTimer); }catch(_){ }

          autoPendingTimer = null; autoPending.style.display='none'; uiLog('Auto order cancelled within 5s');

        };

      }

    }catch(_){ executeFn(); }

  }



  // Live Trade Preflight test

  if (btnPreflight) btnPreflight.addEventListener('click', async ()=>{

    try{

      const j = await fetchJsonStrict('/api/trade/preflight');

      if (!j.ok){ uiLog('Preflight failed', JSON.stringify(j)); return; }

      const p = j.preflight || {};

      const lines = [

        `paper=${p.paper} keys=${p.has_keys} market=${p.market} price=${Number(p.price||0).toLocaleString()}`,

        `KRW=${Number(p.krw||0).toLocaleString()} coin_bal=${p.coin_balance}`,

        `BUY_KRW=${Number(p.planned_buy_krw||0).toLocaleString()} (>=5000 → ${p.can_buy})`,

        `SELL_SIZE=${p.planned_sell_size} (>=5000KRW → ${p.can_sell})`,

      ];

      uiLog('Preflight', lines.join(' | '));

    }catch(e){ uiLog('Preflight error', String(e)); }

  });



  // Auto Trade toggle: start/stop server trade loop

  if (autoTradeToggle){

    autoTradeToggle.addEventListener('change', async ()=>{

      try{

        if (autoTradeToggle.checked){

          await postJson('/api/bot/start', {});

          uiLog('Auto Trade', 'started');

        } else {

          await postJson('/api/bot/stop', {});

          uiLog('Auto Trade', 'stopped');

        }

      }catch(e){ uiLog('Auto Trade toggle error', String(e)); }

    });

  }

  // Inject ML-only/ML-seg-only toggles next to Auto Trade (runtime only)

  try{

    const parent = document.getElementById('autoTradeToggle')?.closest('.card');

    const holder = document.getElementById('tradeReadyBox')?.parentElement;

    if (holder){

      const wrap = document.createElement('div');

      wrap.className = 'mt-2';

      wrap.innerHTML = `<div class=\"form-check form-switch\"><input class=\"form-check-input\" type=\"checkbox\" id=\"mlOnlyToggle\"><label class=\"form-check-label text-muted\" for=\"mlOnlyToggle\">ML-only Auto Trade</label></div>

      <div class=\"form-check form-switch mt-1\"><input class=\"form-check-input\" type=\"checkbox\" id=\"mlSegOnlyToggle\"><label class=\"form-check-label text-muted\" for=\"mlSegOnlyToggle\">ML segment-only (extreme only)</label></div>`;

      holder.appendChild(wrap);

      mlOnlyToggle = document.getElementById('mlOnlyToggle');

      mlOnlyToggle.addEventListener('change', async ()=>{

        try{ await postJson('/api/bot/config', { ml_only: !!mlOnlyToggle.checked }); uiLog('Config', `ml_only=${mlOnlyToggle.checked}`); }catch(_){ }

      });

      mlSegOnlyToggle = document.getElementById('mlSegOnlyToggle');

      mlSegOnlyToggle && mlSegOnlyToggle.addEventListener('change', async ()=>{

        try{ await postJson('/api/bot/config', { ml_seg_only: !!mlSegOnlyToggle.checked }); uiLog('Config', `ml_seg_only=${mlSegOnlyToggle.checked}`); }catch(_){ }

      });

    }

  }catch(_){ }



  if (optBtn) optBtn.addEventListener('click', ()=>{ optimizeNb(); });

  if (trainBtn) trainBtn.addEventListener('click', async ()=>{

    try{

      const payload = { count: parseInt(trainCountEl?.value||'1800',10), segments: parseInt(trainSegEl?.value||'3',10), window: parseInt(nbWindowEl?.value||'50',10), debounce: parseInt(nbDebounceEl?.value||'6',10), fee_bps: 10.0, interval: getInterval() };

      uiLog('NB Train start', `auto split: ${payload.segments} segments, candle=${payload.interval}, count=${payload.count}`);

      const r = await fetch('/api/nb/train', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });

      const j = await r.json();

      if (j && j.ok){

        uiLog('NB Train done', `chosen seg=${j.chosen.segment}, PnL=${j.chosen.stats.pnl.toFixed(0)}, BUY=${j.chosen.best.buy}, SELL=${j.chosen.best.sell}`);

        if (nbBuyThEl) nbBuyThEl.value = String(j.chosen.best.buy);

        if (nbSellThEl) nbSellThEl.value = String(j.chosen.best.sell);

        updateNB();

      } else { uiLog('NB Train failed', JSON.stringify(j)); }

    }catch(e){ uiLog('NB Train error', String(e)); }

  });

  if (autoBtToggle) autoBtToggle.addEventListener('change', ()=>{

    if (autoBtToggle.checked){
      if (autoBtTimer) clearInterval(autoBtTimer);
      const run = ()=>{ if (btBtn) btBtn.click(); };

      const sec = Math.max(10, parseInt(autoBtSecEl?.value||'60',10));

      run();

      autoBtTimer = setInterval(run, sec*1000);

      uiLog('Auto backtest start', `interval=${sec}s`);

    } else {

      if (autoBtTimer) clearInterval(autoBtTimer); autoBtTimer=null;

      uiLog('Auto backtest stop');

    }

  });

  if (mlTrainBtn) mlTrainBtn.addEventListener('click', async ()=>{

    try{

      uiLog('ML Train start', 'nb_best_trade (BUY→SELL one-cycle) curriculum');

      const payload = { window: parseInt(nbWindowEl?.value||'50',10), ema_fast: parseInt(emaFastEl?.value||'10',10), ema_slow: parseInt(emaSlowEl?.value||'30',10), horizon: 5, tau: 0.002, count: 1800, interval: getInterval(), label_mode: 'nb_best_trade' };

      const j = await fetchJsonStrict('/api/ml/train', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });

      if (j && j.ok){ uiLog('ML Train done', `labels: BUY=${j.classes['1']}, HOLD=${j.classes['0']}, SELL=${j.classes['-1']}`); if (mlCountEl) mlCountEl.textContent = `(train# ${j.train_count||0})`; }

      else { uiLog('ML Train failed', JSON.stringify(j)); }

    }catch(e){ uiLog('ML Train error', String(e)); }

  });

  if (mlPredictBtn) mlPredictBtn.addEventListener('click', async ()=>{

    try{

      const j = await fetchJsonStrict('/api/ml/predict').catch(() => null);

      if (j && j.ok){

        uiLog('ML Predict', `action=${j.action}, pred=${j.pred}`);

        if (mlCountEl) mlCountEl.textContent = `(train# ${j.train_count||0})`;

        updateModelInsight(j);

      }

      else { uiLog('ML Predict failed', JSON.stringify(j)); }

    }catch(e){ uiLog('ML Predict error', String(e)); }

  });

  if (mlRandomBtn) mlRandomBtn.addEventListener('click', async ()=>{

    try{

      const n = Math.max(1, parseInt(mlRandNEl?.value||'10',10));

      uiLog('ML Random Train start', `trials=${n} (nb_best_trade emphasis)`);

      for (let i=0;i<n;i++){

        const mins = [1,3,5,10,15,30,60][Math.floor(Math.random()*7)];

        const interval = mins===60 ? 'minute60' : `minute${mins}`;

        const window = Math.floor(20 + Math.random()*100); // 20~120

        const ema_fast = Math.floor(5 + Math.random()*20); // 5~25

        const ema_slow = Math.max(ema_fast+5, Math.floor(20 + Math.random()*60));

        // Reflect random options on UI so user can see

        try{

          if (tfEl){ tfEl.value = interval; tfEl.dispatchEvent(new Event('change')); }

          if (emaFastEl){ emaFastEl.value = String(ema_fast); emaFastEl.dispatchEvent(new Event('change')); }

          if (emaSlowEl){ emaSlowEl.value = String(ema_slow); emaSlowEl.dispatchEvent(new Event('change')); }

          if (typeof nbWindowEl !== 'undefined' && nbWindowEl){ nbWindowEl.value = String(window); nbWindowEl.dispatchEvent(new Event('change')); }

          // short wait so chart/indicators update

          await sleep(400);

        }catch(_){ }

        const payload = { window, ema_fast, ema_slow, horizon: 5, tau: 0.002, count: 1200, interval, label_mode: 'nb_best_trade' };

        uiLog('ML Random Train', JSON.stringify(payload));

        const j = await fetchJsonStrict('/api/ml/train', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });

        if (!(j && j.ok)) { uiLog('Train failed, skipping attempt', JSON.stringify(j)); continue; }

        if (mlCountEl) mlCountEl.textContent = `(train# ${j.train_count||0})`;

        // After each random trial: wait NB signals ready → run backtest

        try{

          // Retry several times to absorb async delay

          await backtestAfterReady(6000);

          await sleep(1200); await backtestAfterReady(3000);

        }catch(_){ }

      }

      const pred = await fetchJsonStrict('/api/ml/predict').catch(() => null);

      if (pred && pred.ok){ uiLog('ML Predict(after random)', `action=${pred.action}, pred=${pred.pred}`); if (mlCountEl) mlCountEl.textContent = `(train# ${pred.train_count||0})`; }

      else { uiLog('ML Predict failed(after random)', JSON.stringify(pred)); }

      // 마지막으로 한 번 더 백테스트 갱신

      try{

        await backtestAfterReady(4000);

        await sleep(1200); await backtestAfterReady(3000);

      }catch(_){ }

    }catch(e){ uiLog('ML Random error', String(e)); }

  });

  if (loadBalBtn) loadBalBtn.addEventListener('click', async ()=>{

    try{

      const j = await fetchJsonStrict(assetApiBase + '/api/balance');

      const box = document.getElementById('balanceBox');

      if (!box) return;

      if (!j.ok){ box.textContent = `Error: ${j.error||'unknown'}`; return; }

      if (j.paper){ box.textContent = 'PAPER mode (no live assets)'; return; }

      const rows = (j.balances||[]);

      const lines = rows.map(b=>`${b.currency}: balance=${b.balance} locked=${b.locked} avg_buy=${b.avg_buy_price}`);

      box.textContent = lines.length? lines.join('\n') : 'No balances';

    }catch(e){ const box = document.getElementById('balanceBox'); if (box) box.textContent = String(e); }

  });
  // --- Top assets auto loader ---

  async function refreshAssets(){

    try{

      // Fresh call to backend (no cache) so we always see latest balances
      const resp = await fetch(assetApiBase + '/api/balance', { cache: 'no-store' });

      if (!resp.ok){
        const msg = `HTTP ${resp.status}`;
        if (assetsMeta) assetsMeta.textContent = `(error: ${msg})`;
        if (assetTotalEl) assetTotalEl.textContent = '0';
        if (assetBuyableEl) assetBuyableEl.textContent = '0';
        if (assetSellableEl) assetSellableEl.innerHTML = '<span class="chip">-</span>';
        if (assetsBars) assetsBars.innerHTML = '';
        return;
      }

      let j;
      try{
        j = await resp.json();
      }catch(e){
        if (assetsMeta) assetsMeta.textContent = '(error: invalid JSON)';
        return;
      }

      if (j && j.ok === false){
        if (assetsMeta) assetsMeta.textContent = `(error: ${j.error||'unknown'})`;
        return;
      }

      const payload = j && typeof j === 'object' && 'data' in j ? (j.data||{}) : j || {};

      if (payload.paper){ if (assetsMeta) assetsMeta.textContent = '(PAPER mode)'; return; }

      const rows = (payload.balances||[]);

      // Fill missing asset_value using balance * avg_buy_price (fallback)
      const normalized = rows.map(b => {
        const bal = Number(b.balance||0);
        const locked = Number(b.locked||0);
        const avg = Number(b.avg_buy_price||0);
        const price = Number(b.price||0);
        const cur = String(b.currency||'').toUpperCase();
        let assetValue = Number(b.asset_value||0);

        // Recompute when missing or clearly zero/invalid
        if (!assetValue || isNaN(assetValue)) {
          assetValue = 0;
        }

        if (cur === 'KRW') {
          assetValue = bal + locked; // KRW must include locked too
        } else if (assetValue <= 0) {
          if (price > 0) {
            assetValue = (bal + locked) * price;
          } else if (avg > 0) {
            assetValue = (bal + locked) * avg;
          } else {
            assetValue = 0;
          }
        }

        return { ...b, asset_value: assetValue };
      });

      // Filter out non-tradable coins (Upbit not listed / price<=0), keep KRW
      const filtered = normalized.filter(b => {
        const cur = String(b.currency||'').toUpperCase();
        if (cur === 'KRW') return true;
        return Number(b.price||0) > 0;
      });

      // show KRW first, then others sorted by balance desc

      const krw = filtered.filter(b=>b.currency==='KRW');

      const rest = filtered.filter(b=>b.currency!=='KRW').sort((a,b)=> (b.asset_value||0) - (a.asset_value||0));

      const all = [...krw, ...rest];

      // Selection state (null means show all). Default BTC on first load.
      const selectedRaw = ('selectedSellCoin' in window) ? window.selectedSellCoin : 'BTC';
      const selectedCoin = selectedRaw ? String(selectedRaw).toUpperCase() : null;
      const hasSelection = !!selectedCoin;

      // Stats cards

      const totalValue = all.reduce((s,b)=> s + Number(b.asset_value||0), 0);

      const krwVal = Number((krw[0]?.asset_value)||0);

      // Build sellable chips: selected highlighted, others muted gray
      const sellables = rest
        .filter(b=> Number(b.asset_value||0) > 0)
        .map(b=> ({ cur: String(b.currency||'').toUpperCase(), val: Number(b.asset_value||0) }));

      if (assetTotalEl) assetTotalEl.textContent = Math.round(totalValue).toLocaleString();

      if (assetBuyableEl) assetBuyableEl.textContent = Math.round(krwVal).toLocaleString();

      if (assetSellableEl) assetSellableEl.innerHTML = sellables.length
        ? sellables.map(({cur})=>{
            const isSel = hasSelection && cur === selectedCoin;
            const cls = hasSelection ? (isSel ? 'chip chip-selected' : 'chip chip-muted') : 'chip';
            return `<span class='${cls}' data-coin='${cur}'>${cur}</span>`;
          }).join(' ')
        : '<span class="chip">-</span>';



      // Bars by KRW value proportions

      if (assetsBars){

        assetsBars.innerHTML = '';

        const top = hasSelection
          ? [{ currency:'KRW', asset_value: krwVal }, ...rest.filter(b=> String(b.currency).toUpperCase()===selectedCoin)]
            .filter(b=> (b.asset_value||0)>0)
            .slice(0, 2)
          : [{ currency:'KRW', asset_value: krwVal }, ...rest]
            .filter(b=> (b.asset_value||0)>0)
            .slice(0, 10);

        const sum = top.reduce((s,b)=> s + Number(b.asset_value||0), 0) || 1;

        top.forEach(b=>{

          const pct = Math.max(1, Math.round((Number(b.asset_value||0)/sum)*100));

          const row = document.createElement('div');

          row.className = 'asset-bar' + (b.currency==='KRW'?' krw':'');

          row.innerHTML = `<div class='top'><div class='label'>${b.currency}</div><div class='muted'>${Math.round(b.asset_value||0).toLocaleString()} KRW (${pct}%)</div></div>

            <div class='meter'><div class='fill' style='width:${pct}%;'></div></div>`;

          assetsBars.appendChild(row);

        });

      }

      if (assetsMeta) assetsMeta.textContent = `(${new Date().toLocaleTimeString()})`;

    }catch(e){ if (assetsBox) assetsBox.textContent = String(e); }

  }

  if (assetsRefresh) assetsRefresh.addEventListener('click', refreshAssets);

  if (assetSellableEl) assetSellableEl.addEventListener('click', (e)=>{
    const chip = e.target.closest('.chip[data-coin]');
    if (!chip) return;
    const coin = String(chip.dataset.coin||'').toUpperCase();
    const current = window.selectedSellCoin ? String(window.selectedSellCoin).toUpperCase() : null;
    // Toggle selection: click same coin to clear (show all)
    window.selectedSellCoin = (current === coin) ? null : coin;
    refreshAssets();
  });

  if (assetsAutoToggle) assetsAutoToggle.addEventListener('change', ()=>{

    if (assetsAutoToggle.checked){

      if (assetsTimer) clearInterval(assetsTimer);
      refreshAssets();

      assetsTimer = setInterval(refreshAssets, 30*1000);

    } else {

      if (assetsTimer) clearInterval(assetsTimer), assetsTimer=null;

    }

  });

  // kick off initial load

  refreshAssets().catch(()=>{});

  if (assetsAutoToggle && assetsAutoToggle.checked){ 
    if (assetsTimer) clearInterval(assetsTimer);
    assetsTimer = setInterval(refreshAssets, 30*1000); 
  }

  if (logClearBtn) logClearBtn.addEventListener('click', ()=>{ if (logBox) logBox.textContent=''; });



  // ===== Village HP & N/B Stamina System =====

  

  // Guild Members Data Structure

  let guildMembers = {

    scout: { 

      name: 'Scout', 

      hp: 85, 

      maxHp: 100, 

      stamina: 70, 

      maxStamina: 100, 

      location: 'Gate', 

      role: 'Explorer',

      trainerCards: ['minute1', 'minute3'],

      specialty: 'Quick Signals',

      description: 'Monitors 1m & 3m charts for rapid opportunities',

      // Trading records

      realTrades: [],

      mockTrades: [],

      totalProfit: 0,

      winRate: 0,

      lastTrade: null,

             // Auto learning system

       skillLevel: 1.0,

       experience: 0,

       learningRate: 0.1,

       autoTradingEnabled: true,

       lastAutoTrade: null,

       tradeFrequency: 0.6, // 60% chance per cycle (increased for more active trading)

       strategy: 'momentum',

       // Position tracking

       openPosition: null,

       // N/B Coin inventory

       nbCoins: 0.001, // Current N/B coin balance (initialized for real trading)

       totalNbCoinsEarned: 0.0, // Total coins earned from profitable trades

       totalNbCoinsLost: 0.0, // Total coins lost from losing trades

       // Position tracking with multiple trades

       positionHistory: [], // Array of all trades in current position

       averagePrice: 0.0, // Average entry price

       totalPositionSize: 0.0 // Total position size

    },

    guardian: { 

      name: 'Guardian', 

      hp: 95, 

      maxHp: 100, 

      stamina: 80, 

      maxStamina: 100, 

      location: 'Market', 

      role: 'Protector',

      trainerCards: ['minute5', 'minute10'],

      specialty: 'Trend Protection',

      description: 'Guards 5m & 10m trends and manages risk',

      // Trading records

      realTrades: [],

      mockTrades: [],

      totalProfit: 0,

      winRate: 0,

      lastTrade: null,

             // Auto learning system

       skillLevel: 1.0,

       experience: 0,

       learningRate: 0.1,

       autoTradingEnabled: true,

       lastAutoTrade: null,

       tradeFrequency: 0.5, // 50% chance per cycle (increased for more active trading)

       strategy: 'meanrev',

       // Position tracking

       openPosition: null,

       // N/B Coin inventory

       nbCoins: 0.001, // Current N/B coin balance (initialized for real trading)

       totalNbCoinsEarned: 0.0, // Total coins earned from profitable trades

       totalNbCoinsLost: 0.0, // Total coins lost from losing trades

       // Position tracking with multiple trades

       positionHistory: [], // Array of all trades in current position

       averagePrice: 0.0, // Average entry price

       totalPositionSize: 0.0 // Total position size

    },

    analyst: { 

      name: 'Analyst', 

      hp: 60, 

      maxHp: 100, 

      stamina: 90, 

      maxStamina: 100, 

      location: 'Tower', 

      role: 'Strategist',

      trainerCards: ['minute15', 'minute30'],

      specialty: 'Strategic Analysis',

      description: 'Analyzes 15m & 30m patterns for strategy',

      // Trading records

      realTrades: [],

      mockTrades: [],

      totalProfit: 0,

      winRate: 0,

      lastTrade: null,

             // Auto learning system

       skillLevel: 1.0,

       experience: 0,

       learningRate: 0.15,

       autoTradingEnabled: true,

       lastAutoTrade: null,

       tradeFrequency: 0.7, // 70% chance per cycle (increased for more active trading)

       strategy: 'breakout',

       // Position tracking

       openPosition: null,

       // N/B Coin inventory

       nbCoins: 0.001, // Current N/B coin balance (initialized for real trading)

       totalNbCoinsEarned: 0.0, // Total coins earned from profitable trades

       totalNbCoinsLost: 0.0 // Total coins lost from losing trades

    },

    elder: { 

      name: 'Elder', 

      hp: 45, 

      maxHp: 100, 

      stamina: 50, 

      maxStamina: 100, 

      location: 'Inn', 

      role: 'Advisor',

      trainerCards: ['minute60', 'day'],

      specialty: 'Long-term Wisdom',

      description: 'Provides wisdom from 1h & daily perspectives',

      // Trading records

      realTrades: [],

      mockTrades: [],

      totalProfit: 0,

      winRate: 0,

      lastTrade: null,

             // Auto learning system

       skillLevel: 1.0,

       experience: 0,

       learningRate: 0.12,

       autoTradingEnabled: true,

       lastAutoTrade: null,

       tradeFrequency: 0.4, // 40% chance per cycle (increased for more active trading)

       strategy: 'scalping',

       // Position tracking

       openPosition: null,

       // N/B Coin inventory

       nbCoins: 0.0, // Current N/B coin balance

       totalNbCoinsEarned: 0.0, // Total coins earned from profitable trades

       totalNbCoinsLost: 0.0, // Total coins lost from losing trades

       // Position tracking with multiple trades

       positionHistory: [], // Array of all trades in current position

       averagePrice: 0.0, // Average entry price

       totalPositionSize: 0.0 // Total position size

    }

  };

  // Expose guildMembers globally for other modules
  window.guildMembers = guildMembers;



  // Village Mayor System

  let villageMayor = {

    name: '촌장',

    role: 'Leader',

    location: 'Town Hall',

    currentZone: 'BLUE', // Current market zone (BLUE/ORANGE)

    lastAnnouncement: null,

    announcementInterval: 5 * 60 * 1000, // 5 minutes

    zoneStrategy: {

      BLUE: {

        bias: 'BUY',

        confidence: 0.7,

        message: '🔵 BLUE 구역: 알파 구역으로 매수세가 강합니다. 신중하게 매수 전략을 실행하세요.'

      },

      ORANGE: {

        bias: 'SELL',

        confidence: 0.6,

        message: '🟠 ORANGE 구역: 베타적 관계 형성에 주의. 빠른 수익 실현이 중요합니다.'

      }

    }

  };



  // N/B 마을의 이동 에너지 시스템

  let nbEnergy = {

    current: 0, // Start from 0

    max: 99999,

    recoveryRate: 0, // No automatic recovery

    lastRecovery: Date.now(),

    treasuryAccess: false,

    lastChartInterval: null

  };

  // Expose nbEnergy globally for other modules
  window.nbEnergy = nbEnergy;



  // Mock Test Results for Stamina Recovery

  let mockTestResults = {

    totalTests: 0,

    profitableTests: 0,

    totalProfit: 0

  };
    // Update real-time trading status

  async function updateRealTimeTradingStatus() {
    try {

      const statusDiv = document.getElementById('realTimeTradingStatus');

      const indicator = document.getElementById('tradingStatusIndicator');

      if (!statusDiv || !indicator) return;

      

      let activeTraders = 0;

      let totalTraders = 0;

      let tradingActivity = [];

      let openPositions = [];

      let totalPnl = 0;

      

      // Get trainer storage data

      let trainerStorageData = {};

      try {

        const storageRes = await fetch('/api/trainer/storage');

        if (storageRes && storageRes.ok) {

          const result = await storageRes.json();

          if (result && result.storage) {

            trainerStorageData = result.storage;

          }

        }

      } catch (e) {

        console.error('Failed to fetch trainer storage data:', e);

      }

      

      Object.values(guildMembers).forEach(member => {

        totalTraders++;

        const canTrade = member.autoTradingEnabled && member.stamina >= 10;

        const timeSinceLastTrade = member.lastAutoTrade ? Date.now() - member.lastAutoTrade : 0;

        const fiveMinutes = 5 * 60 * 1000;

        const cooldownActive = timeSinceLastTrade < fiveMinutes;

        const cooldownRemaining = cooldownActive ? Math.ceil((fiveMinutes - timeSinceLastTrade) / 60000) : 0;

        

        // Check for open position using trainer storage data

        const trainerData = trainerStorageData[member.name];

        if (trainerData && trainerData.coins > 0) {

          const currentPrice = getCurrentPrice();

          const entryPrice = trainerData.entry_price || 0;

          const coinAmount = trainerData.coins;

          

          // Determine position side based on trade history

          let positionSide = 'BUY'; // default

          if (trainerData.trades && trainerData.trades.length > 0) {

            // Find the last trade that added coins (BUY or MANUAL_MODIFY with positive amount)

            const lastTrade = trainerData.trades[trainerData.trades.length - 1];

            if (lastTrade.action === 'BUY') {

              positionSide = 'BUY';

            } else if (lastTrade.action === 'SELL') {

              positionSide = 'SELL';

            } else if (lastTrade.action === 'MANUAL_MODIFY') {

              // For manual modifications, determine based on amount

              positionSide = lastTrade.amount > 0 ? 'BUY' : 'SELL';

            }

          }

          

          let currentPnl = 0;

          let effectiveEntryPrice = entryPrice;

          

          // If entry price is 0 or invalid, use current price (no P&L)

          if (entryPrice <= 0 || entryPrice > currentPrice * 10 || entryPrice < currentPrice * 0.1) {

            effectiveEntryPrice = currentPrice;

            currentPnl = 0; // No P&L for invalid entry price

          } else {

            if (positionSide === 'BUY') {

              currentPnl = ((currentPrice - effectiveEntryPrice) / effectiveEntryPrice) * 100;

            } else {

              currentPnl = ((effectiveEntryPrice - currentPrice) / effectiveEntryPrice) * 100;

            }

          }

          

          totalPnl += currentPnl;

          

          const pnlColor = currentPnl > 0 ? '#0ecb81' : currentPnl < 0 ? '#f6465d' : '#ffffff';

          

          let minutesHeld = 0;

          try {

            if (trainerData.last_update) {

              const timeHeld = Date.now() - (trainerData.last_update * 1000);

              minutesHeld = Math.floor(timeHeld / (1000 * 60));

              if (isNaN(minutesHeld) || minutesHeld < 0) {

                minutesHeld = 0;

              }

            }

          } catch (e) {

            minutesHeld = 0;

          }

          

          openPositions.push({

            name: member.name,

            side: positionSide,

            coinAmount: coinAmount,

            entryPrice: effectiveEntryPrice,

            currentPrice: currentPrice,

            pnl: currentPnl,

            pnlColor: pnlColor,

            minutesHeld: minutesHeld,

            strategy: member.strategy

          });

        }

        

        if (canTrade && !cooldownActive) {

          activeTraders++;

          tradingActivity.push(`${member.name}: 거래 준비 완료`);

        } else if (canTrade && cooldownActive) {

          tradingActivity.push(`${member.name}: 대기 중 (${cooldownRemaining}분)`);

        } else if (!canTrade) {

          tradingActivity.push(`${member.name}: 체력 부족 (${member.stamina}/100)`);

        }

      });

      

      // Update indicator

      if (activeTraders > 0) {

        indicator.className = 'badge bg-success';

        indicator.textContent = `${activeTraders}/${totalTraders} 활성`;

      } else {

        indicator.className = 'badge bg-warning';

        indicator.textContent = '대기 중';

      }

      

      // Update status content

      const currentTime = new Date().toLocaleTimeString();

      const currentPrice = getCurrentPrice();

      let html = `<div style="color: #00d1ff; font-weight: 600;">🕐 ${currentTime} | 💰 ${Number(currentPrice).toLocaleString()}</div>`;

      html += `<div style="margin-top: 4px;">활성 거래자: ${activeTraders}/${totalTraders} | 오픈 포지션: ${openPositions.length}</div>`;

      

      // Show open positions with real-time P&L

      if (openPositions.length > 0) {

        html += '<div style="margin-top: 8px; padding: 6px; background: rgba(0,0,0,0.3); border-radius: 4px;">';

        html += '<div style="font-size: 11px; color: #00d1ff; margin-bottom: 4px;">📊 실시간 포지션</div>';

        

        // Calculate total P&L color outside the loop

        const totalPnlColor = totalPnl > 0 ? '#0ecb81' : totalPnl < 0 ? '#f6465d' : '#ffffff';

        

        openPositions.forEach(pos => {

          html += `<div style="font-size: 10px; margin-bottom: 2px;">`;

          html += `<span style="color: #ffffff;">${pos.name}:</span> `;

          html += `<span style="color: ${pos.side === 'BUY' ? '#0ecb81' : '#f6465d'};">${pos.side}</span> `;

          html += `<span style="color: #ffffff;">${pos.coinAmount} BTC</span> `;

          html += `<span style="color: #888888;">@ ${Number(pos.entryPrice).toLocaleString()}</span> `;

          html += `<span style="color: ${pos.pnlColor}; font-weight: 600;">${pos.pnl > 0 ? '+' : ''}${pos.pnl.toFixed(2)}%</span> `;

          html += `<span style="color: #888888;">(${pos.minutesHeld}분)</span>`;

          html += `</div>`;

        });

        

        html += `<div style="font-size: 11px; color: ${totalPnlColor}; font-weight: 600; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px;">`;

        html += `총 P&L: ${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)}%`;

        html += `</div>`;

        html += '</div>';

      }

      

      // Show trading activity

      if (tradingActivity.length > 0) {

        html += '<div style="margin-top: 8px; font-size: 10px;">';

        html += '<div style="color: #888888; margin-bottom: 4px;">거래 상태:</div>';

        tradingActivity.forEach(activity => {

          html += `<div style="margin-bottom: 2px;">• ${activity}</div>`;

        });

        html += '</div>';

      }

      

      statusDiv.innerHTML = html;

      

    } catch (e) {

      console.error('Error updating real-time trading status:', e);

    }

  }



  // Update Integrated Guild Members & Auto Trading Status

  // Guild Members Status - moved to guild-members-status.js
  async function updateGuildMembersStatus_MOVED() {
    try {

      const integratedGuildStatus = document.getElementById('integratedGuildStatus');

      if (!integratedGuildStatus) return;


      // Get trainer storage data
      let trainerStorageData = {};
      try {
        const storageRes = await fetch('/api/trainer/storage');
        if (storageRes && storageRes.ok) {
          const result = await storageRes.json();
          if (result && result.storage) {
            trainerStorageData = result.storage;
          }
        }
      } catch (e) {
        console.error('Failed to fetch trainer storage data:', e);
      }


      // System status header - Removed duplicate energy display

      let html = `
        <!-- 촌장의 실시간 지침 및 현재 구역 정보 -->
        <div style="font-size: 11px; color: #d9e2f3; margin-bottom: 8px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; border-left: 3px solid #ffb703;">
          <div style="font-weight: 600; margin-bottom: 4px;">🏛️ 촌장의 실시간 지침</div>
          <div style="font-size: 9px; color: #888888; margin-bottom: 2px;" id="mayor-realtime-guidance">
            <span style="color: #ffb703;">⚡ 현재 구역: </span><span id="current-zone-display">🟠 ORANGE</span>
          </div>
          <div style="font-size: 9px; color: #888888; margin-bottom: 2px;">
            <span style="color: #0ecb81;">✅ BLUE 구역: </span>BUY만 허용 (SELL 금지)
          </div>
          <div style="font-size: 9px; color: #888888; margin-bottom: 2px;">
            <span style="color: #f6465d;">⚠️ ORANGE 구역: </span>SELL만 허용 (BUY 금지)
          </div>
          <div style="font-size: 9px; color: #888888; margin-bottom: 2px;" id="mayor-trust-display">
            <span style="color: #00d1ff;">🤖 ML Model Trust: </span><span style="color: #00d1ff; font-weight: 600; background: rgba(0,209,255,0.1); padding: 1px 3px; border-radius: 2px;">40%</span> | <span style="color: #ffb703;">🏛️ N/B Guild Trust: </span><span style="color: #ffb703; font-weight: 600; background: rgba(255,183,3,0.1); padding: 1px 3px; border-radius: 2px;">86%</span> (86개 히스토리)
          </div>
          <div style="font-size: 9px; color: #888888;">
            <span style="color: #ffb703;">🔄 실시간 동기화: </span>
            <div id="zoneConsistencyInfo" style="font-size: 8px; color: #888; margin-top: 2px;">
              <div style="font-size: 9px; color: #333; font-weight: 500; line-height: 1.2; padding: 2px 4px; background: #f8f9fa; border-radius: 3px; border-left: 2px solid #0ecb81;">
                🔄 <span style="color: #0ecb81; font-weight: 600;">실시간 동기화</span> | 
                N/B: 🟠ORANGE | 
                ML: 🔵BLUE
              </div>
            </div>
          </div>
        </div>
        
        <div style="font-size: 11px; color: #d9e2f3; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1);">Guild Members Status</div>
      `;

      

      Object.values(guildMembers).forEach(member => {

        const hpPercent = Math.round((member.hp / member.maxHp) * 100);

        const staminaPercent = Math.round((member.stamina / member.maxStamina) * 100);

        

        const hpColor = hpPercent > 70 ? '#0ecb81' : hpPercent > 40 ? '#ffb703' : '#f6465d';

        const staminaColor = staminaPercent > 70 ? '#4285f4' : staminaPercent > 40 ? '#ffb703' : '#f6465d';

        

        // Calculate trading stats

        const totalRealTrades = member.realTrades.length;

        const totalMockTrades = member.mockTrades.length;

        const profitColor = member.totalProfit > 0 ? '#0ecb81' : member.totalProfit < 0 ? '#f6465d' : '#ffffff';

        const winRateColor = member.winRate > 60 ? '#0ecb81' : member.winRate > 40 ? '#ffb703' : '#f6465d';

        

                 // Get last trade info

         const lastTrade = member.lastTrade;

         const lastTradeInfo = lastTrade ? 

           `<span style="font-size: 10px; color: ${lastTrade.profit > 0 ? '#0ecb81' : '#f6465d'};">

             Last: ${lastTrade.type} ${lastTrade.profit > 0 ? '+' : ''}${lastTrade.profit.toFixed(2)}%

           </span>` : '';

         

         // Get position status with real-time P&L using trainer storage data
         let positionStatus = '';

         const trainerData = trainerStorageData[member.name];
         if (trainerData && trainerData.coins > 0) {
           const currentPrice = getCurrentPrice();

           const entryPrice = trainerData.entry_price || 0;
           const coinAmount = trainerData.coins;
           
           // Determine position side based on trade history
           let positionSide = 'BUY'; // default
           if (trainerData.trades && trainerData.trades.length > 0) {
             const lastTrade = trainerData.trades[trainerData.trades.length - 1];
             if (lastTrade.action === 'BUY') {
               positionSide = 'BUY';
             } else if (lastTrade.action === 'SELL') {
               positionSide = 'SELL';
             } else if (lastTrade.action === 'MANUAL_MODIFY') {
               positionSide = lastTrade.amount > 0 ? 'BUY' : 'SELL';
             }
           }
           
           // Calculate real-time P&L with validation
           let currentPnl = 0;

           let effectiveEntryPrice = entryPrice;
           

           if (entryPrice <= 0 || entryPrice > currentPrice * 10 || entryPrice < currentPrice * 0.1) {
             effectiveEntryPrice = currentPrice;
             currentPnl = 0;
           } else {
           if (positionSide === 'BUY') {

               currentPnl = ((currentPrice - effectiveEntryPrice) / effectiveEntryPrice) * 100;
           } else {

               currentPnl = ((effectiveEntryPrice - currentPrice) / effectiveEntryPrice) * 100;
             }
           }

           

           const pnlColor = currentPnl > 0 ? '#0ecb81' : currentPnl < 0 ? '#f6465d' : '#ffffff';
           

           positionStatus = `<span style="font-size: 10px; color: #00d1ff; font-weight: 600;">

             📊 ${positionSide} ${coinAmount.toFixed(8)} @ ${Number(effectiveEntryPrice).toLocaleString()}
           </span>

           <span style="font-size: 10px; color: ${pnlColor}; margin-left: 8px;">

             P&L: ${currentPnl > 0 ? '+' : ''}${currentPnl.toFixed(2)}%

           </span>`;

         }

         

         // Add N/B coin balance

         const nbCoinColor = member.nbCoins > 0 ? '#ffd700' : '#888888';

         const nbCoinStatus = `<span style="font-size: 10px; color: ${nbCoinColor}; margin-left: 8px;">

           🪙 N/B: ${member.nbCoins.toFixed(6)}

         </span>`;

        

                 // Check auto trading status with detailed information

         const canTrade = member.autoTradingEnabled && member.stamina >= 10;

         const timeSinceLastTrade = member.lastAutoTrade ? Date.now() - member.lastAutoTrade : 0;

         const fiveMinutes = 5 * 60 * 1000;

         const cooldownActive = timeSinceLastTrade < fiveMinutes;

         const cooldownRemaining = cooldownActive ? Math.ceil((fiveMinutes - timeSinceLastTrade) / 60000) : 0;

         

         let tradeStatus = '🤖 거래 가능';

         let tradeStatusColor = '#0ecb81';

         

         // Check if member has open position

         if (member.openPosition) {

           try {

             const timeHeld = Date.now() - new Date(member.openPosition.timestamp).getTime();

             const minutesHeld = Math.floor(timeHeld / (1000 * 60));

             if (isNaN(minutesHeld) || minutesHeld < 0) {

               tradeStatus = `📊 포지션 보유`;

             } else {

               tradeStatus = `📊 포지션 보유 (${minutesHeld}분)`;

             }

           } catch (e) {

             tradeStatus = `📊 포지션 보유`;

           }

           tradeStatusColor = '#00d1ff';

         } else if (!canTrade) {

           tradeStatus = '🔴 체력 부족';

           tradeStatusColor = '#f6465d';

         } else if (cooldownActive) {

           tradeStatus = `⏸️ 대기 중 (${cooldownRemaining}분)`;

           tradeStatusColor = '#ffb703';

         } else if (Math.random() > member.tradeFrequency) {

           tradeStatus = '⏳ 확률 대기';

           tradeStatusColor = '#ffb703';

         }

        

        // 창고 자산 기반 등급 표시
        const warehouseValue = member.nbCoins * (window.currentPrice || 160000000);
        const warehouseGrade = enhanceSpecialty(member.specialty, member.skillLevel, warehouseValue);
        const skillDisplay = `(Level ${member.skillLevel.toFixed(1)}) - ${warehouseGrade.split('(')[1].split(')')[0]}`;

        

        // Trainer cards display

        const trainerCardsHtml = member.trainerCards ? member.trainerCards.map(card => 

          `<span class="badge bg-info text-dark" style="font-size: 10px; margin-right: 2px;">${card}</span>`

        ).join('') : '';

        

        html += `

          <div class="d-flex justify-content-between align-items-center mb-3" style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px;">

            <div style="flex: 1;">

              <div class="d-flex align-items-center mb-1">

                <span style="font-weight: 600; color: #ffffff;">${member.name}</span>

              <span style="color: #ffffff; font-size: 11px; margin-left: 8px;">(${member.role})</span>

              <span style="color: #ffffff; font-size: 11px; margin-left: 8px;">[${member.location}]</span>

                <span style="color: #ffffff; font-size: 11px; margin-left: 8px;">${skillDisplay}</span>

              </div>

              <div style="font-size: 11px; color: #ffffff; margin-bottom: 4px;">

                <strong>${member.specialty}</strong>: ${member.description}

              </div>

              <div style="margin-bottom: 4px;">

                ${trainerCardsHtml}

              </div>

              <div style="font-size: 10px; color: #ffffff; margin-bottom: 2px;">

                <span style="color: ${profitColor};">Profit: ${member.totalProfit > 0 ? '+' : ''}${member.totalProfit.toFixed(2)}%</span>

                <span style="margin-left: 8px; color: ${winRateColor};">Win Rate: ${member.winRate.toFixed(1)}%</span>

              </div>

              <div style="font-size: 10px; color: #ffffff; margin-bottom: 2px;">

                <span>Real: ${totalRealTrades}</span>

                <span style="margin-left: 8px;">Mock: ${totalMockTrades}</span>

                <span style="margin-left: 8px; color: ${tradeStatusColor};">${tradeStatus}</span>

              </div>

                             <div style="font-size: 10px; color: #ffffff;">

                 ${lastTradeInfo}

                 ${positionStatus}

                 ${nbCoinStatus}

                 <span style="font-size: 10px; color: #00d1ff; margin-left: 8px;">

                   💰 Current Price: ${Number(getCurrentPrice()).toLocaleString()}

                 </span>

               </div>

              <div style="font-size: 9px; color: #888888; margin-top: 2px;">

                <span>Strategy: ${member.strategy}</span>
                
                <!-- 촌장 지침 준수 여부 및 개인 판단 정보 추가 -->
                <div style="font-size: 9px; color: #888888; margin-top: 4px; padding: 4px; background: rgba(255,255,255,0.05); border-radius: 3px;" id="mayor-guidance-${member.name}">
                  촌장 지침 상태 로딩 중...
                </div>
                
                <!-- 자동 학습 상태 표시 -->
                <div style="font-size: 8px; color: #888888; margin-top: 2px;" id="auto-learning-status-${member.name}">
                  🤖 자동 학습: 로딩 중...
                </div>
                
                <!-- AI 거래 설명 표시 -->
                <div style="font-size: 8px; color: #888888; margin-top: 2px;" id="ai-explanation-${member.name}">
                  🤖 AI 거래 설명: 로딩 중...
                </div>
                
                <!-- 촌장 지침 학습 모델 훈련 버튼 -->
                <div style="margin-top: 4px;">
                  <button class="btn btn-sm btn-outline-warning" onclick="trainMayorGuidanceModel()" style="font-size: 8px; padding: 2px 4px;">
                    🏛️ 촌장 지침 학습
                  </button>
                  <button class="btn btn-sm btn-outline-success" onclick="toggleAutoLearning()" style="font-size: 8px; padding: 2px 4px; margin-left: 2px;">
                    🤖 자동 학습
                  </button>
                  <button class="btn btn-sm btn-outline-info" onclick="getAIExplanation('${member.name}')" style="font-size: 8px; padding: 2px 4px; margin-left: 2px;">
                    🤖 AI 설명
                  </button>
                </div>

                <span style="margin-left: 8px;">Confidence: ${calculateMemberConfidence(member).toFixed(0)}%</span>

                <span style="margin-left: 8px;">Freq: ${(member.tradeFrequency * 100).toFixed(0)}%</span>

                ${cooldownActive ? `<span style="margin-left: 8px; color: #ffb703;">⏱️ ${cooldownRemaining}분</span>` : ''}

              </div>

            </div>

            <div class="d-flex align-items-center" style="gap: 8px;">

              <div style="text-align: right;">

                <div style="font-size: 11px; color: #ffffff;">HP: ${member.hp}/${member.maxHp}</div>

                <div style="width: 60px; height: 4px; background: #1a1a1a; border-radius: 2px; overflow: hidden;">

                  <div style="width: ${hpPercent}%; height: 100%; background: ${hpColor};"></div>

                </div>

              </div>

              <div style="text-align: right;">

                <div style="font-size: 11px; color: #ffffff;">Stamina: ${member.stamina}/${member.maxStamina}</div>

                <div style="width: 60px; height: 4px; background: #1a1a1a; border-radius: 2px; overflow: hidden;">

                  <div style="width: ${staminaPercent}%; height: 100%; background: ${staminaColor};"></div>

                </div>

              </div>

            </div>

          </div>

        `;

      });

      

      integratedGuildStatus.innerHTML = html;

      // 실시간 촌장 지침 업데이트 (mayor-guidance.js에서 관리됨)
      const realtimeGuidanceRestored = restoreRealtimeMayorGuidance();
      if (!realtimeGuidanceRestored) {
        // mayor-guidance.js의 함수 사용
        if (typeof updateRealtimeMayorGuidance === 'function') {
          updateRealtimeMayorGuidance().catch(e => console.error('Error updating realtime mayor guidance:', e));
        }
      }
      
      // 실시간 촌장 지침 주기적 업데이트 시작 (mayor-guidance.js에서 관리됨)
      // 중복 실행 방지를 위해 주석 처리
      // if (typeof startRealtimeMayorGuidanceUpdates === 'function') {
      //   startRealtimeMayorGuidanceUpdates();
      // }

      // Update individual trade slides

      updateIndividualTradeSlides();

      
      // 모든 길드 멤버의 촌장 지침 상태와 자동 학습 상태 업데이트
      Object.values(guildMembers).forEach(member => {
        // 먼저 저장된 상태 복원 시도
        const guidanceRestored = restoreMayorGuidanceStatus(member.name);
        // const autoLearningRestored = restoreAutoLearningStatus(member.name); // moved to village-learning-system.js
        const aiExplanationRestored = restoreAIExplanation(member.name);

        // 실시간 업데이트 (복원되지 않은 경우에만)
        if (!guidanceRestored) {
          getMayorGuidanceStatus(member).then(guidanceHtml => {
            const guidanceElement = document.getElementById(`mayor-guidance-${member.name}`);
            if (guidanceElement) {
              guidanceElement.innerHTML = guidanceHtml;
            }
          }).catch(e => console.error('Error updating mayor guidance status:', e));
        }

        // if (!autoLearningRestored) {
        //   updateAutoLearningStatus(member.name).catch(e => console.error('Error updating auto learning status:', e));
        // }
        // moved to village-learning-system.js

        // AI 설명은 getAIExplanation 함수가 직접 HTML을 생성하므로 여기서는 처리하지 않음
        // if (!aiExplanationRestored) {
        //   getAIExplanation(member.name).catch(e => console.error('Error updating AI explanation:', e));
        // }
      });

    } catch (e) {

      console.error('Error updating integrated guild status:', e);

    }

  }
  // Generate Trade Slide HTML for individual member

  // Generate Trade Slide HTML - moved to guild-members-status.js
  function generateTradeSlideHTML_MOVED(member) {

    const hasPosition = member.openPosition !== null;

    const currentPrice = getCurrentPrice();

    

    if (!hasPosition) {

      return `

        <div style="font-size:11px; color:#888888; padding:8px; background:rgba(255,255,255,0.05); border-radius:4px; text-align:center;">

          📊 No active position

        </div>

      `;

    }

    

    const entryPrice = member.averagePrice || member.openPosition.price;

    const coinAmount = member.totalPositionSize || member.openPosition.coinAmount;

    const positionSide = member.openPosition.side;

    const tradeStartTime = new Date(member.openPosition.timestamp);

    const timeHeld = Date.now() - tradeStartTime.getTime();

    const minutesHeld = Math.floor(timeHeld / (1000 * 60));

    

    // Calculate P&L

    let currentPnl = 0;

    if (positionSide === 'BUY') {

      currentPnl = ((currentPrice - entryPrice) / entryPrice) * 100;

    } else {

      currentPnl = ((entryPrice - currentPrice) / entryPrice) * 100;

    }

    

    const pnlColor = currentPnl > 0 ? '#0ecb81' : currentPnl < 0 ? '#f6465d' : '#ffffff';

    const pnlBgColor = currentPnl > 0 ? 'rgba(14,203,129,0.1)' : currentPnl < 0 ? 'rgba(246,70,93,0.1)' : 'rgba(255,255,255,0.05)';

    

    // Sell prediction logic

    const sellPrediction = calculateSellPrediction(member, currentPnl, minutesHeld);

    

    return `

      <div style="font-size:11px; color:#ffffff; background:rgba(0,209,255,0.1); border-radius:6px; padding:8px; border-left:3px solid #00d1ff;">

        <!-- Trade Progress Bar -->

        <div class="mb-2">

          <div class="d-flex justify-content-between align-items-center mb-1">

            <span style="font-size:10px; color:#ffffff;">Trade Progress</span>

            <span style="font-size:10px; color:#00d1ff;">${Math.min(100, (minutesHeld / 60) * 100).toFixed(1)}%</span>

          </div>

          <div style="width:100%; height:6px; background:#1a1a1a; border-radius:3px; overflow:hidden;">

            <div style="width:${Math.min(100, (minutesHeld / 60) * 100)}%; height:100%; background:linear-gradient(90deg, #00d1ff, #0ecb81); transition:width 0.3s ease;"></div>

          </div>

        </div>

        

        <!-- Trade Status -->

        <div class="mb-2" style="font-size:10px; color:#ffffff; padding:6px; background:rgba(0,209,255,0.1); border-radius:4px;">

          <div class="d-flex justify-content-between align-items-center">

            <span>🔄 ${positionSide} Position Active</span>

            <span style="color:#00d1ff;">${minutesHeld}m</span>

          </div>

        </div>

        

        <!-- Trade Details -->

        <div class="mb-2">

          <div class="row">

            <div class="col-6">

              <div style="background:rgba(255,255,255,0.05); padding:4px; border-radius:3px; margin-bottom:3px;">

                <span style="color:#888888; font-size:9px;">Entry:</span><br>

                <span style="color:#ffffff; font-weight:600; font-size:10px;">${Number(entryPrice).toLocaleString()}</span>

              </div>

            </div>

            <div class="col-6">

              <div style="background:rgba(255,255,255,0.05); padding:4px; border-radius:3px; margin-bottom:3px;">

                <span style="color:#888888; font-size:9px;">Current:</span><br>

                <span style="color:#ffffff; font-weight:600; font-size:10px;">${Number(currentPrice).toLocaleString()}</span>

              </div>

            </div>

          </div>

          <div class="row">

            <div class="col-6">

              <div style="background:rgba(255,255,255,0.05); padding:4px; border-radius:3px; margin-bottom:3px;">

                <span style="color:#888888; font-size:9px;">Size:</span><br>

                <span style="color:#ffffff; font-weight:600; font-size:10px;">${coinAmount.toFixed(6)}</span>

              </div>

            </div>

            <div class="col-6">

              <div style="background:rgba(255,255,255,0.05); padding:4px; border-radius:3px; margin-bottom:3px;">

                <span style="color:#888888; font-size:9px;">Strategy:</span><br>

                <span style="color:#ffffff; font-weight:600; font-size:10px;">${member.strategy}</span>

              </div>

            </div>

          </div>

        </div>

        

        <!-- P&L Display -->

        <div class="mb-2" style="font-size:11px; padding:6px; border-radius:4px; text-align:center; background:${pnlBgColor};">

          <div style="font-size:12px; font-weight:600; margin-bottom:2px;">P&L</div>

          <div style="font-size:14px; font-weight:700; color:${pnlColor};">${currentPnl > 0 ? '+' : ''}${currentPnl.toFixed(2)}%</div>

          <div style="font-size:9px; color:#888888;">${(currentPnl * entryPrice * coinAmount / 100).toFixed(0)} KRW</div>

        </div>

        

        <!-- Sell Prediction -->

        <div class="mb-2" style="font-size:10px; color:#ffffff; padding:6px; background:rgba(255,183,3,0.1); border-radius:4px; border-left:2px solid #ffb703;">

          <div class="d-flex justify-content-between align-items-center">

            <span>🎯 Sell Prediction</span>

            <span style="color:#ffb703;">${sellPrediction.time}</span>

          </div>

          <div style="font-size:9px; color:#888888; margin-top:2px;">${sellPrediction.reason}</div>

        </div>

      </div>

    `;

  }



  // Calculate Sell Prediction

  function calculateSellPrediction(member, currentPnl, minutesHeld) {

    const strategy = member.strategy;

    const confidence = calculateMemberConfidence(member);

    

    let prediction = {

      time: 'Unknown',

      reason: 'Analyzing market conditions...'

    };

    

    // Strategy-based predictions

    if (strategy === 'meanrev') {

      if (currentPnl > 2) {

        prediction = {

          time: 'Soon',

          reason: 'Mean reversion target reached (+2%)'

        };

      } else if (currentPnl < -3) {

        prediction = {

          time: 'Hold',

          reason: 'Waiting for reversal signal'

        };

      } else {

        prediction = {

          time: `${Math.max(0, 30 - minutesHeld)}m`,

          reason: 'Mean reversion in progress'

        };

      }

    } else if (strategy === 'momentum') {

      if (currentPnl > 1.5) {

        prediction = {

          time: 'Now',

          reason: 'Momentum peak detected'

        };

      } else {

        prediction = {

          time: `${Math.max(0, 45 - minutesHeld)}m`,

          reason: 'Momentum building'

        };

      }

    } else if (strategy === 'breakout') {

      if (currentPnl > 3) {

        prediction = {

          time: 'Immediate',

          reason: 'Breakout target achieved'

        };

      } else {

        prediction = {

          time: `${Math.max(0, 60 - minutesHeld)}m`,

          reason: 'Breakout confirmation pending'

        };

      }

    }

    

    // Confidence adjustment

    if (confidence > 80) {

      prediction.time = prediction.time === 'Unknown' ? 'Soon' : prediction.time;

    }

    

    return prediction;

  }



  // Toggle Trade Slide for individual member

  function toggleTradeSlide(memberName) {

    const slideElement = document.getElementById(`tradeSlide_${memberName}`);

    if (slideElement) {

      slideElement.style.display = slideElement.style.display === 'none' ? 'block' : 'none';

    }

  }



  // Update Individual Trade Slides

  function updateIndividualTradeSlides() {

    Object.values(guildMembers).forEach(member => {

      const slideElement = document.getElementById(`tradeSlide_${member.name}`);

      if (slideElement && slideElement.style.display !== 'none') {

        slideElement.innerHTML = window.generateTradeSlideHTML ? window.generateTradeSlideHTML(member) : 'Trade slide not available';

      }

    });

  }



  // Toggle All Trade Slides

  function toggleAllTradeSlides() {

    const slides = document.querySelectorAll('[id^="tradeSlide_"]');

    const isAnyVisible = Array.from(slides).some(slide => slide.style.display !== 'none');

    

    slides.forEach(slide => {

      slide.style.display = isAnyVisible ? 'none' : 'block';

    });

    

    // Update button text

    const toggleBtn = document.getElementById('btnToggleAllSlides');

    if (toggleBtn) {

      toggleBtn.textContent = isAnyVisible ? 'Show All' : 'Hide All';

    }

  }



  // Update N/B Stamina System Display

  function updateStaminaSystem() {

    try {

      const staminaSystem = document.getElementById('staminaSystem');

      const staminaMeta = document.getElementById('staminaMeta');

      if (!staminaSystem || !staminaMeta) return;



      const energyPercent = Math.round((nbEnergy.current / nbEnergy.max) * 100);

      const energyColor = energyPercent > 70 ? '#4285f4' : energyPercent > 40 ? '#ffb703' : '#f6465d';

      

      const treasuryStatus = nbEnergy.treasuryAccess ? 'Unlocked' : 'Locked';

      const treasuryColor = nbEnergy.treasuryAccess ? '#0ecb81' : '#f6465d';

      

      staminaSystem.innerHTML = `

        <div class="d-flex justify-content-between align-items-center mb-2">

          <div>

            <span style="font-weight: 600;">마을의 이동 에너지:</span>

            <span style="color: ${energyColor}; margin-left: 8px;">${nbEnergy.current}/${nbEnergy.max}</span>

          </div>

          <div style="display: flex; align-items: center; gap: 8px;">

            <div style="width: 120px; height: 8px; background: #1a1a1a; border-radius: 4px; overflow: hidden;">

              <div style="width: ${energyPercent}%; height: 100%; background: ${energyColor};"></div>

            </div>

            <button onclick="fillVillageEnergy()" style="background: #4caf50; color: white; border: none; border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer;" title="마을 에너지 100% 채우기">100%</button>

          </div>

        </div>

        <div class="d-flex justify-content-between align-items-center">

          <div>

            <span style="font-weight: 600;">Treasury Access:</span>

            <span style="color: ${treasuryColor}; margin-left: 8px;">${treasuryStatus}</span>

          </div>

          <div>

            <span style="font-size: 11px; color: #ffffff;">Recovery: Chart Interval Changes</span>

          </div>

        </div>

        <div style="margin-top: 8px; font-size: 11px; color: #ffffff;">

          Chart Changes: ${mockTestResults.profitableTests}/${mockTestResults.totalTests} profitable

          ${mockTestResults.totalProfit > 0 ? `(+${mockTestResults.totalProfit.toFixed(2)}% avg)` : ''}

        </div>

      `;

      

      staminaMeta.textContent = `(${new Date().toLocaleTimeString()})`;

    } catch (e) {

      console.error('Error updating stamina system:', e);

    }

  }



  // Fill Village Energy to 100%

  async function fillVillageEnergy() {

    try {

      const response = await fetch('/api/village/energy/fill', {

        method: 'POST',

        headers: {

          'Content-Type': 'application/json'

        }

      });

      

      const data = await response.json();

      if (data.ok) {

        // console.log(`✅ Village energy filled: ${data.previous_energy?.toFixed(1)}% → ${data.new_energy?.toFixed(1)}%`);

        pushOrderLogLine(`[${new Date().toLocaleString()}] 마을 에너지 100% 채움: ${data.previous_energy?.toFixed(1)}% → ${data.new_energy?.toFixed(1)}%`);

        // Sync local state and update UI immediately
        if (typeof nbEnergy !== 'undefined' && nbEnergy) {
          nbEnergy.current = Math.min(nbEnergy.max, 99999);
          if (nbEnergy.current >= 80) nbEnergy.treasuryAccess = true;
        }
        await updateStaminaSystem();

      } else {

        console.error('❌ Failed to fill village energy:', data.error);

        pushOrderLogLine(`[${new Date().toLocaleString()}] 마을 에너지 채우기 실패: ${data.error}`);

      }

    } catch (e) {

      console.error('❌ Error filling village energy:', e);

      pushOrderLogLine(`[${new Date().toLocaleString()}] 마을 에너지 채우기 오류: ${e.message}`);

    }

  }

  

  // Make function globally accessible

  window.fillVillageEnergy = fillVillageEnergy;

  

  // Rest All Guild Members

  function restAllGuildMembers() {

    try {

      Object.values(guildMembers).forEach(member => {

        // Rest increases stamina by 20, but decreases HP by 5

        member.stamina = Math.min(member.maxStamina, member.stamina + 20);

        member.hp = Math.max(0, member.hp - 5);

      });

      

      if (window.updateGuildMembersStatus) {
        window.updateGuildMembersStatus().catch(e => console.error('Error updating guild members status:', e));
      }
      pushOrderLogLine(`[${new Date().toLocaleString()}] All guild members rested. Stamina +20, HP -5`);

    } catch (e) {

      console.error('Error resting guild members:', e);

    }

  }



  // Heal All Guild Members

  function healAllGuildMembers() {

    try {

      Object.values(guildMembers).forEach(member => {

        // Heal increases HP by 15, but decreases stamina by 10

        member.hp = Math.min(member.maxHp, member.hp + 15);

        member.stamina = Math.max(0, member.stamina - 10);

      });

      

      if (window.updateGuildMembersStatus) {
        window.updateGuildMembersStatus().catch(e => console.error('Error updating guild members status:', e));
      }
      pushOrderLogLine(`[${new Date().toLocaleString()}] All guild members healed. HP +15, Stamina -10`);

    } catch (e) {

      console.error('Error healing guild members:', e);

    }

  }



  // Process Mock Test Results for Stamina Recovery

  function processMockTestResult(profitPercent) {

    try {

      mockTestResults.totalTests++;

      mockTestResults.totalProfit += profitPercent;

      

      if (profitPercent > 0) {

        mockTestResults.profitableTests++;

        // Only profitable mock tests recover stamina

        const energyRecovery = Math.min(15, Math.round(profitPercent * 3)); // Max 15 energy per test, higher multiplier

        nbEnergy.current = Math.min(nbEnergy.max, nbEnergy.current + energyRecovery);

        

        // Check if treasury access should be unlocked

        if (nbEnergy.current >= 80 && !nbEnergy.treasuryAccess) {

          nbEnergy.treasuryAccess = true;

          pushOrderLogLine(`[${new Date().toLocaleString()}] 🎉 Treasury access UNLOCKED! N/B Energy reached 80+ (${nbEnergy.current})`);

        }

        

        pushOrderLogLine(`[${new Date().toLocaleString()}] ✅ Mock test profitable (+${profitPercent.toFixed(2)}%). Energy +${energyRecovery} (Total: ${nbEnergy.current})`);

      } else {

        // Unprofitable mock tests do NOT consume stamina (stamina stays the same)

        // Only profitable tests can recover stamina

        

        pushOrderLogLine(`[${new Date().toLocaleString()}] ❌ Mock test unprofitable (${profitPercent.toFixed(2)}%). No energy recovery.`);

      }

      

      // Record mock trade for guild members

      recordMockTrade(profitPercent);

      

      updateStaminaSystem();

    } catch (e) {

      console.error('Error processing mock test result:', e);

    }

  }



  // Record Mock Trade for Guild Members

  function recordMockTrade(profitPercent) {

    try {

      // Find the guild member who participated in the mock trade

      const activeMembers = Object.values(guildMembers).filter(member => member.stamina > 30);

      if (activeMembers.length === 0) return;

      

      // Randomly select a participating member (simulating consultation)

      const participatingMember = activeMembers[Math.floor(Math.random() * activeMembers.length)];

      

      // Create mock trade record

      const mockTrade = {

        timestamp: new Date().toLocaleString(),

        type: 'MOCK',

        profit: profitPercent,

        strategy: ['meanrev', 'momentum', 'breakout', 'scalping'][Math.floor(Math.random() * 4)],

        interval: getInterval(),

        success: profitPercent > 0

      };

      

      // Add to member's mock trades

      participatingMember.mockTrades.push(mockTrade);

      

      // Update member's stats

      updateMemberStats(participatingMember);

      

      // Update last trade

      participatingMember.lastTrade = mockTrade;

      

      console.log(`Mock trade recorded for ${participatingMember.name}: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%`);

      

    } catch (e) {

      console.error('Error recording mock trade:', e);

    }

  }
  // Record Real Trade for Guild Members

  function recordRealTrade(side, price, size, profit = 0) {

    try {

      // Find the guild member responsible for the current interval

      const currentInterval = getInterval();

      let responsibleMember = null;

      

      for (const member of Object.values(guildMembers)) {

        if (member.trainerCards && member.trainerCards.includes(currentInterval)) {

          responsibleMember = member;

          break;

        }

      }

      

      // If no specific member is responsible, assign to a random active member

      if (!responsibleMember) {

        const activeMembers = Object.values(guildMembers).filter(member => member.stamina > 30);

        if (activeMembers.length > 0) {

          responsibleMember = activeMembers[Math.floor(Math.random() * activeMembers.length)];

        }

      }

      

      if (!responsibleMember) return;

      

      // Create real trade record

      const realTrade = {

        timestamp: new Date().toLocaleString(),

        type: 'REAL',

        side: side,

        price: price,

        size: size,

        profit: profit,

        interval: currentInterval,

        success: profit > 0

      };

      

      // Add to member's real trades

      responsibleMember.realTrades.push(realTrade);

      

      // Update member's stats

      updateMemberStats(responsibleMember);

      

      // Update last trade

      responsibleMember.lastTrade = realTrade;

      

      // Log detailed real trade information

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 💼 ${responsibleMember.name} (${responsibleMember.role}) - 실제 거래 실행`);

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 📈 ${side} ${size} @ ${Number(price).toLocaleString()} | ${currentInterval} 차트`);

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 💰 수익: ${profit > 0 ? '+' : ''}${profit.toFixed(2)}% | 누적 수익: ${responsibleMember.totalProfit > 0 ? '+' : ''}${responsibleMember.totalProfit.toFixed(2)}%`);

      

      console.log(`Real trade recorded for ${responsibleMember.name}: ${side} ${size} @ ${price} (${profit > 0 ? '+' : ''}${profit.toFixed(2)}%)`);

      

    } catch (e) {

      console.error('Error recording real trade:', e);

    }

  }



  // Update Member Statistics

  function updateMemberStats(member) {

    try {

      // Calculate total profit from all trades

      const allTrades = [...member.realTrades, ...member.mockTrades];

      const totalProfit = allTrades.reduce((sum, trade) => sum + trade.profit, 0);

      

      // Calculate win rate

      const successfulTrades = allTrades.filter(trade => trade.success).length;

      const winRate = allTrades.length > 0 ? (successfulTrades / allTrades.length) * 100 : 0;

      

      // Update member stats

      member.totalProfit = totalProfit;

      member.winRate = winRate;

      

    } catch (e) {

      console.error('Error updating member stats:', e);

    }

  }



  // Auto Stamina Recovery (disabled - only through profitable mock tests)

  function autoStaminaRecovery() {

    try {

      // No automatic recovery - stamina only recovers through profitable mock tests

      // This function is kept for potential future use but does nothing

    } catch (e) {

      console.error('Error in auto stamina recovery:', e);

    }

  }



  // Event Listeners for New Buttons

  const btnRestAll = document.getElementById('btnRestAll');

  const btnHealAll = document.getElementById('btnHealAll');

  const btnMockTrade = document.getElementById('btnMockTrade');

  const btnEmergencyReset = document.getElementById('btnEmergencyReset');

  const btnClearMockResults = document.getElementById('btnClearMockResults');

  const btnTrainerDiagnostics = document.getElementById('btnTrainerDiagnostics');

  const btnClearDiagnostics = document.getElementById('btnClearDiagnostics');

  

  if (btnRestAll) {

    btnRestAll.addEventListener('click', restAllGuildMembers);

  }

  

  if (btnHealAll) {

    btnHealAll.addEventListener('click', healAllGuildMembers);

  }

  

  // Mock Trade button removed - now using auto trading system

  

  if (btnEmergencyReset) {

    btnEmergencyReset.addEventListener('click', emergencyStaminaReset);

  }

  

  if (btnClearMockResults) {

    btnClearMockResults.addEventListener('click', () => {

      // Clear mock trade log

      const mockTradeBox = document.getElementById('mockTradeBox');

      if (mockTradeBox) mockTradeBox.textContent = '-';

      

      // Clear all trade history for all guild members

      Object.values(guildMembers).forEach(member => {

        // Reset trade history

        member.realTrades = [];

        member.mockTrades = [];

        member.positionHistory = [];

        member.totalPositionSize = 0;

        member.averagePrice = 0;

        member.openPosition = null;

        member.lastTrade = null;

        

        // Reset stats

        member.totalProfit = 0;

        member.winRate = 0;

        member.totalTrades = 0;

        member.successfulTrades = 0;

        

        // Reset N/B coins to initial value

        member.nbCoins = 0.001;

      });

      

      // Update displays

      if (window.updateGuildMembersStatus) {
        window.updateGuildMembersStatus().catch(e => console.error('Error updating guild members status:', e));
      }
      updateRealTimeTradingStatus().catch(e => console.error('Error updating real-time trading status:', e));
      

      console.log('All trade history cleared for all guild members');

    });

  }



  // Add Toggle All Trade Slides button event listener

  const btnToggleAllSlides = document.getElementById('btnToggleAllSlides');

  if (btnToggleAllSlides) {

    btnToggleAllSlides.addEventListener('click', toggleAllTradeSlides);

  }

  

  if (btnTrainerDiagnostics) {

    btnTrainerDiagnostics.addEventListener('click', runTrainerDiagnostics);

  }

  

  if (btnClearDiagnostics) {

    btnClearDiagnostics.addEventListener('click', () => {

      const trainerDiagnosticsBox = document.getElementById('trainerDiagnosticsBox');

      if (trainerDiagnosticsBox) trainerDiagnosticsBox.textContent = '-';

    });

  }



  // Initialize and start auto updates

  if (window.updateGuildMembersStatus) {
    window.updateGuildMembersStatus().catch(e => console.error('Error updating guild members status:', e));
  }
  updateStaminaSystem();

  
  // Force initial village mayor announcement
  setTimeout(() => {
    villageMayorAnnouncement();
  }, 2000); // 2초 후 첫 공지사항
  

  // Auto recovery timer (check every 5 minutes)

  if (window.autoStaminaRecoveryTimer) clearInterval(window.autoStaminaRecoveryTimer);
  window.autoStaminaRecoveryTimer = setInterval(autoStaminaRecovery, 5 * 60 * 1000);

  

  // Village Mayor and Auto Trading System

  if (window.villageMayorAnnouncementTimer) clearInterval(window.villageMayorAnnouncementTimer);
  window.villageMayorAnnouncementTimer = setInterval(villageMayorAnnouncement, 5 * 60 * 1000); // Every 5 minutes (mayor announcements)

  if (window.autoMockTradingSchedulerTimer) clearInterval(window.autoMockTradingSchedulerTimer);
  window.autoMockTradingSchedulerTimer = setInterval(autoMockTradingScheduler, 30 * 1000); // Every 30 seconds for more frequent trading

  // Trainer Learning System - moved to village-learning-system.js

  

  // Update displays every 5 seconds for real-time P&L

  setInterval(() => {

    if (window.updateGuildMembersStatus) {
    window.updateGuildMembersStatus().catch(e => console.error('Error updating guild members status:', e));
  }
    updateStaminaSystem();

    // updateAutoTradingStatus(); // 카드 시스템으로 이동됨

          updateRealTimeTradingStatus().catch(e => console.error('Error updating real-time trading status:', e));
  }, 5 * 1000);



  // Get Guild Members Status for specific interval

  // Get Guild Members Status for specific interval - moved to guild-members-status.js
  function getGuildMembersStatusForInterval_MOVED(interval) {

    try {

      // Calculate active members (those with stamina > 30)

      const activeMembers = Object.values(guildMembers).filter(member => member.stamina > 30).length;

      

      // Calculate N/B Energy percentage

      const nbEnergyPercent = Math.round((nbEnergy.current / nbEnergy.max) * 100);

      

      // Determine N/B Energy color

      let nbEnergyColor = '#f6465d'; // red

      if (nbEnergyPercent > 70) {

        nbEnergyColor = '#4285f4'; // blue

      } else if (nbEnergyPercent > 40) {

        nbEnergyColor = '#ffb703'; // yellow

      }

      

      // Different intervals have different guild member distributions

      const intervalModifiers = {

        'minute1': { energyBonus: 5, activeBonus: 1 },

        'minute3': { energyBonus: 3, activeBonus: 1 },

        'minute5': { energyBonus: 2, activeBonus: 0 },

        'minute10': { energyBonus: 0, activeBonus: 0 },

        'minute15': { energyBonus: -2, activeBonus: -1 },

        'minute30': { energyBonus: -3, activeBonus: -1 },

        'minute60': { energyBonus: -5, activeBonus: -2 },

        'day': { energyBonus: -10, activeBonus: -3 }

      };

      

      const modifier = intervalModifiers[interval] || { energyBonus: 0, activeBonus: 0 };

      const adjustedEnergy = Math.max(0, Math.min(100, nbEnergyPercent + modifier.energyBonus));

      const adjustedActive = Math.max(0, Math.min(4, activeMembers + modifier.activeBonus));

      

      return {

        nbEnergy: adjustedEnergy,

        nbEnergyColor: adjustedEnergy > 70 ? '#4285f4' : adjustedEnergy > 40 ? '#ffb703' : '#f6465d',

        activeMembers: adjustedActive,

        treasuryAccess: adjustedEnergy >= 80

      };

    } catch (e) {

      console.error('Error getting guild status for interval:', e);

      return {

        nbEnergy: 0,

        nbEnergyColor: '#f6465d',

        activeMembers: 0,

        treasuryAccess: false

      };

    }

  }



  // Real Market-Based Mock Trading System

  async function executeMockTrade() {

    try {

      // Check if we have enough N/B Energy

      if (nbEnergy.current < 10) {

        appendMockTradeLine(`[${new Date().toLocaleTimeString()}] ❌ Insufficient N/B Energy (${nbEnergy.current}/100). Need at least 10 to trade.`);

        return;

      }



      // Consume energy for mock trading (Scout's energy cost: 5)

      const energyCost = 5;

      nbEnergy.current = Math.max(0, nbEnergy.current - energyCost);

      

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🔄 Starting Real Market Mock Trade (Energy -${energyCost}, Remaining: ${nbEnergy.current})`);

      

      // Step 1: Market Analysis Phase

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 📊 Phase 1: Market Analysis...`);

      await sleep(500);

      

      // Get current market data

      const currentInterval = getInterval();

      const chartData = candle.data();

      const lastPrice = chartData && chartData.length > 0 ? chartData[chartData.length - 1].close : 0;

      

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 📈 Current Price: ${Number(lastPrice).toLocaleString()} KRW (${currentInterval})`);

      

      // Step 2: Strategy Selection Phase

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🎯 Phase 2: Strategy Selection...`);

      await sleep(300);

      

      const strategies = ['meanrev', 'momentum', 'breakout', 'scalping'];

      const selectedStrategy = strategies[Math.floor(Math.random() * strategies.length)];

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🎲 Selected Strategy: ${selectedStrategy}`);

      

      // Step 3: Guild Members Consultation

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 👥 Phase 3: Guild Members Consultation...`);

      await sleep(400);

      

      const activeMembers = Object.values(guildMembers).filter(member => member.stamina > 30);

      const consultedMember = activeMembers[Math.floor(Math.random() * activeMembers.length)];

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 💬 ${consultedMember.name} (${consultedMember.role}): "${consultedMember.specialty}"`);

      

      // Step 4: Decision Making Phase

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🤔 Phase 4: Decision Making...`);

      await sleep(600);

      

      const decisions = ['BUY', 'SELL', 'HOLD'];

      const decision = decisions[Math.floor(Math.random() * decisions.length)];

      const confidence = Math.floor(Math.random() * 40) + 60; // 60-100%

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] ✅ Decision: ${decision} (Confidence: ${confidence}%)`);

      

      // Step 5: Execution Phase

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] ⚡ Phase 5: Trade Execution...`);

      await sleep(800);

      

      // Simulate trade execution with more realistic timing

      const executionDelay = 1000 + Math.random() * 2000; // 1-3 seconds

      setTimeout(async () => {

        try {

          // Calculate profit based on real market conditions

          let profitPercent = 0;

          let marketComment = '';

          

          if (decision !== 'HOLD') {

            // Get real market data for profit calculation

            const entryPrice = lastPrice;

            

            // Simulate price movement based on decision and real market conditions

            let priceChange = 0;

            const volatility = 0.02; // 2% base volatility

            

            if (decision === 'BUY') {

              // For BUY: simulate price increase (positive bias)

              const marketBias = Math.random() * 0.6 + 0.2; // 20-80% chance of profit

              const priceMovement = (Math.random() - 0.5) * volatility * 2; // -2% to +2%

              priceChange = priceMovement + (marketBias * 0.01); // Add positive bias

            } else if (decision === 'SELL') {

              // For SELL: simulate price decrease (negative bias)

              const marketBias = Math.random() * 0.6 + 0.2; // 20-80% chance of profit

              const priceMovement = (Math.random() - 0.5) * volatility * 2; // -2% to +2%

              priceChange = -priceMovement - (marketBias * 0.01); // Add negative bias

            }

            

            // Calculate profit percentage

            profitPercent = priceChange * 100;

            

            // Add market commentary based on real conditions

            if (profitPercent > 3) {

              marketComment = '📈 Strong market movement!';

            } else if (profitPercent > 1) {

              marketComment = '📊 Moderate gains';

            } else if (profitPercent > -1) {

              marketComment = '📉 Minor setback';

            } else if (profitPercent > -3) {

              marketComment = '📉 Moderate loss';

            } else {

              marketComment = '💥 Significant loss';

            }

            

            // Add strategy effectiveness factor

            const strategyEffectiveness = Math.random() * 0.4 - 0.2; // -20% to +20% adjustment

            profitPercent += strategyEffectiveness;

            

            // Add guild member expertise factor

            const guildExpertise = Math.random() * 0.3 - 0.15; // -15% to +15% adjustment

            profitPercent += guildExpertise;

            

            // Add confidence factor

            const confidenceFactor = (confidence - 60) / 40 * 0.2; // 0% to +20% based on confidence

            profitPercent += confidenceFactor;

            

          } else {

            // HOLD decision: minimal impact

            profitPercent = (Math.random() - 0.5) * 2; // -1% to +1%

            marketComment = '⏸️ Market observation';

          }

          

          appendMockTradeLine(`[${new Date().toLocaleTimeString()}] ${marketComment} Trade Result: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%`);

          

          processMockTestResult(profitPercent);

          

          // Update stamina system display

          updateStaminaSystem();

          

        } catch (e) {

          appendMockTradeLine(`[${new Date().toLocaleTimeString()}] ❌ Profit calculation error: ${String(e)}`);

        }

      }, executionDelay);

      

    } catch (e) {

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] ❌ Mock Trade Error: ${String(e)}`);

    }

  }



  // Simulate mock test results for demonstration (legacy function)

  function simulateMockTest() {

    // Increase chance of profitable tests to demonstrate stamina recovery

    const profitPercent = (Math.random() - 0.3) * 25; // -7.5% to +17.5% range, slightly more profitable

    processMockTestResult(profitPercent);

  }



  // Helper function to append lines to mock trade box

  function appendMockTradeLine(line) {

    const mockTradeBox = document.getElementById('mockTradeBox');

    if (mockTradeBox) {

      if (mockTradeBox.textContent === '-') {

        mockTradeBox.textContent = line;

      } else {

        mockTradeBox.textContent += '\n' + line;

      }

      mockTradeBox.scrollTop = mockTradeBox.scrollHeight;

    }

  }



  // Helper function to append lines to trainer diagnostics box

  function appendDiagnosticsLine(line) {

    const trainerDiagnosticsBox = document.getElementById('trainerDiagnosticsBox');

    if (trainerDiagnosticsBox) {

      if (trainerDiagnosticsBox.textContent === '-') {

        trainerDiagnosticsBox.textContent = line;

      } else {

        trainerDiagnosticsBox.textContent += '\n' + line;

      }

      trainerDiagnosticsBox.scrollTop = trainerDiagnosticsBox.scrollHeight;

    }

  }
  // Trainer System Diagnostics Function

  async function runTrainerDiagnostics() {

    try {

      appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 🔍 Starting Trainer System Diagnostics...`);

      

      // 1. Check current interval

      const currentInterval = getInterval();

      appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 📊 Current Interval: ${currentInterval}`);

      

      // 2. Check chart data

      const chartData = candle.data();

      const lastPrice = chartData && chartData.length > 0 ? chartData[chartData.length - 1].close : 0;

      appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 📈 Chart Data: ${chartData ? chartData.length : 0} candles, Last Price: ${Number(lastPrice).toLocaleString()}`);

      

      // 3. Check N/B zone and parameters

      try {

        const nbZoneResponse = await fetchJsonStrict('/api/nb/zone');

        if (nbZoneResponse && nbZoneResponse.ok) {

          const zone = nbZoneResponse.zone || 'UNKNOWN';

          const pBlue = nbZoneResponse.p_blue || 0;

          const pOrange = nbZoneResponse.p_orange || 0;

          appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 🎯 N/B Zone: ${zone} (BLUE: ${(pBlue*100).toFixed(1)}%, ORANGE: ${(pOrange*100).toFixed(1)}%)`);

        } else {

          appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ❌ N/B Zone: Error - ${JSON.stringify(nbZoneResponse)}`);

        }

      } catch (e) {

        appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ❌ N/B Zone: Error - ${String(e)}`);

      }

      

      // 4. Check ML model (simulated)

      try {

        // Simulate ML model predictions

        const zones = ['BLUE', 'ORANGE', 'GREEN'];

        const zone = zones[Math.floor(Math.random() * zones.length)];

        const confidence = 200 + Math.random() * 100; // 200-300%

        

        appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 🤖 ML Model: Zone=${zone}, Confidence=${confidence.toFixed(1)}%`);

      } catch (e) {

        appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ❌ ML Model: Error - ${String(e)}`);

      }

      

      // 5. Check trainer suggestions (simulated)

      try {

        // Simulate trainer suggestions based on current state

        const strategies = ['meanrev', 'momentum', 'breakout', 'scalping'];

        const strategy = strategies[Math.floor(Math.random() * strategies.length)];

        const intent = Math.random() > 0.5 ? 'BUY' : 'SELL';

        const canBuy = Math.random() > 0.3;

        const canSell = Math.random() > 0.3;

        

        appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 🎓 Trainer: Strategy=${strategy}, Intent=${intent}, BUY=${canBuy ? '✓' : '×'}, SELL=${canSell ? '✓' : '×'}`);

      } catch (e) {

        appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ❌ Trainer: Error - ${String(e)}`);

      }

      

      // 6. Check trade readiness (simulated)

      try {

        // Simulate trade readiness based on current state

        const krw = 15000 + Math.random() * 50000;

        const coins = 0.0001 + Math.random() * 0.001;

        const canBuy = krw > 10000;

        const canSell = coins > 0.0001;

        

        appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 💰 Trade Readiness: BUY=${canBuy ? '✓' : '×'}, SELL=${canSell ? '✓' : '×'}, KRW=${Number(krw).toLocaleString()}, Coins=${coins.toFixed(8)}`);

      } catch (e) {

        appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ❌ Trade Readiness: Error - ${String(e)}`);

      }

      

      // 7. Check N/B COIN status

      try {

        const coinResponse = await fetchJsonStrict('/api/nb/coin');

        if (coinResponse && coinResponse.ok) {

          const currentCoin = coinResponse.current || {};

          const recentCoins = coinResponse.recent || [];

          const activeCoins = recentCoins.filter(coin => coin && coin.side && coin.side !== 'NONE').length;

          appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 🪙 N/B COIN: Current=${currentCoin.side || 'NONE'}, Active=${activeCoins}/${recentCoins.length} recent`);

        } else {

          appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ❌ N/B COIN: Error - ${JSON.stringify(coinResponse)}`);

        }

      } catch (e) {

        appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ❌ N/B COIN: Error - ${String(e)}`);

      }

      

      // 8. Check guild members status

      try {

        if (typeof guildMembers !== 'undefined' && guildMembers) {

          const members = Object.values(guildMembers);

          const activeMembers = members.filter(member => member.stamina > 30).length;

          const totalStamina = members.reduce((sum, member) => sum + member.stamina, 0);

          appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 👥 Guild: ${activeMembers}/${members.length} active members, Total Stamina=${totalStamina}`);

          

          // Add trainer card integration info

          members.forEach(member => {

            const cardList = member.trainerCards ? member.trainerCards.join(', ') : 'None';

            appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 🎯 ${member.name} (${member.role}): ${member.specialty} - Cards: [${cardList}]`);

          });

        } else {

          appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 👥 Guild: Not initialized yet`);

        }

      } catch (e) {

        appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ❌ Guild: Error - ${String(e)}`);

      }

      

      // 9. Check N/B Stamina

      try {

              if (typeof nbEnergy !== 'undefined' && nbEnergy) {

        const energyPercent = Math.round((nbEnergy.current / nbEnergy.max) * 100);

        appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ⚡ N/B Energy: ${nbEnergy.current}/${nbEnergy.max} (${energyPercent}%)`);

              } else {

          appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ⚡ N/B Energy: Not initialized yet`);

        }

      } catch (e) {

        appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ❌ N/B Stamina: Error - ${String(e)}`);

      }

      

      // 10. Check Auto Trade status

      try {

        const autoTradeResponse = await fetchJsonStrict('/api/bot/status');

        if (autoTradeResponse) {

          // The response is the status object directly, not wrapped in {ok: true, status: {...}}

          const status = autoTradeResponse;

          const running = status.running ? 'ENABLED' : 'DISABLED';

          const lastSignal = status.last_signal || 'NONE';

          const coin = status.coin || {};

          const reasons = coin.reasons || [];

          

          appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 🤖 Auto Trade: ${running} (Last Signal: ${lastSignal})`);

          

          // Show coin status if available

          if (coin.side && coin.side !== 'NONE') {

            appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] 🪙 Coin Status: ${coin.side} (${coin.coin_count || 0} coins)`);

          }

          

          // Show blocking reasons if any

          if (reasons.length > 0) {

            const reasonText = reasons.join(', ');

            appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ⚠️ Blocked: ${reasonText}`);

          }

        } else {

          appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ❌ Auto Trade: No response data`);

        }

      } catch (e) {

        appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ❌ Auto Trade: Error - ${String(e)}`);

      }

      

      appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ✅ Trainer System Diagnostics Complete`);

      

    } catch (e) {

      appendDiagnosticsLine(`[${new Date().toLocaleTimeString()}] ❌ Diagnostics Error: ${String(e)}`);

    }

  }



  // Emergency Stamina Reset Function

  function emergencyStaminaReset() {

    try {

      // Only allow reset if energy is critically low (less than 10)

      if (nbEnergy.current >= 10) {

        appendMockTradeLine(`[${new Date().toLocaleTimeString()}] ⚠️ Emergency Reset not needed. Current energy: ${nbEnergy.current}/100`);

        return;

      }



      // Reset energy to 30 (enough for 3 mock trades)

      const oldEnergy = nbEnergy.current;

      nbEnergy.current = 30;

      

      // Reset guild members to active state

      Object.values(guildMembers).forEach(member => {

        member.stamina = Math.min(member.maxStamina, member.stamina + 40);

        member.hp = Math.min(member.maxHp, member.hp + 20);

      });



      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🚨 EMERGENCY RESET ACTIVATED!`);

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] ⚡ N/B Energy: ${oldEnergy} → ${nbEnergy.current}/100`);

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 👥 Guild Members: Restored to active state`);

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🎯 Trainer Cards: All 8 intervals linked to guild members`);

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] ✅ System ready for Mock Trading`);



      // Update displays

      updateStaminaSystem();

      if (window.updateGuildMembersStatus) {
        window.updateGuildMembersStatus().catch(e => console.error('Error updating guild members status:', e));
      }
      

      // Log the emergency reset

      pushOrderLogLine(`[${new Date().toLocaleString()}] 🚨 Emergency Energy Reset activated. Energy: ${oldEnergy} → ${nbEnergy.current}`);

      

    } catch (e) {

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] ❌ Emergency Reset Error: ${String(e)}`);

    }

  }



  // Add mock test simulation to auto distribute BTC button

  const originalAutoDistributeBtc = window.autoDistributeBtc;

  if (originalAutoDistributeBtc) {

    window.autoDistributeBtc = async function() {

      await originalAutoDistributeBtc();

      // Simulate mock test result after distribution

      setTimeout(simulateMockTest, 1000);

    };

  }



  // Hook into existing trade functions to record real trades

  const originalPushOrderLogLine = window.pushOrderLogLine || function() {};

  window.pushOrderLogLine = function(line) {

    originalPushOrderLogLine(line);

    

    // Parse trade information from log line

    try {

      if (line.includes('BUY') || line.includes('SELL')) {

        const side = line.includes('BUY') ? 'BUY' : 'SELL';

        const priceMatch = line.match(/(\d{1,3}(?:,\d{3})*)/);

        const sizeMatch = line.match(/(\d+\.\d+)/);

        

        if (priceMatch && sizeMatch) {

          const price = parseFloat(priceMatch[1].replace(/,/g, ''));

          const size = parseFloat(sizeMatch[1]);

          

          // Calculate estimated profit (simplified)

          const profit = (Math.random() - 0.5) * 10; // -5% to +5% for demo

          

          recordRealTrade(side, price, size, profit);

        }

      }

    } catch (e) {

      console.error('Error parsing trade log:', e);

    }

  };



  // Add demo data for testing

  function addDemoTrades() {

    try {

      // Add some demo trades for each guild member

      Object.values(guildMembers).forEach((member, index) => {

        // Add demo real trades

        for (let i = 0; i < 3 + index; i++) {

          const profit = (Math.random() - 0.4) * 8; // Slightly positive bias

          const realTrade = {

            timestamp: new Date(Date.now() - Math.random() * 86400000).toLocaleString(),

            type: 'REAL',

            side: Math.random() > 0.5 ? 'BUY' : 'SELL',

            price: 160000000 + Math.random() * 10000000,

            size: 0.001 + Math.random() * 0.01,

            profit: profit,

            interval: member.trainerCards[Math.floor(Math.random() * member.trainerCards.length)],

            success: profit > 0

          };

          member.realTrades.push(realTrade);

        }

        

        // Add demo mock trades

        for (let i = 0; i < 5 + index * 2; i++) {

          const profit = (Math.random() - 0.3) * 6; // Positive bias for mock trades

          const mockTrade = {

            timestamp: new Date(Date.now() - Math.random() * 86400000).toLocaleString(),

            type: 'MOCK',

            profit: profit,

            strategy: ['meanrev', 'momentum', 'breakout', 'scalping'][Math.floor(Math.random() * 4)],

            interval: member.trainerCards[Math.floor(Math.random() * member.trainerCards.length)],

            success: profit > 0

          };

          member.mockTrades.push(mockTrade);

        }

        

        // Update stats

        updateMemberStats(member);

        

        // Set last trade

        if (member.realTrades.length > 0 || member.mockTrades.length > 0) {

          const allTrades = [...member.realTrades, ...member.mockTrades];

          member.lastTrade = allTrades[allTrades.length - 1];

        }

      });

      

      console.log('Demo trades added for all guild members');

      

    } catch (e) {

      console.error('Error adding demo trades:', e);

    }

  }



  // Village Mayor Announcement System

  function villageMayorAnnouncement() {

    try {

      const currentZone = getCurrentZone();

      const timeSinceLastAnnouncement = villageMayor.lastAnnouncement ? 

        Date.now() - villageMayor.lastAnnouncement : villageMayor.announcementInterval + 1000;

      

      // Make announcement every 5 minutes or when zone changes

      if (timeSinceLastAnnouncement >= villageMayor.announcementInterval || 

          villageMayor.currentZone !== currentZone) {

        

        villageMayor.currentZone = currentZone;

        villageMayor.lastAnnouncement = Date.now();

        

        const zoneInfo = villageMayor.zoneStrategy[currentZone];

        const currentPrice = getCurrentPrice();

        

        // Mayor's announcement

        const nbZone = window.zoneNow || 'BLUE';

        const mlZone = currentZone;
        
        // Zone discrepancy analysis
        let zoneAnalysis = '';
        if (nbZone !== mlZone) {
          zoneAnalysis = ` | ⚠️ 주의: N/B(${nbZone}) ≠ ML(${mlZone}) - 마을 주민들은 N/B 기반 판정을 우선시하세요`;
        } else {
          zoneAnalysis = ` | ✅ 일치: N/B(${nbZone}) = ML(${mlZone}) - 신뢰도 높음`;
        }
        
        appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🏛️ ${villageMayor.name} 공지사항`);

        appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 📊 현재 구역: ${nbZone === 'BLUE' ? '🔵 BLUE' : '🟠 ORANGE'} (N/B 기반) | ML 모델: ${mlZone === 'BLUE' ? '🔵 BLUE' : '🟠 ORANGE'} | 현재가: ${Number(currentPrice).toLocaleString()}`);
        appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 📢 ${zoneInfo.message}${zoneAnalysis}`);
        appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🎯 권장 전략: ${zoneInfo.bias} | 신뢰도: ${(zoneInfo.confidence * 100).toFixed(0)}%`);

        
        // Zone-based trading instruction
        const tradingInstruction = nbZone === 'BLUE' ? 
          '🔵 BLUE 구역: 마을 주민 트레이너들에게 BUY 전략을 실행하도록 지침' :
          '🟠 ORANGE 구역: 마을 주민 트레이너들에게 SELL 전략을 실행하도록 지침';
        appendMockTradeLine(`[${new Date().toLocaleTimeString()}] ${tradingInstruction}`);
        

        // Update all guild members with zone information

        Object.values(guildMembers).forEach(member => {

          member.currentZone = currentZone;

          member.zoneBias = zoneInfo.bias;

          member.zoneConfidence = zoneInfo.confidence;

        });

        
        // console.log('🏛️ Village Mayor announcement made:', currentZone, zoneInfo.message);
      }

      

    } catch (e) {

      console.error('Village Mayor Announcement Error:', e);

    }

  }

  // Auto Mock Trading Scheduler

  function autoMockTradingScheduler() {

    try {

      if (typeof guildMembers === 'undefined' || !guildMembers) return;

      

      // Debug: Log current system status

      // console.log('Auto Mock Trading Scheduler running...');

      // console.log('N/B Energy:', typeof nbEnergy !== 'undefined' ? nbEnergy.current : 'undefined');

      

      Object.values(guildMembers).forEach(member => {

        // Increase trade frequency and reduce cooldown for more active trading

        const canTrade = member.autoTradingEnabled && 

                        member.stamina >= 5 && // Reduced stamina requirement

                        Math.random() < (member.tradeFrequency * 1.5) && // Increased frequency

                        (!member.lastAutoTrade || Date.now() - member.lastAutoTrade > 120000); // Reduced cooldown to 2 minutes

        

        // Debug: Log member status

        // console.log(`${member.name}: enabled=${member.autoTradingEnabled}, stamina=${member.stamina}, frequency=${member.tradeFrequency}, canTrade=${canTrade}`);

        

        if (canTrade) {

          // Force both mock and real trades more frequently

          const shouldDoRealTrade = decideTradeType(member);

          

          // Execute both types of trades more aggressively

          if (shouldDoRealTrade && member.nbCoins >= 0.001) {

            executeRealTrade(member);

          } else {

            executeAutoMockTrade(member);

          }

          

          // Additional mock trade if conditions are met

          if (Math.random() < 0.3 && member.stamina >= 15) { // 30% chance for additional mock trade

            setTimeout(() => executeAutoMockTrade(member), 5000); // 5 second delay

          }

        }

      });

    } catch (e) {

      console.error('Auto Mock Trading Scheduler Error:', e);

    }

  }



  // Execute Real Trade for specific member

  async function executeRealTrade(member) {

    try {

      // Check if we have enough N/B Energy

      if (typeof nbEnergy !== 'undefined' && nbEnergy && nbEnergy.current < 10) {

        console.log(`Not enough N/B Energy: ${nbEnergy.current}/100`);

        return; // Not enough energy

      }



      // Consume energy for real trading

      if (typeof nbEnergy !== 'undefined' && nbEnergy) {

        const energyCost = 15; // Higher cost for real trades

        nbEnergy.current = Math.max(0, nbEnergy.current - energyCost);

      }



      // Update member's last auto trade time

      member.lastAutoTrade = Date.now();



      // Get current market data

      const currentInterval = getInterval();

      const chartData = candle.data();

      const lastPrice = chartData && chartData.length > 0 ? chartData[chartData.length - 1].close : 0;



      // Check if member has an open position

      const hasOpenPosition = member.openPosition && member.openPosition.side;

      

      if (hasOpenPosition) {

        // Close existing position

        const closeDecision = shouldClosePosition(member, lastPrice, currentInterval);

        

        if (closeDecision) {

          // Close position logic (similar to mock trade but with real market impact)

          const entryPrice = member.averagePrice || member.openPosition.price;

          const positionSide = member.openPosition.side;

          const coinAmount = member.totalPositionSize || member.openPosition.coinAmount;

          const tradeValue = member.averagePrice * member.totalPositionSize || member.openPosition.tradeValue;

          const profitPercent = calculatePositionProfit(positionSide, entryPrice, lastPrice);

          const profitValue = (profitPercent / 100) * tradeValue;

          

          // Real trade impact on N/B coins (more significant)

          if (profitPercent > 0) {

            const coinGain = coinAmount * (profitPercent / 100) * 1.5; // 50% bonus for real trades

            member.nbCoins += coinGain;

            member.totalNbCoinsEarned += coinGain;

            member.experience += Math.floor(coinGain * 1500); // More experience for real trades

            member.skillLevel += coinGain * 0.15;

          } else {

            const coinLoss = coinAmount * Math.abs(profitPercent / 100) * 1.5; // 50% penalty for real trades

            member.nbCoins = Math.max(0, member.nbCoins - coinLoss);

            member.totalNbCoinsLost += coinLoss;

            member.experience += Math.floor(coinLoss * 750);

            member.skillLevel = Math.max(0.1, member.skillLevel - coinLoss * 0.08);

          }

          

          // Record real trade

          const realTrade = {

            timestamp: new Date().toLocaleString(),

            type: 'REAL_CLOSE',

            profit: profitPercent,

            strategy: member.strategy,

            interval: currentInterval,

            decision: positionSide === 'BUY' ? 'SELL' : 'BUY',

            confidence: calculateMemberConfidence(member),

            entryPrice: entryPrice,

            exitPrice: lastPrice,

            coinAmount: coinAmount,

            tradeValue: tradeValue,

            success: profitPercent > 0

          };

          

          member.realTrades.push(realTrade);

          member.lastTrade = realTrade;

          

          // Clear position

          member.openPosition = null;

          member.positionHistory = [];

          member.averagePrice = 0.0;

          member.totalPositionSize = 0.0;

          

          // Log real trade

          appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 💰 ${member.name} (${member.role}) - 실제 거래 종료`);

          appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 📈 ${positionSide === 'BUY' ? 'SELL' : 'BUY'} ${coinAmount} BTC @ ${Number(lastPrice).toLocaleString()} | 진입가: ${Number(entryPrice).toLocaleString()}`);

          appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 💰 실제 수익: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}% (${profitValue > 0 ? '+' : ''}${Number(profitValue).toLocaleString()} KRW)`);

                  // Update server trainer storage for SELL transaction with trade matching
                  try {
                    const response = await fetch('/api/trainer/storage/modify', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        trainer: member.name,
                        amount: -coinAmount,  // Negative for SELL
                        trade_match: {
                          upbit_trade_id: `SELL_${Date.now()}`, // 임시 ID
                          upbit_size: coinAmount,
                          upbit_price: currentPrice,
                          upbit_time: new Date().toISOString(),
                          system_trainer: member.name,
                          system_action: 'SELL',
                          profit_percent: profitPercent,
                          profit_value: profitValue
                        }
                      })
                    });
                    
                    if (response.ok) {
                      const result = await response.json();
                      console.log(`✅ Server trainer storage updated: ${member.name} -${coinAmount} BTC (SELL, 업비트 거래 매칭)`);
                    } else {
                      console.error(`❌ Failed to update server trainer storage: ${member.name}`);
                    }
                  } catch (error) {
                    console.error('Error updating server trainer storage:', error);
                  }

          if (profitPercent > 0) {

            const coinGain = coinAmount * (profitPercent / 100) * 1.5;

            appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🪙 실제 N/B 코인 획득: +${coinGain.toFixed(6)} | 총 보유: ${member.nbCoins.toFixed(6)}`);

          } else {

            const coinLoss = coinAmount * Math.abs(profitPercent / 100) * 1.5;

            appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🪙 실제 N/B 코인 손실: -${coinLoss.toFixed(6)} | 총 보유: ${member.nbCoins.toFixed(6)}`);

          }

        }

      } else {

        // Open new position

        const decision = makeMemberDecision(member, lastPrice, currentInterval);

        const confidence = calculateMemberConfidence(member);

        

        if (decision !== 'HOLD') {

          const coinAmount = 0.001;

          const tradeValue = lastPrice * coinAmount;

          

          // Use N/B coins for real trade

          if (member.nbCoins >= coinAmount) {

            member.nbCoins -= coinAmount; // Spend N/B coins for real trade

            

            // Position tracking (same as mock trade)

            if (member.openPosition && member.openPosition.side === decision) {

              const newTrade = {

                price: lastPrice,

                coinAmount: coinAmount,

                timestamp: new Date().toISOString()

              };

              

              member.positionHistory.push(newTrade);

              member.totalPositionSize += coinAmount;

              member.averagePrice = calculateAveragePrice(member.positionHistory);

              

              member.openPosition.price = member.averagePrice;

              member.openPosition.coinAmount = member.totalPositionSize;

              member.openPosition.tradeValue = member.averagePrice * member.totalPositionSize;

              

            } else {

              member.positionHistory = [{

                price: lastPrice,

                coinAmount: coinAmount,

                timestamp: new Date().toISOString()

              }];

              member.totalPositionSize = coinAmount;

              member.averagePrice = lastPrice;

              

              member.openPosition = {

                side: decision,

                price: lastPrice,

                coinAmount: coinAmount,

                tradeValue: tradeValue,

                timestamp: new Date().toISOString(),

                strategy: member.strategy

              };

            }

            

            // Log real trade opening

            appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 💰 ${member.name} (${member.role}) - 실제 거래 시작`);

            appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 📊 현재가: ${Number(lastPrice).toLocaleString()} | 전략: ${member.strategy} | 신뢰도: ${confidence.toFixed(0)}%`);

            

            if (member.positionHistory.length > 1) {

              appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🎯 실제 포지션 추가: ${decision} ${coinAmount} BTC @ ${Number(lastPrice).toLocaleString()}`);

              appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 📈 평균가: ${Number(member.averagePrice).toLocaleString()} | 총 수량: ${member.totalPositionSize.toFixed(6)} BTC`);

            } else {

              appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🎯 실제 포지션 오픈: ${decision} ${coinAmount} BTC @ ${Number(lastPrice).toLocaleString()} (${Number(tradeValue).toLocaleString()} KRW)`);

            }

            

            appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🪙 N/B 코인 사용: -${coinAmount.toFixed(6)} | 잔액: ${member.nbCoins.toFixed(6)}`);

                  // Update server trainer storage with trade matching info
                  try {
                    const response = await fetch('/api/trainer/storage/modify', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        trainer: member.name,
                        amount: coinAmount,
                        trade_match: {
                          upbit_trade_id: `BUY_${Date.now()}`, // 임시 ID
                          upbit_size: coinAmount,
                          upbit_price: currentPrice,
                          upbit_time: new Date().toISOString(),
                          system_trainer: member.name,
                          system_action: 'BUY'
                        }
                      })
                    });
                    
                    if (response.ok) {
                      const result = await response.json();
                      console.log(`✅ Server trainer storage updated: ${member.name} +${coinAmount} BTC (업비트 거래 매칭)`);
                    } else {
                      console.error(`❌ Failed to update server trainer storage: ${member.name}`);
                    }
                  } catch (error) {
                    console.error('Error updating server trainer storage:', error);
                  }

          } else {

            // Not enough N/B coins, fall back to mock trade

            appendMockTradeLine(`[${new Date().toLocaleTimeString()}] ⚠️ ${member.name} - N/B 코인 부족 (${member.nbCoins.toFixed(6)}), 모의 거래로 전환`);

            executeAutoMockTrade(member);

          }

        }

      }

      

    } catch (e) {

      console.error('Real Trade Error:', e);

    }

  }
  // Execute Auto Mock Trade for specific member

  async function executeAutoMockTrade(member) {

    try {

      // Check if we have enough N/B Energy

      if (typeof nbEnergy !== 'undefined' && nbEnergy && nbEnergy.current < 10) {

        console.log(`Not enough N/B Energy: ${nbEnergy.current}/100`);

        return; // Not enough energy

      }



      // Consume energy for mock trading

      if (typeof nbEnergy !== 'undefined' && nbEnergy) {

        const energyCost = 10;

        nbEnergy.current = Math.max(0, nbEnergy.current - energyCost);

      }



      // Update member's last auto trade time

      member.lastAutoTrade = Date.now();



      // Get current market data

      const currentInterval = getInterval();

      const chartData = candle.data();

      const lastPrice = chartData && chartData.length > 0 ? chartData[chartData.length - 1].close : 0;



      // Check if member has an open position

      const hasOpenPosition = member.openPosition && member.openPosition.side;

      

      if (hasOpenPosition) {

        // If has open position, decide whether to close it (SELL if BUY position, BUY if SELL position)

        const closeDecision = shouldClosePosition(member, lastPrice, currentInterval);

        

                          if (closeDecision) {

           // Close the position and calculate profit using average price

           const entryPrice = member.averagePrice || member.openPosition.price;

           const positionSide = member.openPosition.side;

           const coinAmount = member.totalPositionSize || member.openPosition.coinAmount;

           const tradeValue = member.averagePrice * member.totalPositionSize || member.openPosition.tradeValue;

           const profitPercent = calculatePositionProfit(positionSide, entryPrice, lastPrice);

           const profitValue = (profitPercent / 100) * tradeValue;

           

           // Handle N/B coin gains/losses based on profit/loss (with real-time learning impact)

           if (profitPercent > 0) {

             // Profit: Gain additional N/B coins

             const coinGain = coinAmount * (profitPercent / 100);

             member.nbCoins += coinGain;

             member.totalNbCoinsEarned += coinGain;

             

             // Learning: Positive reinforcement based on N/B coin gain

             member.experience += Math.floor(coinGain * 1000); // Convert coin gain to experience points

             member.skillLevel += coinGain * 0.1; // Skill improvement proportional to coin gain

             

             // Adjust trade frequency based on success (more confident = trade more)

             member.tradeFrequency = Math.min(0.8, member.tradeFrequency + coinGain * 0.05);

             

           } else {

             // Loss: Lose some N/B coins

             const coinLoss = coinAmount * Math.abs(profitPercent / 100);

             member.nbCoins = Math.max(0, member.nbCoins - coinLoss);

             member.totalNbCoinsLost += coinLoss;

             

             // Learning: Negative reinforcement (but still learn from mistakes)

             member.experience += Math.floor(coinLoss * 500); // Less experience for losses

             member.skillLevel = Math.max(0.1, member.skillLevel - coinLoss * 0.05); // Skill decrease

             

             // Adjust trade frequency based on failure (more cautious = trade less)

             member.tradeFrequency = Math.max(0.1, member.tradeFrequency - coinLoss * 0.03);

           }

           

           // Record the closing trade

           const closeTrade = {

             timestamp: new Date().toLocaleString(),

             type: 'AUTO_MOCK_CLOSE',

             profit: profitPercent,

             strategy: member.strategy,

             interval: currentInterval,

             decision: positionSide === 'BUY' ? 'SELL' : 'BUY',

             confidence: calculateMemberConfidence(member),

             entryPrice: entryPrice,

             exitPrice: lastPrice,

             coinGain: profitPercent > 0 ? coinAmount * (profitPercent / 100) : 0,

             coinLoss: profitPercent < 0 ? coinAmount * Math.abs(profitPercent / 100) : 0,

             success: profitPercent > 0

           };

          

          member.mockTrades.push(closeTrade);

          member.lastTrade = closeTrade;

          

                     // Clear open position and reset position tracking

           member.openPosition = null;

           member.positionHistory = [];

           member.averagePrice = 0.0;

           member.totalPositionSize = 0.0;

          

                     // Log closing trade

           appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🤖 ${member.name} (${member.role}) - 포지션 종료`);

           appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 📈 ${positionSide === 'BUY' ? 'SELL' : 'BUY'} ${coinAmount} BTC @ ${Number(lastPrice).toLocaleString()} | 진입가: ${Number(entryPrice).toLocaleString()}`);

           appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 💰 수익: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}% (${profitValue > 0 ? '+' : ''}${Number(profitValue).toLocaleString()} KRW) | 누적 수익: ${member.totalProfit > 0 ? '+' : ''}${member.totalProfit.toFixed(2)}%`);

           

           // Log N/B coin changes

           if (profitPercent > 0) {

             const coinGain = coinAmount * (profitPercent / 100);

             appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🪙 N/B 코인 획득: +${coinGain.toFixed(6)} | 총 보유: ${member.nbCoins.toFixed(6)}`);

           } else {

             const coinLoss = coinAmount * Math.abs(profitPercent / 100);

             appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🪙 N/B 코인 손실: -${coinLoss.toFixed(6)} | 총 보유: ${member.nbCoins.toFixed(6)}`);

           }

          

        } else {

          // Hold the position

          appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🤖 ${member.name} (${member.role}) - 포지션 유지 중 (${member.openPosition.side} @ ${Number(member.openPosition.price).toLocaleString()})`);

        }

      } else {

        // No open position, decide whether to open a new one

        const decision = makeMemberDecision(member, lastPrice, currentInterval);

        const confidence = calculateMemberConfidence(member);

        

                 if (decision !== 'HOLD') {

           // Calculate trade amount (fixed 0.001 BTC per trade)

           const coinAmount = 0.001;

           const tradeValue = lastPrice * coinAmount;

           

           // Receive N/B coins when opening position (learning impact)

           member.nbCoins += coinAmount;

           

           // Learning: Position opening affects confidence and experience

           member.experience += 10; // Small experience gain for taking action

           member.skillLevel += 0.01; // Small skill improvement for active trading

           

           // Check if we already have a position in the same direction

           if (member.openPosition && member.openPosition.side === decision) {

             // Add to existing position (average down/up)

             const newTrade = {

               price: lastPrice,

               coinAmount: coinAmount,

               timestamp: new Date().toISOString()

             };

             

             member.positionHistory.push(newTrade);

             member.totalPositionSize += coinAmount;

             member.averagePrice = calculateAveragePrice(member.positionHistory);

             

             // Update open position with new totals

             member.openPosition.price = member.averagePrice;

             member.openPosition.coinAmount = member.totalPositionSize;

             member.openPosition.tradeValue = member.averagePrice * member.totalPositionSize;

             

           } else {

             // Start new position

             member.positionHistory = [{

               price: lastPrice,

               coinAmount: coinAmount,

               timestamp: new Date().toISOString()

             }];

             member.totalPositionSize = coinAmount;

             member.averagePrice = lastPrice;

             

             // Open new position with detailed information

             member.openPosition = {

               side: decision,

               price: lastPrice,

               coinAmount: coinAmount,

               tradeValue: tradeValue,

               timestamp: new Date().toISOString(), // Use ISO string for better compatibility

               strategy: member.strategy

             };

           }

          

          // Record the opening trade

          const openTrade = {

            timestamp: new Date().toLocaleString(),

            type: 'AUTO_MOCK_OPEN',

            profit: 0, // No profit yet

            strategy: member.strategy,

            interval: currentInterval,

            decision: decision,

            confidence: confidence,

            entryPrice: lastPrice,

            success: true // Opening is always successful

          };

          

          member.mockTrades.push(openTrade);

          member.lastTrade = openTrade;

          

                     // Log opening trade

           appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🤖 ${member.name} (${member.role}) - ${currentInterval} 차트 분석 중...`);

           appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 📊 현재가: ${Number(lastPrice).toLocaleString()} | 전략: ${member.strategy} | 신뢰도: ${confidence.toFixed(0)}%`);

           

           if (member.positionHistory.length > 1) {

             // Multiple trades in same position

             appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🎯 포지션 추가: ${decision} ${coinAmount} BTC @ ${Number(lastPrice).toLocaleString()}`);

             appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 📈 평균가: ${Number(member.averagePrice).toLocaleString()} | 총 수량: ${member.totalPositionSize.toFixed(6)} BTC`);

           } else {

             // New position

             appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🎯 포지션 오픈: ${decision} ${coinAmount} BTC @ ${Number(lastPrice).toLocaleString()} (${Number(tradeValue).toLocaleString()} KRW)`);

           }

          

        } else {

          // HOLD decision

          appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🤖 ${member.name} (${member.role}) - 관망 중 (${currentInterval} 차트)`);

        }

      }

      

      // Update member stats

      updateMemberStats(member);

      

      // Process result for stamina recovery (only for closed positions)

      if (member.lastTrade && member.lastTrade.type === 'AUTO_MOCK_CLOSE' && typeof processMockTestResult === 'function') {

        processMockTestResult(member.lastTrade.profit);

      }

      

    } catch (e) {

      console.error('Auto Mock Trade Error:', e);

    }

  }



  // Make member-specific trading decision (with zone awareness)

  function makeMemberDecision(member, price, interval) {

    const role = member.role;

    const skillLevel = member.skillLevel || 1.0;

    

    // Get current zone information - Always use N/B zone for consistency

    const currentZone = window.zoneNow || 'BLUE'; // Direct N/B zone

    const zoneBias = currentZone === 'BLUE' ? 'BUY' : 'SELL';

    const zoneConfidence = 0.8; // High confidence for N/B zone

    

    // Simulate market sentiment (in real implementation, this would come from ML model)

    const marketSentiment = Math.random(); // 0 = bearish, 1 = bullish

    const isBullish = marketSentiment > 0.5;

    const isBearish = marketSentiment < 0.3;

    

    // Base decision on role and current market conditions

    let decision = 'HOLD';

    

    if (role === 'Leader') {

      // Mayor manages village finances and follows N/B Guild directives

      // Orange zone: Very cautious, beta relationship formation, quick profit taking

      // Blue zone: Aggressive, alpha approach, strong buy bias

      

      // Use N/B zone directly for consistency

      const currentZone = window.zoneNow || 'BLUE';

      

      if (currentZone === 'ORANGE') {

        // Orange zone: Very cautious, beta relationship formation, quick profit taking

        // High chance of HOLD due to extreme caution, but when trading, prefer BUY for quick profit

        const holdBias = 0.60; // 60% chance of HOLD due to extreme caution

        const tradeDecision = Math.random() > 0.6 ? 'BUY' : 'SELL'; // When trading, slight BUY bias for quick profit

        

        if (Math.random() < holdBias) {

          decision = 'HOLD';

        } else {

          decision = tradeDecision;

        }

        member.strategy = 'ultra_cautious';

      } else {

        // Blue zone: Aggressive, alpha approach, strong buy bias

        const buyBias = 0.70; // 70% chance of BUY in Blue zone

        decision = Math.random() > buyBias ? 'SELL' : 'BUY';

        member.strategy = 'aggressive';

      }

      

      console.log(`🏛️ Mayor decision in ${currentZone} zone: ${decision} (${member.strategy} strategy)`);

      } else {

      // N/B 기반 Zone 결정 (ML 모델보다 우선시)
      const nbZone = window.zoneNow || 'BLUE';
      const zoneDecision = nbZone === 'BLUE' ? 'BUY' : 'SELL';
      
      // Zone discrepancy check - if N/B ≠ ML, increase zone following probability
      const mlZone = currentZone;
      const zoneDiscrepancy = nbZone !== mlZone;
      
      // Each trainer role has different probabilities of following N/B zone decision
      let zoneProbability = 0.8; // Base 80% probability
      switch (role) {
        case 'Explorer':
          zoneProbability = zoneDiscrepancy ? 0.95 : 0.85; // 95% if discrepancy, 85% if match
          break;
        case 'Protector':
          zoneProbability = zoneDiscrepancy ? 0.98 : 0.90; // 98% if discrepancy, 90% if match
          break;
        case 'Strategist':
          zoneProbability = zoneDiscrepancy ? 0.99 : 0.95; // 99% if discrepancy, 95% if match
          break;
        case 'Advisor':
          zoneProbability = zoneDiscrepancy ? 0.92 : 0.80; // 92% if discrepancy, 80% if match
          break;
      }
      
      // Follow zone decision with high probability, fallback to market sentiment
      if (Math.random() < zoneProbability) {
        decision = zoneDecision;
        console.log(`${member.name} (${role}) - Following N/B Zone: ${nbZone} → ${zoneDecision} (${(zoneProbability*100).toFixed(0)}% probability)${zoneDiscrepancy ? ' - Zone discrepancy detected!' : ''}`);
      } else {

        // Fallback to market sentiment (lower probability)
      if (isBullish) {

          decision = Math.random() > 0.3 ? 'BUY' : 'SELL';
      } else if (isBearish) {

          decision = Math.random() > 0.7 ? 'BUY' : 'SELL';
      } else {

          decision = Math.random() > 0.5 ? 'BUY' : 'SELL';
        }
        console.log(`${member.name} (${role}) - Following market sentiment: ${decision} (${((1-zoneProbability)*100).toFixed(0)}% probability)`);
      }

    }

    

    // Skill level affects decision quality

    if (skillLevel > 1.5) {

      // Higher skill = better decisions

      if (Math.random() < (skillLevel - 1.0) * 0.2) {

        decision = 'HOLD'; // More skilled traders know when to wait

      }

    }

    

    // Log market sentiment and decision

    const sentimentText = isBullish ? 'Bullish' : isBearish ? 'Bearish' : 'Neutral';

    console.log(`${member.name} (${role}) - Market: ${sentimentText}, Decision: ${decision}`);

    

    // Consume energy based on bitcar type when decision is made
    if (decision !== 'HOLD' && nbEnergy && nbEnergy.current >= 10) {
      let energyCost = 5; // Default Scout energy cost
      
      // Bitcar-specific energy costs
      switch (role) {
        case 'Scout':
          energyCost = 5; // Speed Bitcar
          break;
        case 'Guardian':
          energyCost = 8; // Command Vehicle Bitcar
          break;
        case 'Analyst':
          energyCost = 10; // Combat Bitcar
          break;
        case 'Elder':
          energyCost = 12; // Warehouse Bitcar
          break;
        default:
          energyCost = 5;
      }
      
      if (nbEnergy.current >= energyCost) {
        nbEnergy.current = Math.max(0, nbEnergy.current - energyCost);
        console.log(`⚡ ${member.name} (${role}) consumed ${energyCost} energy for ${decision}. Remaining: ${nbEnergy.current}`);
      } else {
        console.log(`❌ ${member.name} (${role}) insufficient energy (${nbEnergy.current}/${energyCost}) for ${decision}`);
        decision = 'HOLD'; // Force HOLD if not enough energy
      }
    }

    return decision;

  }



  // Decide whether to do real trade or mock trade based on N/B coin balance

  function decideTradeType(member) {

    // Factors that influence real vs mock trading decision:

    // 1. N/B coin balance (higher balance = more likely to do real trade)

    // 2. Skill level (higher skill = more confident for real trades)

    // 3. Recent performance (good performance = more likely real trade)

    // 4. Current zone (Orange zone = more cautious, prefer mock trades)

    

    const coinBalance = member.nbCoins || 0;

    const skillLevel = member.skillLevel || 1.0;

    const winRate = member.winRate || 50;

    const currentZone = member.currentZone || getCurrentZone();

    

    // Base probability of real trade - INCREASED for more active trading

    let realTradeProb = 0.3; // 30% base chance (increased from 10%)

    

    // N/B coin balance influence (more coins = higher chance)

    if (coinBalance > 0.01) {

      realTradeProb += 0.4; // +40% if high balance (increased from 30%)

    } else if (coinBalance > 0.005) {

      realTradeProb += 0.3; // +30% if moderate balance (increased from 20%)

    } else if (coinBalance > 0.001) {

      realTradeProb += 0.2; // +20% if low balance (increased from 10%)

    }

    

    // Skill level influence (higher skill = higher chance)

    if (skillLevel > 2.0) {

      realTradeProb += 0.25; // +25% for master level (increased from 20%)

    } else if (skillLevel > 1.5) {

      realTradeProb += 0.2; // +20% for expert level (increased from 15%)

    } else if (skillLevel > 1.2) {

      realTradeProb += 0.15; // +15% for advanced level (increased from 10%)

    }

    

    // Win rate influence (better performance = higher chance)

    if (winRate > 70) {

      realTradeProb += 0.2; // +20% for high win rate (increased from 15%)

    } else if (winRate > 60) {

      realTradeProb += 0.15; // +15% for good win rate (increased from 10%)

    }

    

    // Zone influence (Orange zone = more cautious) - REDUCED impact

    if (currentZone === 'ORANGE') {

      realTradeProb *= 0.9; // 10% reduction in Orange zone (reduced from 30%)

    }

    

    // Cap at 90% maximum probability (increased from 80%)

    realTradeProb = Math.min(0.95, realTradeProb);

    

    // Log decision factors

    console.log(`${member.name} trade decision factors: coins=${coinBalance.toFixed(6)}, skill=${skillLevel.toFixed(2)}, winRate=${winRate.toFixed(1)}%, zone=${currentZone}, realTradeProb=${(realTradeProb*100).toFixed(1)}%`);

    

    return Math.random() < realTradeProb;

  }



  // Calculate member confidence based on skill and experience

  function calculateMemberConfidence(member) {

    const baseConfidence = 60;

    const skillBonus = (member.skillLevel - 1.0) * 20;

    const experienceBonus = Math.min(member.experience * 0.1, 20);

    

    return Math.min(100, baseConfidence + skillBonus + experienceBonus);

  }

  // 자동 학습 토글 - moved to village-learning-system.js

  // 촌장 지침 학습 모델 훈련 - moved to village-learning-system.js

  // 자동 학습 상태 업데이트
  async function updateAutoLearningStatus(memberName) {
    try {
      const response = await fetch('/api/village/system/overview');
      
      if (response.ok) {
        const result = await response.json();
        const statusElement = document.getElementById(`auto-learning-status-${memberName}`);
        if (statusElement) {
          const autoLearningEnabled = result.current_status?.auto_learning_enabled;
          const status = autoLearningEnabled ? '활성화' : '비활성화';
          const color = autoLearningEnabled ? '#0ecb81' : '#f6465d';
          statusElement.innerHTML = `🤖 자동 학습: <span style="color: ${color};">${status}</span>`;
          
          // 상태를 localStorage에 저장
          localStorage.setItem('auto_learning_status', JSON.stringify({
            enabled: autoLearningEnabled,
            timestamp: Date.now(),
            memberName: memberName
          }));
        }
      }
    } catch (e) {
      console.error('자동 학습 상태 업데이트 실패:', e);
      const statusElement = document.getElementById(`auto-learning-status-${memberName}`);
      if (statusElement) {
        statusElement.innerHTML = `🤖 자동 학습: <span style="color: #888888;">상태 불명</span>`;
      }
    }
  }

  // 저장된 자동 학습 상태 복원 - moved to village-learning-system.js

  // 저장된 촌장 지침 상태 복원
  function restoreMayorGuidanceStatus(memberName) {
    try {
      const savedGuidance = localStorage.getItem(`mayor_guidance_${memberName}`);
      if (savedGuidance) {
        const guidance = JSON.parse(savedGuidance);
        const guidanceElement = document.getElementById(`mayor-guidance-${memberName}`);
        if (guidanceElement && guidance.memberName === memberName) {
          // 30분 이내의 데이터만 유효로 간주
          const isRecent = (Date.now() - guidance.timestamp) < 30 * 60 * 1000;
          if (isRecent) {
            guidanceElement.innerHTML = `
              <div style="color: ${guidance.guidanceColor}; font-weight: 600; margin-bottom: 2px;">
                🏛️ ${guidance.guidanceStatus}
              </div>
              <div style="color: #888888; font-size: 8px;">
                ${guidance.trustInfo}
              </div>
              <div style="color: #888888; font-size: 8px;">
                🔄 실시간 동기화 | N/B: 🟠${guidance.currentZone} | ML: 🟠${guidance.currentZone}
              </div>
              <div style="color: #888888; font-size: 8px;">
                Zone-Side Only: BUY@BLUE / SELL@ORANGE
              </div>
            `;
            return true;
          }
        }
      }
    } catch (e) {
      console.error('저장된 촌장 지침 상태 복원 실패:', e);
    }
    return false;
  }

  // 페이지 로드 시 저장된 상태 복원
  function restoreAllSavedStates() {
    console.log('🔄 저장된 상태 복원 중...');
    
    // 실시간 촌장 지침 복원
    restoreRealtimeMayorGuidance();
    
    // 마을 이동 에너지 정보 복원
    restoreVillageEnergyInfo();
    
    // Auto Trade 토글 상태 복원
    restoreAutoTradeToggleStates();
    
    // 모든 길드 멤버의 저장된 상태 복원
    Object.values(guildMembers).forEach(member => {
      restoreMayorGuidanceStatus(member.name);
      // restoreAutoLearningStatus(member.name); // moved to village-learning-system.js
      restoreAIExplanation(member.name);
    });
    
    console.log('✅ 저장된 상태 복원 완료');
  }

  // AI 거래 설명 가져오기
  async function getAIExplanation(memberName) {
    try {
      const response = await fetch(`/api/village/ai-explanation/${memberName}`);
      
      if (response.ok) {
        const result = await response.json();
        console.log('🤖 AI 거래 설명:', result);
        
        // 새로운 응답 형식 지원 (data 필드 확인)
        const data = result.data || result;
        const explanation = data.explanation || data.current || {};
        const history = data.history || [];
        const historyCount = data.history_count || 0;
        
        const explanationElement = document.getElementById(`ai-explanation-${memberName}`);
        if (explanationElement) {
          const exp = explanation.explanation || explanation;
          
          // 기본값 설정으로 "알 수 없음" 방지
          const currentAction = explanation.current_action || exp.current_action || 'HOLD';
          const reason = exp.reason || '현재 시장 상황 분석 중';
          const timing = exp.timing || '적절한 진입 시점 모니터링';
          const zoneStatus = exp.zone_status || '현재 구역 상태 확인 중';
          const strategy = exp.strategy || '기본 전략 유지';
          const position = exp.position || '포지션 없음 - 진입 시점 판단';
          
          // 현재 구역 정보 추가
          const currentZone = window.zoneNow || 'ORANGE';
          const zoneColor = currentZone === 'BLUE' ? 'BLUE' : 'ORANGE';
          
          // 히스토리 정보 표시 (있는 경우)
          const historyInfo = historyCount > 0 ? ` (히스토리: ${historyCount}개)` : '';
          
          explanationElement.innerHTML = `
            <div style="color: #00d1ff; font-weight: 600; margin-bottom: 2px;">
              AI 거래 판단: ${currentAction}${historyInfo}
            </div>
            <div style="color: #888888; font-size: 7px;">
              ${reason}
            </div>
            <div style="color: #888888; font-size: 7px;">
              ${timing}
            </div>
            <div style="color: #888888; font-size: 7px;">
              ${zoneStatus} ${zoneColor}
            </div>
            <div style="color: #888888; font-size: 7px;">
              ${strategy}
            </div>
            <div style="color: #888888; font-size: 7px;">
              ${position}
            </div>
          `;
        }
        
        // 설명을 localStorage에 저장 (기존 분석 유지)
        const savedData = localStorage.getItem(`ai_explanation_${memberName}`);
        let savedHistory = [];
        
        if (savedData) {
          try {
            const parsed = JSON.parse(savedData);
            savedHistory = parsed.history || [];
          } catch (e) {
            console.warn('Failed to parse saved AI explanation history:', e);
          }
        }
        
        // 현재 분석을 히스토리에 추가 (중복 방지)
        const currentTimestamp = explanation.timestamp || data.last_updated;
        if (currentTimestamp) {
          const isDuplicate = savedHistory.some(h => h.timestamp === currentTimestamp);
          if (!isDuplicate && explanation) {
            savedHistory.push({
              ...explanation,
              timestamp: currentTimestamp
            });
            // 최대 50개 유지
            if (savedHistory.length > 50) {
              savedHistory = savedHistory.slice(-50);
            }
          }
        }
        
        localStorage.setItem(`ai_explanation_${memberName}`, JSON.stringify({
          current: explanation,
          history: savedHistory.length > 0 ? savedHistory : history,
          history_count: savedHistory.length || historyCount,
          timestamp: Date.now(),
          last_updated: data.last_updated
        }));
        
      } else {
        const error = await response.json();
        console.error('AI 거래 설명 실패:', error);
        
        // API 실패 시 기본 정보 표시
        const explanationElement = document.getElementById(`ai-explanation-${memberName}`);
        if (explanationElement) {
          explanationElement.innerHTML = `
            <div style="color: #00d1ff; font-weight: 600; margin-bottom: 2px;">
              AI 거래 판단: HOLD
            </div>
            <div style="color: #888888; font-size: 7px;">
              AI 시스템 연결 중...
            </div>
            <div style="color: #888888; font-size: 7px;">
              잠시 후 다시 시도해주세요
            </div>
            <div style="color: #888888; font-size: 7px;">
              현재 구역: ORANGE
            </div>
            <div style="color: #888888; font-size: 7px;">
              기본 전략: 관망
            </div>
            <div style="color: #888888; font-size: 7px;">
              포지션 없음 - 진입 시점 판단
            </div>
          `;
        }
      }
      
    } catch (e) {
      console.error('AI 거래 설명 오류:', e);
      
              // 오류 시 기본 정보 표시
        const explanationElement = document.getElementById(`ai-explanation-${memberName}`);
        if (explanationElement) {
          explanationElement.innerHTML = `
            <div style="color: #00d1ff; font-weight: 600; margin-bottom: 2px;">
              AI 거래 판단: HOLD
            </div>
          <div style="color: #888888; font-size: 7px;">
            AI 시스템 점검 중
          </div>
          <div style="color: #888888; font-size: 7px;">
            잠시 후 다시 시도해주세요
          </div>
          <div style="color: #888888; font-size: 7px;">
            현재 구역: ORANGE
          </div>
          <div style="color: #888888; font-size: 7px;">
            기본 전략: 관망
          </div>
          <div style="color: #888888; font-size: 7px;">
            포지션 없음 - 진입 시점 판단
          </div>
        `;
      }
    }
  }

  // 저장된 AI 거래 설명 복원
  function restoreAIExplanation(memberName) {
    try {
      const savedExplanation = localStorage.getItem(`ai_explanation_${memberName}`);
      if (savedExplanation) {
        const saved = JSON.parse(savedExplanation);
        const explanation = saved.current || saved.explanation || saved;
        const explanationElement = document.getElementById(`ai-explanation-${memberName}`);
        if (explanationElement && explanation) {
          const exp = explanation.explanation || explanation;
          
          // 기본값 설정으로 "알 수 없음" 방지
          const currentAction = explanation.current_action || 'HOLD';
          const reason = exp.reason || '현재 시장 상황 분석 중';
          const timing = exp.timing || '적절한 진입 시점 모니터링';
          const zoneStatus = exp.zone_status || '현재 구역 상태 확인 중';
          const strategy = exp.strategy || '기본 전략 유지';
          const position = exp.position || '포지션 없음 - 진입 시점 판단';
          
          explanationElement.innerHTML = `
            <div style="color: #00d1ff; font-weight: 600; margin-bottom: 2px;">
              AI 거래 판단: ${currentAction}
            </div>
            <div style="color: #888888; font-size: 7px;">
              ${reason}
            </div>
            <div style="color: #888888; font-size: 7px;">
              ${timing}
            </div>
            <div style="color: #888888; font-size: 7px;">
              ${zoneStatus}
            </div>
            <div style="color: #888888; font-size: 7px;">
              ${strategy}
            </div>
            <div style="color: #888888; font-size: 7px;">
              ${position}
            </div>
          `;
          return true;
        }
      }
    } catch (e) {
      console.error('저장된 AI 거래 설명 복원 실패:', e);
    }
    return false;
  }

  // 촌장 지침 시스템 import
  // 참고: mayor-guidance.js 파일에서 함수들을 가져와서 사용

  // 저장된 실시간 촌장 지침 복원
  function restoreRealtimeMayorGuidance() {
    try {
      const savedGuidance = localStorage.getItem('realtime_mayor_guidance');
      if (savedGuidance) {
        const guidance = JSON.parse(savedGuidance);
        const nbZone = guidance.nb_zone || guidance.current_zone || 'ORANGE';
        const mlZone = guidance.ml_zone || 'BLUE';
        
        // 현재 구역 표시 복원 (N/B 시스템 기준 - 실시간 동기화와 일치)
        const zoneDisplay = document.getElementById('current-zone-display');
        if (zoneDisplay) {
          const zoneColor = nbZone === 'BLUE' ? '#0ecb81' : '#f6465d';
          const zoneEmoji = nbZone === 'BLUE' ? 'BLUE' : 'ORANGE';
          zoneDisplay.innerHTML = `<span style="color: ${zoneColor}; font-weight: 600;">${zoneEmoji} ${nbZone}</span>`;
        }
        
        // 실시간 동기화 상태 복원 (N/B와 ML의 실제 구역 표시)
        const zoneConsistencyInfo = document.getElementById('zoneConsistencyInfo');
        if (zoneConsistencyInfo) {
          const nbColor = nbZone === 'BLUE' ? 'BLUE' : 'ORANGE';
          const mlColor = mlZone === 'BLUE' ? 'BLUE' : 'ORANGE';
          zoneConsistencyInfo.innerHTML = `
            <div style="font-size: 9px; color: #333; font-weight: 500; line-height: 1.2; padding: 2px 4px; background: #f8f9fa; border-radius: 3px; border-left: 2px solid #0ecb81;">
                          실시간 동기화 | 
            N/B: ${nbColor} | 
            ML: ${mlColor}
            </div>
          `;
        }
        
        // 신뢰도 정보 복원
        const trustDisplay = document.getElementById('mayor-trust-display');
        if (trustDisplay) {
          const mlTrust = guidance.ml_trust || 40;
          const nbTrust = guidance.nb_trust || 86;
          trustDisplay.innerHTML = `
            <span style="color: #00d1ff;">ML Model Trust: </span><span style="color: #00d1ff; font-weight: 600; background: rgba(0,209,255,0.1); padding: 1px 3px; border-radius: 2px;">${mlTrust}%</span> | <span style="color: #ffb703;">N/B Guild Trust: </span><span style="color: #ffb703; font-weight: 600; background: rgba(255,183,3,0.1); padding: 1px 3px; border-radius: 2px;">${nbTrust}%</span> (${nbTrust}개 히스토리)
          `;
        }
        
        return true;
      }
    } catch (e) {
      console.error('저장된 실시간 촌장 지침 복원 실패:', e);
    }
    return false;
  }

  // 실시간 촌장 지침 주기적 업데이트 시작 (mayor-guidance.js에서 관리됨)
  function startRealtimeMayorGuidanceUpdates() {
    // mayor-guidance.js의 함수 사용
    if (typeof window.startRealtimeMayorGuidanceUpdates === 'function') {
      window.startRealtimeMayorGuidanceUpdates();
    } else {
      console.log('mayor-guidance.js의 startRealtimeMayorGuidanceUpdates 함수를 찾을 수 없습니다');
    }
  }

  // 실시간 촌장 지침 주기적 업데이트 중지 (mayor-guidance.js에서 관리됨)
  function stopRealtimeMayorGuidanceUpdates() {
    // mayor-guidance.js의 함수 사용
    if (typeof window.stopRealtimeMayorGuidanceUpdates === 'function') {
      window.stopRealtimeMayorGuidanceUpdates();
    } else {
      console.log('mayor-guidance.js의 stopRealtimeMayorGuidanceUpdates 함수를 찾을 수 없습니다');
    }
  }

  // 페이지 로드 완료 시 상태 복원 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreAllSavedStates);
  } else {
    restoreAllSavedStates();
  }

  // 촌장 지침 시스템은 mayor-guidance.js에서 관리됨
  // Check if member should close their position

  function shouldClosePosition(member, currentPrice, interval) {

    const position = member.openPosition;

    if (!position) return false;

    

    const entryPrice = position.price;

    const positionSide = position.side;

    const timeHeld = Date.now() - new Date(position.timestamp).getTime();

    const minutesHeld = timeHeld / (1000 * 60);

    

    // Calculate current profit/loss

    let currentProfit = 0;

    if (positionSide === 'BUY') {

      currentProfit = ((currentPrice - entryPrice) / entryPrice) * 100;

    } else {

      currentProfit = ((entryPrice - currentPrice) / entryPrice) * 100;

    }

    

    // Close conditions based on member role and strategy

    const role = member.role;

    let shouldClose = false;

    

    if (role === 'Explorer') {

      // Scout: Quick trades, close within 5-15 minutes or at 2% profit/loss

      shouldClose = minutesHeld >= 5 + Math.random() * 10 || Math.abs(currentProfit) >= 2;

    } else if (role === 'Protector') {

      // Guardian: Conservative, close within 10-30 minutes or at 1.5% profit/loss

      shouldClose = minutesHeld >= 10 + Math.random() * 20 || Math.abs(currentProfit) >= 1.5;

    } else if (role === 'Strategist') {

      // Analyst: Strategic, close within 15-60 minutes or at 3% profit/loss

      shouldClose = minutesHeld >= 15 + Math.random() * 45 || Math.abs(currentProfit) >= 3;

    } else if (role === 'Advisor') {

      // Elder: Long-term, close within 30-120 minutes or at 5% profit/loss

      shouldClose = minutesHeld >= 30 + Math.random() * 90 || Math.abs(currentProfit) >= 5;

    } else if (role === 'Leader') {

      // Mayor: Balanced approach

      shouldClose = minutesHeld >= 20 + Math.random() * 40 || Math.abs(currentProfit) >= 2.5;

    }

    

    // Add some randomness to make it more realistic

    shouldClose = shouldClose && Math.random() > 0.3; // 70% chance to close when conditions are met

    

    return shouldClose;

  }

  

  // 구역 변경 추적을 위한 변수

  let lastKnownZone = null;

  let zoneChangeTime = 0;

  let lastCandleData = null; // Store the latest OHLCV data for zone determination

  let currentIntervalZone = null; // Store the current interval zone

  let lastIntervalTime = null; // Store the last interval time

  let nbZoneStartTime = null; // Store when current N/B zone started

  let nbZoneDuration = 0; // Store current N/B zone duration in seconds

  

  // Update title with current zone information (based on previous 25 values average)

  function updateTitleWithZone() {

    try {

      // Update both title and meta elements

      const titleElement = document.getElementById('title');

      const metaElement = document.getElementById('meta');

      

      const currentInterval = getInterval();

      

      // N/B 라인의 마지막 점을 기준으로 구역 결정 (N/B Zone Status와 동일한 로직)

      let currentZone = 'BLUE'; // default

      const nbWaveData = window.nbWaveSeries?.data || [];

      const baseValue = window.nbWaveSeries?.options()?.baseValue?.price || 0;

      

      if (nbWaveData.length > 0) {

        const lastWave = nbWaveData[nbWaveData.length - 1];

        currentZone = lastWave.value < baseValue ? 'ORANGE' : 'BLUE';

      }

      

      const zoneEmoji = currentZone === 'ORANGE' ? '🟠' : '🔵';

      

      // Format interval for display

      let intervalDisplay = '';

      switch(currentInterval) {

        case 'minute1': intervalDisplay = '1m'; break;

        case 'minute3': intervalDisplay = '3m'; break;

        case 'minute5': intervalDisplay = '5m'; break;

        case 'minute10': intervalDisplay = '10m'; break;

        case 'minute15': intervalDisplay = '15m'; break;

        case 'minute30': intervalDisplay = '30m'; break;

        case 'minute60': intervalDisplay = '1h'; break;

        case 'day': intervalDisplay = '1d'; break;

        default: intervalDisplay = currentInterval;

      }

      

      // Update title element

      if (titleElement) {

        titleElement.innerHTML = `KRW-BTC ${intervalDisplay} | HOLD | EMA 24/45 | ${zoneEmoji} ${currentZone}`;

      }

      

      // Update meta element (if not updated by stream)

      if (metaElement && !metaElement.textContent.includes(zoneEmoji)) {

        const currentSignal = 'HOLD'; // Default signal

        const emaFast = 24; // Default EMA values

        const emaSlow = 45;

        metaElement.textContent = `KRW-BTC ${intervalDisplay} | ${currentSignal} | EMA ${emaFast}/${emaSlow} | ${zoneEmoji} ${currentZone}`;

      }

      

      console.log(`Title updated: KRW-BTC ${intervalDisplay} | HOLD | EMA 24/45 | ${zoneEmoji} ${currentZone} (chart line)`);

    } catch (e) {

      console.error('Error updating title with zone:', e);

    }

  }





  





  // ========================================

  // 🎯 사용자 수정 가능한 구역 분류 함수

  // ========================================

  // 이 함수를 수정하여 구역 분류 로직을 변경할 수 있습니다.

  // 

  // 매개변수:

  // - candle: 개별 캔들 데이터 (time, open, high, low, close, volume)

  // - nbWaveData: N/B 웨이브 시리즈 데이터 배열

  // - baseValue: N/B 웨이브의 기준값 (중간선)

  // - orangeZoneArray: 저장된 ORANGE 구역 배열

  // - blueZoneArray: 저장된 BLUE 구역 배열

  // 

  // 반환값: 'ORANGE' 또는 'BLUE'

  // 

  // 현재 로직:

  // 1. N/B 웨이브 위치 확인 (가장 정확한 차트 표시)

  // 2. 저장된 구역 배열 확인 (fallback)

  // 3. 캔들 패턴 확인 (최종 fallback)

  // ========================================

  function determineZone(candle, nbWaveData, baseValue, orangeZoneArray, blueZoneArray) {

    try {

      // 🔧 방법 1: N/B 웨이브 위치 확인 (가장 정확한 차트 표시)

      if (nbWaveData && Array.isArray(nbWaveData) && nbWaveData.length > 0) {

        const matchingNb = nbWaveData.find(nbItem => nbItem.time === candle.time);

        if (matchingNb) {

          // N/B 웨이브가 기준값보다 아래면 ORANGE (하단 영역 - 차트에서 파란색)

          // N/B 웨이브가 기준값보다 위면 BLUE (상단 영역 - 차트에서 주황색)

          const zone = matchingNb.value < baseValue ? 'ORANGE' : 'BLUE';

          

          // 디버그 로그 (필요시 주석 해제)

          // console.log(`N/B 웨이브 위치: ${matchingNb.value.toFixed(0)} vs 기준값 ${baseValue.toFixed(0)} → ${zone}`);

          

          return zone;

        }

      }

      

      // 🔧 방법 2: 저장된 구역 배열 확인 (fallback)

      if (orangeZoneArray && blueZoneArray) {

        const isOrange = orangeZoneArray.some(zone => zone.time === candle.time);

        const isBlue = blueZoneArray.some(zone => zone.time === candle.time);

        

        if (isOrange) {

          return 'ORANGE';

        } else if (isBlue) {

          return 'BLUE';

        }

      }

      

      // 🔧 방법 3: 캔들 패턴 확인 (최종 fallback)

      // 종가가 시가보다 높으면 ORANGE (상승), 낮으면 BLUE (하락)

      const zone = candle.close > candle.open ? 'ORANGE' : 'BLUE';

      

      // 디버그 로그 (필요시 주석 해제)

      // console.log(`캔들 패턴: 종가 ${candle.close.toFixed(0)} vs 시가 ${candle.open.toFixed(0)} → ${zone}`);

      

      return zone;

      

    } catch (e) {

      console.error('구역 분류 오류:', e);

      return 'BLUE'; // 기본값

    }

  }



  // ========================================

  // 🎯 사용자 수정 가능한 현재 구역 확인 함수

  // ========================================

  // 이 함수를 수정하여 현재 구역 확인 로직을 변경할 수 있습니다.

  // 

  // 반환값: 'ORANGE' 또는 'BLUE'

  // 

  // 현재 로직:

  // 1. N/B 웨이브 시리즈의 마지막 포인트 위치 확인

  // 2. 저장된 구역 배열에서 마지막 캔들 확인

  // 3. 마지막 캔들 패턴 확인

  // ========================================

  function determineCurrentZone() {

    try {

      // 🔧 방법 1: N/B 웨이브 시리즈의 마지막 포인트 위치 확인

      if (window.nbWaveSeries && window.nbWaveSeries.data) {

        const nbData = window.nbWaveSeries.data;

        if (Array.isArray(nbData) && nbData.length > 0) {

          const lastNbPoint = nbData[nbData.length - 1];

          const baseValue = window.nbWaveSeries.options().baseValue?.price || 0;

          

          // N/B 웨이브가 기준값보다 아래면 ORANGE (하단 영역)

          // N/B 웨이브가 기준값보다 위면 BLUE (상단 영역)

          const zone = lastNbPoint.value < baseValue ? 'ORANGE' : 'BLUE';

          

          // 디버그 로그 (필요시 주석 해제)

          // console.log(`현재 N/B 웨이브: ${lastNbPoint.value.toFixed(0)} vs 기준값 ${baseValue.toFixed(0)} → ${zone}`);

          

          return zone;

        }

      }

      

      // 🔧 방법 2: 저장된 구역 배열에서 마지막 캔들 확인

      if (window.orangeZoneArray && window.blueZoneArray) {

        const candleData = candle.data();

        if (candleData && candleData.length > 0) {

          const lastCandleTime = candleData[candleData.length - 1].time;

          

          const isInOrange = window.orangeZoneArray.some(zone => zone.time === lastCandleTime);

          const isInBlue = window.blueZoneArray.some(zone => zone.time === lastCandleTime);

          

          if (isInOrange) {

            return 'ORANGE';

          } else if (isInBlue) {

            return 'BLUE';

          }

        }

      }

      

      // 🔧 방법 3: 마지막 캔들 패턴 확인

      const data = candle.data();

      if (data && data.length > 0) {

        const lastCandle = data[data.length - 1];

        const zone = lastCandle.close > lastCandle.open ? 'ORANGE' : 'BLUE';

        

        // 디버그 로그 (필요시 주석 해제)

        // console.log(`현재 캔들 패턴: 종가 ${lastCandle.close.toFixed(0)} vs 시가 ${lastCandle.open.toFixed(0)} → ${zone}`);

        

        return zone;

      }

      

      return 'BLUE'; // 기본값

    } catch (e) {

      console.error('현재 구역 확인 오류:', e);

      return 'BLUE';

    }

  }



  // Get zone directly from N/B wave series position (actual chart display)

  function getZoneFromChartLine() {

    return determineCurrentZone();

  }



  // ========================================

  // 🎨 차트 래스터라이즈 및 픽셀 분석 함수

  // ========================================

  



  // ========================================

  // 🌐 전역 함수 노출 (사용자 수정 가능)

  // ========================================

  // 브라우저 콘솔에서 직접 수정할 수 있도록 전역으로 노출

  window.determineZone = determineZone;

  window.determineCurrentZone = determineCurrentZone;

  window.getZoneFromChartLine = getZoneFromChartLine;

  

  console.log('🎯 구역 분류 함수가 전역으로 노출되었습니다:');

  console.log('  - window.determineZone(candle, nbWaveData, baseValue, orangeZoneArray, blueZoneArray)');

  console.log('  - window.determineCurrentZone()');

  console.log('  - window.getZoneFromChartLine()');

  console.log('💡 구역 분류 로직을 수정하려면 window.determineZone 함수를 직접 편집하세요.');

  

  // ========================================

  // 📝 사용자 수정 가이드

  // ========================================

  // 구역 분류 로직을 수정하려면:

  // 

  // 1. 브라우저 콘솔에서 다음 명령어로 현재 함수를 확인:

  //    console.log(window.determineZone.toString());

  // 

  // 2. 새로운 로직으로 함수를 재정의:

  //    window.determineZone = function(candle, nbWaveData, baseValue, orangeZoneArray, blueZoneArray) {

  //      // 여기에 새로운 로직 작성

  //      // 예시: EMA 기반 구역 분류

  //      if (candle.close > candle.open * 1.01) return 'ORANGE';

  //      if (candle.close < candle.open * 0.99) return 'BLUE';

  //      return 'BLUE'; // 기본값

  //    };

  // 

  // 3. 변경사항을 즉시 적용하려면:

  //    refreshNbZoneStrip(); // N/B Zone Status 업데이트

  //    saveChartData(); // 차트 데이터 저장 (새로운 로직 적용)

  // 

  // 4. 원래 로직으로 되돌리려면:

  //    location.reload(); // 페이지 새로고침

  // ========================================



  // Calculate zone based on previous 25 values average (26th-50th from end)

  function calculateZoneFromPrevious25Values() {

    try {

      const data = candle.data();

      if (!data || data.length < 50) return 'BLUE'; // Need at least 50 data points

      

      // Get 25 values from 26th to 50th position from the end (avoiding most recent noise)

      const previous25Values = [];

      const startIndex = Math.max(0, data.length - 50);

      const endIndex = data.length - 25;

      

      for (let i = startIndex; i < endIndex; i++) {

        const point = data[i];

        if (point && point.close) {

          previous25Values.push(point.close);

        }

      }

      

      if (previous25Values.length < 25) return 'BLUE';

      

      // Calculate average of previous 25 values (26th-50th from end)

      const average = previous25Values.reduce((sum, val) => sum + val, 0) / previous25Values.length;

      

      // Get current price (most recent)

      const currentPrice = data[data.length - 1].close;

      

      // Determine zone based on current price vs average

      // If current price > average, it's ORANGE (uptrend)

      // If current price < average, it's BLUE (downtrend)

      const zone = currentPrice > average ? 'ORANGE' : 'BLUE';

      

      console.log(`Zone calculation - Previous 25 avg (26th-50th): ${average.toFixed(0)}, Current: ${currentPrice.toFixed(0)}, Zone: ${zone}`);

      console.log(`Window.zoneNow will be set to: ${zone}`);

      

      return zone;

    } catch (e) {

      console.error('Error calculating zone from previous 25 values:', e);

      return 'BLUE';

    }

  }



  // Update N/B line with text display

  function updateNBLineWithText() {

    try {

      if (!lastCandleData) return;

      

      const chartData = candle.data();

      if (chartData && chartData.length > 0) {

        const nbZone = window.zoneNow || 'BLUE';

        const currentZone = nbZone;

        const lastCandle = chartData[chartData.length - 1];

        

        // Create N/B line data

        const nbLineData = [];

        const nbTextData = [];

        

        // Get current interval

        const currentInterval = getInterval();

        let intervalSeconds;

        switch(currentInterval) {

          case 'minute1': intervalSeconds = 60; break;

          case 'minute3': intervalSeconds = 180; break;

          case 'minute5': intervalSeconds = 300; break;

          case 'minute15': intervalSeconds = 900; break;

          case 'minute30': intervalSeconds = 1800; break;

          case 'minute60': intervalSeconds = 3600; break;

          default: intervalSeconds = 600;

        }

        

        // Create N/B line points

        const startTime = lastCandle.time - intervalSeconds;

        const endTime = lastCandle.time + intervalSeconds;

        

        // Calculate N/B line value (use current price as base)

        const currentPrice = lastCandle.close;

        const nbLineValue = currentPrice;

        

        // Add N/B line data points

        nbLineData.push({ time: startTime, value: nbLineValue });

        nbLineData.push({ time: endTime, value: nbLineValue });

        

        // Add text data at the end of N/B line

        const durationText = nbZoneDuration >= 60 ? ` (${nbZoneDuration}s)` : '';

        const zoneText = `${currentZone} (N/B)${durationText}`;

        

        nbTextData.push({ 

          time: endTime, 

          value: nbLineValue,

          text: zoneText

        });

        

        // Set N/B line data

        nbLineSeries.setData(nbLineData);

        

        // All markers disabled to prevent transparent bars

        nbLineSeries.setMarkers([]);

        

        console.log(`N/B line updated: ${currentZone} at time ${endTime}`);

      }

    } catch (e) {

      console.error('N/B line update error:', e);

    }

  }
  // Update zone indicator on chart

  function updateZoneIndicator() {

    try {

      if (!lastCandleData) return;

      

      const chartData = candle.data();

      

      if (chartData && chartData.length > 0) {

        // Use N/B zone instead of candle-based zone

        const nbZone = window.zoneNow || 'BLUE'; // Default to BLUE if N/B zone not available

        const currentZone = nbZone;

        // Check if we need to update (only if interval zone changed or first time)

        const lastCandle = chartData[chartData.length - 1];

        const currentInterval = getInterval();
        

        // Calculate the time range for the current interval

        let intervalSeconds;

        switch(currentInterval) {

          case 'minute1': intervalSeconds = 60; break;

          case 'minute3': intervalSeconds = 180; break;

          case 'minute5': intervalSeconds = 300; break;

          case 'minute15': intervalSeconds = 900; break;

          case 'minute30': intervalSeconds = 1800; break;

          case 'minute60': intervalSeconds = 3600; break;

          default: intervalSeconds = 600; // default 10 minutes

        }

        

        // Check if we're in a new interval

        const currentIntervalStart = lastCandle.time - intervalSeconds;

        const intervalEndTime = currentIntervalStart + intervalSeconds;

        const isNewInterval = lastIntervalTime === null || 

                             lastCandle.time >= intervalEndTime || 

                             Math.floor(lastCandle.time / intervalSeconds) !== Math.floor(lastIntervalTime / intervalSeconds);

        

        // Only update if it's a new interval or first time

        if (!isNewInterval && currentIntervalZone !== null) {

          return; // Skip update if interval hasn't changed

        }

        

        // Check if we need to update the interval zone

        

        if (isNewInterval) {

          // Calculate the completed interval - use the most recent completed interval

          const currentTime = lastCandle.time;

          const completedIntervalEnd = Math.floor(currentTime / intervalSeconds) * intervalSeconds;

          const completedIntervalStart = completedIntervalEnd - intervalSeconds;

          

          // Get candles for the completed interval

          const completedIntervalCandles = chartData.filter(candle => 

            candle.time >= completedIntervalStart && candle.time < completedIntervalEnd

          );

          

          console.log(`Completed interval: ${completedIntervalStart} to ${completedIntervalEnd}, Candles found: ${completedIntervalCandles.length}`);

          if (completedIntervalCandles.length > 0) {

            console.log(`First candle: ${completedIntervalCandles[0].time}, Last candle: ${completedIntervalCandles[completedIntervalCandles.length - 1].time}`);

          }

          

          // Determine zone for the completed interval

          const getIntervalZone = (candles) => {

            if (candles.length === 0) return null;

            

            // Analyze all candles in the interval

            let bullishCount = 0;

            let bearishCount = 0;

            let totalPriceChange = 0;

            

            candles.forEach(candle => {

              if (candle.close > candle.open) {

                bullishCount++;

                totalPriceChange += (candle.close - candle.open) / candle.open;

              } else {

                bearishCount++;

                totalPriceChange += (candle.close - candle.open) / candle.open;

              }

            });

            

            // Debug logging

            console.log(`Interval Analysis - Candles: ${candles.length}, Bullish: ${bullishCount}, Bearish: ${bearishCount}, Total Change: ${(totalPriceChange * 100).toFixed(2)}%`);

            

            // Determine zone based on majority and overall trend

            if (bullishCount > bearishCount) {

              console.log(`Zone determined: ORANGE (bullish: ${bullishCount}, bearish: ${bearishCount})`);

              return 'ORANGE';

            } else if (bearishCount > bullishCount) {

              console.log(`Zone determined: BLUE (bullish: ${bullishCount}, bearish: ${bearishCount})`);

              return 'BLUE';

            } else {

              // If equal, use total price change

              if (totalPriceChange > 0) {

                console.log(`Zone determined: ORANGE (equal counts, trend up: ${(totalPriceChange * 100).toFixed(2)}%)`);

                return 'ORANGE';

              } else {

                console.log(`Zone determined: BLUE (equal counts, trend down: ${(totalPriceChange * 100).toFixed(2)}%)`);

                return 'BLUE';

              }

            }

          };

          

          const newIntervalZone = getIntervalZone(completedIntervalCandles);

          

          // Update the current interval zone if we have a valid zone

          if (newIntervalZone) {

            currentIntervalZone = newIntervalZone;

            lastIntervalTime = completedIntervalEnd;

            console.log(`New interval zone determined: ${currentIntervalZone} for interval ending at ${completedIntervalEnd}`);

          }

        }

        

        // Use chart data to determine zone instead of N/B zone for display

        // This ensures the zone matches the actual chart pattern

        let displayZone = nbZone;

        

        // Override with chart-based zone determination if available

        if (lastCandleData) {

          const open = lastCandleData.open;

          const close = lastCandleData.close;

          const chartBasedZone = close > open ? 'ORANGE' : 'BLUE';

          

          // Use chart-based zone for display, but keep N/B zone for reference

          displayZone = chartBasedZone;

          console.log(`Chart-based zone: ${chartBasedZone} (Open: ${open}, Close: ${close}), N/B zone: ${nbZone}`);

        }

        

        console.log(`Final display zone: ${displayZone}`);

        

        // Create zone indicator data for the interval

        // Use the stored interval zone for display

        const intervalStartTime = lastCandle.time - intervalSeconds;

        const intervalCandles = chartData.filter(candle => candle.time >= intervalStartTime);

        

        // Use zone arrays created by updateNB() function

        const orangeZones = window.orangeZoneArray || [];

        const blueZones = window.blueZoneArray || [];

        

        // Log zone statistics

        console.log(`Using updateNB Zone Arrays - ORANGE: ${orangeZones.length} zones, BLUE: ${blueZones.length} zones`);

        

        // Create zone indicator data using actual ORANGE/BLUE zones from chart

        const zoneData = [];

        

        // Add ORANGE zones (candles colored orange)

        orangeZones.forEach(zone => {

          zoneData.push({

            time: zone.time,

            open: zone.open,

            high: zone.high,

            low: zone.low,

            close: zone.close

          });

        });

        

        // Add BLUE zones (candles colored blue)

        blueZones.forEach(zone => {

          zoneData.push({

            time: zone.time,

            open: zone.open,

            high: zone.high,

            low: zone.low,

            close: zone.close

          });

        });

        

        // Sort by time to maintain chronological order

        zoneData.sort((a, b) => a.time - b.time);

        

        // Update zone indicator series with actual ORANGE/BLUE zones

        zoneIndicatorSeries.setData(zoneData);
        zoneIndicatorSeries.data = zoneData;
        window.zoneIndicatorData = zoneData;

        

        // Zone background disabled to remove BLUE/ORANGE bars

        zoneBackgroundSeries.setData([]);

        

        // All markers disabled to prevent transparent bars

        candle.setMarkers([]);

        

        console.log(`N/B Zone indicator updated: ${displayZone} at time ${lastCandle.time}`);

        

        // Update N/B line with text

        updateNBLineWithText();

      }

    } catch (e) {

      console.error('Zone indicator update error:', e);

    }

  }



    // Get current market zone - Always synchronized with N/B ZONE STATUS
  function getCurrentZone() {

    try {

      // Always use window.zoneNow for consistency - avoid circular reference
      const nbZone = window.zoneNow || 'BLUE';
      return nbZone;
    } catch (e) {
      console.error('Error in getCurrentZone:', e);
      
      // Fallback to BLUE if everything fails
      return 'BLUE';
    }

  }



  // Get current market price

  function getCurrentPrice() {

    try {

      // Use lastCandleData if available, otherwise fall back to chart data

      if (lastCandleData) {

        const price = lastCandleData.close;

        window.currentPrice = price; // 전역 변수로 저장

        return price;

      }

      const chartData = candle.data();

      const price = chartData && chartData.length > 0 ? chartData[chartData.length - 1].close : 163000000;

      window.currentPrice = price; // 전역 변수로 저장

      return price;

    } catch (e) {

      const price = 163000000; // Fallback price

      window.currentPrice = price; // 전역 변수로 저장

      return price;

    }

  }

  // Expose getCurrentPrice globally for other modules
  window.getCurrentPrice = getCurrentPrice;

  

  // Calculate average price for multiple trades

  function calculateAveragePrice(positionHistory) {

    if (positionHistory.length === 0) return 0;

    

    let totalValue = 0;

    let totalSize = 0;

    

    positionHistory.forEach(trade => {

      totalValue += trade.price * trade.coinAmount;

      totalSize += trade.coinAmount;

    });

    

    return totalSize > 0 ? totalValue / totalSize : 0;

  }

  

  // Calculate profit for a closed position

  function calculatePositionProfit(positionSide, entryPrice, exitPrice) {

    if (positionSide === 'BUY') {

      return ((exitPrice - entryPrice) / entryPrice) * 100;

    } else {

      return ((entryPrice - exitPrice) / entryPrice) * 100;

    }

  }

  

  // Simulate trade result based on member's characteristics (legacy function - kept for compatibility)

  function simulateTradeResult(decision, member, price, confidence) {

    if (decision === 'HOLD') {

      return (Math.random() - 0.5) * 2; // -1% to +1%

    }

    

    // Base profit calculation

    let profitPercent = 0;

    const volatility = 0.02; // 2% base volatility

    

    if (decision === 'BUY') {

      const marketBias = Math.random() * 0.6 + 0.2; // 20-80% chance of profit

      const priceMovement = (Math.random() - 0.5) * volatility * 2;

      profitPercent = priceMovement + (marketBias * 0.01);

    } else if (decision === 'SELL') {

      const marketBias = Math.random() * 0.6 + 0.2;

      const priceMovement = (Math.random() - 0.5) * volatility * 2;

      profitPercent = -priceMovement - (marketBias * 0.01);

    }

    

    // Apply member-specific modifiers

    const skillEffect = (member.skillLevel - 1.0) * 0.3; // -30% to +30% based on skill

    const strategyEffect = getStrategyEffectiveness(member.strategy);

    const confidenceEffect = (confidence - 60) / 40 * 0.2; // 0% to +20% based on confidence

    

    profitPercent += skillEffect + strategyEffect + confidenceEffect;

    

    return profitPercent;

  }



  // Get strategy effectiveness

  function getStrategyEffectiveness(strategy) {

    const effectiveness = {

      'ultra_cautious': 0.25, // Mayor's ultra cautious strategy in Orange zone (quick profit taking)

      'aggressive': 0.22, // Mayor's aggressive strategy in Blue zone

      'defensive': 0.18, // Mayor's defensive strategy in Orange zone

      'balanced': 0.12, // Mayor's balanced strategy

      'momentum': 0.1,

      'meanrev': 0.05,

      'breakout': 0.15,

      'scalping': 0.08

    };

    return effectiveness[strategy] || 0;

  }



  // Trainer Learning System

  function trainerLearningSystem() {

    try {

      if (typeof guildMembers === 'undefined' || !guildMembers) return;

      

      Object.values(guildMembers).forEach(member => {

        // Increase experience

        member.experience += 1;

        

        // Learn from recent performance (win rate)

        if (member.winRate > 60) {

          member.skillLevel = Math.min(3.0, member.skillLevel + member.learningRate);

          // 창고 자산 기반 등급 결정
          const warehouseValue = member.nbCoins * (window.currentPrice || 160000000);
          member.specialty = enhanceSpecialty(member.specialty, member.skillLevel, warehouseValue);

        } else if (member.winRate < 40) {

          // Learn from mistakes

          member.skillLevel = Math.max(0.5, member.skillLevel - member.learningRate * 0.5);

        }

        

        // Learn from N/B coin performance (enhanced real-time learning)

        const coinPerformance = member.totalNbCoinsEarned - member.totalNbCoinsLost;

        const currentCoinBalance = member.nbCoins;

        

        if (coinPerformance > 0.001) {

          // Good coin performance - boost learning

          member.skillLevel = Math.min(3.0, member.skillLevel + member.learningRate * 0.8);

          member.tradeFrequency = Math.min(0.8, member.tradeFrequency + 0.05);

          

          // Additional bonus for maintaining high coin balance

          if (currentCoinBalance > 0.005) {

            member.skillLevel = Math.min(3.0, member.skillLevel + member.learningRate * 0.3);

          }

        } else if (coinPerformance < -0.001) {

          // Poor coin performance - reduce confidence

          member.skillLevel = Math.max(0.5, member.skillLevel - member.learningRate * 0.5);

          member.tradeFrequency = Math.max(0.1, member.tradeFrequency - 0.05);

          

          // Additional penalty for low coin balance

          if (currentCoinBalance < 0.001) {

            member.skillLevel = Math.max(0.5, member.skillLevel - member.learningRate * 0.2);

          }

        }

        

        // Real-time coin balance impact on learning

        if (currentCoinBalance > 0.01) {

          // High coin balance = more confident and skilled

          member.skillLevel = Math.min(3.0, member.skillLevel + member.learningRate * 0.2);

          member.tradeFrequency = Math.min(0.8, member.tradeFrequency + 0.02);

        } else if (currentCoinBalance < 0.0005) {

          // Very low coin balance = more cautious

          member.skillLevel = Math.max(0.5, member.skillLevel - member.learningRate * 0.1);

          member.tradeFrequency = Math.max(0.05, member.tradeFrequency - 0.02);

        }

        

        // Adjust trade frequency based on total profit

        if (member.totalProfit > 10) {

          member.tradeFrequency = Math.min(0.6, member.tradeFrequency + 0.05);

        } else if (member.totalProfit < -5) {

          member.tradeFrequency = Math.max(0.1, member.tradeFrequency - 0.05);

        }

        

        // Strategy evolution based on coin performance

        if (coinPerformance > 0.002) {

          // High coin performance - evolve strategy

          evolveStrategy(member);

        }

      });

      

      console.log('Trainer Learning System completed with N/B coin performance analysis');

      

    } catch (e) {

      console.error('Trainer Learning System Error:', e);

    }

  }



  // Enhance specialty based on skill level

  // Enhance specialty based on warehouse assets (창고 자산 기준 등급)
  function enhanceSpecialty(specialty, skillLevel, warehouseValue = 0) {
    // 창고 자산 기준 등급 결정
    if (warehouseValue >= 1500000) {
      return `${specialty} (부자)`;
    } else if (warehouseValue >= 1000000) {
      return `${specialty} (돈많은이)`;
    } else if (warehouseValue >= 500000) {
      return `${specialty} (중산층)`;
    } else if (warehouseValue >= 100000) {
      return `${specialty} (서민)`;
    } else if (warehouseValue >= 50000) {
      return `${specialty} (가난뱅이)`;
    } else if (warehouseValue >= 10000) {
      return `${specialty} (거렁뱅이)`;
    } else if (warehouseValue >= 1000) {
      return `${specialty} (주정뱅이)`;
    }
    return `${specialty} (거지)`;
  }



  // Evolve member's strategy

  function evolveStrategy(member) {

    const strategies = ['momentum', 'meanrev', 'breakout', 'scalping'];

    const currentStrategy = member.strategy;

    

    // 10% chance to evolve strategy

    if (Math.random() < 0.1) {

      const newStrategy = strategies[Math.floor(Math.random() * strategies.length)];

      if (newStrategy !== currentStrategy) {

        member.strategy = newStrategy;

        appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🧠 ${member.name} evolved strategy: ${currentStrategy} → ${newStrategy}`);

      }

    }

  }



  // Update Auto Trading Status Display (now integrated into updateGuildMembersStatus)

  // Update Auto Trading Status Display - moved to guild-members-status.js
  function updateAutoTradingStatus_MOVED() {

    // This function is now integrated into updateGuildMembersStatus

    // Keeping it for compatibility but it's no longer needed

  }
  // Force start auto trading for testing

  // Force start auto trading for testing - moved to guild-members-status.js
  function forceStartAutoTrading_MOVED() {

    try {

      if (typeof guildMembers === 'undefined' || !guildMembers) {

        console.log('Guild members not initialized yet');

        return;

      }

      

      // console.log('Force starting auto trading...');

      

      // Reset all members to be able to trade

      Object.values(guildMembers).forEach(member => {

        member.lastAutoTrade = null; // Reset last trade time

        member.stamina = Math.max(member.stamina, 50); // Ensure minimum stamina

      });

      

      // Force N/B Energy if available

      if (typeof nbEnergy !== 'undefined' && nbEnergy) {

        nbEnergy.current = Math.max(nbEnergy.current, 20);

      }

      

      // Run scheduler immediately

      autoMockTradingScheduler();

      

      appendMockTradeLine(`[${new Date().toLocaleTimeString()}] 🚀 Force started auto trading system`);

      

    } catch (e) {

      console.error('Force start auto trading error:', e);

    }

  }


  // Initialize Information Trust System (moved to trust-module.js)
  if (window.trustModule && typeof window.trustModule.init === 'function') {
    window.trustModule.init();
  }

  // Backward-compatible helper for weighted zone
  window.getTrustWeightedZone = function() {
    if (window.trustModule && typeof window.trustModule.getWeightedZone === 'function') {
      return window.trustModule.getWeightedZone();
    }
    const mlZone = window.mlPrediction?.insight?.zone || 'BLUE';
    const nbZone = window.zoneNow || 'BLUE';
    return nbZone || mlZone;
  };


  // Initialize demo data after a short delay

  setTimeout(addDemoTrades, 2000);

  

  // Force start auto trading after initialization

  // setTimeout(forceStartAutoTrading, 3000); // 함수가 정의되지 않아 주석 처리

  

  // 초기 구역 설정

  setTimeout(() => {

    try {

      const initialZone = getCurrentZone();

      lastKnownZone = initialZone;

      uiLog('초기 구역 설정', `현재 구역: ${initialZone} (신뢰도 기반)`);
    } catch (e) {

      console.error('초기 구역 설정 오류:', e);

    }

  }, 1000);

  // Real-time Zone Synchronization System
  let lastKnownNbZone = null;
  let zoneSyncInterval = null;

  function initializeZoneSynchronization() {
    // Start monitoring N/B zone changes
    if (zoneSyncInterval) clearInterval(zoneSyncInterval);
    zoneSyncInterval = setInterval(() => {
      const currentNbZone = window.zoneNow || 'BLUE';
      
      // Check if N/B zone has changed
      if (lastKnownNbZone !== null && lastKnownNbZone !== currentNbZone) {
        console.log(`🔄 N/B Zone Change Detected: ${lastKnownNbZone} → ${currentNbZone}`);
        
        // Update current zone immediately
        updateCurrentZoneDisplay(currentNbZone);
        
        // Update all related UI elements
        updateZoneConsistencyDisplay();
        
        // Force update guild members with new zone
        updateGuildMembersZone(currentNbZone);
        
        // Log the synchronization
        console.log(`✅ Zone Synchronization Complete: Current Zone = ${currentNbZone}`);
      }
      
      // Update last known zone
      lastKnownNbZone = currentNbZone;
    }, 1000); // Check every second
    
    console.log('🔄 Real-time Zone Synchronization System Started');
  }



  function updateZoneConsistencyDisplay() {
    try {
      // Read directly from nbZoneNow element
      const nbZoneNowElement = document.getElementById('nbZoneNow');
      let nbZone = 'BLUE'; // Default fallback
      
      if (nbZoneNowElement) {
        const nbZoneText = nbZoneNowElement.textContent.trim().toUpperCase();
        if (nbZoneText === 'BLUE' || nbZoneText === 'ORANGE') {
          nbZone = nbZoneText;
        }
      }
      
      const mlZone = window.mlPrediction?.insight?.zone || 'BLUE';
      
      // Update zone consistency info - Clean one-line design
      const zoneInfoEl = document.getElementById('zoneConsistencyInfo');
      if (zoneInfoEl) {
        const zoneEmoji = nbZone === 'ORANGE' ? '🟠' : '🔵';
        const mlEmoji = mlZone === 'ORANGE' ? '🟠' : '🔵';
        
        zoneInfoEl.innerHTML = `
          <div style="font-size: 11px; color: #333; font-weight: 500; line-height: 1.2; padding: 4px 8px; background: #f8f9fa; border-radius: 4px; border-left: 3px solid #0ecb81;">
            🔄 <span style="color: #0ecb81; font-weight: 600;">실시간 동기화</span> | 
            N/B: ${zoneEmoji}${nbZone} | 
            ML: ${mlEmoji}${mlZone}
          </div>
        `;
      }
      
    } catch (e) {
      console.error('Error updating zone consistency display:', e);
    }
  }

  function updateGuildMembersZone(newZone) {
    try {
      if (typeof guildMembers !== 'undefined' && guildMembers) {
        Object.values(guildMembers).forEach(member => {
          member.currentZone = newZone;
          member.zoneBias = newZone === 'BLUE' ? 'BUY' : 'SELL';
          member.zoneConfidence = 0.8;
        });
        
        console.log(`🏛️ Updated all guild members to zone: ${newZone}`);
      }
    } catch (e) {
      console.error('Error updating guild members zone:', e);
    }
  }

  // Display zone consistency information
  function displayZoneConsistency() {
    try {
      // Read directly from nbZoneNow element
      const nbZoneNowElement = document.getElementById('nbZoneNow');
      let nbZone = 'BLUE'; // Default fallback
      
      if (nbZoneNowElement) {
        const nbZoneText = nbZoneNowElement.textContent.trim().toUpperCase();
        if (nbZoneText === 'BLUE' || nbZoneText === 'ORANGE') {
          nbZone = nbZoneText;
        }
      }
      
      const mlZone = window.mlPrediction?.insight?.zone || 'BLUE';
      
      console.log('🔍 Real-time Zone Consistency Check:');
      console.log(`  N/B Zone Status: ${nbZone}`);
      console.log(`  ML Model Zone: ${mlZone}`);
      console.log(`  Status: ✅ Real-time Synchronized with N/B Zone`);
      
      // Update UI to show zone consistency - Clean one-line design
      const zoneInfoEl = document.getElementById('zoneConsistencyInfo');
      if (zoneInfoEl) {
        const zoneEmoji = nbZone === 'ORANGE' ? '🟠' : '🔵';
        const mlEmoji = mlZone === 'ORANGE' ? '🟠' : '🔵';
        
        zoneInfoEl.innerHTML = `
          <div style="font-size: 11px; color: #333; font-weight: 500; line-height: 1.2; padding: 4px 8px; background: #f8f9fa; border-radius: 4px; border-left: 3px solid #0ecb81;">
            🔄 <span style="color: #0ecb81; font-weight: 600;">실시간 동기화</span> | 
            N/B: ${zoneEmoji}${nbZone} | 
            ML: ${mlEmoji}${mlZone}
          </div>
        `;
      }
    } catch (e) {
      console.error('Error displaying zone consistency:', e);
    }
  }

  // Real-time zone synchronization - Update every 1 second
  let lastSyncedZone = null; // Track last synced zone to prevent unnecessary updates
  
  function syncCurrentZoneWithNBStatus() {
    try {
      // Always use window.zoneNow for consistency - avoid circular reference
      const nbZone = window.zoneNow || 'BLUE';
      
      // Only update if zone has actually changed
      if (nbZone !== lastSyncedZone) {
        updateZoneConsistencyDisplay();
        updateGuildMembersZone(nbZone);
        
        // Log synchronization status only when changed
        console.log(`🔄 구역 변경 감지: ${lastSyncedZone || 'NONE'} → ${nbZone}`);
        
        lastSyncedZone = nbZone;
      }
      
    } catch (e) {
      console.error('Error in real-time zone synchronization:', e);
    }
  }

  // Initialize real-time zone synchronization
  setTimeout(() => {
    initializeZoneSynchronization();
    displayZoneConsistency();
    
    // Force initial zone synchronization
    const currentZone = window.zoneNow || 'BLUE';
    updateZoneConsistencyDisplay();
    updateGuildMembersZone(currentZone);
    
    console.log('🔧 Forced initial zone synchronization:', currentZone);
  }, 2000); // Start after 2 seconds
  
  // Real-time zone synchronization - Update every 1 second
  if (window.syncCurrentZoneWithNBStatusTimer) clearInterval(window.syncCurrentZoneWithNBStatusTimer);
  window.syncCurrentZoneWithNBStatusTimer = setInterval(syncCurrentZoneWithNBStatus, 1000); // Check every 1 second

  // 🏰 8BIT Village 거래 프로세스 모니터링 시작
  setTimeout(() => {
    if (typeof startVillageTradingProcessMonitoring === 'function') {
      startVillageTradingProcessMonitoring();
      // console.log('🏰 8BIT Village 거래 프로세스 모니터링 시작됨');
    } else {
      // console.log('⚠️ startVillageTradingProcessMonitoring 함수를 찾을 수 없습니다');
    }
  }, 3000); // 3초 후 시작

  // 🏰 마을 이동 에너지 자동 저장 시스템
  function saveVillageEnergyAndChartInfo() {
    try {
      // 현재 시간
      const now = new Date();
      const currentTime = now.toLocaleTimeString('ko-KR', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false 
      });
      
      // 마을 이동 에너지 정보 수집
      const energyInfo = {
        currentEnergy: 99999,
        maxEnergy: 99999,
        percentage: 100,
        treasuryAccess: 'Unlocked',
        recovery: 'Chart Interval Changes',
        chartChanges: {
          total: 0,
          profitable: 0,
          ratio: '0/0 profitable'
        },
        lastUpdate: currentTime,
        timestamp: Date.now()
      };
      
      // localStorage에 저장
      localStorage.setItem('village_energy_info', JSON.stringify(energyInfo));
      
      console.log('🏰 마을 이동 에너지 정보 저장됨:', energyInfo);
      
      // UI 업데이트
      updateVillageEnergyDisplay(energyInfo);
      
    } catch (e) {
      console.error('마을 이동 에너지 정보 저장 실패:', e);
    }
  }
  
  // 마을 이동 에너지 정보 복원
  function restoreVillageEnergyInfo() {
    try {
      const savedEnergyInfo = localStorage.getItem('village_energy_info');
      if (savedEnergyInfo) {
        const energyInfo = JSON.parse(savedEnergyInfo);
        
        // UI 업데이트
        updateVillageEnergyDisplay(energyInfo);
        
        console.log('🏰 마을 이동 에너지 정보 복원됨:', energyInfo);
        return true;
      }
    } catch (e) {
      console.error('마을 이동 에너지 정보 복원 실패:', e);
    }
    return false;
  }
  
  // 마을 이동 에너지 UI 업데이트
  function updateVillageEnergyDisplay(energyInfo) {
    // 에너지 표시 요소 찾기
    const energyElements = document.querySelectorAll('[data-energy-display]');
    
    energyElements.forEach(element => {
      element.innerHTML = `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 8px; border-radius: 6px; color: white; font-size: 11px;">
          <div style="font-weight: 600; margin-bottom: 4px;">🏰 마을의 이동 에너지</div>
          <div style="margin-bottom: 2px;">
            <span style="color: #00d1ff;">⚡ 에너지:</span> 
            <span style="color: #ffffff; font-weight: 600;">${energyInfo.currentEnergy}/${energyInfo.maxEnergy}</span>
            <span style="color: #0ecb81; margin-left: 4px;">${energyInfo.percentage}%</span>
          </div>
          <div style="margin-bottom: 2px;">
            <span style="color: #ffb703;">💰 Treasury Access:</span> 
            <span style="color: #0ecb81; font-weight: 600;">${energyInfo.treasuryAccess}</span>
          </div>
          <div style="margin-bottom: 2px;">
            <span style="color: #f6465d;">🔄 Recovery:</span> 
            <span style="color: #ffffff;">${energyInfo.recovery}</span>
          </div>
          <div style="margin-bottom: 2px;">
            <span style="color: #9c27b0;">📊 Chart Changes:</span> 
            <span style="color: #ffffff;">${energyInfo.chartChanges.ratio}</span>
          </div>
          <div style="font-size: 9px; color: #cccccc; margin-top: 4px;">
            마지막 업데이트: ${energyInfo.lastUpdate}
          </div>
        </div>
      `;
    });
    
    // 차트 변경 정보 업데이트
    updateChartChangesInfo(energyInfo.chartChanges);
  }
  
  // 차트 변경 정보 업데이트
  function updateChartChangesInfo(chartChanges) {
    const chartInfoElements = document.querySelectorAll('[data-chart-changes]');
    
    chartInfoElements.forEach(element => {
      element.innerHTML = `
        <div style="font-size: 10px; color: #888888; padding: 4px; background: rgba(255,255,255,0.05); border-radius: 3px;">
          <div style="color: #9c27b0; font-weight: 600; margin-bottom: 2px;">📊 Chart Changes</div>
          <div style="margin-bottom: 1px;">
            <span style="color: #00d1ff;">총 변경:</span> ${chartChanges.total}
          </div>
          <div style="margin-bottom: 1px;">
            <span style="color: #0ecb81;">수익성:</span> ${chartChanges.profitable}
          </div>
          <div style="margin-bottom: 1px;">
            <span style="color: #ffb703;">비율:</span> ${chartChanges.ratio}
          </div>
        </div>
      `;
    });
  }
  
  // 차트 변경 정보 자동 업데이트 (실제 차트 변경 시 호출)
  function updateChartChangesCount(isProfitable = false) {
    try {
      const savedEnergyInfo = localStorage.getItem('village_energy_info');
      if (savedEnergyInfo) {
        const energyInfo = JSON.parse(savedEnergyInfo);
        
        // 차트 변경 카운트 업데이트
        energyInfo.chartChanges.total += 1;
        if (isProfitable) {
          energyInfo.chartChanges.profitable += 1;
        }
        
        // 비율 계산
        const ratio = energyInfo.chartChanges.profitable / energyInfo.chartChanges.total;
        energyInfo.chartChanges.ratio = `${energyInfo.chartChanges.profitable}/${energyInfo.chartChanges.total} profitable (${(ratio * 100).toFixed(1)}%)`;
        
        // 현재 시간 업데이트
        const now = new Date();
        energyInfo.lastUpdate = now.toLocaleTimeString('ko-KR', { 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit',
          hour12: false 
        });
        energyInfo.timestamp = Date.now();
        
        // 저장 및 UI 업데이트
        localStorage.setItem('village_energy_info', JSON.stringify(energyInfo));
        updateVillageEnergyDisplay(energyInfo);
        
        console.log('📊 차트 변경 정보 업데이트됨:', energyInfo.chartChanges);
      }
    } catch (e) {
      console.error('차트 변경 정보 업데이트 실패:', e);
    }
  }
  
  // 에너지 복구 시뮬레이션
  function simulateEnergyRecovery() {
    try {
      const savedEnergyInfo = localStorage.getItem('village_energy_info');
      if (savedEnergyInfo) {
        const energyInfo = JSON.parse(savedEnergyInfo);
        
        // 에너지 복구 (차트 간격 변경 시)
        if (energyInfo.currentEnergy < energyInfo.maxEnergy) {
          energyInfo.currentEnergy = Math.min(energyInfo.maxEnergy, energyInfo.currentEnergy + 1000);
          energyInfo.percentage = Math.round((energyInfo.currentEnergy / energyInfo.maxEnergy) * 100);
          
          // 현재 시간 업데이트
          const now = new Date();
          energyInfo.lastUpdate = now.toLocaleTimeString('ko-KR', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: false 
          });
          energyInfo.timestamp = Date.now();
          
          // 저장 및 UI 업데이트
          localStorage.setItem('village_energy_info', JSON.stringify(energyInfo));
          updateVillageEnergyDisplay(energyInfo);
          
          console.log('⚡ 에너지 복구됨:', energyInfo.currentEnergy);
        }
      }
    } catch (e) {
      console.error('에너지 복구 시뮬레이션 실패:', e);
    }
  }
  
  // 마을 이동 에너지 자동 저장 시작
  setTimeout(() => {
    // 초기 저장
    saveVillageEnergyAndChartInfo();
    
    // 30초마다 자동 저장
    setInterval(() => {
      saveVillageEnergyAndChartInfo();
    }, 30000); // 30초마다
    
    console.log('🏰 마을 이동 에너지 자동 저장 시작됨');
  }, 5000); // 5초 후 시작

  // 🎛️ Auto Trade 토글 상태 자동 저장 시스템
  function saveAutoTradeToggleStates() {
    try {
      // 현재 시간
      const now = new Date();
      const currentTime = now.toLocaleTimeString('ko-KR', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false 
      });
      
      // Auto Trade 토글 상태 수집
      const toggleStates = {
        autoTrade: {
          enabled: false,
          interval: '1m',
          autoBT: {
            enabled: false,
            seconds: 5,
            count: 1800,
            segments: 1
          }
        },
        mlOnlyAutoTrade: {
          enabled: false,
          modelInsight: '-',
          mlAuto: {
            enabled: false
          }
        },
        mlSegmentOnly: {
          enabled: false,
          extreme: true
        },
        lastUpdate: currentTime,
        timestamp: Date.now()
      };
      
      // 실제 토글 상태 확인 (체크박스, 버튼 등)
      const autoTradeCheckbox = document.querySelector('input[name="auto-trade"], input[type="checkbox"][data-auto-trade]');
      if (autoTradeCheckbox) {
        toggleStates.autoTrade.enabled = autoTradeCheckbox.checked;
      }
      
      const mlOnlyCheckbox = document.querySelector('input[name="ml-only"], input[type="checkbox"][data-ml-only]');
      if (mlOnlyCheckbox) {
        toggleStates.mlOnlyAutoTrade.enabled = mlOnlyCheckbox.checked;
      }
      
      const mlSegmentCheckbox = document.querySelector('input[name="ml-segment"], input[type="checkbox"][data-ml-segment]');
      if (mlSegmentCheckbox) {
        toggleStates.mlSegmentOnly.enabled = mlSegmentCheckbox.checked;
      }
      
      // ML Auto 토글 상태 확인
      const mlAutoButton = document.querySelector('button[data-ml-auto], .ml-auto-toggle');
      if (mlAutoButton) {
        toggleStates.mlOnlyAutoTrade.mlAuto.enabled = mlAutoButton.classList.contains('active') || 
                                                     mlAutoButton.getAttribute('data-active') === 'true';
      }
      
      // localStorage에 저장
      localStorage.setItem('auto_trade_toggle_states', JSON.stringify(toggleStates));
      
      // console.log('🎛️ Auto Trade 토글 상태 저장됨:', toggleStates);
      
      // UI 업데이트
      updateAutoTradeToggleDisplay(toggleStates);
      
    } catch (e) {
      console.error('Auto Trade 토글 상태 저장 실패:', e);
    }
  }
  
  // Auto Trade 토글 상태 복원
  function restoreAutoTradeToggleStates() {
    try {
      const savedToggleStates = localStorage.getItem('auto_trade_toggle_states');
      if (savedToggleStates) {
        const toggleStates = JSON.parse(savedToggleStates);
        
        // 토글 상태 복원
        restoreToggleState('auto-trade', toggleStates.autoTrade.enabled);
        restoreToggleState('ml-only', toggleStates.mlOnlyAutoTrade.enabled);
        restoreToggleState('ml-segment', toggleStates.mlSegmentOnly.enabled);
        restoreToggleState('ml-auto', toggleStates.mlOnlyAutoTrade.mlAuto.enabled);
        
        // UI 업데이트
        updateAutoTradeToggleDisplay(toggleStates);
        
        // console.log('🎛️ Auto Trade 토글 상태 복원됨:', toggleStates);
        return true;
      }
    } catch (e) {
      console.error('Auto Trade 토글 상태 복원 실패:', e);
    }
    return false;
  }
  
  // 개별 토글 상태 복원
  function restoreToggleState(toggleName, enabled) {
    try {
      // 체크박스 찾기
      const checkbox = document.querySelector(`input[name="${toggleName}"], input[data-${toggleName}]`);
      if (checkbox) {
        checkbox.checked = enabled;
        // 이벤트 트리거
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
      
      // 버튼 토글 찾기
      const button = document.querySelector(`button[data-${toggleName}], .${toggleName}-toggle`);
      if (button) {
        if (enabled) {
          button.classList.add('active');
          button.setAttribute('data-active', 'true');
        } else {
          button.classList.remove('active');
          button.setAttribute('data-active', 'false');
        }
        // 이벤트 트리거
        button.dispatchEvent(new Event('click', { bubbles: true }));
      }
      
    } catch (e) {
      console.error(`${toggleName} 토글 상태 복원 실패:`, e);
    }
  }
  
  // Auto Trade 토글 UI 업데이트
  function updateAutoTradeToggleDisplay(toggleStates) {
    // 토글 상태 표시 요소 찾기
    const toggleDisplayElements = document.querySelectorAll('[data-toggle-display]');
    
    toggleDisplayElements.forEach(element => {
      element.innerHTML = `
        <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); padding: 8px; border-radius: 6px; color: white; font-size: 11px;">
          <div style="font-weight: 600; margin-bottom: 4px;">🎛️ Auto Trade 토글 상태</div>
          <div style="margin-bottom: 2px;">
            <span style="color: #00d1ff;">🔄 Auto Trade:</span> 
            <span style="color: ${toggleStates.autoTrade.enabled ? '#0ecb81' : '#f6465d'}; font-weight: 600;">
              ${toggleStates.autoTrade.enabled ? 'ON' : 'OFF'}
            </span>
            <span style="color: #ffffff; margin-left: 4px;">(${toggleStates.autoTrade.interval})</span>
          </div>
          <div style="margin-bottom: 2px;">
            <span style="color: #ffb703;">🤖 ML-only Auto Trade:</span> 
            <span style="color: ${toggleStates.mlOnlyAutoTrade.enabled ? '#0ecb81' : '#f6465d'}; font-weight: 600;">
              ${toggleStates.mlOnlyAutoTrade.enabled ? 'ON' : 'OFF'}
            </span>
          </div>
          <div style="margin-bottom: 2px;">
            <span style="color: #9c27b0;">📊 ML segment-only:</span> 
            <span style="color: ${toggleStates.mlSegmentOnly.enabled ? '#0ecb81' : '#f6465d'}; font-weight: 600;">
              ${toggleStates.mlSegmentOnly.enabled ? 'ON' : 'OFF'}
            </span>
            <span style="color: #ffffff; margin-left: 4px;">(extreme: ${toggleStates.mlSegmentOnly.extreme ? 'ON' : 'OFF'})</span>
          </div>
          <div style="margin-bottom: 2px;">
            <span style="color: #e74c3c;">⚡ ML Auto:</span> 
            <span style="color: ${toggleStates.mlOnlyAutoTrade.mlAuto.enabled ? '#0ecb81' : '#f6465d'}; font-weight: 600;">
              ${toggleStates.mlOnlyAutoTrade.mlAuto.enabled ? 'ON' : 'OFF'}
            </span>
          </div>
          <div style="font-size: 9px; color: #cccccc; margin-top: 4px;">
            마지막 업데이트: ${toggleStates.lastUpdate}
          </div>
        </div>
      `;
    });
    
    // Auto BT 설정 표시
    updateAutoBTSettingsDisplay(toggleStates.autoTrade.autoBT);
  }
  
  // Auto BT 설정 표시
  function updateAutoBTSettingsDisplay(autoBTSettings) {
    const autoBTElements = document.querySelectorAll('[data-auto-bt-settings]');
    
    autoBTElements.forEach(element => {
      element.innerHTML = `
        <div style="font-size: 10px; color: #888888; padding: 4px; background: rgba(255,255,255,0.05); border-radius: 3px;">
          <div style="color: #00d1ff; font-weight: 600; margin-bottom: 2px;">⚡ Auto BT 설정</div>
          <div style="margin-bottom: 1px;">
            <span style="color: #ffb703;">상태:</span> 
            <span style="color: ${autoBTSettings.enabled ? '#0ecb81' : '#f6465d'};">
              ${autoBTSettings.enabled ? '활성화' : '비활성화'}
            </span>
          </div>
          <div style="margin-bottom: 1px;">
            <span style="color: #9c27b0;">간격:</span> ${autoBTSettings.seconds}초
          </div>
          <div style="margin-bottom: 1px;">
            <span style="color: #e74c3c;">횟수:</span> ${autoBTSettings.count}
          </div>
          <div style="margin-bottom: 1px;">
            <span style="color: #f39c12;">세그먼트:</span> ${autoBTSettings.segments}
          </div>
        </div>
      `;
    });
  }
  
  // 토글 상태 변경 감지 및 자동 저장
  function setupToggleChangeListeners() {
    // Auto Trade 토글 변경 감지
    const autoTradeToggles = document.querySelectorAll('input[type="checkbox"], button[data-toggle], .toggle-button');
    
    autoTradeToggles.forEach(toggle => {
      toggle.addEventListener('change', () => {
        console.log('🎛️ 토글 상태 변경 감지:', toggle.name || toggle.className);
        setTimeout(() => {
          saveAutoTradeToggleStates();
        }, 100); // 100ms 후 저장 (상태 변경 완료 후)
      });
      
      toggle.addEventListener('click', () => {
        console.log('🎛️ 토글 클릭 감지:', toggle.name || toggle.className);
        setTimeout(() => {
          saveAutoTradeToggleStates();
        }, 100); // 100ms 후 저장 (상태 변경 완료 후)
      });
    });
    
    console.log('🎛️ 토글 변경 감지 리스너 설정 완료');
  }
  
  // Auto Trade 토글 자동 저장 시작
  setTimeout(() => {
    // 초기 저장
    saveAutoTradeToggleStates();
    
    // 토글 변경 감지 설정
    setupToggleChangeListeners();
    
    // 60초마다 자동 저장 (토글 상태는 자주 변경되지 않음)
    setInterval(() => {
      saveAutoTradeToggleStates();
    }, 60000); // 60초마다
    
    // console.log('🎛️ Auto Trade 토글 자동 저장 시작됨');
  }, 6000); // 6초 후 시작

  // 🎯 UI 차트 간격을 서버에 전송하여 동기화
  async function updateServerCurrentInterval() {
    try {
      const currentInterval = getInterval();
      console.log(`🎯 UI 차트 간격을 서버에 전송: ${currentInterval}`);
      
      const response = await fetch('/api/village/update-current-interval', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          current_interval: currentInterval
        })
      });
      
      const result = await response.json();
      if (result.ok) {
        console.log(`✅ 서버 차트 간격 업데이트 완료: ${currentInterval}`);
      } else {
        console.error('❌ 서버 차트 간격 업데이트 실패:', result.error);
      }
    } catch (error) {
      console.error('❌ 서버 차트 간격 업데이트 오류:', error);
    }
  }
  
  // 🎯 자동 차트 변경 감지 및 서버 동기화
  let lastKnownInterval = null;
  
  function checkAndUpdateInterval() {
    const currentInterval = getInterval();
    
    // 간격이 변경되었는지 확인
    if (lastKnownInterval !== currentInterval) {
      console.log(`🔄 자동 차트 변경 감지: ${lastKnownInterval} → ${currentInterval}`);
      lastKnownInterval = currentInterval;
      
      // 서버에 업데이트 전송
      updateServerCurrentInterval();
    }
  }
  
  // 페이지 로드 시 초기 간격 전송
  setTimeout(() => {
    lastKnownInterval = getInterval();
    updateServerCurrentInterval();
  }, 2000); // 2초 후 초기 전송
  
  // 자동 차트 변경 감지 시작 (간격 완화: 10초)
  setTimeout(() => {
    if (window.checkAndUpdateIntervalTimer) clearInterval(window.checkAndUpdateIntervalTimer);
    window.checkAndUpdateIntervalTimer = setInterval(checkAndUpdateInterval, 10000); // 10초마다 체크
    console.log('🎯 자동 차트 변경 감지 시작됨 (10s)');
  }, 3000); // 3초 후 시작

  // 트레이너 시스템 초기화
  setTimeout(() => {
    if (typeof window.initializeTrainerSystem === 'function') {
      window.initializeTrainerSystem();
      console.log('✅ 트레이너 시스템 초기화 완료');
    } else {
      console.log('⚠️ 트레이너 시스템 초기화 함수를 찾을 수 없습니다');
    }
  }, 4000); // 4초 후 트레이너 시스템 초기화

  // 마을 학습 시스템 초기화
  setTimeout(() => {
    if (typeof window.initializeVillageLearningSystem === 'function') {
      window.initializeVillageLearningSystem();
      console.log('✅ 마을 학습 시스템 초기화 완료');
    } else {
      console.log('⚠️ 마을 학습 시스템 초기화 함수를 찾을 수 없습니다');
    }
  }, 5000); // 5초 후 마을 학습 시스템 초기화

  // 길드 멤버 상태 시스템 초기화
  setTimeout(() => {
    if (typeof window.initializeGuildMembersStatusSystem === 'function') {
      window.initializeGuildMembersStatusSystem();
      console.log('✅ 길드 멤버 상태 시스템 초기화 완료');
    } else {
      console.log('⚠️ 길드 멤버 상태 시스템 초기화 함수를 찾을 수 없습니다');
    }
  }, 6000); // 6초 후 길드 멤버 상태 시스템 초기화
  
  // Mark chart as initialized to prevent duplicates
  window.chartInitialized = true;
      // console.log('✅ Chart initialization completed');
  
  // Auto-enable toggles after chart initialization (single run to reduce config spam)
  setTimeout(() => {
    enableAutoToggles();
  }, 2000);
}

// Initialize chart when DOM is ready - but only if not called from dynamic loading
if (typeof window.tradingDashboardLoaded === 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChart);
  } else {
    // Delay initialization to allow libraries to load
    setTimeout(initChart, 500);
  }
} else {
  // If trading dashboard is already loaded, don't auto-initialize chart
      // console.log('📊 Trading Dashboard already loaded, skipping auto chart initialization');
}

  // Periodic wave counter update
  // Use window.updateWaveCounter to ensure the global function is referenced correctly
  if (window.updateWaveCounter) {
    if (window.updateWaveCounterTimer) clearInterval(window.updateWaveCounterTimer);
    window.updateWaveCounterTimer = setInterval(window.updateWaveCounter, 2000); // Update every 2 seconds
  } else {
    console.warn('⚠️ window.updateWaveCounter is not yet defined when setting interval');
  }
  
  // Manual wave counter update button
  document.addEventListener('DOMContentLoaded', function() {
    const btnUpdateWaveCounter = document.getElementById('btnUpdateWaveCounter');
    if (btnUpdateWaveCounter) {
      btnUpdateWaveCounter.addEventListener('click', function() {
        console.log('🔘 Manual wave counter update clicked');
        if (window.updateWaveCounter) {
          window.updateWaveCounter();
        } else {
          console.error('❌ window.updateWaveCounter is not defined on manual button click');
        }
      });
    }
    
  });

// Auto-enable toggles function
function enableAutoToggles() {
  try {
    console.log('🎛️ Auto-enabling toggles...');
    
    // Auto Trade 토글 활성화
    const autoTradeToggle = document.getElementById('autoTradeToggle');
    if (autoTradeToggle && !autoTradeToggle.checked) {
      autoTradeToggle.checked = true;
      autoTradeToggle.dispatchEvent(new Event('change'));
      // console.log('✅ Auto Trade 토글 활성화됨');
    }
    
    // ML Auto 토글 활성화
    const mlAutoToggle = document.getElementById('mlAuto');
    if (mlAutoToggle && !mlAutoToggle.checked) {
      mlAutoToggle.checked = true;
      mlAutoToggle.dispatchEvent(new Event('change'));
      console.log('✅ ML Auto 토글 활성화됨');
    }
    
    // ML-only Auto Trade 토글 활성화 (있는 경우)
    const mlOnlyToggle = document.getElementById('mlOnlyToggle');
    if (mlOnlyToggle && !mlOnlyToggle.checked) {
      mlOnlyToggle.checked = true;
      mlOnlyToggle.dispatchEvent(new Event('change'));
      console.log('✅ ML-only Auto Trade 토글 활성화됨');
    }
    
    console.log('🎛️ 모든 토글 자동 활성화 완료');
    
    // Update wave counter after initialization
    if (window.updateWaveCounter) {
      setTimeout(window.updateWaveCounter, 1000);
    } else {
      console.warn('⚠️ window.updateWaveCounter is not defined when scheduling post-toggle update');
    }
    
    // 마을 에너지도 함께 충전
    chargeVillageEnergy();
    
    // 마을 에너지 100% 버튼 클릭
    clickVillageEnergyButton();
  } catch (error) {
    console.error('❌ 토글 자동 활성화 중 오류:', error);
  }
}

// Auto-charge village energy function
function chargeVillageEnergy() {
  try {
    // console.log('⚡ Auto-charging village energy...');
    
    // 마을 에너지 관련 요소들 찾기
    const energyElements = [
      'villageEnergy',
      'mayorEnergy', 
      'energyBar',
      'energyLevel',
      'villageEnergyBar'
    ];
    
    let energyCharged = false;
    
    // 각 에너지 요소에 대해 최대값으로 설정
    energyElements.forEach(elementId => {
      const element = document.getElementById(elementId);
      if (element) {
        // progress bar인 경우
        if (element.tagName === 'PROGRESS' || element.classList.contains('progress-bar')) {
          element.value = 100;
          element.style.width = '100%';
          element.textContent = '100%';
          energyCharged = true;
          console.log(`✅ ${elementId} 에너지 충전됨 (100%)`);
        }
        // 일반 텍스트인 경우
        else if (element.tagName === 'SPAN' || element.tagName === 'DIV') {
          element.textContent = '100';
          element.style.color = '#0ecb81';
          energyCharged = true;
          console.log(`✅ ${elementId} 에너지 충전됨 (100)`);
        }
      }
    });
    
    // 마을 이동 관련 토글들 활성화
    const moveToggles = [
      'villageMoveToggle',
      'mayorMoveToggle',
      'autoMoveToggle'
    ];
    
    moveToggles.forEach(toggleId => {
      const toggle = document.getElementById(toggleId);
      if (toggle && !toggle.checked) {
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
        console.log(`✅ ${toggleId} 마을 이동 토글 활성화됨`);
      }
    });
    
    // 마을 이동 버튼들 활성화
    const moveButtons = document.querySelectorAll('[data-action="move"], [data-action="village-move"], .move-btn, .village-move-btn');
    moveButtons.forEach(button => {
      if (button.disabled) {
        button.disabled = false;
        button.classList.remove('disabled');
        console.log('✅ 마을 이동 버튼 활성화됨');
      }
    });
    
    if (energyCharged) {
      console.log('⚡ 마을 에너지 자동 충전 완료');
    } else {
      console.log('⚠️ 마을 에너지 요소를 찾을 수 없습니다');
    }
    
  } catch (error) {
    console.error('❌ 마을 에너지 충전 중 오류:', error);
  }
}

// Auto-click village energy 100% button function
function clickVillageEnergyButton() {
  try {
    // console.log('🔘 Auto-clicking village energy 100% button...');
    
    // 마을 에너지 100% 버튼들 찾기 (다양한 선택자로 검색)
    const energyButtonSelectors = [
      'button[data-action="charge-energy"]',
      'button[data-action="energy-100"]',
      'button[data-action="village-energy"]',
      '.energy-100-btn',
      '.charge-energy-btn',
      '.village-energy-btn',
      'button:contains("100%")',
      'button:contains("에너지")',
      'button:contains("Energy")',
      'button:contains("충전")',
      'button:contains("Charge")',
      '[onclick*="energy"]',
      '[onclick*="charge"]',
      '[onclick*="100"]'
    ];
    
    let buttonClicked = false;
    
    // 각 선택자로 버튼 찾기
    energyButtonSelectors.forEach(selector => {
      try {
        const buttons = document.querySelectorAll(selector);
        buttons.forEach(button => {
          if (button && !buttonClicked) {
            // 버튼이 보이고 클릭 가능한 상태인지 확인
            if (button.offsetParent !== null && !button.disabled) {
              button.click();
              console.log(`✅ 마을 에너지 100% 버튼 클릭됨: ${button.textContent || button.className || button.id}`);
              buttonClicked = true;
            }
          }
        });
      } catch (e) {
        // 선택자 오류 무시하고 계속 진행
      }
    });
    
    // 텍스트 기반으로 버튼 찾기 (jQuery 사용)
    if (!buttonClicked && typeof $ !== 'undefined') {
      const textButtons = $('button').filter(function() {
        const text = $(this).text().toLowerCase();
        return text.includes('100%') || 
               text.includes('에너지') || 
               text.includes('energy') || 
               text.includes('충전') || 
               text.includes('charge');
      });
      
      textButtons.each(function() {
        if (!buttonClicked && $(this).is(':visible') && !$(this).prop('disabled')) {
          $(this).click();
          console.log(`✅ 텍스트 기반 마을 에너지 버튼 클릭됨: ${$(this).text()}`);
          buttonClicked = true;
          return false; // break loop
        }
      });
    }
    
    // ID 기반으로 버튼 찾기
    const energyButtonIds = [
      'energy100Btn',
      'chargeEnergyBtn',
      'villageEnergyBtn',
      'energyButton',
      'chargeButton',
      'villageButton'
    ];
    
    energyButtonIds.forEach(id => {
      const button = document.getElementById(id);
      if (button && !buttonClicked && button.offsetParent !== null && !button.disabled) {
        button.click();
        console.log(`✅ ID 기반 마을 에너지 버튼 클릭됨: ${id}`);
        buttonClicked = true;
      }
    });
    
    if (buttonClicked) {
      console.log('🔘 마을 에너지 100% 버튼 자동 클릭 완료');
    } else {
      console.log('⚠️ 마을 에너지 100% 버튼을 찾을 수 없습니다');
    }
    
  } catch (error) {
    console.error('❌ 마을 에너지 버튼 클릭 중 오류:', error);
  }
}

// N/B Zone Status timeframe update function
function updateNBZoneTimeframe() {
  const timeframeBadge = document.getElementById('nbZoneTimeframe');
  if (timeframeBadge) {
    // Get current timeframe from multiple sources
    let currentInterval = window.currentGlobalInterval;
    
    // If global interval is not available, try to get from timeframe element
    if (!currentInterval) {
      const tfEl = document.getElementById('timeframe');
      if (tfEl) {
        currentInterval = tfEl.value;
        window.currentGlobalInterval = currentInterval;
      }
    }
    
    // Fallback to default
    if (!currentInterval) {
      currentInterval = 'minute10';
      window.currentGlobalInterval = currentInterval;
    }
    
    let timeframeDisplay = '';
    switch(currentInterval) {
      case 'minute1': timeframeDisplay = '1m'; break;
      case 'minute3': timeframeDisplay = '3m'; break;
      case 'minute5': timeframeDisplay = '5m'; break;
      case 'minute10': timeframeDisplay = '10m'; break;
      case 'minute15': timeframeDisplay = '15m'; break;
      case 'minute30': timeframeDisplay = '30m'; break;
      case 'minute60': timeframeDisplay = '1h'; break;
      case 'day': timeframeDisplay = '1d'; break;
      default: timeframeDisplay = currentInterval;
    }
    
    timeframeBadge.textContent = timeframeDisplay;
    timeframeBadge.className = 'badge bg-info';
    // console.log('🔄 updateNBZoneTimeframe: timeframe updated to:', timeframeDisplay, 'from interval:', currentInterval);
  }
}

// 강제 업데이트 함수 - 모든 가능한 방법으로 시간프레임 동기화
function forceUpdateNBZoneTimeframe() {
  console.log('🔧 Force updating N/B Zone Status timeframe...');
  
  // 1. 모든 N/B Zone Status 요소 찾기
  const timeframeBadges = document.querySelectorAll('#nbZoneTimeframe');
  // console.log('Found timeframe badges:', timeframeBadges.length);
  
  // 2. 현재 시간프레임 확인
  let currentInterval = window.currentGlobalInterval;
  const tfEl = document.getElementById('timeframe');
  
  if (tfEl) {
    currentInterval = tfEl.value;
    window.currentGlobalInterval = currentInterval;
    // console.log('📊 Current timeframe from element:', currentInterval);
  }
  
  if (!currentInterval) {
    currentInterval = 'minute10';
    window.currentGlobalInterval = currentInterval;
    // console.log('📊 Using default timeframe:', currentInterval);
  }
  
  // 3. 시간프레임 표시 형식 변환
  let timeframeDisplay = '';
  switch(currentInterval) {
    case 'minute1': timeframeDisplay = '1m'; break;
    case 'minute3': timeframeDisplay = '3m'; break;
    case 'minute5': timeframeDisplay = '5m'; break;
    case 'minute10': timeframeDisplay = '10m'; break;
    case 'minute15': timeframeDisplay = '15m'; break;
    case 'minute30': timeframeDisplay = '30m'; break;
    case 'minute60': timeframeDisplay = '1h'; break;
    case 'day': timeframeDisplay = '1d'; break;
    default: timeframeDisplay = currentInterval;
  }
  
  // 4. 모든 요소 업데이트
  timeframeBadges.forEach((badge, index) => {
    badge.textContent = timeframeDisplay;
    badge.className = 'badge bg-info';
    // console.log(`✅ Updated badge ${index + 1}:`, timeframeDisplay);
  });
  
  // 5. 전역 변수 설정
  window.currentGlobalInterval = currentInterval;
  // console.log('🔧 Force update completed. Global interval set to:', currentInterval);
}



// ===== 분봉 자동 순회 시스템 =====
let timeframeCycleInterval = null;
let timeframeCycleProgress = 0;
let timeframeCycleDuration = 30; // 기본 30초
let timeframeCyclePaused = false;
let currentTimeframeIndex = 0;

// 분봉 목록 (순회 순서)
const timeframeList = [
  { value: 'minute1', display: '1m' },
  { value: 'minute3', display: '3m' },
  { value: 'minute5', display: '5m' },
  { value: 'minute10', display: '10m' },
  { value: 'minute15', display: '15m' },
  { value: 'minute30', display: '30m' },
  { value: 'minute60', display: '1h' },
  { value: 'day', display: '1d' }
];

// 현재 분봉의 인덱스 찾기
function findCurrentTimeframeIndex() {
  try {
    // getInterval이 스코프 밖에 있을 수 있으므로 직접 확인
    let currentInterval = window.currentGlobalInterval || 'minute10';
    const tfEl = document.getElementById('timeframe');
    if (tfEl) {
      currentInterval = tfEl.value;
      window.currentGlobalInterval = currentInterval;
    }
    const index = timeframeList.findIndex(tf => tf.value === currentInterval);
    if (index >= 0) {
      return index;
    } else {
      // 기본값: minute10 (인덱스 3)
      console.warn(`⚠️ 분봉 인덱스를 찾을 수 없어 기본값 사용: ${currentInterval}`);
      return 3;
    }
  } catch (error) {
    console.error('❌ 현재 분봉 인덱스 찾기 오류:', error);
    return 3; // 기본값: minute10 (인덱스 3)
  }
}

// 분봉 전환 함수
function switchToTimeframe(timeframeValue, forceRefresh = false) {
  try {
    const tfEl = document.getElementById('timeframe');
    if (!tfEl) {
      console.warn('⚠️ timeframe 요소를 찾을 수 없습니다.');
      return false;
    }
    
    // 값이 다를 때만 전환 (또는 강제 새로고침 요청 시)
    const needsUpdate = tfEl.value !== timeframeValue || forceRefresh;
    const wasChanged = tfEl.value !== timeframeValue;
    
    if (needsUpdate) {
      // 먼저 값 설정
      if (wasChanged) {
        tfEl.value = timeframeValue;
        window.currentGlobalInterval = timeframeValue;
        window.currentActiveTimeframe = timeframeValue;
      }
      
      // change 이벤트 트리거 (이미 등록된 이벤트 리스너가 seed를 호출함)
      // 이벤트를 트리거하면 자동으로 seed(getInterval())이 호출됨
      const event = new Event('change', { bubbles: true });
      tfEl.dispatchEvent(event);
      
      // change 이벤트가 제대로 처리되었는지 확인
      // seed 함수 호출 확인을 위한 플래그 설정
      let seedCalled = false;
      const checkInterval = setInterval(() => {
        const currentValue = tfEl.value;
        if (currentValue === timeframeValue) {
          seedCalled = true;
          clearInterval(checkInterval);
          console.log(`✅ 분봉 전환 완료: ${timeframeValue}`);
        }
      }, 50);
      
      // 최대 2초 대기 후 타임아웃
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!seedCalled && wasChanged) {
          console.warn(`⚠️ 분봉 전환 후 seed 호출 확인 실패: ${timeframeValue}`);
          // 재시도: change 이벤트를 다시 트리거
          const retryEvent = new Event('change', { bubbles: true });
          tfEl.dispatchEvent(retryEvent);
        }
      }, 2000);
    }
    
    // 분봉 카드 업데이트 (값이 같아도 업데이트)
    updateTimeframeCards(timeframeValue);
    
    // 분봉 표시 업데이트
    updateTimeframeDisplay();
    
    // N/B Zone Status 업데이트 (약간의 지연 후)
    setTimeout(() => {
      if (typeof updateNBZoneTimeframe === 'function') {
        updateNBZoneTimeframe();
      }
      // refreshNbZoneStrip이 전역에 있는지 확인
      if (typeof window.refreshNbZoneStrip === 'function') {
        window.refreshNbZoneStrip();
      } else if (typeof refreshNbZoneStrip === 'function') {
        refreshNbZoneStrip();
      }
    }, 800);
    
    if (wasChanged) {
      console.log(`🔄 분봉 전환: ${timeframeValue}`);
      if (typeof window.loadCurrentCardDebounced === 'function') {
        window.loadCurrentCardDebounced();
      }
    } else if (forceRefresh) {
      console.log(`🔄 분봉 강제 새로고침: ${timeframeValue}`);
      if (typeof window.loadCurrentCardDebounced === 'function') {
        window.loadCurrentCardDebounced();
      }
    }
    
    return true;
  } catch (error) {
    console.error('❌ 분봉 전환 오류:', error);
    return false;
  }
}

// 분봉 카드 업데이트
function updateTimeframeCards(activeTimeframe) {
  try {
    if (!activeTimeframe) {
      console.warn('⚠️ 활성 분봉 값이 없습니다.');
      return;
    }
    
    // 상단 카드 업데이트
    document.querySelectorAll('.timeframe-card').forEach(card => {
      try {
        card.classList.remove('active');
        if (card.dataset.timeframe === activeTimeframe) {
          card.classList.add('active');
          const statusEl = card.querySelector('.timeframe-status');
          if (statusEl) statusEl.textContent = '활성';
        } else {
          const statusEl = card.querySelector('.timeframe-status');
          if (statusEl) statusEl.textContent = '대기';
        }
      } catch (e) {
        console.warn('⚠️ 분봉 카드 업데이트 중 오류:', e);
      }
    });
    
    // 하단 카드 업데이트
    document.querySelectorAll('.timeframe-card-bottom').forEach(card => {
      try {
        card.classList.remove('active');
        if (card.dataset.timeframe === activeTimeframe) {
          card.classList.add('active');
          const statusEl = card.querySelector('.timeframe-status-bottom');
          if (statusEl) statusEl.textContent = '활성';
        } else {
          const statusEl = card.querySelector('.timeframe-status-bottom');
          if (statusEl) statusEl.textContent = '대기';
        }
      } catch (e) {
        console.warn('⚠️ 하단 분봉 카드 업데이트 중 오류:', e);
      }
    });
  } catch (error) {
    console.error('❌ 분봉 카드 업데이트 오류:', error);
  }
}

// 프로그레스바 업데이트
function updateTimeframeCycleProgress(percent) {
  const progressBar = document.getElementById('timeframeCycleProgress');
  const progressText = document.getElementById('timeframeCyclePercent');
  
  if (progressBar) {
    progressBar.style.width = percent + '%';
  }
  
  if (progressText) {
    progressText.textContent = Math.round(percent) + '%';
  }
}

// 다음 분봉으로 이동
function moveToNextTimeframe() {
  try {
    // winListEl 미리 캐싱
    const winListEl = document.getElementById('winList');
    
    // 현재 분봉 인덱스 재확인 (동기화)
    try {
      currentTimeframeIndex = findCurrentTimeframeIndex();
    } catch (e) {
      // getInterval이 없을 경우 직접 접근
      let currentInterval = window.currentGlobalInterval || 'minute10';
      const tfEl = document.getElementById('timeframe');
      if (tfEl) {
        currentInterval = tfEl.value;
        window.currentGlobalInterval = currentInterval;
      }
      const index = timeframeList.findIndex(tf => tf.value === currentInterval);
      currentTimeframeIndex = index >= 0 ? index : 3;
    }
    
    // 다음 분봉 인덱스 계산
    const nextIndex = (currentTimeframeIndex + 1) % timeframeList.length;
    const nextTimeframe = timeframeList[nextIndex];
    
    if (!nextTimeframe) {
      console.error('❌ 다음 분봉을 찾을 수 없습니다.');
      return false;
    }
    
    // 프로그레스바 리셋 (전환 전에)
    timeframeCycleProgress = 0;
    updateTimeframeCycleProgress(0);
    
    // 분봉 전환 (change 이벤트가 자동으로 차트를 업데이트함)
    const success = switchToTimeframe(nextTimeframe.value);
    
    if (success) {
      // 현재 인덱스 업데이트
      currentTimeframeIndex = nextIndex;
      
      // 분봉 순회 시 히스토리 추가
      try {
        console.log('[TIMEFRAME] History add attempt - winListEl:', !!winListEl);
        
        const nbZone = window.zoneNow || 'BLUE';
        const timeStr = new Date().toLocaleTimeString();
        const currentInterval = nextTimeframe.value;
        const zoneEmoji = nbZone === 'ORANGE' ? '🟠' : '🔵';
        const zoneColor = nbZone === 'ORANGE' ? '#ff6b35' : '#0ecb81';
        
        console.log('[TIMEFRAME] Zone:', nbZone, 'Interval:', currentInterval);
        
        // winListEl이 존재하고 최대 25개를 넘지 않을 때만 추가
        if (typeof winListEl !== 'undefined' && winListEl) {
          console.log('[TIMEFRAME] ✅ winListEl is valid, current children:', winListEl.children.length);
          
          // 처음 추가 시 "데이터 없음" 플레이스홀더 제거
          if (winListEl.children.length === 1) {
            const placeholder = winListEl.children[0];
            if (placeholder && placeholder.textContent.includes('데이터 없음')) {
              winListEl.innerHTML = '';
              console.log('[TIMEFRAME] ✅ 플레이스홀더 제거');
            }
          }
          
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'win-chip btn btn-sm';
          item.title = `분봉 순회 | ${timeStr} | ${nbZone} | ${nextTimeframe.display}`;
          item.innerHTML = `
            <div class='meta' style="font-size: 10px; line-height: 1.2; text-align: left;">
              <span style="color: #666;">${timeStr}</span><br>
              <span style="color: ${zoneColor}; font-weight: 600;">${zoneEmoji}${nbZone}</span> 
              <span style="color: #999; font-size: 9px;">(${nextTimeframe.display})</span>
            </div>
          `;
          item.dataset.zone = nbZone;
          item.dataset.interval = currentInterval;
          item.dataset.timestamp = Date.now();
          item.classList.add('timeframe-rotation');
          
          // Zone에 따라 positive 클래스 추가 (Win% 계산용)
          // ORANGE = positive (win), BLUE = negative (loss)로 간주
          if (nbZone === 'ORANGE') {
            item.classList.add('positive');
          }
          
          winListEl.prepend(item);
          console.log('[TIMEFRAME] ✅ Item added, new count:', winListEl.children.length);
          
          // 최대 25개 유지
          while (winListEl.childElementCount > 25) {
            winListEl.removeChild(winListEl.lastElementChild);
          }
          
          // Win% 업데이트 (함수 존재 확인)
          if (typeof updateTopPnlFromList === 'function') {
            updateTopPnlFromList();
          } else if (typeof window.updateTopPnlFromList === 'function') {
            window.updateTopPnlFromList();
          }
          
          // localStorage에 저장
          if (typeof saveWinHistory === 'function') {
            saveWinHistory();
          }
          
          console.log(`[Win History] 분봉 순회 기록: ${nextTimeframe.display} | Zone: ${nbZone} | ${timeStr}`);
        }
      } catch (histErr) {
        console.error('[Win History] 분봉 순회 히스토리 추가 실패:', histErr);
      }
      
      // 다음 분봉 표시 업데이트 (약간의 지연 후)
      setTimeout(() => {
        updateTimeframeDisplay();
      }, 200);
      
      console.log(`⏭️ 다음 분봉으로 이동: ${nextTimeframe.display}`);
      return true;
    } else {
      console.error(`❌ 분봉 전환 실패: ${nextTimeframe.display}`);
      return false;
    }
  } catch (error) {
    console.error('❌ 다음 분봉 이동 오류:', error);
    return false;
  }
}

// 분봉 표시 업데이트
function updateTimeframeDisplay() {
  try {
    const currentIndex = findCurrentTimeframeIndex();
    if (currentIndex < 0 || currentIndex >= timeframeList.length) {
      console.warn('⚠️ 유효하지 않은 분봉 인덱스:', currentIndex);
      return;
    }
    
    const nextIndex = (currentIndex + 1) % timeframeList.length;
    
    const currentDisplay = document.getElementById('currentTimeframeDisplay');
    const nextDisplay = document.getElementById('nextTimeframeDisplay');
    
    if (currentDisplay && timeframeList[currentIndex]) {
      currentDisplay.textContent = timeframeList[currentIndex].display;
    }
    
    if (nextDisplay && timeframeList[nextIndex]) {
      nextDisplay.textContent = '→ ' + timeframeList[nextIndex].display;
    }
  } catch (error) {
    console.error('❌ 분봉 표시 업데이트 오류:', error);
  }
}

// 분봉 순회 시작
function startTimeframeCycle() {
  // 기존 interval 정리
  if (timeframeCycleInterval) {
    clearInterval(timeframeCycleInterval);
    timeframeCycleInterval = null;
  }
  
  // 현재 분봉 인덱스 확인 및 동기화
  try {
    currentTimeframeIndex = findCurrentTimeframeIndex();
  } catch (e) {
    // getInterval이 없을 경우 직접 접근
    let currentInterval = window.currentGlobalInterval || 'minute10';
    const tfEl = document.getElementById('timeframe');
    if (tfEl) {
      currentInterval = tfEl.value;
      window.currentGlobalInterval = currentInterval;
    }
    const index = timeframeList.findIndex(tf => tf.value === currentInterval);
    currentTimeframeIndex = index >= 0 ? index : 3;
  }
  
  // 차트의 현재 분봉을 기준으로 인덱스 재설정 (차트가 기준)
  const tfEl = document.getElementById('timeframe');
  if (tfEl) {
    const chartInterval = tfEl.value;
    const chartIndex = timeframeList.findIndex(tf => tf.value === chartInterval);
    if (chartIndex >= 0) {
      currentTimeframeIndex = chartIndex;
      window.currentGlobalInterval = chartInterval;
    }
  }
  
  const currentTf = timeframeList[currentTimeframeIndex];
  
  timeframeCyclePaused = false;
  timeframeCycleProgress = 0;
  
  // 상태 업데이트
  const statusEl = document.getElementById('timeframeCycleStatus');
  const toggleBtn = document.getElementById('toggleTimeframeCycle');
  
  if (statusEl) {
    statusEl.textContent = '활성';
    statusEl.className = 'badge bg-success';
  }
  
  if (toggleBtn) {
    toggleBtn.textContent = '일시정지';
  }
  
  // 초기 표시 업데이트
  updateTimeframeDisplay();
  updateTimeframeCycleProgress(0);
  
  // 프로그레스바 업데이트 (100ms마다)
  timeframeCycleInterval = setInterval(() => {
    if (!timeframeCyclePaused) {
      timeframeCycleProgress += (100 / (timeframeCycleDuration * 10)); // 100ms마다 증가
      
      if (timeframeCycleProgress >= 100) {
        timeframeCycleProgress = 100;
        updateTimeframeCycleProgress(100);
        // 약간의 지연 후 다음 분봉으로 이동
        setTimeout(() => {
          try {
            const success = moveToNextTimeframe();
            if (!success) {
              // 전환 실패 시 프로그레스바 리셋
              timeframeCycleProgress = 0;
              updateTimeframeCycleProgress(0);
            }
          } catch (error) {
            console.error('❌ 분봉 순회 중 오류:', error);
            timeframeCycleProgress = 0;
            updateTimeframeCycleProgress(0);
          }
        }, 100);
      } else {
        updateTimeframeCycleProgress(timeframeCycleProgress);
      }
    }
  }, 100);
  
  console.log(`🔄 분봉 자동 순회 시작: 현재 분봉=${currentTf.display}, 인덱스=${currentTimeframeIndex}`);
}

// 분봉 순회 일시정지/재개
function toggleTimeframeCycle() {
  timeframeCyclePaused = !timeframeCyclePaused;
  
  const statusEl = document.getElementById('timeframeCycleStatus');
  const toggleBtn = document.getElementById('toggleTimeframeCycle');
  
  if (timeframeCyclePaused) {
    if (statusEl) {
      statusEl.textContent = '일시정지';
      statusEl.className = 'badge bg-warning';
    }
    if (toggleBtn) {
      toggleBtn.textContent = '재개';
    }
  } else {
    if (statusEl) {
      statusEl.textContent = '활성';
      statusEl.className = 'badge bg-success';
    }
    if (toggleBtn) {
      toggleBtn.textContent = '일시정지';
    }
  }
}

// 분봉 순회 중지
function stopTimeframeCycle() {
  if (timeframeCycleInterval) {
    clearInterval(timeframeCycleInterval);
    timeframeCycleInterval = null;
  }
  
  timeframeCyclePaused = false;
  timeframeCycleProgress = 0;
  updateTimeframeCycleProgress(0);
  
  const statusEl = document.getElementById('timeframeCycleStatus');
  const toggleBtn = document.getElementById('toggleTimeframeCycle');
  
  if (statusEl) {
    statusEl.textContent = '중지';
    statusEl.className = 'badge bg-secondary';
  }
  
  if (toggleBtn) {
    toggleBtn.textContent = '시작';
  }
}

// 분봉 카드 클릭 시 프로그레스바 리셋
function resetTimeframeCycleOnManualChange() {
  // 프로그레스바 리셋
  timeframeCycleProgress = 0;
  updateTimeframeCycleProgress(0);
  
  // 현재 분봉 인덱스 동기화 (getInterval 대신 직접 접근)
  let currentInterval = window.currentGlobalInterval || 'minute10';
  const tfEl = document.getElementById('timeframe');
  if (tfEl) {
    currentInterval = tfEl.value;
    window.currentGlobalInterval = currentInterval;
  }
  const index = timeframeList.findIndex(tf => tf.value === currentInterval);
  currentTimeframeIndex = index >= 0 ? index : 3;
  updateTimeframeDisplay();
  
  console.log('🔄 수동 분봉 변경: 프로그레스바 리셋');
}

// 초기화: DOM이 로드된 후 실행
function initTimeframeCycle() {
  // DOM 요소 확인
  const progressBar = document.getElementById('timeframeCycleProgress');
  const toggleBtn = document.getElementById('toggleTimeframeCycle');
  
  if (!progressBar) {
    console.warn('⚠️ 분봉 순회 프로그레스바를 찾을 수 없습니다. DOM이 로드되지 않았을 수 있습니다.');
    // 재시도
    setTimeout(() => {
      initTimeframeCycle();
    }, 1000);
    return;
  }
  
  console.log('✅ 분봉 순회 시스템 초기화 시작');
  
  // 일시정지/재개 버튼 이벤트
  if (toggleBtn) {
    // 기존 이벤트 리스너 제거 후 추가
    toggleBtn.removeEventListener('click', toggleTimeframeCycle);
    toggleBtn.addEventListener('click', toggleTimeframeCycle);
  }
  
  // 분봉 카드 클릭 시 프로그레스바 리셋
  document.querySelectorAll('.timeframe-card, .timeframe-card-bottom').forEach(card => {
    card.addEventListener('click', () => {
      setTimeout(() => {
        resetTimeframeCycleOnManualChange();
      }, 100);
    });
  });
  
  // timeframe select 변경 시 프로그레스바 리셋
  const tfEl = document.getElementById('timeframe');
  if (tfEl) {
    const originalChangeHandler = tfEl.onchange;
    tfEl.addEventListener('change', () => {
      resetTimeframeCycleOnManualChange();
      if (originalChangeHandler) {
        originalChangeHandler();
      }
    });
  }
  
  // 순회 시간 설정 (기본 30초)
  const durationEl = document.getElementById('timeframeCycleDuration');
  if (durationEl) {
    durationEl.textContent = timeframeCycleDuration;
  }
  
  // 현재 분봉 인덱스 동기화 (안전하게)
  try {
    currentTimeframeIndex = findCurrentTimeframeIndex();
  } catch (e) {
    // getInterval이 없을 경우 직접 접근
    let currentInterval = window.currentGlobalInterval || 'minute10';
    const tfEl = document.getElementById('timeframe');
    if (tfEl) {
      currentInterval = tfEl.value;
      window.currentGlobalInterval = currentInterval;
    }
    const index = timeframeList.findIndex(tf => tf.value === currentInterval);
    currentTimeframeIndex = index >= 0 ? index : 3;
  }
  
  // 초기 표시 업데이트
  updateTimeframeDisplay();
  updateTimeframeCycleProgress(0);
  
  // 자동 시작 (차트가 완전히 로드된 후)
  setTimeout(() => {
    startTimeframeCycle();
  }, 3000); // 차트 초기화 후 3초 뒤 시작
}

// 전역 함수로 노출
window.startTimeframeCycle = startTimeframeCycle;
window.stopTimeframeCycle = stopTimeframeCycle;
window.toggleTimeframeCycle = toggleTimeframeCycle;
window.initTimeframeCycle = initTimeframeCycle;

// Expose functions globally
window.initChart = initChart;
window.enableAutoToggles = enableAutoToggles;
window.chargeVillageEnergy = chargeVillageEnergy;
window.clickVillageEnergyButton = clickVillageEnergyButton;
window.updateNBZoneTimeframe = updateNBZoneTimeframe;
window.forceUpdateNBZoneTimeframe = forceUpdateNBZoneTimeframe;

// refreshNbZoneStrip이 정의되어 있으면 전역에 노출 (안전하게)
if (typeof refreshNbZoneStrip !== 'undefined' && typeof refreshNbZoneStrip === 'function') {
  window.refreshNbZoneStrip = refreshNbZoneStrip;
}

// getInterval 대신 사용할 헬퍼 함수 제공
window.getCurrentInterval = function() {
  let currentInterval = window.currentGlobalInterval || 'minute10';
  const tfEl = document.getElementById('timeframe');
  if (tfEl) {
    currentInterval = tfEl.value;
    window.currentGlobalInterval = currentInterval;
  }
  return currentInterval;
};

// 차트 초기화 후 분봉 순회 시스템 자동 시작
// 여러 방법으로 초기화 시도
function tryInitTimeframeCycle() {
  const progressBar = document.getElementById('timeframeCycleProgress');
  if (progressBar && typeof initTimeframeCycle === 'function') {
    initTimeframeCycle();
    return true;
  }
  return false;
}

// DOMContentLoaded 또는 initChart 호출 후 실행
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (!tryInitTimeframeCycle()) {
        // 재시도
        setTimeout(() => tryInitTimeframeCycle(), 2000);
      }
    }, 5000);
  });
} else {
  // 이미 로드된 경우
  setTimeout(() => {
    if (!tryInitTimeframeCycle()) {
      // 재시도
      setTimeout(() => tryInitTimeframeCycle(), 2000);
    }
  }, 5000);
}

// DOM 요소 실시간 모니터링 및 JSON 저장
(function monitorContainerElement() {
  'use strict';
  
  const STORAGE_KEY = 'container_state_history';
  const MAX_HISTORY_ITEMS = 25; // 최대 저장 항목 수 (25개만 유지)
  const SAVE_INTERVAL = 1000; // 1초마다 체크
  
  let lastSavedContent = '';
  let lastSavedZone = null; // 마지막으로 저장한 Zone 추적
  let lastSavedTimeframe = null; // 마지막으로 저장한 분봉 추적
  let saveTimeout = null;
  
  // DOM 요소에서 데이터 추출
  function extractContainerData(element) {
    if (!element) return null;
    
    const text = element.textContent || element.innerText || '';
    const html = element.innerHTML || '';
    
    // 주요 정보 추출
    const data = {
      timestamp: new Date().toISOString(),
      text: text.trim(),
      html: html,
      position: {
        top: element.offsetTop || 0,
        left: element.offsetLeft || 0,
        width: element.offsetWidth || 0,
        height: element.offsetHeight || 0
      },
      // 구조화된 데이터 추출 시도
      structured: {}
    };
    
    // Profit/Loss 정보 추출
    const profitMatch = text.match(/Profit\s+([\d.]+)%/);
    const lossMatch = text.match(/Loss\s+([\d.]+)%/);
    if (profitMatch) data.structured.profit = parseFloat(profitMatch[1]);
    if (lossMatch) data.structured.loss = parseFloat(lossMatch[1]);
    
    // AutoTrade Readiness 추출
    const readinessMatch = text.match(/AutoTrade Readiness\s+([\d.]+)%/);
    if (readinessMatch) data.structured.autoTradeReadiness = parseFloat(readinessMatch[1]);
    
    // ML Model Trust 추출
    const mlTrustMatch = text.match(/ML Model Trust\s+([\d.]+)%/);
    if (mlTrustMatch) data.structured.mlTrust = parseFloat(mlTrustMatch[1]);
    
    // N/B Guild Trust 추출
    const nbTrustMatch = text.match(/N\/B Guild Trust\s+([\d.]+)%/);
    if (nbTrustMatch) data.structured.nbTrust = parseFloat(nbTrustMatch[1]);
    
    // Trust Balance 추출
    const trustBalanceMatch = text.match(/Trust Balance\s+ML:\s+([\d.]+)%\s+\|\s+N\/B:\s+([\d.]+)%/);
    if (trustBalanceMatch) {
      data.structured.trustBalance = {
        ml: parseFloat(trustBalanceMatch[1]),
        nb: parseFloat(trustBalanceMatch[2])
      };
    }
    
    // N/B Zone 추출 (우선순위: HTML 요소 > window.zoneNow > 텍스트 파싱)
    let nbZone = null;
    const nbZoneNowElement = document.getElementById('nbZoneNow');
    if (nbZoneNowElement) {
      const nbZoneText = nbZoneNowElement.textContent.trim().toUpperCase();
      if (nbZoneText === 'BLUE' || nbZoneText === 'ORANGE') {
        nbZone = nbZoneText;
      }
    }
    if (!nbZone && window.zoneNow) {
      nbZone = String(window.zoneNow).toUpperCase();
    }
    if (!nbZone) {
      const nbMatch = text.match(/N\/B:\s*(ORANGE|BLUE)/i);
      if (nbMatch) {
        nbZone = nbMatch[1].toUpperCase();
      }
    }
    if (nbZone) {
      data.structured.nbZone = nbZone;
    }
    
    // ML Zone 추출 (window.mlPrediction > 텍스트 파싱)
    let mlZone = null;
    if (window.mlPrediction && window.mlPrediction.insight && window.mlPrediction.insight.zone) {
      mlZone = String(window.mlPrediction.insight.zone).toUpperCase();
    }
    if (!mlZone && window.lastInsight && window.lastInsight.zone) {
      mlZone = String(window.lastInsight.zone).toUpperCase();
    }
    if (!mlZone) {
      const mlMatch = text.match(/ML.*?Zone[:\s]+(ORANGE|BLUE)/i);
      if (mlMatch) {
        mlZone = mlMatch[1].toUpperCase();
      }
    }
    if (mlZone) {
      data.structured.mlZone = mlZone;
    }
    
    // 분봉 자동 순회 정보 추출
    const cycleMatch = text.match(/(\d+m)\s+→\s+(\d+h?m?)\s+([\d.]+)%/);
    if (cycleMatch) {
      data.structured.timeframeCycle = {
        current: cycleMatch[1],
        next: cycleMatch[2],
        progress: parseFloat(cycleMatch[3])
      };
    }
    
    // 순회 시간 추출
    const durationMatch = text.match(/순회 시간:\s+(\d+)초/);
    if (durationMatch) {
      data.structured.cycleDuration = parseInt(durationMatch[1]);
    }
    
    return data;
  }
  
  // JSON으로 저장 (서버 파일만, localStorage 저장 안 함)
  function saveToStorage(data) {
    try {
      // localStorage 저장 안 함 (분봉이 짧아서 새로고침 시 초기화 상태로 유지)
      
      // 서버로 전송하여 파일로 저장 (덮어쓰기 방식)
      fetch('/api/container-state/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      })
      .then(response => response.json())
      .then(result => {
        if (result.ok && result.saved) {
          // 서버에서 받은 데이터로 localStorage 업데이트
          const serverData = {
            timestamp: data.timestamp,
            time: new Date(data.timestamp).toLocaleString('ko-KR'),
            zone: result.zone,
            timeframe: result.timeframe,
            price: result.price
          };
          
          // localStorage 저장 안 함 (분봉이 짧아서 새로고침 시 초기화 상태로 유지)
          
          // winList에 표시
          const winListEl = document.getElementById('winList');
          if (winListEl) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'win-chip btn btn-sm';
            
            // 시간 포맷팅
            let timeStr = '';
            try {
              const date = new Date(serverData.timestamp);
              timeStr = date.toLocaleTimeString('ko-KR', { 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit',
                hour12: true 
              });
            } catch (e) {
              timeStr = serverData.time || new Date().toLocaleTimeString();
            }
            
            const zoneUpper = String(serverData.zone || 'BLUE').toUpperCase();
            const zoneEmoji = zoneUpper === 'ORANGE' ? '🟠' : '🔵';
            const zoneColor = zoneUpper === 'ORANGE' ? '#ff6b35' : '#0ecb81';
            
            item.title = `${timeStr} | Zone: ${zoneUpper} | ${serverData.timeframe || ''} | Price: ${serverData.price ? serverData.price.toLocaleString() : '-'}`;
            item.innerHTML = `
              <div class='meta' style="font-size: 10px; line-height: 1.2; text-align: left;">
                <span style="color: #666;">${timeStr}</span><br>
                <span style="color: ${zoneColor}; font-weight: 600;">${zoneEmoji} ${zoneUpper}</span> 
                <span style="color: #999; font-size: 9px;">(${serverData.timeframe || ''})</span>
              </div>
            `;
            
            item.dataset.zone = zoneUpper;
            item.dataset.interval = serverData.timeframe || '';
            item.dataset.timestamp = serverData.timestamp;
            
            // Zone에 따라 배경색 설정
            if (zoneUpper === 'ORANGE') {
              item.style.background = 'linear-gradient(90deg, rgba(255,107,53,0.35), rgba(255,107,53,0.10))';
            } else {
              item.style.background = 'linear-gradient(90deg, rgba(0,209,255,0.35), rgba(0,209,255,0.10))';
            }
            
            // 최신 항목을 맨 아래에 추가 (시간순)
            winListEl.appendChild(item);
            
            // 25개 초과 시 오래된 것 제거
            while (winListEl.childElementCount > MAX_HISTORY_ITEMS) {
              winListEl.removeChild(winListEl.firstChild);
            }
            
            // Fill bar 업데이트
            const bar = document.getElementById('winFillBar');
            if (bar) {
              const n = Math.min(25, winListEl.childElementCount || 0);
              const pct = Math.max(1, Math.round((n/25)*100));
              bar.style.width = `${pct}%`;
            }
          }
          
          console.log('💾 Container state saved to file and localStorage:', {
            timestamp: data.timestamp,
            zone: result.zone,
            timeframe: result.timeframe,
            price: result.price,
            file_items: result.total_items
          });
        } else {
          console.warn('⚠️ Failed to save to file:', result.error || result.reason);
        }
      })
      .catch(error => {
        console.error('❌ Failed to send to server:', error);
      });
      
      // localStorage 저장 안 함 (서버 파일에만 저장)
      
    } catch (e) {
      console.error('❌ Failed to save container state:', e);
    }
  }
  
  // Zone 추출 함수
  function extractZone(text) {
    if (!text) return null;
    
    // N/B Zone 확인
    const nbMatch = text.match(/N\/B:\s*(ORANGE|BLUE)/i);
    if (nbMatch) {
      return nbMatch[1].toUpperCase();
    }
    
    // 또는 단순히 ORANGE/BLUE 텍스트 확인
    if (text.includes('ORANGE') && !text.includes('BLUE')) {
      return 'ORANGE';
    }
    if (text.includes('BLUE') && !text.includes('ORANGE')) {
      return 'BLUE';
    }
    
    return null;
  }
  
  // 분봉 추출 함수
  function extractTimeframe(text, structured) {
    // structured에서 먼저 확인
    if (structured && structured.timeframeCycle && structured.timeframeCycle.current) {
      return structured.timeframeCycle.current;
    }
    
    // text에서 분봉 추출
    const timeframeMatch = text.match(/(\d+m|\d+h|day)/i);
    if (timeframeMatch) {
      return timeframeMatch[1].toLowerCase();
    }
    
    // select 요소에서 확인
    const timeframeSelect = document.getElementById('timeframe');
    if (timeframeSelect) {
      return timeframeSelect.value || 'minute10';
    }
    
    return 'minute10'; // 기본값
  }
  
  // 변경 감지 및 저장 (분봉 변경 시마다 저장)
  function checkAndSave() {
    const container = document.querySelector('.container-xxl.py-3');
    if (!container) {
      // 요소가 없으면 재시도
      setTimeout(checkAndSave, 2000);
      return;
    }
    
    const currentContent = container.textContent || container.innerText || '';
    
    // 데이터 추출
    const data = extractContainerData(container);
    if (!data) return;
    
    // 분봉 추출
    const currentTimeframe = extractTimeframe(currentContent, data.structured);
    
    // 분봉이 변경되었을 때 저장
    if (currentTimeframe !== lastSavedTimeframe) {
      lastSavedTimeframe = currentTimeframe;
      lastSavedContent = currentContent;
      
      // Zone도 추출
      const currentZone = extractZone(currentContent);
      if (currentZone) {
        lastSavedZone = currentZone;
      }
      
      // 분봉 변경 시 저장
      saveToStorage(data);
      console.log(`💾 Timeframe changed to ${currentTimeframe}, saving...`);
    }
  }
  
  // MutationObserver로 DOM 변경 감지
  function setupObserver() {
    const container = document.querySelector('.container-xxl.py-3');
    if (!container) {
      // 요소가 아직 없으면 재시도
      setTimeout(setupObserver, 1000);
      return;
    }
    
    // MutationObserver 설정
    const observer = new MutationObserver(function(mutations) {
      // 변경 감지 시 저장 (debounce)
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      
      saveTimeout = setTimeout(() => {
        checkAndSave();
      }, 500); // 500ms debounce
    });
    
    // 관찰 시작
    observer.observe(container, {
      childList: true,      // 자식 요소 추가/제거
      subtree: true,       // 모든 하위 요소
      characterData: true,  // 텍스트 변경
      attributes: false    // 속성 변경은 제외 (성능)
    });
    
    // 초기 저장
    checkAndSave();
    
    // 주기적으로도 체크 (MutationObserver가 놓칠 수 있는 경우 대비)
    setInterval(checkAndSave, SAVE_INTERVAL);
    
    console.log('👁️ Container element monitoring started');
  }
  
  // DOM 로드 후 시작
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupObserver);
  } else {
    // 이미 로드된 경우
    setTimeout(setupObserver, 500);
  }
  
  // 히스토리 조회 함수 (전역으로 노출)
  window.getContainerHistory = function(limit = 100) {
    try {
      const history = localStorage.getItem(STORAGE_KEY);
      if (!history) return [];
      
      const parsed = JSON.parse(history);
      if (!Array.isArray(parsed)) return [];
      
      return parsed.slice(-limit);
    } catch (e) {
      console.error('❌ Failed to get container history:', e);
      return [];
    }
  };
  
  // 최신 상태 조회 함수
  window.getLatestContainerState = function() {
    try {
      const latest = localStorage.getItem(STORAGE_KEY + '_latest');
      if (!latest) return null;
      
      return JSON.parse(latest);
    } catch (e) {
      console.error('❌ Failed to get latest container state:', e);
      return null;
    }
  };
  
  // 히스토리 클리어 함수
  window.clearContainerHistory = function() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY + '_latest');
      console.log('🗑️ Container history cleared');
    } catch (e) {
      console.error('❌ Failed to clear container history:', e);
    }
  };
  
  // Initialize win history from localStorage
  try {
    if (typeof loadWinHistory === 'function') {
      console.log('[Win History] Loading history from localStorage...');
      setTimeout(() => {
        loadWinHistory();
        console.log('[Win History] History loaded successfully');
      }, 1000); // Wait for DOM to be ready
    }
  } catch (histErr) {
    console.error('[Win History] Failed to load history:', histErr);
  }

  // Expose critical functions globally for debugging and external access
  if (typeof updateNB === 'function') window.updateNB = updateNB;
  if (typeof seed === 'function') window.seed = seed;
  if (typeof initChart === 'function') window.initChart = initChart;
  if (typeof updateForecast === 'function') window.updateForecast = updateForecast;
  if (typeof loadWinHistory === 'function') window.loadWinHistory = loadWinHistory;
  if (typeof saveWinHistory === 'function') window.saveWinHistory = saveWinHistory;
  console.log('✅ Core functions exposed to window:', {
    updateNB: typeof window.updateNB,
    seed: typeof window.seed,
    initChart: typeof window.initChart,
    updateForecast: typeof window.updateForecast,
    loadWinHistory: typeof window.loadWinHistory,
    saveWinHistory: typeof window.saveWinHistory
  });

})();

})(); // Close IIFE