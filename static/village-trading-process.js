// ========================================
// 🏰 8BIT Village Trading Process System
// ========================================

// 🎯 구역 변경 시 주민들의 학습 모델 매매 전략 프로세스
function executeVillageTradingProcess(member, currentZone, previousZone) {
  console.log(`🏰 ${member.name}의 매매 전략 프로세스 시작 - 구역 변경: ${previousZone} → ${currentZone}`);
  
  // 1단계: 현재 구역에서 SELL/BUY 시 손실 예상
  const profitLossPrediction = predictProfitLoss(member, currentZone);
  
  // 2단계: 촌장 지침 준수 여부 판단 (위반도 정상적인 상황)
  const mayorGuidanceDecision = evaluateMayorGuidance(member, currentZone, profitLossPrediction);
  
  // 3단계: 실제/모의 거래 판단
  const tradeTypeDecision = decideTradeType(member, mayorGuidanceDecision);
  
  // 4단계: 실행
  const executionResult = executeTradeDecision(member, tradeTypeDecision);
  
  // 결과를 창고에 저장
  saveTradingProcessResult(member, {
    zoneChange: `${previousZone} → ${currentZone}`,
    profitLossPrediction,
    mayorGuidanceDecision,
    tradeTypeDecision,
    executionResult,
    timestamp: Date.now()
  });
  
  return {
    process: 'Village Trading Process',
    member: member.name,
    zoneChange: `${previousZone} → ${currentZone}`,
    steps: {
      step1: profitLossPrediction,
      step2: mayorGuidanceDecision,
      step3: tradeTypeDecision,
      step4: executionResult
    }
  };
}

// 1단계: 손실 예상
function predictProfitLoss(member, currentZone) {
  const currentPrice = member.currentPrice || 160000000;
  const entryPrice = member.entryPrice || currentPrice;
  const position = member.position || 'FLAT';
  
  // 현재 포지션에 따른 손익 계산
  let currentPnl = 0;
  if (position === 'LONG') {
    currentPnl = ((currentPrice - entryPrice) / entryPrice) * 100;
  } else if (position === 'SHORT') {
    currentPnl = ((entryPrice - currentPrice) / entryPrice) * 100;
  }
  
  // SELL 시 예상 손익 (현재 포지션 청산)
  const sellPrediction = {
    action: 'SELL',
    expectedPnl: currentPnl,
    risk: currentPnl < 0 ? '손실 위험' : '수익 기대',
    confidence: Math.abs(currentPnl) > 2 ? '높음' : '보통'
  };
  
  // BUY 시 예상 손익 (새로운 포지션 진입)
  const buyPrediction = {
    action: 'BUY',
    expectedPnl: currentZone === 'BLUE' ? 1.5 : -0.8, // 구역별 예상 수익률
    risk: currentZone === 'BLUE' ? '낮음' : '높음',
    confidence: currentZone === 'BLUE' ? '높음' : '낮음'
  };
  
  return {
    currentPnl: currentPnl,
    sellPrediction: sellPrediction,
    buyPrediction: buyPrediction,
    recommendation: currentPnl > 1 ? 'SELL 권장' : (currentZone === 'BLUE' ? 'BUY 권장' : 'HOLD 권장')
  };
}

// 2단계: 촌장 지침 준수 여부 판단 (위반도 정상적인 상황)
function evaluateMayorGuidance(member, currentZone, profitLossPrediction) {
  const mayorGuidance = currentZone === 'BLUE' ? 'BUY만 허용' : 'SELL만 허용';
  const currentPosition = member.position || 'FLAT';
  
  let guidanceCompliance = '';
  let decision = '';
  let reason = '';
  let isViolation = false;
  
  if (currentZone === 'ORANGE') {
    if (currentPosition === 'LONG') {
      guidanceCompliance = '✅ 촌장 지침 준수';
      decision = 'SELL 실행';
      reason = 'ORANGE 구역에서 LONG 포지션 청산';
    } else if (currentPosition === 'FLAT') {
      // 개인 판단으로 BUY를 할 수도 있음 (정상적인 상황)
      const personalDecision = Math.random() > 0.7; // 30% 확률로 개인 판단
      if (personalDecision) {
        guidanceCompliance = '🤔 개인 판단 (촌장 지침 위반)';
        decision = 'BUY 실행';
        reason = '개인 분석으로 BUY 기회 포착';
        isViolation = true;
      } else {
        guidanceCompliance = '✅ 촌장 지침 준수';
        decision = 'HOLD 유지';
        reason = 'ORANGE 구역에서 BUY 금지, SELL 기회 대기';
      }
    }
  } else if (currentZone === 'BLUE') {
    if (currentPosition === 'FLAT') {
      guidanceCompliance = '✅ 촌장 지침 준수';
      decision = 'BUY 실행';
      reason = 'BLUE 구역에서 BUY 기회 포착';
    } else if (currentPosition === 'LONG') {
      // 개인 판단으로 SELL을 할 수도 있음 (정상적인 상황)
      const personalDecision = Math.random() > 0.8; // 20% 확률로 개인 판단
      if (personalDecision) {
        guidanceCompliance = '🤔 개인 판단 (촌장 지침 위반)';
        decision = 'SELL 실행';
        reason = '개인 분석으로 수익 실현';
        isViolation = true;
      } else {
        guidanceCompliance = '✅ 촌장 지침 준수';
        decision = 'HOLD 유지';
        reason = 'BLUE 구역에서 LONG 포지션 유지';
      }
    }
  }
  
  return {
    guidance: mayorGuidance,
    compliance: guidanceCompliance,
    decision: decision,
    reason: reason,
    isViolation: isViolation,
    confidence: Math.random() * 40 + 60 // 60-100%
  };
}

