# 8BIT Village Trading System - 설계 구도 에이전트

## 📋 시스템 개요

8BIT Village Trading System은 업비트 자동매매 봇으로, 마을 기반 거래 시스템과 실시간 Flask UI, NB-wave 신호, ML 모델링, 백테스팅, 실시간 주문 마커를 포함합니다.

## 🏗️ 시스템 아키텍처

### 1. 전체 구조

```
┌─────────────────────────────────────────────────────────────┐
│                   8BIT Village Trading System                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Frontend   │    │   Backend    │    │   Upbit API  │  │
│  │   (UI/JS)    │◄───►│  (Flask)    │◄───►│  (pyupbit)  │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                    │                    │          │
│         └────────────────────┼────────────────────┘          │
│                              │                                │
│                    ┌─────────▼─────────┐                    │
│                    │  Trading Engine   │                    │
│                    │  - Strategy       │                    │
│                    │  - ML Models      │                    │
│                    │  - Risk Mgmt      │                    │
│                    └───────────────────┘                    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 2. 컴포넌트 구조

#### 2.1 Frontend (UI Layer)

**파일 구조:**
```
static/
├── ui.html                    # 메인 UI 컨테이너
├── trading-dashboard.html     # 트레이딩 대시보드
├── ui.js                      # 메인 UI 로직
├── mayor-guidance.js          # 촌장 가이던스 시스템
├── village-trading-process.js # 마을 거래 프로세스
├── trainer-system.js          # 트레이너 시스템
├── village-learning-system.js # 마을 학습 시스템
└── guild-members-status.js   # 길드 멤버 상태
```

**주요 기능:**
- 실시간 차트 표시 (Lightweight Charts)
- 주문 마커 표시
- 자동 거래 제어
- ML 모델 인사이트 표시
- 마을 시스템 UI
- 로딩 상태 로그

#### 2.2 Backend (Server Layer)

**파일 구조:**
```
bot/
├── server.py              # Flask 서버 및 API
├── trade.py               # 주문 실행 로직
├── strategy.py            # 거래 전략
├── main.py                # 메인 루프
├── models/                # ML 모델 저장소
│   ├── nb_ml_minute1.pkl
│   ├── nb_ml_minute3.pkl
│   └── ...
└── data/                  # 데이터 저장소
    ├── nb_coins_store.json
    ├── nb_params.json
    └── trainer_storage.json
