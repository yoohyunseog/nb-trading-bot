// ========================================
// 트레이너 시스템 (N/B Guild NPC Control)
// ========================================

// Function to modify trainer storage (N/B Guild NPC control)
async function modifyTrainerStorage(trainer, amount) {
  try {
    console.log(`Modifying trainer storage: ${trainer} ${amount > 0 ? '+' : ''}${amount.toFixed(8)} BTC`);
    
    const response = await fetch('/api/trainer/storage/modify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        trainer: trainer,
        amount: amount
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      const actualAmount = result.actual_amount || amount;
      console.log(`Trainer storage modified: ${trainer} ${actualAmount > 0 ? '+' : ''}${actualAmount.toFixed(8)} BTC`);
      return result;
    } else {
      const result = await response.json();
      console.error('Failed to modify trainer storage:', result.error);
      return null;
    }
  } catch (error) {
    console.error('Error modifying trainer storage:', error);
    return null;
  }
}

// Function to reset trainer storage average price
async function resetTrainerStoragePrice(trainer) {
  try {
    console.log(`Resetting average price for: ${trainer}`);
    
    const response = await fetch('/api/trainer/storage/reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        trainer: trainer
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`Average price reset for: ${trainer}`);
      return result;
    } else {
      const result = await response.json();
      console.error('Failed to reset average price:', result.error);
      return null;
    }
  } catch (error) {
    console.error('Error resetting average price:', error);
    return null;
  }
}

// Function to modify trainer storage ticks
async function modifyTrainerTicks(trainer, delta) {
  try {
    console.log(`Modifying ticks for: ${trainer} ${delta > 0 ? '+' : ''}${delta}`);
    
    const response = await fetch('/api/trainer/storage/tick', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        trainer: trainer,
        delta: delta
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`Ticks modified for: ${trainer} ${delta > 0 ? '+' : ''}${delta} (new total: ${result.new_ticks})`);
      return result;
    } else {
      const result = await response.json();
      console.error('Failed to modify ticks:', result.error);
      return null;
    }
  } catch (error) {
    console.error('Error modifying ticks:', error);
    return null;
  }
}

// Trainer message (EN) builder
function buildTrainerMessage(iv, side, coinCount, reasons, extra) {
  const chosen = extra?.chosen || 'N/A';
  const intent = extra?.intent || 'N/A';
  const feasTxt = extra?.feasTxt || '';
  
  let message = `Interval: ${iv} | Side: ${side} | Coins: ${coinCount.toFixed(8)} BTC`;
  
  if (reasons && reasons.length > 0) {
    message += ` | Reasons: ${reasons.join(', ')}`;
  }
  
  if (chosen !== 'N/A') {
    message += ` | Chosen: ${chosen}`;
  }
  
  if (intent !== 'N/A') {
    message += ` | Intent: ${intent}`;
  }
  
  if (feasTxt) {
    message += ` | ${feasTxt}`;
  }
  
  return message;
}

// Helper function to append lines to trainer diagnostics box
function appendTrainerDiagnosticsLine(text) {
  const diagnosticsBox = document.getElementById('trainerDiagnosticsBox');
  if (diagnosticsBox) {
    const timestamp = new Date().toLocaleTimeString();
    const line = `[${timestamp}] ${text}`;
    diagnosticsBox.textContent += line + '\n';
    diagnosticsBox.scrollTop = diagnosticsBox.scrollHeight;
  }
}

// Trainer System Diagnostics Function
async function runTrainerDiagnostics() {
  try {
    appendTrainerDiagnosticsLine('Trainer System Diagnostics 시작...');
    
    // Get trainer storage data
    const storageRes = await fetch('/api/trainer/storage');
    if (storageRes.ok) {
      const result = await storageRes.json();
      appendTrainerDiagnosticsLine(`Trainer Storage 데이터 로드 완료: ${Object.keys(result.storage || {}).length}개 트레이너`);
      
      // Check each trainer's data
      Object.entries(result.storage || {}).forEach(([trainer, data]) => {
        appendTrainerDiagnosticsLine(`${trainer}: ${data.coins.toFixed(8)} BTC, ${data.ticks}틱, 평균가: ${data.avg_price?.toLocaleString() || 'N/A'} KRW`);
      });
    } else {
      appendTrainerDiagnosticsLine('Trainer Storage 데이터 로드 실패');
    }
    
    // Test trainer suggestions
    const intervals = ['minute1', 'minute3', 'minute5', 'minute10', 'minute15', 'minute30', 'minute60', 'day'];
    for (const interval of intervals) {
      try {
        const suggestRes = await fetch(`/api/trainer/suggest?interval=${encodeURIComponent(interval)}`);
        if (suggestRes.ok) {
          const suggestData = await suggestRes.json();
          appendTrainerDiagnosticsLine(`${interval} 트레이너 제안: ${suggestData.side || 'N/A'}, ${suggestData.coin_count?.toFixed(8) || 'N/A'} BTC`);
        } else {
          appendTrainerDiagnosticsLine(`${interval} 트레이너 제안 실패`);
        }
      } catch (e) {
        appendTrainerDiagnosticsLine(`${interval} 트레이너 제안 오류: ${e.message}`);
      }
    }
    
    appendTrainerDiagnosticsLine('Trainer System Diagnostics 완료');
    
  } catch (error) {
    appendTrainerDiagnosticsLine(`Trainer System Diagnostics 오류: ${error.message}`);
  }
}

