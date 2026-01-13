# 🎴 카드 등급 시스템 완전 가이드

## 개요

NBverse 카드 등급 시스템은 **N/B Zone 상태**와 **ML Trust 신뢰도**를 조합하여 매수/매도 카드의 품질을 평가합니다.

---

## 🗺️ N/B Zone 시스템

### Zone 종류

| Zone | 의미 | zone_flag | 카드 등급 영향 |
|------|------|-----------|----------------|
| 🔵 **BLUE** | 매수 구간 (가격 낮음) | `+1` | **+10점 보너스** |
| 🟠 **ORANGE** | 매도 구간 (가격 높음) | `-1` | **-10점 페널티** |
| ⚪ **NEUTRAL** | 중립 구간 | `0` | 보너스/페널티 없음 |

### Zone 판단 방법

#### 1. N/B 길드 방식 (기본)
- N/B Wave 분석: `r`, `w`, `ema_diff` 등을 종합
- 가격이 `zone_min_price`에 가까우면 BLUE
- 가격이 `zone_max_price`에 가까우면 ORANGE

#### 2. ML 모델 방식 (선택적)
```python
# rating_ml_v2.py - ZonePredictionModel
# Random Forest Classifier를 사용하여 zone 예측
zone_pred = zone_model.predict(card)
# => { "zone": "BLUE", "confidence": 0.85 }
```

---

## 🤖 ML Trust 시스템

### ML Trust란?

ML 모델이 **자신의 예측에 대한 신뢰도**를 백분율로 표현한 값입니다.

- **ML Trust = 50%**: ML 모델과 N/B 길드의 판단을 50:50으로 신뢰
- **ML Trust = 80%**: ML 모델 예측을 80% 신뢰, N/B 길드를 20% 신뢰
- **ML Trust = 20%**: ML 모델 예측을 20% 신뢰, N/B 길드를 80% 신뢰

### Trust 계산

```javascript
// server.py - /api/trust/config
const ml_trust = Number(trustConfig.ml_trust || 50) / 100;  // 0.5
const nb_trust = 1.0 - ml_trust;  // 0.5

// 최종 Zone 결정
if (ml_zone === nb_zone) {
  final_zone = ml_zone;  // 일치하면 그대로
} else if (ml_confidence > nb_confidence) {
  final_zone = ml_zone;  // ML이 더 확신하면 ML 선택
} else {
  final_zone = nb_zone;  // N/B가 더 확신하면 N/B 선택
}
```

---

## 🎯 카드 등급 계산

### N/B 카드 등급 (Card Rating System)

**N/B MAX + MIN 합계**를 기반으로 등급을 계산합니다.

#### 점수 계산 공식

```javascript
// 1. 각 항목별 점수 (0-100)
function calculateScore(max, min) {
  const sum = max + min;
  const ratio = max > min ? (max / (min || 1)) : 0.5;
  
  // 합계 기반 점수
  const baseScore = Math.min(100, (sum / 100) * 50);
  
  // MAX/MIN 비율 보너스
  const ratioBonus = ratio > 1 ? Math.min(50, (ratio - 1) * 25) : -20;
  
  return Math.max(0, Math.min(100, baseScore + ratioBonus));
}

// 2. 가격, 거래량, 거래대금 평균
const avgScore = (priceScore + volumeScore + amountScore) / 3;

// 3. Zone 보너스/페널티
let finalScore = avgScore;
if (zone === 'BLUE') finalScore += 10;
else if (zone === 'ORANGE') finalScore -= 10;
```

#### 등급 매핑

| 점수 | 등급 | 색상 | 이모지 |
|------|------|------|--------|
| 95+ | SSS+ | #ff00ff | ✨ |
| 90+ | SSS | #ff1493 | ⭐ |
| 85+ | SS+ | #ff6b9d | ✨ |
| 80+ | SS | #ff69b4 | ⭐ |
| 75+ | S+ | #ff8c00 | 💫 |
| 70+ | S | #ffa500 | ⭐ |
| 65+ | A+ | #ffb347 | 🌟 |
| 60+ | A | #ffd700 | ⭐ |
| 50+ | B+ | #90ee90 | ✓ |
| 40+ | B | #00cc00 | ✓ |
| 0+ | C | #888888 | — |

### ML 카드 등급 (ML Rating)

**ML 모델이 예측한 강화 수치**를 기반으로 등급을 계산합니다.

#### ML Feature 추출

```python
# helpers/rating_ml.py - CardRatingML.extract_features()
features = [
    p_max, p_min,           # 가격 N/B
    v_max, v_min,           # 거래량 N/B
    t_max, t_min,           # 거래대금 N/B
    r_price, r_vol, r_amt,  # 각 항목의 r 값
    avg_r,                  # 평균 r 값
    current_price,          # 현재 가격
    interval_hash,          # 시간대 해시
    zone_flag               # Zone 플래그 (BLUE=1, ORANGE=-1)
]
```

#### ML 예측 결과

```python
# Random Forest Regressor가 강화 수치(1-99) 예측
result = {
    "ok": True,
    "enhancement": 75,      # 강화 수치
    "grade": "A",           # 등급 (F, E, D, C, B, A, S)
    "method": "ml_rf",      # 또는 "rule" (규칙 기반)
    "zone": "BLUE",         # Zone 정보
    "trust_score": 0.85     # ML 신뢰도
}
```

#### ML 등급 매핑

