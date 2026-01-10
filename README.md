# NB Trading Bot

AI-powered cryptocurrency trading bot with NBverse card system and multi-timeframe analysis.

## 📊 Project Information

- **Server**: https://참소식.com
- **Manager**: Server Administrator
- **Status**: 수익화 모듈 개발 중
- **Target**: ₩100,000,000 (1억원)

## Features

- **ML Trust Analysis**: Machine learning-based confidence scoring
- **N/B Zone Detection**: Blue/Orange zone trading signals
- **NBverse Card System**: Price/Volume/Turnover snapshot cards with auto-save
- **Automated Trading**: Paper and live trading modes with Upbit API
- **Flow Dashboard**: Real-time monitoring with 9-step progressive cycle
- **Multi-Timeframe**: Support for 1m, 3m, 5m, 10m, 15m, 30m, 1h, 1d intervals
- **Card Rating System**: Automatic grade calculation (Bronze to Challenger)
- **Win Rate Tracking**: Historical zone performance analysis

## Installation

```bash
pip install -r requirements.txt
```

## Quick Start

```bash
# Simple server (minimal features)
python server_simple.py

# Full server (all features)
python server.py
```

Access the dashboard at: `http://localhost:5057`

## Configuration

Create a `config.py` or set environment variables:

```python
# Upbit API Keys (optional for paper trading)
UPBIT_ACCESS_KEY = "your_access_key"
UPBIT_SECRET_KEY = "your_secret_key"

# Trading Mode
PAPER_TRADING = 1  # 1 for paper trading, 0 for live

# Market & Interval
MARKET = "KRW-BTC"
CANDLE_INTERVAL = "minute10"
```

## Project Structure

```
nb-bot-ai-v0.0.2/
├── server.py              # Main server with full features
├── server_simple.py       # Simplified server
├── trade_routes.py        # Trading route handlers
├── strategy.py            # Trading strategy logic
├── config.py              # Configuration
├── main.py                # Core trading functions
├── trade.py               # Trade execution
├── rating_ml.py           # ML rating prediction
├── helpers/               # Helper modules
│   ├── candles.py         # Candle data processing
│   ├── features.py        # Feature extraction
│   ├── nbverse.py         # NBverse card management
│   ├── nb_wave.py         # N/B wave calculation
│   └── storage.py         # Data persistence
├── static/                # Frontend assets
│   ├── flow-dashboard.html
│   ├── js/
│   │   └── flow-dashboard.js
│   └── css/
└── data/                  # Data storage
    ├── nbverse/           # NBverse snapshots
    ├── buy_cards/         # Buy order history
    └── sell_cards/        # Sell order history
```

## API Endpoints

### Trading
- `POST /api/trade/buy` - Execute buy order
- `POST /api/trade/sell` - Execute sell order
- `GET /api/trade/preflight` - Check trading feasibility

### Cards & Data
- `GET /api/cards/buy` - Get buy order cards
- `GET /api/cards/sell` - Get sell order cards
- `GET /api/nbverse/card` - Get current NBverse card
- `GET /api/nbverse/load` - Load saved NBverse snapshot
- `GET /api/nbverse/search` - Search NBverse cards

### Analysis
- `GET /api/ml/predict` - ML prediction with trust score
- `GET /api/nb-wave` - N/B zone status and history
- `GET /api/ohlcv` - OHLCV candle data

## Dashboard Features

### 9-Step Progressive Cycle
1. **Timeframe Selection** - Choose analysis interval
2. **ML Trust Loading** - Load ML confidence scores
3. **N/B Zone Status** - Current zone and historical trend
4. **Chart Rendering** - Price chart with N/B wave overlay
5. **Current Card** - Real-time NBverse card with rating
6. **Win% Calculation** - Zone performance snapshot
7. **Asset Loading** - Portfolio and balance info
8. **Buy Cards** - Historical buy orders with loss tracking
9. **Sell Cards** - Historical sell orders with profit tracking