// Trainer Learning System - moved to village-learning-system.js

// Trainer Grants: simulate random BTC distribution among trainers
function distributeTrainerGrants() {
  const trainerGrantsBox = document.getElementById('trainerGrantsBox');
  if (!trainerGrantsBox) return;
  
  const now = new Date();
  const text = `[${now.toLocaleTimeString()}] Trainer Grants distributed`;
  
  const prev = String(trainerGrantsBox.textContent || '').trim();
  trainerGrantsBox.textContent = prev && prev !== '-' ? `${text}\n${prev}` : text;
}

// Split BTC portion randomly among trainers
function splitBTCAmongTrainers(btcAmount, trainers) {
  if (!trainers || trainers.length === 0) return {};
  
  const distribution = {};
  const remainingBTC = btcAmount;
  
  // Randomly distribute BTC among trainers
  trainers.forEach(trainer => {
    const randomPortion = Math.random() * remainingBTC * 0.1; // Max 10% of remaining
    distribution[trainer] = randomPortion;
  });
  
  return distribution;
}

// Get trainer storage data
async function getTrainerStorageData() {
  try {
    let trainerStorageData = {};
    
    try {
      const storageRes = await fetch('/api/trainer/storage');
      if (storageRes.ok) {
        const result = await storageRes.json();
        trainerStorageData = result.storage;
      }
    } catch (e) {
      console.error('Failed to fetch trainer storage data:', e);
    }
    
    return trainerStorageData;
  } catch (error) {
    console.error('Error getting trainer storage data:', error);
    return {};
  }
}

// Check for open position using trainer storage data
function checkTrainerPosition(member, trainerStorageData) {
  const trainerData = trainerStorageData[member.name];
  if (trainerData && trainerData.coins > 0) {
    return {
      hasPosition: true,
      coins: trainerData.coins,
      avgPrice: trainerData.avg_price,
      ticks: trainerData.ticks
    };
  }
  return { hasPosition: false };
}