// 3단계: 실제/모의 거래 판단
function decideTradeType(member, mayorGuidanceDecision) {
  const confidence = mayorGuidanceDecision.confidence;
  const isViolation = mayorGuidanceDecision.isViolation;
  
  // 신뢰도에 따른 거래 타입 결정
  let tradeType = '';
  let reason = '';
  
  if (confidence >= 60) {
    tradeType = '실제 거래';
    reason = '보통 신뢰도로 실제 거래 실행';
  } else if (confidence >= 40) {
    tradeType = '모의 거래';
    reason = '낮은 신뢰도로 모의 거래 실행';
  } else {
    tradeType = '관망';
    reason = '매우 낮은 신뢰도로 거래 보류';
  }
  
  // 촌장 지침 위반 시 추가 설명
  if (isViolation) {
    reason += ' (개인 판단 우선)';
  }
  
  return {
    tradeType: tradeType,
    reason: reason,
    confidence: confidence,
    riskLevel: confidence >= 60 ? '높음' : (confidence >= 40 ? '보통' : '낮음'),
    isViolation: isViolation
  };
}

// 4단계: 실행
function executeTradeDecision(member, tradeTypeDecision) {
  const tradeType = tradeTypeDecision.tradeType;
  const confidence = tradeTypeDecision.confidence;
  const isViolation = tradeTypeDecision.isViolation;
  
  let executionResult = {
    status: '대기 중',
    action: 'NONE',
    result: 'N/A',
    timestamp: Date.now()
  };
  
  if (tradeType === '실제 거래') {
    executionResult = {
      status: '실행 중',
      action: member.currentZone === 'BLUE' ? 'BUY' : 'SELL',
      result: '실제 거래 실행',
      timestamp: Date.now()
    };
  } else if (tradeType === '모의 거래') {
    executionResult = {
      status: '모의 실행',
      action: member.currentZone === 'BLUE' ? 'BUY' : 'SELL',
      result: '모의 거래 실행',
      timestamp: Date.now()
    };
  } else {
    executionResult = {
      status: '관망',
      action: 'HOLD',
      result: '거래 보류',
      timestamp: Date.now()
    };
  }
  
  // 촌장 지침 위반 시 추가 정보
  if (isViolation) {
    executionResult.note = '개인 판단으로 촌장 지침 위반';
  }
  
  return executionResult;
}

// 거래 프로세스 결과를 창고에 저장
function saveTradingProcessResult(member, result) {
  const warehouseKey = `trading_process_${member.name}`;
  const existingData = localStorage.getItem(warehouseKey);
  let processHistory = [];
  
  if (existingData) {
    processHistory = JSON.parse(existingData);
  }
  
  // 최근 10개만 유지
  processHistory.push(result);
  if (processHistory.length > 10) {
    processHistory = processHistory.slice(-10);
  }
  
  localStorage.setItem(warehouseKey, JSON.stringify(processHistory));
  console.log(`🏪 ${member.name}의 거래 프로세스 결과 저장됨`);
}