### Card Rating System
- **Grades**: F, E, D, C, B, A, S (Bronze to Challenger league)
- **Enhancement**: +1 to +99 based on magnitude and N/B bias
- **Super Cards**: Triple-A or double-S rated cards
- **Bias**: Orange-heavy cards get + modifier, Blue-heavy get - modifier

## NBverse Card System

NBverse cards are time-stamped snapshots containing:
- Price MAX/MIN (normalized to 0-100 scale)
- Volume MAX/MIN
- Turnover MAX/MIN
- Recent value arrays (last 30 data points)
- N/B zone metadata (zone, r_value, w_value)
- Chart data (OHLCV candles)

Cards are automatically saved to disk for historical analysis and can be loaded by:
- Path (direct file access)
- N/B value (search by max/min value)
- Price range (search by current price)

## Security Update (2026-01-10)
- Absolute `nbverse_path` is no longer stored in buy-card files (prevents path disclosure and ransomware-style misuse).
- Dashboard Step 8 now fetches NBverse data **only via API** (`loadNbverseByNb`), never by direct file paths.
- Existing historical cards may still contain `nbverse_path`; scrub/rotate old data if path exposure is a concern.

## Environment Variables

```bash
# Trading
PAPER_TRADING=1
DISABLE_ZONE_RULE=1
ZONE100_TH=80.0

# N/B Wave
NB_HIGH=0.55
NB_LOW=0.45

# API
API_BASE=http://localhost:5057
```

## Development

```bash
# Run with auto-reload
python server.py

# Run tests
python test_normalize.py
python test_ohlcv.py
```

## 📄 License

**GNU General Public License v3.0 (GPL-3.0)**

This project is licensed under the GNU General Public License v3.0.

### Key Points:
- ✅ **Commercial Use**: You may use this software for commercial purposes
- ✅ **Modification**: You may modify the source code
- ✅ **Distribution**: You may distribute the software
- ✅ **Patent Use**: Express grant of patent rights from contributors
- ⚠️ **Disclose Source**: Source code must be made available when distributing
- ⚠️ **License and Copyright Notice**: Must include original license and copyright
- ⚠️ **Same License**: Modifications must be released under GPL-3.0
- ⚠️ **State Changes**: Must document changes made to the code

### What This Means:
If you modify and distribute this bot, you **must**:
1. Share your modified source code
2. Keep the same GPL-3.0 license
3. Credit the original authors
4. Document your changes

This is a **copyleft** license - it ensures the software and its derivatives remain free and open source.

For the complete license text, see the [LICENSE](LICENSE) file or visit:
https://www.gnu.org/licenses/gpl-3.0.html

### Why GPL-3.0?
We chose GPL-3.0 to:
- Protect the open-source nature of this trading bot
- Prevent proprietary forks without giving back to the community
- Ensure improvements benefit everyone
- Grant patent rights to all users

---

# NB 트레이딩 봇 (한글)

NBverse 카드 시스템과 다중 시간프레임 분석을 갖춘 AI 기반 암호화폐 자동매매 봇입니다.

## 주요 기능

- **ML Trust 분석**: 머신러닝 기반 신뢰도 점수
- **N/B 구역 감지**: 블루/오렌지 구역 매매 신호
- **NBverse 카드 시스템**: 가격/거래량/거래대금 스냅샷 카드 자동 저장
- **자동매매**: Upbit API를 사용한 가상/실전 거래
- **플로우 대시보드**: 9단계 진행 사이클 실시간 모니터링
- **다중 시간프레임**: 1분, 3분, 5분, 10분, 15분, 30분, 1시간, 1일 지원
- **카드 등급 시스템**: 브론즈부터 첼린저까지 자동 등급 계산
- **승률 추적**: 구역별 과거 성능 분석

## 설치

```bash
pip install -r requirements.txt
```

## 빠른 시작

```bash
# 간단한 서버 (기본 기능만)
python server_simple.py

# 전체 서버 (모든 기능)
python server.py
```

대시보드 접속: `http://localhost:5057`

## 설정

