# 비트코인 아이템화 시스템 설계

## 🎯 핵심 아이디어

**비트코인을 구매하면 → 아이템으로 변환 → 실제 시세에 연동되어 가치 표시**

---

## 📋 시스템 개요

### 1. 기본 개념

```
비트코인 구매
    ↓
아이템으로 변환 (인벤토리에 저장)
    ↓
실시간 시세 연동
    ↓
아이템 가치 표시 (KRW)
```

### 2. 아이템 속성

```json
{
  "item_id": "btc_item_20251217_001",
  "item_name": "비트코인",
  "item_type": "crypto",
  "purchase_price": 95000000,  // 구매 가격 (KRW)
  "purchase_amount": 0.001,   // 구매 수량 (BTC)
  "purchase_time": "2025-12-17T10:30:00",
  "current_price": 96000000,   // 현재 시세 (KRW)
  "current_value": 96000,       // 현재 가치 (KRW)
  "profit_loss": 1000,          // 손익 (KRW)
  "profit_loss_percent": 1.05,  // 손익률 (%)
  "status": "active"           // active, sold, expired
}
```

---

## 🎮 아이템 시스템 구조

### 1. 아이템 생성

#### 구매 시 자동 생성
```
비트코인 구매 성공
    ↓
아이템 생성
    ├─ 고유 ID 생성
    ├─ 구매 정보 저장
    ├─ 현재 시세 저장
    └─ 인벤토리에 추가
```

#### 아이템 정보
- **아이템 ID**: 고유 식별자
- **아이템 이름**: "비트코인" 또는 커스텀 이름
- **구매 가격**: 구매 당시 KRW 가격
- **구매 수량**: 구매한 BTC 수량
- **구매 시간**: 구매 시각
- **현재 가치**: 실시간 시세 × 수량
- **손익**: 현재 가치 - 구매 가격
- **손익률**: (손익 / 구매 가격) × 100

### 2. 실시간 시세 연동

#### 업데이트 주기
- **실시간**: 5초마다 업데이트
- **시세 소스**: 업비트 API
- **가치 계산**: 현재 시세 × 보유 수량

#### 업데이트 프로세스
```
주기적 업데이트 (5초마다)
    ↓
업비트 API에서 현재 시세 조회
    ↓
모든 아이템의 현재 가치 재계산
    ↓
손익/손익률 업데이트
    ↓
UI에 반영
```

### 3. 아이템 표시

#### 인벤토리 UI
```
┌─────────────────────────────────────┐
│  비트코인 인벤토리                     │
├─────────────────────────────────────┤
│                                      │
│  [아이템 카드 1]                      │
│  ┌──────────────────────────────┐  │
│  │ 🪙 비트코인 #001              │  │
│  │ 수량: 0.001 BTC               │  │
│  │ 구매가: 95,000,000 KRW         │  │
│  │ 현재가: 96,000,000 KRW         │  │
│  │ 현재 가치: 96,000 KRW          │  │
│  │ 손익: +1,000 KRW (+1.05%)     │  │
│  │ 구매일: 2025-12-17 10:30      │  │
│  │ [판매] [상세보기]              │  │
│  └──────────────────────────────┘  │
│                                      │
│  [아이템 카드 2]                      │
│  ...                                 │
│                                      │
│  [총 보유 가치]                       │
│  총 수량: 0.005 BTC                  │
│  총 가치: 480,000 KRW                │
│  총 손익: +5,000 KRW (+1.05%)       │
│                                      │
└─────────────────────────────────────┘
```

#### 아이템 카드 디자인
- **색상 구분**:
  - 수익: 초록색 테두리
  - 손실: 빨간색 테두리
  - 보통: 회색 테두리

- **시각적 표시**:
  - 손익률 바
  - 가격 변동 그래프 (선택적)
  - 상태 아이콘

---

## 💾 데이터 저장

### 1. 저장 위치