// 구역 변경 감지 및 프로세스 실행
function detectZoneChangeAndExecute(member, newZone) {
  const previousZone = member.lastZone || 'ORANGE';
  
  if (newZone !== previousZone) {
    console.log(`🔄 구역 변경 감지: ${member.name} - ${previousZone} → ${newZone}`);
    
    // 프로세스 실행
    const processResult = executeVillageTradingProcess(member, newZone, previousZone);
    
    // UI 업데이트
    updateMemberTradingProcessUI(member, processResult);
    
    // 마지막 구역 업데이트
    member.lastZone = newZone;
    
    return processResult;
  }
  
  return null;
}

// 멤버의 거래 프로세스 UI 업데이트 (직접적인 방법)
function updateMemberTradingProcessUI(member, processResult) {
  console.log(`🎯 ${member.name}의 거래 프로세스 UI 업데이트 시작`);
  
  // 더 직접적인 방법으로 멤버 요소 찾기
  let memberElement = findMemberElement(member.name);
  
  if (!memberElement) {
    console.warn(`⚠️ ${member.name}의 DOM 요소를 찾을 수 없습니다. 직접 생성합니다.`);
    createMemberProcessDisplay(member, processResult);
    return;
  }
  
  console.log(`✅ ${member.name}의 DOM 요소 찾음:`, memberElement);
  
  const processInfo = `
    <div style="font-size: 8px; color: #888888; margin-top: 4px; padding: 2px; background: rgba(255,255,255,0.05); border-radius: 3px;">
      <div style="color: #00d1ff; font-weight: 600; margin-bottom: 2px;">🎯 매매 전략 프로세스</div>
      <div style="margin-bottom: 1px;">
        <span style="color: #ffb703;">1단계:</span> ${processResult.steps.step1.recommendation}
      </div>
      <div style="margin-bottom: 1px;">
        <span style="color: #0ecb81;">2단계:</span> ${processResult.steps.step2.decision}
        ${processResult.steps.step2.isViolation ? ' <span style="color: #f6465d;">(개인 판단)</span>' : ''}
      </div>
      <div style="margin-bottom: 1px;">
        <span style="color: #f6465d;">3단계:</span> ${processResult.steps.step3.tradeType}
      </div>
      <div style="margin-bottom: 1px;">
        <span style="color: #9c27b0;">4단계:</span> ${processResult.steps.step4.status}
      </div>
    </div>
  `;
  
  // 기존 프로세스 정보 제거
  const existingProcess = memberElement.querySelector('.trading-process-info');
  if (existingProcess) {
    existingProcess.remove();
  }
  
  // 새로운 프로세스 정보 추가
  const processDiv = document.createElement('div');
  processDiv.className = 'trading-process-info';
  processDiv.innerHTML = processInfo;
  memberElement.appendChild(processDiv);
  
  console.log(`✅ ${member.name}의 거래 프로세스 UI 업데이트 완료`);
}

// 멤버 요소 찾기 (개선된 방법)
function findMemberElement(memberName) {
  // 방법 1: ID로 찾기
  let element = document.getElementById(`member-${memberName}`);
  if (element) return element;
  
  // 방법 2: 특정 클래스로 찾기
  const classSelectors = ['.guild-member', '.member-card', '.trainer-card', '[data-member]'];
  for (let selector of classSelectors) {
    const elements = document.querySelectorAll(selector);
    for (let el of elements) {
      if (el.textContent.includes(memberName)) {
        return el;
      }
    }
  }
  
  // 방법 3: 텍스트 내용으로 찾기 (더 정확한 검색)
  const allElements = document.querySelectorAll('div, span, p, li');
  for (let el of allElements) {
    if (el.textContent && el.textContent.includes(memberName) && 
        (el.textContent.includes('Scout') || el.textContent.includes('Guardian') || 
         el.textContent.includes('Analyst') || el.textContent.includes('Elder'))) {
      return el;
    }
  }
  
  return null;
}