| 강화 수치 | 등급 |
|-----------|------|
| 80-99 | S |
| 70-79 | A |
| 60-69 | B |
| 50-59 | C |
| 40-49 | D |
| 30-39 | E |
| 1-29 | F |

---

## 🔥 강화 수치 (Enhancement)

강화 수치는 **Zone에 따라 부호가 결정**됩니다:

| Zone | 부호 | 의미 |
|------|------|------|
| 🔵 BLUE | `+` | 강화 수치가 높을수록 좋은 매수 기회 |
| 🟠 ORANGE | `-` | 강화 수치가 높을수록 좋은 매도 기회 |
| ⚪ NEUTRAL | (없음) | 중립 |

### 표시 예시

- `ML S +85강` (BLUE Zone, 강화 85)
- `ML A -72강` (ORANGE Zone, 강화 72)
- `N/B SS+ +95점` (BLUE Zone, 점수 95)

---

## 📊 실제 카드 표시

### Buy Card (매수 카드)

```javascript
{
  "market": "KRW-BTC",
  "price": 134870000,
  "size": 0.00003744,
  
  // N/B 카드 등급
  "card_rating": {
    "code": "SS+",        // 등급 코드
    "league": "Challenger", // 리그 (Bronze, Silver, Gold, Challenger)
    "group": "Super",     // 그룹 (Normal, Super)
    "super": true,        // Super 카드 여부
    "enhancement": "+95", // 강화 수치
    "color": "#ff6b9d"    // 등급 색상
  },
  
  // ML 등급
  "ml_trust": {
    "grade": "A",         // ML 등급
    "enhancement": "72",  // ML 강화 수치
    "trust_score": 0.85,  // ML 신뢰도
    "method": "ml_rf"     // 예측 방법
  },
  
  // Zone 정보
  "nb_zone": {
    "zone": "BLUE",       // Zone 상태
    "zone_flag": 1,       // BLUE=1, ORANGE=-1
    "zone_conf": 0.90,    // Zone 신뢰도
    "dist_high": 0.05,    // 고점까지 거리
    "dist_low": 0.02      // 저점까지 거리
  }
}
```

---

## 🎮 사용 시나리오

### 1. BLUE Zone에서 매수

```
Current Zone: 🔵 BLUE
ML Trust: 80% (ML 모델 우선)
N/B Trust: 20%

ML 예측: BLUE (confidence: 0.90)
N/B 예측: BLUE (confidence: 0.85)

=> 최종 Zone: BLUE ✅
=> 카드 등급: N/B SS+ +95점, ML A +72강
=> 행동: 매수 추천
```

### 2. ORANGE Zone에서 매도

```
Current Zone: 🟠 ORANGE
ML Trust: 30% (N/B 길드 우선)
N/B Trust: 70%

ML 예측: ORANGE (confidence: 0.75)
N/B 예측: ORANGE (confidence: 0.95)

=> 최종 Zone: ORANGE ✅
=> 카드 등급: N/B A -68점, ML B -55강
=> 행동: 매도 추천
```

### 3. Zone 불일치

```
Current Zone: ⚪ NEUTRAL
ML Trust: 50%
N/B Trust: 50%

ML 예측: BLUE (confidence: 0.60)
N/B 예측: ORANGE (confidence: 0.80)

=> 최종 Zone: ORANGE (N/B 신뢰도가 더 높음)
=> 카드 등급: N/B B -48점, ML C +52강
=> 행동: 관망 또는 N/B 신뢰도 재조정 필요
```

---

## 🔧 설정 파일

### Trust Config (`data/trust_config.json`)

```json
{
  "ml_trust": 50.0,     // ML 모델 신뢰도 (0-100%)
  "nb_trust": 50.0,     // N/B 길드 신뢰도 (0-100%)
  "last_updated": "2026-01-13T00:00:00"
}
```

### Auto Buy Config (`data/auto_buy.json`)

```json
{
  "enabled": true,
  "intervals": ["minute5", "minute10", "minute15"],
  "min_trust": 80,      // 최소 신뢰도 (%)
  "target_zone": "BLUE" // 자동 매수 대상 Zone
}
```

---

## 📚 관련 파일

### 프론트엔드
- `static/card-rating-system.js` - N/B 카드 등급 계산
- `static/js/flow-dashboard.js` - 카드 렌더링 및 표시
- `static/mayor-guidance.js` - 촌장 지침 (Trust 시스템)

### 백엔드
- `helpers/rating_ml.py` - ML 카드 등급 모델 (v1)
- `rating_ml_v2.py` - ML 카드 등급 모델 (v2, Zone 예측 포함)
- `server.py` - Trust Config API
- `trade_routes.py` - Buy/Sell 카드 저장

### 데이터 저장
- `data/buy_cards/buy_cards_*.json` - 매수 카드
- `data/sell_cards/sell_cards_*.json` - 매도 카드
- `data/nbverse/max/` - NBverse MAX 카드 (card_rating 포함)
- `data/nbverse/min/` - NBverse MIN 카드

---

## 🎯 핵심 요약

1. **N/B Zone**: 시장 상태를 BLUE/ORANGE/NEUTRAL로 분류
2. **ML Trust**: ML 모델 신뢰도 (0-100%), N/B Trust와 합쳐서 100%
3. **카드 등급**: N/B 등급(SSS+~C)과 ML 등급(S~F) 병행 표시
4. **강화 수치**: Zone에 따라 +/- 부호가 결정됨
5. **최종 판단**: ML Trust와 N/B Trust 비율로 최종 Zone 결정

---

**작성일**: 2026-01-13  
**버전**: v0.0.2
