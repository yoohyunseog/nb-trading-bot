/**
 * 🎴 Card Rating System
 * N/B MAX + MIN 합계로 카드 등급을 계산
 * - MAX + MIN 합계가 클수록 등급 높음
 * - MAX < MIN일 때: 등급 낮음 (MIN 쪽에 치우침)
 * - MIN < MAX일 때: 등급 높음 (MAX 쪽에 치우침)
 */

const CardRatingSystem = (() => {
  /**
   * MAX + MIN 합계를 점수로 변환 (0-100)
   * - 합계가 크면 높은 점수
   * - MAX와 MIN의 크기 관계를 반영
   */
  function calculateScore(max, min) {
    const sum = max + min;
    const ratio = max > min ? (max / (min || 1)) : 0.5; // MAX > MIN이면 보너스
    
    // 합계 기반 점수 (0-100)
    const baseScore = Math.min(100, (sum / 100) * 50);
    
    // MAX/MIN 비율 보너스 (MAX > MIN이면 +점수)
    const ratioBonus = ratio > 1 ? Math.min(50, (ratio - 1) * 25) : -20;
    
    return Math.max(0, Math.min(100, baseScore + ratioBonus));
  }

  /**
   * 등급 계산 (0-100 점수 -> 등급)
   * SSS+ > SSS > SS+ > SS > S+ > S > A+ > A > B+ > B > C
   */
  function getGradeFromScore(score) {
    const grades = [
      { min: 95, grade: 'SSS+', color: '#ff00ff', emoji: '✨' },
      { min: 90, grade: 'SSS', color: '#ff1493', emoji: '⭐' },
      { min: 85, grade: 'SS+', color: '#ff6b9d', emoji: '✨' },
      { min: 80, grade: 'SS', color: '#ff69b4', emoji: '⭐' },
      { min: 75, grade: 'S+', color: '#ff8c00', emoji: '💫' },
      { min: 70, grade: 'S', color: '#ffa500', emoji: '⭐' },
      { min: 65, grade: 'A+', color: '#ffb347', emoji: '🌟' },
      { min: 60, grade: 'A', color: '#ffd700', emoji: '⭐' },
      { min: 50, grade: 'B+', color: '#90ee90', emoji: '✓' },
      { min: 40, grade: 'B', color: '#00cc00', emoji: '✓' },
      { min: 0, grade: 'C', color: '#888888', emoji: '—' }
    ];

    return grades.find(g => score >= g.min);
  }

  /**
   * 카드 등급 계산 (N/B MAX + MIN 기반)
   * @param {object} priceNB - { max, min }
   * @param {object} volumeNB - { max, min }
   * @param {object} amountNB - { max, min }
   * @param {string} zone - 'BLUE' 또는 'ORANGE'
   * @returns {object} { grade, score, color, emoji, details }
   */
  function calculateCardRating(priceNB, volumeNB, amountNB, zone = 'BLUE') {
    // N/B 객체에서 max, min 추출
    const pMax = priceNB?.max || 0;
    const pMin = priceNB?.min || 0;
    const vMax = volumeNB?.max || 0;
    const vMin = volumeNB?.min || 0;
    const aMax = amountNB?.max || 0;
    const aMin = amountNB?.min || 0;

    // 각 항목별 점수 계산
    const priceScore = calculateScore(pMax, pMin);
    const volumeScore = calculateScore(vMax, vMin);
    const amountScore = calculateScore(aMax, aMin);

    // 평균 점수
    const avgScore = (priceScore + volumeScore + amountScore) / 3;

    // Zone 보너스/페널티
    let finalScore = avgScore;
    if (zone === 'BLUE') {
      finalScore += 10; // BLUE는 +10 보너스
    } else if (zone === 'ORANGE') {
      finalScore -= 10; // ORANGE는 -10 페널티
    }

    finalScore = Math.max(0, Math.min(100, finalScore));

    const gradeInfo = getGradeFromScore(finalScore);

    return {
      grade: gradeInfo.grade,
      score: Math.round(finalScore),
      color: gradeInfo.color,
      emoji: gradeInfo.emoji,
      zone: zone,
      zoneEmoji: zone === 'BLUE' ? '🔵' : '🟠',
      details: {
        price: Math.round(priceScore),
        volume: Math.round(volumeScore),
        amount: Math.round(amountScore),
        average: Math.round(avgScore),
        sums: {
          price: pMax + pMin,
          volume: vMax + vMin,
          amount: aMax + aMin
        }
      }
    };
  }

  /**
   * HTML 카드 등급 뱃지 생성
   */
  function createRatingBadge(rating) {
    return `<span style="
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      background: ${rating.color};
      color: white;
      font-weight: 700;
      font-size: 12px;
      text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    ">${rating.emoji} ${rating.grade}</span>`;
  }

  /**
   * 자세한 정보 표시
   */
  function createDetailedInfo(rating) {
    return `<div style="font-size: 10px; color: #888; margin-top: 4px; line-height: 1.4;">
      💰 가격: ${rating.details.price}% | 
      📈 거래량: ${rating.details.volume}% | 
      💵 거래대금: ${rating.details.amount}%
    </div>`;
  }

  // Public API
  return {
    calculate: calculateCardRating,
    getGrade: getGradeFromScore,
    createBadge: createRatingBadge,
    createDetails: createDetailedInfo,
    calculateScore: calculateScore
  };
})();

// 전역으로 노출
window.CardRatingSystem = CardRatingSystem;

console.log('✅ Card Rating System loaded');