// 멤버 프로세스 표시 직접 생성
function createMemberProcessDisplay(member, processResult) {
  console.log(`🏗️ ${member.name}의 프로세스 표시 직접 생성`);
  
  // 페이지에 직접 추가
  const container = document.querySelector('.guild-members-container') || 
                   document.querySelector('#guild-members');

  // Skip floating overlay when no guild container is present (e.g., trading dashboard)
  if (!container) {
    console.warn(`⚠️ ${member.name} 프로세스 표시 위치 없음. 팝업 생성을 건너뜁니다.`);
    return;
  }
  
  const processDiv = document.createElement('div');
  processDiv.id = `process-${member.name}`;
  processDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(0,0,0,0.8);
    color: white;
    padding: 10px;
    border-radius: 5px;
    font-size: 12px;
    z-index: 1000;
    max-width: 300px;
  `;
  
  processDiv.innerHTML = `
    <div style="color: #00d1ff; font-weight: 600; margin-bottom: 5px;">🎯 ${member.name} 매매 전략 프로세스</div>
    <div style="margin-bottom: 2px;"><span style="color: #ffb703;">1단계:</span> ${processResult.steps.step1.recommendation}</div>
    <div style="margin-bottom: 2px;"><span style="color: #0ecb81;">2단계:</span> ${processResult.steps.step2.decision}</div>
    <div style="margin-bottom: 2px;"><span style="color: #f6465d;">3단계:</span> ${processResult.steps.step3.tradeType}</div>
    <div style="margin-bottom: 2px;"><span style="color: #9c27b0;">4단계:</span> ${processResult.steps.step4.status}</div>
    <button onclick="this.parentElement.remove()" style="margin-top: 5px; padding: 2px 5px; font-size: 10px;">닫기</button>
  `;
  
  container.appendChild(processDiv);
  
  // 10초 후 자동 제거
  setTimeout(() => {
    if (processDiv.parentElement) {
      processDiv.remove();
    }
  }, 10000);
}

// 모든 멤버의 거래 프로세스 모니터링 시작 (개선된 버전)
function startVillageTradingProcessMonitoring() {
  console.log('🏰 8BIT Village 거래 프로세스 모니터링 시작');
  
  // guildMembers 객체가 정의되지 않은 경우 기본 멤버 생성
  if (typeof guildMembers === 'undefined' || !guildMembers) {
    console.log('⚠️ guildMembers 객체가 정의되지 않음. 기본 멤버 생성...');
    window.guildMembers = {
      Scout: { name: 'Scout', position: 'LONG', currentPrice: 160000000, entryPrice: 161000000 },
      Guardian: { name: 'Guardian', position: 'FLAT', currentPrice: 160000000 },
      Analyst: { name: 'Analyst', position: 'FLAT', currentPrice: 160000000 },
      Elder: { name: 'Elder', position: 'FLAT', currentPrice: 160000000 }
    };
  }
  
  // 즉시 첫 번째 실행
  executeInitialTradingProcess();
  
  // 10초마다 구역 변경 확인
  setInterval(() => {
    executeTradingProcessCheck();
  }, 10000); // 10초마다 체크
}

// 초기 거래 프로세스 실행
function executeInitialTradingProcess() {
  console.log('🎯 초기 거래 프로세스 실행');
  
  getMayorGuidanceData().then(data => {
    const currentZone = data.nbZone || 'ORANGE';
    console.log(`현재 구역: ${currentZone}`);
    
    Object.values(window.guildMembers || {}).forEach(member => {
      // 초기 구역 설정
      member.lastZone = currentZone;
      
      // 초기 프로세스 실행
      const processResult = executeVillageTradingProcess(member, currentZone, currentZone);
      updateMemberTradingProcessUI(member, processResult);
    });
  }).catch(error => {
    console.error('초기 거래 프로세스 실행 실패:', error);
  });
}

// 거래 프로세스 체크 실행
function executeTradingProcessCheck() {
  console.log('🔄 거래 프로세스 체크 실행');
  
  getMayorGuidanceData().then(data => {
    const currentZone = data.nbZone || 'ORANGE';
    
    Object.values(window.guildMembers || {}).forEach(member => {
      detectZoneChangeAndExecute(member, currentZone);
    });
  }).catch(error => {
    console.error('거래 프로세스 체크 실패:', error);
  });
}

// 수동으로 거래 프로세스 실행 (테스트용)
function manualExecuteTradingProcess(memberName) {
  console.log(`🎯 수동 거래 프로세스 실행: ${memberName}`);
  
  const member = window.guildMembers?.[memberName];
  if (!member) {
    console.error(`❌ ${memberName} 멤버를 찾을 수 없습니다`);
    return;
  }
  
  getMayorGuidanceData().then(data => {
    const currentZone = data.nbZone || 'ORANGE';
    const processResult = executeVillageTradingProcess(member, currentZone, member.lastZone || currentZone);
    updateMemberTradingProcessUI(member, processResult);
  });
}

// 모듈 내보내기
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    executeVillageTradingProcess,
    predictProfitLoss,
    evaluateMayorGuidance,
    decideTradeType,
    executeTradeDecision,
    saveTradingProcessResult,
    detectZoneChangeAndExecute,
    updateMemberTradingProcessUI,
    startVillageTradingProcessMonitoring,
    manualExecuteTradingProcess
  };
}
