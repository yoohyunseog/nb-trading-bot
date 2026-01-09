// ========================================
// 마을 주민 트레이너 학습 시스템
// ========================================

// Trainer Learning System - Enhanced with N/B coin performance analysis
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
        member.tradeFrequency = Math.max(0.1, member.tradeFrequency - 0.02);
      }
      
      // Experience-based learning adjustments
      if (member.experience > 100) {
        // Veteran members get more stable learning
        member.learningRate = Math.max(0.05, member.learningRate * 0.95);
      } else if (member.experience < 20) {
        // New members learn faster
        member.learningRate = Math.min(0.3, member.learningRate * 1.05);
      }
      
      // Specialization learning based on role
      if (member.role === 'Explorer') {
        // Explorers learn better from quick trades
        if (member.recentTrades && member.recentTrades.length > 0) {
          const recentSuccess = member.recentTrades.filter(t => t.profit > 0).length / member.recentTrades.length;
          if (recentSuccess > 0.6) {
            member.skillLevel = Math.min(3.0, member.skillLevel + member.learningRate * 0.4);
          }
        }
      } else if (member.role === 'Protector') {
        // Protectors learn from defensive strategies
        if (member.totalNbCoinsEarned > member.totalNbCoinsLost) {
          member.skillLevel = Math.min(3.0, member.skillLevel + member.learningRate * 0.3);
        }
      } else if (member.role === 'Strategist') {
        // Strategists learn from long-term patterns
        if (member.winRate > 70) {
          member.skillLevel = Math.min(3.0, member.skillLevel + member.learningRate * 0.5);
        }
      } else if (member.role === 'Advisor') {
        // Advisors learn from community success
        const communitySuccess = Object.values(guildMembers).filter(m => m.winRate > 60).length / Object.keys(guildMembers).length;
        if (communitySuccess > 0.5) {
          member.skillLevel = Math.min(3.0, member.skillLevel + member.learningRate * 0.2);
        }
      }
      
      // Update member's learning progress
      member.lastLearningUpdate = Date.now();
      member.learningProgress = Math.min(100, member.learningProgress + 1);
      
      // Save learning progress to localStorage
      saveMemberLearningProgress(member);
    });
    
    console.log('Trainer Learning System completed with N/B coin performance analysis');
    
  } catch (e) {
    console.error('Trainer Learning System Error:', e);
  }
}

// Save member learning progress to localStorage
function saveMemberLearningProgress(member) {
  try {
    const learningData = {
      name: member.name,
      skillLevel: member.skillLevel,
      experience: member.experience,
      learningRate: member.learningRate,
      learningProgress: member.learningProgress,
      lastLearningUpdate: member.lastLearningUpdate,
      timestamp: Date.now()
    };
    
    localStorage.setItem(`member_learning_${member.name}`, JSON.stringify(learningData));
  } catch (error) {
    console.error('Error saving member learning progress:', error);
  }
}

// Load member learning progress from localStorage
function loadMemberLearningProgress(memberName) {
  try {
    const savedData = localStorage.getItem(`member_learning_${memberName}`);
    if (savedData) {
      return JSON.parse(savedData);
    }
  } catch (error) {
    console.error('Error loading member learning progress:', error);
  }
  return null;
}

// 자동 학습 토글
async function toggleAutoLearning() {
  try {
    const response = await fetch('/api/village/auto-learning/toggle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('자동 학습 토글:', result);
      
      const status = result.auto_learning_enabled ? '활성화' : '비활성화';
      pushOrderLogLine(`[${new Date().toLocaleString()}] 자동 촌장 지침 학습 ${status}`);
      
      // 모든 길드 멤버의 자동 학습 상태 업데이트
      if (typeof guildMembers !== 'undefined') {
        Object.values(guildMembers).forEach(member => {
          const statusElement = document.getElementById(`auto-learning-status-${member.name}`);
          if (statusElement) {
            const color = result.auto_learning_enabled ? '#0ecb81' : '#f6465d';
            statusElement.innerHTML = `자동 학습: <span style="color: ${color};">${status}</span>`;
          }
        });
      }
      
      return result;
    } else {
      const error = await response.json();
      console.error('자동 학습 토글 실패:', error);
      pushOrderLogLine(`[${new Date().toLocaleString()}] 자동 학습 토글 실패: ${error.error}`);
    }
  } catch (e) {
    console.error('자동 학습 토글 오류:', e);
    pushOrderLogLine(`[${new Date().toLocaleString()}] 자동 학습 토글 오류: ${e.message}`);
  }
}

