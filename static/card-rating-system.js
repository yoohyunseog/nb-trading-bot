/**
 * 🎴 Card Rating System
 * N/B 값(가격, 거래량, 거래대금)을 받아서 카드 등급을 계산
 */

const CardRatingSystem = (() => {
  // N/B 범위 데이터
  const nbRanges = {
    price: { max: 3.8940408163, min: 27.2533061224 },
    volume: { max: 4.0633469388, min: 7.7726448980 },
    amount: { max: 4.4935836735, min: 7.9653551020 }
  };

  /**
   * 정규화 (0-1 범위로 변환)
   */
  function normalize(value, min, max) {
    if (max === min) return 0.5;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
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
   * 카드 등급 계산 (가격, 거래량, 거래대금 기반)
   * @param {number} priceNB - 가격 N/B 값
   * @param {number} volumeNB - 거래량 N/B 값
   * @param {number} amountNB - 거래대금 N/B 값
   * @param {string} zone - 'BLUE' 또는 'ORANGE'
   * @returns {object} { grade, score, color, emoji, details }
   */
  function calculateCardRating(priceNB, volumeNB, amountNB, zone = 'BLUE') {
    // 정규화
    const priceScore = normalize(priceNB, nbRanges.price.min, nbRanges.price.max);
    const volumeScore = normalize(volumeNB, nbRanges.volume.min, nbRanges.volume.max);
    const amountScore = normalize(amountNB, nbRanges.amount.min, nbRanges.amount.max);

    // 평균 점수 (0-100)
    const avgScore = (priceScore + volumeScore + amountScore) / 3 * 100;

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
        price: Math.round(priceScore * 100),
        volume: Math.round(volumeScore * 100),
        amount: Math.round(amountScore * 100),
        average: Math.round(avgScore)
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
    normalize: normalize,
    ranges: nbRanges
  };
})();

// 전역으로 노출
window.CardRatingSystem = CardRatingSystem;

console.log('✅ Card Rating System loaded');
