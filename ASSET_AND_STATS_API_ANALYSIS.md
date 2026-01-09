# Asset Values & Trade Statistics API Analysis

## Overview
This document identifies the JavaScript code that populates asset values, trade statistics, and the API endpoints they use in the trading dashboard UI.

---

## Asset Values Population

### HTML Elements (index.html)
Three main asset elements are displayed in the dashboard:

```html
<!-- Lines 850-862 in index.html -->
<div class="col-12 col-md-4">
  <div class="asset-stat">
    <div class="label">총 자산 (KRW 환산)</div>
    <div class="value" id="assetTotal">-</div>
  </div>
</div>
<div class="col-12 col-md-4">
  <div class="asset-stat">
    <div class="label">보유 KRW</div>
    <div class="value" id="assetBuyable">-</div>
  </div>
</div>
<div class="col-12 col-md-4">
  <div class="asset-stat">
    <div class="label">매도 가능 코인</div>
    <div class="value" id="assetSellable">-</div>
  </div>
</div>
```

### Asset Loading Function (ui-main.js, lines 6920-7070)

**Function Name:** `refreshAssets()`

**Location:** [static/ui-main.js](static/ui-main.js#L6920-L7070)

**API Endpoint Used:** `/api/balance`

```javascript
async function refreshAssets(){
  try{
    // Fresh call to backend (no cache) so we always see latest balances
    const resp = await fetch('/api/balance', { cache: 'no-store' });

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

    if (payload.paper){ 
      if (assetsMeta) assetsMeta.textContent = '(PAPER mode)'; 
      return; 
    }

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

    // Update DOM elements
    if (assetTotalEl) assetTotalEl.textContent = Math.round(totalValue).toLocaleString();
    if (assetBuyableEl) assetBuyableEl.textContent = Math.round(krwVal).toLocaleString();
    if (assetSellableEl) assetSellableEl.innerHTML = sellables.length
      ? sellables.map(({cur})=>{
          const isSel = hasSelection && cur === selectedCoin;
          const cls = hasSelection ? (isSel ? 'chip chip-selected' : 'chip chip-muted') : 'chip';
          return `<span class='${cls}' data-coin='${cur}'>${cur}</span>`;
        }).join(' ')
      : '<span class="chip">-</span>';

    // Render asset bars (proportional KRW visualization)
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

  }catch(e){ 
    if (assetsBox) assetsBox.textContent = String(e); 
  }
}
```

### Data Processing Flow

1. **API Call:** `GET /api/balance`
2. **Response Format:**
   ```json
   {
     "ok": true,
     "data": {
       "paper": false,
       "balances": [
         {
           "currency": "KRW",
           "balance": 50000,
           "locked": 0,
           "avg_buy_price": 0,
           "price": 1,
           "asset_value": 50000
         },
         {
           "currency": "BTC",
           "balance": 0.5,
           "locked": 0,
           "avg_buy_price": 45000000,
           "price": 48000000,
           "asset_value": 24000000
         }
       ]
     }
   }
   ```

3. **Calculations:**
   - **assetTotal:** Sum of all `asset_value` from all balances
   - **assetBuyable:** `asset_value` of KRW balance (includes locked)
   - **assetSellable:** Array of coins with `asset_value > 0` (excluding KRW), displayed as chips

### Refresh Schedule

- **Manual:** Click "새로고침" button (assetsRefresh)
- **Automatic:** Every 30 seconds when "자동" checkbox is enabled
- **On Load:** Initial call on page load after DOM is ready

```javascript
// ui-main.js, lines 7071-7106
if (assetsRefresh) assetsRefresh.addEventListener('click', refreshAssets);

if (assetsAutoToggle && assetsAutoToggle.checked){ 
  if (assetsTimer) clearInterval(assetsTimer);
  assetsTimer = setInterval(refreshAssets, 30*1000); // 30 seconds
}

// kick off initial load
refreshAssets().catch(()=>{});
```

---

## Trade Statistics Population

### HTML Elements (index.html)

```html
<!-- Lines 880-931 in index.html -->
<span id="buyCount" class="badge bg-success" style="font-size: 16px;">0</span>

<div id="sellTotalAmount" style="font-size: 16px; font-weight: 700; color: #f6465d;">0 KRW</div>

<div id="sellAvgPrice" style="font-size: 16px; font-weight: 700; color: #f6465d;">0 KRW</div>

<div id="totalProfit" style="font-size: 16px; font-weight: 700;">0 KRW</div>

<div id="profitRate" style="font-size: 16px; font-weight: 700;">0%</div>
```

### Trade Stats Loading Function (index.html, lines 2314-3114)

**Function Name:** `loadTradeStats()`

**Location:** [static/index.html](static/index.html#L2314-L3114)

**API Endpoints Used:**
- `GET /api/cards/buy` - Retrieve buy cards
- `GET /api/cards/sell` - Retrieve sell cards
- `POST /api/ml/rating/train` - Auto ML training trigger

```javascript
async function loadTradeStats() {
  try {
    const now = new Date().toLocaleTimeString('ko-KR');
    document.getElementById('buyStatsTime').textContent = now;
    document.getElementById('sellStatsTime').textContent = now;
    
    // Load buy/sell cards from API
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
      // Fallback to cache if API fails
      try {
        const cachedBuyOrders = localStorage.getItem('buyOrdersCache');
        if (cachedBuyOrders) {
          buyOrders = JSON.parse(cachedBuyOrders);
          console.log('💾 Restoring buy cards from cache:', buyOrders.length, 'items');
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

    // Auto ML training trigger
    try {
      fetch('/api/ml/rating/train', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ auto: true }) 
      })
        .then(async r => {
          if (r.status === 400) {
            console.log('🤖 ML training waiting (collecting training data...)');
            return null;
          }
          if (!r.ok) {
            console.log('🤖 ML training response:', `status ${r.status}`);
            return null;
          }
          return r.json();
        })
        .then(r => {
          if (r && r.ok) {
            console.log('🤖 ML training complete:', r);
          }
        })
        .catch(e => {
          console.debug('🤖 ML training request status:', e.message);
        });
    } catch(_) {}
    
    console.log('📊 loadTradeStats: Total', buyOrders.length + sellOrders.length, 'cards, buy', buyOrders.length, ', sell', sellOrders.length);

    // Calculate realized P&L using FIFO matching
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
      
      // Excess sell (no matching buy) treated as zero-cost
      if (remain > 0) {
        sellProfit += (sellPrice * remain);
        remain = 0;
      }
      
      realizedTotal += sellProfit;
      realizedMax = Math.max(realizedMax, sellProfit);
      realizedCount += 1;
    });
    
    const realizedAvg = realizedCount > 0 ? (realizedTotal / realizedCount) : 0;

    // === Statistics Calculation ===
    
    // Buy statistics
    document.getElementById('buyCount').textContent = buyOrders.length;
    const buyTotal = buyOrders.reduce((sum, o) => sum + (Number(o.price || 0) * Number(o.size || 0)), 0);
    const buyAvg = buyOrders.length > 0 ? buyTotal / buyOrders.length : 0;

    // Sell statistics
    const sellTotal = sellOrders.reduce((sum, o) => sum + (Number(o.price || 0) * Number(o.size || 0)), 0);
    const sellAvg = sellOrders.length > 0 ? sellTotal / sellOrders.length : 0;

    // Current price extraction (from candle cache or latest order)
    let lastPrice = 0;
    try {
      const lastCandle = (window.candleDataCache || []).slice(-1)[0];
      lastPrice = Number(lastCandle?.close || lastCandle?.value || 0) || 0;
    } catch (_) { lastPrice = 0; }
    
    if (!lastPrice && allOrders.length > 0) {
      lastPrice = Number(allOrders[0].price || 0) || 0;
    }

    // Holdings/remaining cost/current P&L calculation
    const buySizeTotal = buyOrders.reduce((sum, o) => sum + Number(o.size || 0), 0);
    const sellSizeTotal = sellOrders.reduce((sum, o) => sum + Number(o.size || 0), 0);
    const netSize = buySizeTotal - sellSizeTotal;
    const remainingCost = Math.max(0, buyTotal - sellTotal);
    const currentValue = netSize > 0 ? (lastPrice * netSize) : 0;
    
    // Fee calculation (0.1% for both buy and sell)
    const buyFee = buyTotal * 0.001;
    const sellFee = sellTotal * 0.001;
    const totalFees = buyFee + sellFee;
    
    // Unrealized P&L = current price - remaining cost - buy fee - expected sell fee
    const unrealizedFeeAdjustment = netSize > 0 ? (currentValue * 0.001) : 0;
    const unrealized = currentValue - remainingCost - buyFee - unrealizedFeeAdjustment;
    const unrealizedRate = remainingCost > 0 ? (unrealized / remainingCost) * 100 : 0;

    // === Update Trade Statistics Elements ===
    
    // Sell count and stats
    document.getElementById('sellCount').textContent = sellOrders.length;
    document.getElementById('sellTotalAmount').textContent = Math.round(sellTotal).toLocaleString() + ' KRW';
    document.getElementById('sellAvgPrice').textContent = Math.round(sellAvg).toLocaleString() + ' KRW';
    
    // Profit calculation
    const profit = sellTotal - buyTotal;
    const profitRate = buyTotal > 0 ? ((profit / buyTotal) * 100) : 0;
    const profitEl = document.getElementById('totalProfit');
    const profitRateEl = document.getElementById('profitRate');
    
    profitEl.textContent = Math.round(profit).toLocaleString() + ' KRW';
    profitEl.style.color = profit >= 0 ? '#0ecb81' : '#f6465d';
    profitRateEl.textContent = profitRate.toFixed(2) + '%';
    profitRateEl.style.color = profit >= 0 ? '#0ecb81' : '#f6465d';

    // Log the loaded data
    console.log('✅ Trade stats loaded:', { 
      buyCount: buyOrders.length, 
      sellCount: sellOrders.length 
    });
    
  } catch (err) {
    console.error('loadTradeStats error:', err);
  }
}
```

### Data Processing Workflow

1. **Fetch Buy Cards:** `GET /api/cards/buy`
   - Returns: `{ ok: true, cards: [ { price, size, time/ts, market, ... } ] }`

2. **Fetch Sell Cards:** `GET /api/cards/sell`
   - Returns: `{ ok: true, cards: [ { price, size, time/ts, market, ... } ] }`

3. **Statistics Calculated:**
   - **buyCount:** Length of buyOrders array
   - **sellCount:** Length of sellOrders array
   - **sellTotalAmount:** Sum of (sell price × sell quantity) for all sells
   - **sellAvgPrice:** sellTotalAmount / sellCount
   - **totalProfit:** sellTotalAmount - buyTotalAmount
   - **profitRate:** (totalProfit / buyTotalAmount) × 100%

### Trade Stats Refresh Schedule

```javascript
// index.html, lines 3121-3173
const refreshBtn = document.getElementById('tradeStatsRefresh');
const logRefreshBtn = document.getElementById('tradeLogRefresh');

if (refreshBtn) refreshBtn.addEventListener('click', loadTradeStats);
if (logRefreshBtn) logRefreshBtn.addEventListener('click', loadTradeStats);

loadTradeStats();
setInterval(loadTradeStats, 30000); // Every 30 seconds
```

---

## Summary Table

| Element | Value | API Endpoint | Location |
|---------|-------|--------------|----------|
| `assetTotal` | Total asset value in KRW | `/api/balance` | [ui-main.js#L6920](static/ui-main.js#L6920) |
| `assetBuyable` | Available KRW (includes locked) | `/api/balance` | [ui-main.js#L6920](static/ui-main.js#L6920) |
| `assetSellable` | Coins with value > 0 | `/api/balance` | [ui-main.js#L6920](static/ui-main.js#L6920) |
| `buyCount` | Number of buy orders | `/api/cards/buy` | [index.html#L2314](static/index.html#L2314) |
| `sellCount` | Number of sell orders | `/api/cards/sell` | [index.html#L2314](static/index.html#L2314) |
| `sellTotalAmount` | Sum of all sell KRW | `/api/cards/sell` | [index.html#L2314](static/index.html#L2314) |
| `sellAvgPrice` | Average sell price | `/api/cards/sell` | [index.html#L2314](static/index.html#L2314) |
| `totalProfit` | sellTotal - buyTotal | `/api/cards/buy` + `/api/cards/sell` | [index.html#L2314](static/index.html#L2314) |
| `profitRate` | (totalProfit / buyTotal) × 100% | `/api/cards/buy` + `/api/cards/sell` | [index.html#L2314](static/index.html#L2314) |

---

## Data Sources & API Endpoints

### Assets Endpoint
- **Endpoint:** `GET /api/balance`
- **Cache:** `no-store` (always fresh)
- **Response:** Balance data with asset values, currency, locked amounts
- **Fallback:** localStorage cache (`buyOrdersCache`) if API fails

### Trade Cards Endpoints
- **Buy Cards:** `GET /api/cards/buy`
- **Sell Cards:** `GET /api/cards/sell`
- **ML Training:** `POST /api/ml/rating/train` (auto triggered after stats load)

### Data Refresh Intervals
- **Assets:** 30 seconds (when auto enabled) or manual click
- **Trade Stats:** 30 seconds automatic or manual refresh

---

## Notes

1. **Asset Calculation:** When `asset_value` is missing, it's computed from:
   - KRW: `balance + locked`
   - Crypto: `(balance + locked) × current_price` or `(balance + locked) × avg_buy_price` as fallback

2. **Profit Calculation:** Uses FIFO matching to calculate realized P&L by chronologically pairing buy and sell orders

3. **Paper Mode:** When paper trading is enabled, assets display "(PAPER mode)" and don't show real balances

4. **Fee Assumption:** 0.1% fee on buy and sell transactions is factored into unrealized P&L calculation

5. **Cache Fallback:** If `/api/cards/buy` fails, the app attempts to restore from localStorage cache (`buyOrdersCache`)