#### 서버 측
```python
# bot/data/bitcoin_items.json
{
  "items": [
    {
      "item_id": "btc_item_20251217_001",
      "purchase_price": 95000000,
      "purchase_amount": 0.001,
      "purchase_time": "2025-12-17T10:30:00",
      "status": "active"
    },
    ...
  ],
  "last_updated": "2025-12-17T10:35:00"
}
```

#### 클라이언트 측
- 메모리에 캐시
- 실시간 업데이트

### 2. 데이터 구조

```python
class BitcoinItem:
    item_id: str           # 고유 ID
    purchase_price: float  # 구매 가격 (KRW)
    purchase_amount: float # 구매 수량 (BTC)
    purchase_time: datetime # 구매 시간
    current_price: float   # 현재 시세 (KRW) - 실시간 업데이트
    current_value: float   # 현재 가치 (KRW) - 실시간 계산
    profit_loss: float     # 손익 (KRW)
    profit_loss_percent: float # 손익률 (%)
    status: str            # active, sold, expired
```

---

## 🔄 API 설계

### 1. 아이템 생성 API

```python
POST /api/items/create
{
  "purchase_price": 95000000,
  "purchase_amount": 0.001,
  "item_name": "비트코인"  # 선택적
}

Response:
{
  "ok": true,
  "item": {
    "item_id": "btc_item_20251217_001",
    "purchase_price": 95000000,
    "purchase_amount": 0.001,
    "purchase_time": "2025-12-17T10:30:00",
    "current_price": 96000000,
    "current_value": 96000,
    "profit_loss": 1000,
    "profit_loss_percent": 1.05,
    "status": "active"
  }
}
```

### 2. 아이템 목록 조회 API

```python
GET /api/items/list?status=active

Response:
{
  "ok": true,
  "items": [
    {
      "item_id": "btc_item_20251217_001",
      "purchase_price": 95000000,
      "purchase_amount": 0.001,
      "purchase_time": "2025-12-17T10:30:00",
      "current_price": 96000000,
      "current_value": 96000,
      "profit_loss": 1000,
      "profit_loss_percent": 1.05,
      "status": "active"
    },
    ...
  ],
  "total": {
    "total_amount": 0.005,
    "total_value": 480000,
    "total_profit_loss": 5000,
    "total_profit_loss_percent": 1.05
  }
}
```

### 3. 아이템 시세 업데이트 API

```python
GET /api/items/update-prices

Response:
{
  "ok": true,
  "updated_count": 5,
  "current_btc_price": 96000000,
  "last_updated": "2025-12-17T10:35:00"
}
```

### 4. 아이템 판매 API

```python
POST /api/items/sell
{
  "item_id": "btc_item_20251217_001"
}

Response:
{
  "ok": true,
  "item": {
    "item_id": "btc_item_20251217_001",
    "status": "sold",
    "sell_price": 96000000,
    "sell_time": "2025-12-17T10:40:00",
    "final_profit_loss": 1000,
    "final_profit_loss_percent": 1.05
  }
}
```

---

## 🎨 UI 통합

### 1. 인벤토리 탭 추가

기존 UI에 "인벤토리" 탭 추가:
- Trading Dashboard
- Guild Members
- **인벤토리** (새로 추가)

### 2. 인벤토리 화면

```
┌─────────────────────────────────────┐
│  비트코인 인벤토리                     │
├─────────────────────────────────────┤
│                                      │
│  [필터] [정렬] [새로고침]            │
│                                      │
│  ┌──────────────────────────────┐   │
│  │ 아이템 카드들 (그리드 레이아웃) │   │
│  │                              │   │
│  │ [카드1] [카드2] [카드3]      │   │
│  │ [카드4] [카드5] [카드6]      │   │
│  │                              │   │
│  └──────────────────────────────┘   │
│                                      │
│  [요약 정보]                          │
│  총 보유: 0.005 BTC                  │
│  총 가치: 480,000 KRW                │
│  총 손익: +5,000 KRW                 │
│                                      │
└─────────────────────────────────────┘
```

### 3. 아이템 카드 컴포넌트

