# Release v0.0.2-alpha (개발 버전)

> ⚠️ **개발 버전 경고**: 이 릴리스는 개발 중인 알파 버전입니다. 프로덕션 환경에서 사용하지 마세요.

## 📋 릴리스 정보
- **버전**: v0.0.2-alpha
- **날짜**: 2026-01-11
- **상태**: Pre-release (사전 출시)
- **안정성**: 개발 중 / 테스트 필요

## 🏷️ 태그
`n/b` `trading-bot` `cryptocurrency` `binance` `machine-learning` `ai-trading` `technical-analysis` `ohlcv` `bit-calculation` `zone-analysis` `blue-zone` `orange-zone` `nb-indicator` `algorithmic-trading` `python` `tensorflow` `real-time-trading` `crypto-bot` `automated-trading` `quantitative-analysis`

## 🔧 주요 변경사항

### features.py 로직 복원
- ✅ BIT 계산 로직을 원본 JavaScript 버전과 동일하게 복원
- ✅ GPU 가속 제거 및 CPU 버전으로 롤백
- ✅ 기본 `bit` 값 `99.9999999999` → `5.5`로 복원
- ✅ `calculate_bit()` 함수 reverse 처리 방식 수정
- ✅ `initialize_arrays()` CPU 전용 버전으로 단순화
- ✅ 중복된 `calculate_array_similarity()` 함수 제거
- ✅ `calculate_array_order_and_duplicate()` 로직 정리

### 프론트엔드 최적화
- ✅ flow-dashboard.js 성능 개선 (buy-card 업데이트 쓰로틀링)
- ✅ 런타임 에러 수정 (timeframeLabel, ccCurrentData, winClientHistory)
- ✅ 메모리 누수 방지 및 DOM 업데이트 최적화

## 🐛 알려진 이슈
- features.py의 MAX/MIN 값이 동일하게 출력되는 경우 발생 (데이터 샘플 크기 관련)
- GPU 가속 기능 완전히 제거됨 (향후 재검토 필요)

## ⚙️ 기술 스택
- Python 3.x
- TensorFlow (GPU 기능 비활성화)
- NumPy, Pandas
- JavaScript (Chart.js, LightweightCharts)

## 📦 설치 방법
```bash
# 저장소 클론
git clone <repository-url>
cd nb-bot-ai-v0.0.2

# 의존성 설치
pip install -r requirements_ml_v3.txt

# 서버 실행
python server.py
```

## 🧪 테스트 상태
- ⚠️ 단위 테스트: 미완성
- ⚠️ 통합 테스트: 진행 중
- ⚠️ 성능 테스트: 필요

## 🚧 다음 버전 계획 (v0.0.3)
- [ ] GPU 가속 안정화 및 재도입
- [ ] features.py 데이터 검증 로직 추가
- [ ] 프론트엔드 JS/HTML 완전 분리
- [ ] 단위 테스트 작성
- [ ] 에러 핸들링 강화

## ⚠️ 주의사항
1. **개발 버전**입니다 - 프로덕션 사용 금지
2. 데이터 손실 가능성 - 백업 필수
3. API 변경 가능성 - 하위 호환성 보장 안 됨
4. 버그 및 불안정성 예상

## 📝 기여자
- 내부 개발팀

## 📄 라이선스
[프로젝트 라이선스 명시 필요]

---

**GitHub 릴리스 태그**: `v0.0.2-alpha`  
**사전 출시 체크**: ✅ 필수