// 촌장 지침 학습 모델 훈련
async function trainMayorGuidanceModel() {
  try {
    console.log('촌장 지침 학습 모델 훈련 시작...');
    
    const response = await fetch('/api/ml/train-mayor-guidance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        window: 50,
        ema_fast: 10,
        ema_slow: 30,
        horizon: 5,
        count: 1800,
        interval: 'minute1'
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('촌장 지침 학습 완료:', result);
      pushOrderLogLine(`[${new Date().toLocaleString()}] 촌장 지침 학습 모델 훈련 완료`);
      return result;
    } else {
      const error = await response.json();
      console.error('촌장 지침 학습 실패:', error);
      pushOrderLogLine(`[${new Date().toLocaleString()}] 촌장 지침 학습 실패: ${error.error}`);
    }
  } catch (e) {
    console.error('촌장 지침 학습 오류:', e);
    pushOrderLogLine(`[${new Date().toLocaleString()}] 촌장 지침 학습 오류: ${e.message}`);
  }
}

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
        statusElement.innerHTML = `자동 학습: <span style="color: ${color};">${status}</span>`;
        
        // Save to localStorage
        localStorage.setItem('auto_learning_status', JSON.stringify({
          enabled: autoLearningEnabled,
          timestamp: Date.now()
        }));
      }
      
      return result;
    } else {
      console.error('자동 학습 상태 업데이트 실패:', e);
      const statusElement = document.getElementById(`auto-learning-status-${memberName}`);
      if (statusElement) {
        statusElement.innerHTML = `자동 학습: <span style="color: #888888;">상태 불명</span>`;
      }
    }
  } catch (e) {
    console.error('자동 학습 상태 업데이트 오류:', e);
  }
}

// 저장된 자동 학습 상태 복원
function restoreAutoLearningStatus(memberName) {
  try {
    const savedStatus = localStorage.getItem('auto_learning_status');
    if (savedStatus) {
      const status = JSON.parse(savedStatus);
      const statusElement = document.getElementById(`auto-learning-status-${memberName}`);
      
      if (statusElement) {
        const autoLearningEnabled = status.enabled;
        const statusText = autoLearningEnabled ? '활성화' : '비활성화';
        const color = autoLearningEnabled ? '#0ecb81' : '#f6465d';
        statusElement.innerHTML = `자동 학습: <span style="color: ${color};">${statusText}</span>`;
      }
      
      return true;
    }
  } catch (e) {
    console.error('저장된 자동 학습 상태 복원 실패:', e);
  }
  return false;
}

// ML Auto 학습 시스템
async function runMLAutoLearning() {
  try {
    console.log('ML Auto 학습 시작');
    
    // Sequential intervals for systematic learning (순차적 실행)
    const intervals = ['minute1', 'minute3', 'minute5', 'minute10', 'minute15', 'minute30', 'minute60', 'day'];
    
    uiLog('ML Auto 학습 시작', `시작 시간: ${new Date().toLocaleTimeString()}`);
    
    for (const interval of intervals) {
      try {
        // Random N/B window for adaptive learning (3-100 range)
        const nbWindow = Math.floor(Math.random() * 97) + 3;
        
        const response = await fetch('/api/ml/auto-train', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            interval: interval,
            nb_window: nbWindow,
            ema_fast: 10,
            ema_slow: 30,
            horizon: 5,
            count: 1800
          })
        });
        
        if (response.ok) {
          const j = await response.json();
          uiLog('ML Auto 학습 완료', `train# ${j.train_count||0}`);
        } else {
          console.error(`ML Auto 학습 실패 (${interval}):`, await response.text());
        }
        
        // Wait between intervals to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (e) {
        console.error(`ML Auto 학습 오류 (${interval}):`, e);
      }
    }
    
    // Update N/B Zone Strip after ML Auto learning
    setTimeout(() => {
      updateNBZoneStrip();
    }, 2000);
    
    // 히스토리 업데이트를 ML Auto 학습 주기에 맞춰서 실행
    setTimeout(() => {
      // 현재 학습된 모델의 성능을 히스토리에 추가
      updateTradeHistory();
    }, 3000);
    
    console.log('ML Auto 학습 주기 완료');
    
  } catch (error) {
    console.error('ML Auto 학습 시스템 오류:', error);
  }
}