`config.py` 생성 또는 환경 변수 설정:

```python
# Upbit API 키 (가상 매매는 선택사항)
UPBIT_ACCESS_KEY = "your_access_key"
UPBIT_SECRET_KEY = "your_secret_key"

# 거래 모드
PAPER_TRADING = 1  # 1: 가상 매매, 0: 실전 매매

# 마켓 & 인터벌
MARKET = "KRW-BTC"
CANDLE_INTERVAL = "minute10"
```

## 주요 API

### 거래
- `POST /api/trade/buy` - 매수 주문 실행
- `POST /api/trade/sell` - 매도 주문 실행
- `GET /api/trade/preflight` - 거래 가능 여부 확인

### 카드 & 데이터
- `GET /api/cards/buy` - 매수 카드 조회
- `GET /api/cards/sell` - 매도 카드 조회
- `GET /api/nbverse/card` - 현재 NBverse 카드
- `GET /api/nbverse/load` - 저장된 스냅샷 로드

### 분석
- `GET /api/ml/predict` - ML 예측 및 신뢰도
- `GET /api/nb-wave` - N/B 구역 상태 및 이력
- `GET /api/ohlcv` - OHLCV 캔들 데이터

## 대시보드 9단계

1. **타임프레임 선택** - 분석 주기 선택
2. **ML Trust 로딩** - ML 신뢰도 점수
3. **N/B 구역 상태** - 현재 구역 및 추이
4. **차트 렌더링** - N/B 파동 오버레이 차트
5. **현재 카드** - 실시간 NBverse 카드 및 등급
6. **Win% 계산** - 구역 성능 스냅샷
7. **자산 조회** - 포트폴리오 및 잔고
8. **매수 카드** - 과거 매수 내역 및 손실 추적
9. **매도 카드** - 과거 매도 내역 및 수익 추적

## 카드 등급 시스템

- **등급**: F, E, D, C, B, A, S (브론즈~첼린저)
- **강화**: +1 ~ +99 (크기와 N/B 편향 기반)
- **슈퍼 카드**: AAA 또는 SS 등급
- **편향**: 오렌지 우세 → +, 블루 우세 → -

## 📄 라이선스

**GNU General Public License v3.0 (GPL-3.0)**

이 프로젝트는 GNU General Public License v3.0 라이선스 하에 배포됩니다.

### 주요 내용:
- ✅ **상업적 사용**: 상업적 목적으로 사용 가능
- ✅ **수정**: 소스 코드 수정 가능
- ✅ **배포**: 소프트웨어 배포 가능
- ✅ **특허 사용**: 기여자로부터 특허 권리 명시적 부여
- ⚠️ **소스 공개**: 배포 시 소스 코드 공개 의무
- ⚠️ **라이선스 및 저작권 표시**: 원본 라이선스와 저작권 포함 필수
- ⚠️ **동일 라이선스**: 수정본도 GPL-3.0으로 배포 필수
- ⚠️ **변경 사항 명시**: 코드 변경 내역 문서화 필수

### 의미:
이 봇을 수정하고 배포할 경우 **반드시**:
1. 수정된 소스 코드를 공개해야 함
2. 동일한 GPL-3.0 라이선스를 유지해야 함
3. 원저작자를 명시해야 함
4. 변경 사항을 문서화해야 함

이것은 **카피레프트(Copyleft)** 라이선스입니다 - 소프트웨어와 파생물이 자유롭고 오픈소스로 유지되도록 보장합니다.

전체 라이선스 텍스트는 [LICENSE](LICENSE) 파일을 참조하거나 다음을 방문하세요:
https://www.gnu.org/licenses/gpl-3.0.html

### 왜 GPL-3.0인가?
GPL-3.0을 선택한 이유:
- 이 트레이딩 봇의 오픈소스 특성 보호
- 커뮤니티에 기여하지 않는 독점 포크 방지
- 개선 사항이 모두에게 혜택이 되도록 보장
- 모든 사용자에게 특허 권리 부여