// Create trainer storage HTML with buttons
function createTrainerStorageHTML(trainerStorageData, currentPrice) {
  let trainerStorageHTML = '';
  
  if (Object.keys(trainerStorageData).length > 0) {
    trainerStorageHTML = Object.keys(trainerStorageData).map(trainer => {
      const data = trainerStorageData[trainer];
      const currentValue = data.coins * currentPrice;
      const profit = data.avg_price ? ((currentPrice - data.avg_price) / data.avg_price) * 100 : 0;
      const ticks = data.ticks || 0;
      
             // Get last REAL trade info (filter out manual modifications)
       const realTrades = data.trades ? data.trades.filter(trade => trade.action === 'REAL_TRADE') : [];
       const lastTrade = realTrades.length > 0 ? realTrades[realTrades.length - 1] : null;
       const lastTradeInfo = lastTrade ? 
         `<br><span style="font-size: 9px; color: #666;">마지막 실제 거래: ${lastTrade.action || 'UNKNOWN'} ${(lastTrade.size || 0).toFixed(8)} BTC @ ${Math.round(lastTrade.price || 0).toLocaleString()} KRW (${lastTrade.ts ? new Date(lastTrade.ts).toLocaleString() : 'Unknown Date'})${lastTrade.new_balance ? `<br><span style="font-size: 8px; color: #999;">잔액: ${lastTrade.new_balance.toFixed(8)} BTC</span>` : ''}${lastTrade.trade_match ? `<br><span style="font-size: 8px; color: #999;">업비트 매칭: ${lastTrade.trade_match.upbit_trade_id}</span>` : ''}</span>` : 
         `<br><span style="font-size: 9px; color: #999;">실제 거래 기록 없음</span>`;
      
      return `
        <div style="margin-bottom: 8px; padding: 4px; background: rgba(25,118,210,0.05); border-radius: 3px;">
          <strong>${trainer}:</strong> ${data.coins.toFixed(8)} BTC (≈ ${Math.round(currentValue).toLocaleString()} KRW) ${ticks}틱
          ${lastTradeInfo}
          <div style="margin-top: 2px; font-size: 10px;">
            <button onclick="modifyTrainerStorage('${trainer}', -0.001)" style="background: #d32f2f; color: white; border: none; border-radius: 2px; width: 24px; height: 20px; font-size: 10px; cursor: pointer;" title="Remove 0.001 BTC">--</button>
            <button onclick="modifyTrainerStorage('${trainer}', -0.0001)" style="background: #f44336; color: white; border: none; border-radius: 2px; width: 20px; height: 20px; font-size: 10px; cursor: pointer;" title="Remove 0.0001 BTC">-</button>
            <button onclick="modifyTrainerStorage('${trainer}', 0.0001)" style="background: #4caf50; color: white; border: none; border-radius: 2px; width: 20px; height: 20px; font-size: 10px; cursor: pointer;" title="Add 5,000 KRW worth">+</button>
            <button onclick="modifyTrainerStorage('${trainer}', 0.001)" style="background: #2e7d32; color: white; border: none; border-radius: 2px; width: 24px; height: 20px; font-size: 10px; cursor: pointer;" title="Add 5,000 KRW worth">++</button>
            <button onclick="resetTrainerStoragePrice('${trainer}')" style="background: #ff9800; color: white; border: none; border-radius: 2px; width: 60px; height: 20px; font-size: 9px; cursor: pointer;" title="평균가 초기화">초기화</button>
            <button onclick="modifyTrainerTicks('${trainer}', -1)" style="background: #9c27b0; color: white; border: none; border-radius: 2px; width: 20px; height: 20px; font-size: 10px; cursor: pointer;" title="틱 -1">-1</button>
            <button onclick="modifyTrainerTicks('${trainer}', 1)" style="background: #673ab7; color: white; border: none; border-radius: 2px; width: 20px; height: 20px; font-size: 10px; cursor: pointer;" title="틱 +1">+1</button>
          </div>
        </div>
      `;
    }).join('');
  } else {
    trainerStorageHTML = '<div style="font-size: 12px; color: #0d47a1;">No data</div>';
  }
  
  return `
    <div style="font-weight: bold; margin-bottom: 4px; color: #1976d2;">Trainer Storage (N/B Guild NPC Control):</div>
    ${trainerStorageHTML}
  `;
}

// Initialize trainer system
function initializeTrainerSystem() {
  // Set up event listeners for trainer grants
  const btnClearGrants = document.getElementById('btnClearGrants');
  if (btnClearGrants) {
    btnClearGrants.addEventListener('click', () => {
      const trainerGrantsBox = document.getElementById('trainerGrantsBox');
      if (trainerGrantsBox) trainerGrantsBox.textContent = '-';
    });
  }
  
  // Expose functions globally
  window.modifyTrainerStorage = modifyTrainerStorage;
  window.resetTrainerStoragePrice = resetTrainerStoragePrice;
  window.modifyTrainerTicks = modifyTrainerTicks;
  window.buildTrainerMessage = buildTrainerMessage;
  window.runTrainerDiagnostics = runTrainerDiagnostics;
  // window.trainerLearningSystem = trainerLearningSystem; // moved to village-learning-system.js
  window.distributeTrainerGrants = distributeTrainerGrants;
  window.getTrainerStorageData = getTrainerStorageData;
  window.checkTrainerPosition = checkTrainerPosition;
  window.createTrainerStorageHTML = createTrainerStorageHTML;
  
  console.log('Trainer System initialized');
}

// Export functions for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    modifyTrainerStorage,
    resetTrainerStoragePrice,
    modifyTrainerTicks,
    buildTrainerMessage,
    runTrainerDiagnostics,
         // trainerLearningSystem, // moved to village-learning-system.js
    distributeTrainerGrants,
    getTrainerStorageData,
    checkTrainerPosition,
    createTrainerStorageHTML,
    initializeTrainerSystem
  };
}