```

**주요 API 엔드포인트:**
- `/api/bot/start` - 봇 시작
- `/api/bot/stop` - 봇 중지
- `/api/bot/status` - 봇 상태
- `/api/balance` - 잔고 조회
- `/api/upbit/connection` - 업비트 연결 상태
- `/api/nb/coin` - N/B 코인 데이터
- `/api/ml/train` - ML 모델 학습
- `/api/village/*` - 마을 시스템 API

### 3. 데이터 흐름

#### 3.1 거래 신호 생성 흐름

```
[차트 데이터] 
    ↓
[N/B Wave 계산]
    ↓
[ML 모델 예측]
    ↓
[촌장 가이던스]
    ↓
[거래 결정]
    ↓
[주문 실행]
    ↓
[결과 기록]
```

#### 3.2 자동화 프로세스

```
[시스템 시작]
    ↓
[업비트 연결 확인]
    ↓
[잔고 조회]
    ↓
[차트 초기화]
    ↓
[Auto Trade 활성화]
    ↓
[주기적 작업]
    ├─ 백테스트 (5분마다)
    ├─ ML 학습 (30분마다)
    ├─ 최적화 (1시간마다)
    └─ 상태 업데이트 (30초마다)
```

## 🏰 마을 시스템 설계

### 1. 마을 주민 구조

```
Village Residents (Guild Members)
├── Scout (Explorer)
│   ├── 역할: 빠른 신호 탐지
│   ├── 담당: 1m, 3m 차트
│   └── 전략: 모멘텀
│
├── Guardian (Protector)
│   ├── 역할: 트렌드 보호
│   ├── 담당: 5m, 10m 차트
│   └── 전략: 트렌드 추종
│
├── Analyst (Strategist)
│   ├── 역할: 전략 분석
│   ├── 담당: 15m, 30m 차트
│   └── 전략: 패턴 분석
│
├── Elder (Advisor)
│   ├── 역할: 장기 조언
│   ├── 담당: 1h, 1D 차트
│   └── 전략: 장기 투자
│
└── Trader_A ~ Trader_F
    ├── 역할: 추가 트레이너
    └── 전략: 각자 고유 전략
```

### 2. 촌장 가이던스 시스템

**신뢰도 시스템:**
- ML 모델 신뢰도: 40%
- N/B 길드 신뢰도: 82%
- 가중 평균으로 최종 결정

**규칙:**
- BLUE 존: BUY만 허용
- ORANGE 존: SELL만 허용
- 실시간 5초 간격 업데이트

### 3. 에너지 시스템

**마을 에너지:**
- HP (체력): 주민별 최대 100
- Stamina (스태미나): 거래 활동에 사용
- Bitcar 에너지: 에너지 주입 시스템

**에너지 관리:**
- 거래 시 스태미나 소모
- 휴식으로 회복
- 에너지 부족 시 거래 제한

## 🤖 ML 모델 시스템

### 1. 모델 구조

**시계열 교차 검증:**
- 분봉별 독립 모델 (1m, 3m, 5m, 10m, 15m, 30m, 1h)
- Light hyper-parameter search
- 확률 보정 (Calibrated probabilities)

**특징:**
- N/B Wave 데이터
- 차트 패턴
- 거래량 정보
- 시간대별 특성

### 2. 학습 프로세스

```
[데이터 수집]
    ↓
[특징 추출]
    ↓
[모델 학습]
    ↓
[검증]
    ↓
[모델 저장]
    ↓
[실시간 예측]
```

## 📊 N/B Wave 시스템

### 1. N/B 계산

**기본 파라미터:**
- NB_HIGH: 0.55 (기본값)
- NB_LOW: 0.45 (기본값)
- Window: 100 (기본값)

**계산 과정:**
1. 차트 데이터 수집
2. N/B 값 계산
3. 존 판단 (BLUE/ORANGE)
4. 신호 생성

### 2. N/B COIN 시스템

**카드 기반 시스템:**
- 분봉별 N/B COIN 카드
- Masonry 레이아웃 (3열)
- 현재 차트 분봉 카드 강조

**기능:**
- BUY/SELL 버튼
- 카드 텍스트 복사
- 코인 카운트 관리

## 🔄 자동화 시스템

### 1. 자동 거래

**조건:**
- Auto Trade 토글 활성화
- 존-사이드 규칙 준수
- 신뢰도 임계값 충족
- 에너지 충분

**프로세스:**
1. 신호 확인
2. 조건 검증
3. 주문 실행
4. 결과 기록

### 2. 주기적 작업

**백테스트:**
- 주기: 5분마다
- 목적: 전략 검증
- 결과: Win% 계산

**ML 학습:**
- 주기: 30분마다
- 목적: 모델 업데이트
- 데이터: 최근 거래 데이터

**최적화:**
- 주기: 1시간마다
- 목적: N/B 파라미터 최적화
- 방법: 그리드 서치

## 🔐 보안 및 안전

### 1. Paper Mode

**기능:**
- 실제 거래 없이 시뮬레이션
- 모든 기능 테스트 가능
- 손실 없이 전략 검증

### 2. 리스크 관리

**포지션 관리:**
- 부분 청산 보호
- 최대 포지션 크기 제한
- 손절/익절 비율 설정

**에너지 기반 제한:**
- 에너지 부족 시 거래 중단
- 자동 휴식 시스템
- 긴급 리셋 기능

## 📈 모니터링 및 로깅

### 1. 로딩 상태 로그

**기능:**
- 실시간 시스템 상태 표시
- 색상 구분 (정보/성공/경고/오류)
- 타임스탬프 포함
- 자동 스크롤

### 2. 업비트 연결 모니터링

**확인 항목:**
- 연결 상태
- 모드 (Paper/Live)
- 키 타입
- 마지막 확인 시간
- 오류 정보

### 3. 거래 로그

**기록 항목:**
- 주문 시간
- 주문 타입 (BUY/SELL)
- 가격
- 수량
- 결과

## 🚀 배포 및 실행

### 1. 서버 시작

```bash
cd bot
python server.py
```

### 2. 접속

- URL: http://127.0.0.1:5057/ui
- 포트: 5057 (기본값)

### 3. 설정

**.env 파일:**
```
UPBIT_ACCESS_KEY=your_key
UPBIT_SECRET_KEY=your_secret
UI_PORT=5057
UI_HTTPS=false
NB_HIGH=0.55
NB_LOW=0.45
PAPER=true  # 또는 false
```

## 🔧 유지보수

### 1. 로그 확인

- 서버 로그: 콘솔 출력
- UI 로그: 로딩 상태 로그 카드
- 거래 로그: Order Log 섹션

### 2. 문제 해결

**차트가 표시되지 않을 때:**
- 브라우저 콘솔 확인
- 서버 연결 확인
- 데이터 로드 확인

**거래가 실행되지 않을 때:**
- Auto Trade 토글 확인
- 업비트 연결 상태 확인
- 에너지 상태 확인
- 존-사이드 규칙 확인

## 📚 추가 문서

- [8BIT Village Scenario (Korean)](../STORY/8BIT_VILLAGE_SCENARIO.md)
- [8BIT Village Scenario (English)](../STORY/8BIT_VILLAGE_SCENARIO_EN.md)
- [Bot README](../bot/README.md)
- [Village System README](../bot/README_VILLAGE_SYSTEM.md)

---

**버전:** 0.10.0  
**최종 업데이트:** 2025-01-18  
**작성자:** 8BIT Village Trading System Team