// 학습 성능 분석
function analyzeLearningPerformance(member) {
  const analysis = {
    skillLevel: member.skillLevel,
    experience: member.experience,
    winRate: member.winRate,
    coinPerformance: member.totalNbCoinsEarned - member.totalNbCoinsLost,
    learningProgress: member.learningProgress,
    recommendations: []
  };
  
  // 학습 권장사항 생성
  if (member.skillLevel < 1.5) {
    analysis.recommendations.push('기본 전략 학습 필요');
  }
  
  if (member.winRate < 50) {
    analysis.recommendations.push('승률 개선을 위한 전략 조정 필요');
  }
  
  if (member.coinPerformance < 0) {
    analysis.recommendations.push('손실 관리 전략 강화 필요');
  }
  
  if (member.experience < 50) {
    analysis.recommendations.push('더 많은 거래 경험 필요');
  }
  
  return analysis;
}

// 학습 진도 시각화
function createLearningProgressVisualization(member) {
  const progress = member.learningProgress || 0;
  const skillLevel = member.skillLevel || 0;
  const experience = member.experience || 0;
  
  return `
    <div style="margin: 4px 0; padding: 4px; background: rgba(25,118,210,0.1); border-radius: 3px;">
      <div style="font-size: 10px; color: #ffffff; margin-bottom: 2px;">
        학습 진도: ${progress}% | 스킬 레벨: ${skillLevel.toFixed(1)} | 경험: ${experience}
      </div>
      <div style="width: 100%; height: 6px; background: #2b3139; border-radius: 3px; overflow: hidden;">
        <div style="width: ${progress}%; height: 100%; background: linear-gradient(90deg, #0ecb81, #2bdab5);"></div>
      </div>
    </div>
  `;
}

// Initialize village learning system
function initializeVillageLearningSystem() {
  // Set up periodic learning updates
  setInterval(trainerLearningSystem, 5 * 60 * 1000); // Every 5 minutes
  
  // Set up ML Auto learning cycle
  setInterval(runMLAutoLearning, 30 * 60 * 1000); // Every 30 minutes
  
  // Load saved learning progress for all members
  if (typeof guildMembers !== 'undefined') {
    Object.values(guildMembers).forEach(member => {
      const savedProgress = loadMemberLearningProgress(member.name);
      if (savedProgress) {
        member.skillLevel = savedProgress.skillLevel || member.skillLevel;
        member.experience = savedProgress.experience || member.experience;
        member.learningRate = savedProgress.learningRate || member.learningRate;
        member.learningProgress = savedProgress.learningProgress || 0;
      }
    });
  }
  
  // Expose functions globally
  window.trainerLearningSystem = trainerLearningSystem;
  window.toggleAutoLearning = toggleAutoLearning;
  window.trainMayorGuidanceModel = trainMayorGuidanceModel;
  window.updateAutoLearningStatus = updateAutoLearningStatus;
  window.restoreAutoLearningStatus = restoreAutoLearningStatus;
  window.runMLAutoLearning = runMLAutoLearning;
  window.analyzeLearningPerformance = analyzeLearningPerformance;
  window.createLearningProgressVisualization = createLearningProgressVisualization;
  
  console.log('Village Learning System initialized');
}

// Export functions for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    trainerLearningSystem,
    saveMemberLearningProgress,
    loadMemberLearningProgress,
    toggleAutoLearning,
    trainMayorGuidanceModel,
    updateAutoLearningStatus,
    restoreAutoLearningStatus,
    runMLAutoLearning,
    analyzeLearningPerformance,
    createLearningProgressVisualization,
    initializeVillageLearningSystem
  };
}