```html
<div class="bitcoin-item-card" data-item-id="btc_item_20251217_001">
  <div class="item-header">
    <span class="item-icon">🪙</span>
    <span class="item-name">비트코인 #001</span>
    <span class="item-status badge">활성</span>
  </div>
  <div class="item-body">
    <div class="item-amount">수량: 0.001 BTC</div>
    <div class="item-purchase-price">구매가: 95,000,000 KRW</div>
    <div class="item-current-price">현재가: 96,000,000 KRW</div>
    <div class="item-current-value">현재 가치: 96,000 KRW</div>
    <div class="item-profit-loss positive">손익: +1,000 KRW (+1.05%)</div>
    <div class="item-purchase-time">구매일: 2025-12-17 10:30</div>
  </div>
  <div class="item-actions">
    <button class="btn-sell">판매</button>
    <button class="btn-detail">상세보기</button>
  </div>
</div>
```

---

## 🔧 구현 계획

### Phase 1: 기본 구조 (1주)

1. ✅ 데이터 모델 정의
2. ✅ 아이템 생성 API
3. ✅ 아이템 목록 조회 API
4. ✅ 기본 인벤토리 UI

### Phase 2: 시세 연동 (3일)

1. ✅ 실시간 시세 업데이트
2. ✅ 가치 계산 로직
3. ✅ 손익 계산 로직
4. ✅ UI 실시간 반영

### Phase 3: UI 개선 (3일)

1. ✅ 아이템 카드 디자인
2. ✅ 필터/정렬 기능
3. ✅ 요약 정보 표시
4. ✅ 판매 기능

### Phase 4: 고급 기능 (선택적)

1. ✅ 가격 변동 그래프
2. ✅ 알림 기능 (손익률 임계값)
3. ✅ 통계 및 분석
4. ✅ 내보내기 기능

---

## 💡 자동화 연동

### 1. 자동 거래 시 아이템 생성

```
자동 거래로 비트코인 구매 성공
    ↓
자동으로 아이템 생성
    ├─ 아이템 ID 생성
    ├─ 구매 정보 저장
    └─ 인벤토리에 추가
```

### 2. 아이템 기반 거래 결정

```
아이템 가치 분석
    ├─ 평균 구매가 계산
    ├─ 현재 손익률 확인
    └─ 판매 결정 (임계값 도달 시)
```

---

## 📊 통계 및 분석

### 1. 아이템 통계

- 총 보유 수량
- 총 가치
- 평균 구매가
- 평균 손익률
- 최고 수익 아이템
- 최대 손실 아이템

### 2. 시간별 분석

- 일별 손익 추이
- 주별 손익 추이
- 월별 손익 추이

---

## 🛡️ 안전장치

### 1. 데이터 보호

- 아이템 데이터 백업
- 구매 기록 보존
- 판매 기록 보존

### 2. 오류 처리

- 시세 조회 실패 시 재시도
- 데이터 불일치 감지
- 자동 복구 메커니즘

---

## 📝 예시 시나리오

### 시나리오 1: 비트코인 구매

```
1. 사용자가 비트코인 구매 (0.001 BTC, 95,000,000 KRW)
2. 시스템이 아이템 생성
   - 아이템 ID: btc_item_20251217_001
   - 구매 정보 저장
3. 인벤토리에 아이템 추가
4. 실시간 시세 연동 시작
```

### 시나리오 2: 시세 변동

```
1. 비트코인 시세가 96,000,000 KRW로 상승
2. 시스템이 5초마다 시세 업데이트
3. 아이템 가치 재계산
   - 현재 가치: 96,000 KRW
   - 손익: +1,000 KRW
   - 손익률: +1.05%
4. UI에 실시간 반영
```

### 시나리오 3: 아이템 판매

```
1. 사용자가 아이템 판매 클릭
2. 현재 시세로 판매 실행
3. 아이템 상태를 "sold"로 변경
4. 최종 손익 기록
5. 인벤토리에서 제거 (또는 판매된 아이템 섹션으로 이동)
```

---

**버전**: 1.0  
**작성일**: 2025-12-17  
**상태**: 설계 단계

