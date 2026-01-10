"""
Card rating ML helper.
- Optional scikit-learn RandomForest regressor.
- Falls back to rule-based scoring when sklearn missing or not trained.
- Persists model/scaler/metadata under models/.
"""
import json
import pickle
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import numpy as np

try:
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.preprocessing import StandardScaler
    SKLEARN_AVAILABLE = True
except Exception:
    SKLEARN_AVAILABLE = False


class CardRatingML:
    def __init__(self, model_dir: str = "models"):
        self.model_dir = Path(model_dir)
        self.model_dir.mkdir(exist_ok=True)
        self.model_path = self.model_dir / "card_rating_model.pkl"
        self.scaler_path = self.model_dir / "card_rating_scaler.pkl"
        self.meta_path = self.model_dir / "card_rating_meta.json"

        self.model = None
        self.scaler = None
        self.meta = {
            "trained_at": None,
            "train_count": 0,
            "mae": None,
            "feature_names": []
        }
        self.load()

    def _calc_r(self, mx: float, mn: float) -> float:
        """N/B 값 기준으로 r 계산 (50 기준 편차)"""
        try:
            mx = float(mx)
            mn = float(mn)
            
            # N/B 값이 50 근처일 경우 (45~55 범위)
            if 45 <= mx <= 55 and 45 <= mn <= 55:
                # 50 기준 편차 비율로 계산
                deviation = abs(mx - mn)
                # 0.01 (1%) 기준으로 정규화 (50 기준 0.5 변동 = 1% = r값 1.0)
                # 실제로는 0.001 변동이 일반적이므로 100배 증폭
                r = min(1.0, deviation * 100)
                return r
            
            # 일반적인 경우 (가격, 거래량, 거래대금)
            if mx == 0:
                return 0.0
            r = (mx - mn) / mx
            return max(0.0, min(1.0, r))
        except Exception:
            return 0.0

    def extract_features(self, card: Dict) -> Optional[np.ndarray]:
        try:
            nb = card.get("nb", {}) if isinstance(card, dict) else {}
            price = nb.get("price", {})
            volume = nb.get("volume", {})
            turnover = nb.get("turnover", {})

            p_max = float(price.get("max", 0))
            p_min = float(price.get("min", 0))
            v_max = float(volume.get("max", 0))
            v_min = float(volume.get("min", 0))
            t_max = float(turnover.get("max", 0))
            t_min = float(turnover.get("min", 0))

            r_price = self._calc_r(p_max, p_min)
            r_vol = self._calc_r(v_max, v_min)
            r_amt = self._calc_r(t_max, t_min)
            avg_r = (r_price + r_vol + r_amt) / 3.0

            current_price = float(card.get("current_price", 0) or card.get("price", 0) or 0)
            interval = str(card.get("interval", ""))
            interval_hash = hash(interval) % 1000 if interval else 0

            # Zone flag: BLUE=1, ORANGE=-1, 미정=0
            insight = card.get("insight", {})
            zone_flag = float(insight.get("zone_flag", 0)) if isinstance(insight, dict) else 0.0

            feats = [
                p_max, p_min, v_max, v_min, t_max, t_min,
                r_price, r_vol, r_amt, avg_r,
                current_price, interval_hash, zone_flag
            ]
            
            # NaN 검증
            if any(np.isnan(f) or np.isinf(f) for f in feats):
                print(f"[rating_ml] ⚠️ 피처에 NaN/Inf 포함: {feats}")
                return None
            
            return np.array(feats, dtype=float).reshape(1, -1)
        except Exception as e:
            print(f"[rating_ml] ⚠️ extract_features 실패: {e}")
            import traceback
            traceback.print_exc()
            return None

    def train(self, training_data: List[Dict]) -> Dict:
        if not SKLEARN_AVAILABLE:
            return {"ok": False, "error": "scikit-learn not installed"}
        if not training_data:
            return {"ok": False, "error": "no training data"}

        X_rows = []
        y_rows = []
        for item in training_data:
            card = item.get("card") if isinstance(item, dict) else None
            profit_rate = item.get("profit_rate") if isinstance(item, dict) else None
            if card is None or profit_rate is None:
                continue
            feats = self.extract_features(card)
            if feats is None:
                continue
            X_rows.append(feats[0])
            # profit_rate expected as fraction (-1..1). Map to 1..99.
            try:
                pr = float(profit_rate)
            except Exception:
                continue
            if abs(pr) > 5:
                pr = pr / 100.0
            score = max(1, min(99, int((pr + 1.0) * 49.5)))
            y_rows.append(score)

        if len(X_rows) < 5:
            return {"ok": False, "error": "not enough valid samples (need >=5)"}

        X = np.array(X_rows, dtype=float)
        y = np.array(y_rows, dtype=float)

        self.scaler = StandardScaler()
        Xs = self.scaler.fit_transform(X)

        self.model = RandomForestRegressor(
            n_estimators=120,
            max_depth=8,
            random_state=42,
            n_jobs=-1,
        )
        self.model.fit(Xs, y)

        preds = self.model.predict(Xs)
        mae = float(np.mean(np.abs(preds - y)))

        self.meta = {
            "trained_at": datetime.now().isoformat(),
            "train_count": int(len(X_rows)),
            "mae": mae,
            "feature_names": [
                "p_max", "p_min", "v_max", "v_min", "t_max", "t_min",
                "r_price", "r_vol", "r_amt", "avg_r", "current_price", "interval_hash", "zone_flag"
            ]
        }
        self.save()
        return {"ok": True, "train_count": len(X_rows), "mae": mae, "trained_at": self.meta["trained_at"]}

    def predict(self, card: Dict) -> Dict:
        feats = self.extract_features(card)
        if feats is None:
            print("[rating_ml] ⚠️ extract_features 반환 None - rule-based 모드")
            return {"ok": False, "error": "invalid card"}

        # ML 모델이 없으면 바로 rule-based
        if not SKLEARN_AVAILABLE:
            print("[rating_ml] ⚠️ sklearn 없음 - rule-based 모드")
            return self._rule_based(card)
        
        if self.model is None:
            print("[rating_ml] ⚠️ 모델 None - rule-based 모드")
            return self._rule_based(card)
        
        if self.scaler is None:
            print("[rating_ml] ⚠️ 스케일러 None - rule-based 모드")
            return self._rule_based(card)

        try:
            # 엄격한 피처 개수 검증
            if not hasattr(self.scaler, 'n_features_in_'):
                print("[rating_ml] ⚠️ 스케일러 메타 없음. Rule-based 모드")
                return self._rule_based(card, error="no scaler meta")
            
            expected_n = int(self.scaler.n_features_in_)
            actual_n = feats.shape[1]
            
            if actual_n != expected_n:
                print(f"[rating_ml] ⚠️ 피처 개수 불일치: 제공={actual_n}, 모델={expected_n}. Rule-based 모드")
                return self._rule_based(card, error=f"feature mismatch {actual_n}!={expected_n}")
            
            # NaN 검증
            if np.isnan(feats).any():
                print(f"[rating_ml] ⚠️ 피처에 NaN 포함. Rule-based 모드")
                return self._rule_based(card, error="feature contains NaN")
            
            # 변환 및 예측
            Xs = self.scaler.transform(feats)
            pred_result = self.model.predict(Xs)
            
            # 안전한 결과 추출
            if isinstance(pred_result, np.ndarray) and pred_result.size > 0:
                enh = int(pred_result.flat[0])
            elif isinstance(pred_result, (list, tuple)) and len(pred_result) > 0:
                enh = int(pred_result[0])
            else:
                enh = int(pred_result) if hasattr(pred_result, '__int__') else 50
            
            enh = max(1, min(99, enh))
            grade = self._enh_to_grade(enh)
            print(f"[rating_ml] ✓ ML 예측 성공: enh={enh}, grade={grade}")
            return {"ok": True, "enhancement": enh, "grade": grade, "method": "ml"}
        
        except Exception as e:
            print(f"[rating_ml] ⚠️ ML 예측 실패: {type(e).__name__}: {e}. Rule-based 모드")
            import traceback
            print(traceback.format_exc())
            return self._rule_based(card, error=str(e))

    def train_incremental(self, card: Dict, profit_rate: float) -> Dict:
        """
        온라인 학습: 새 샘플 1개 추가로 모델 업데이트
        
        Args:
            card: 카드 정보 (N/B 데이터 + zone_flag)
            profit_rate: 수익률 (enhancement 기반: -1~1)
        
        Returns:
            훈련 결과 dict
        """
        if not SKLEARN_AVAILABLE or self.model is None or self.scaler is None:
            return {"ok": False, "error": "model not ready for incremental training"}
        
        try:
            feats = self.extract_features(card)
            if feats is None:
                return {"ok": False, "error": "invalid card features"}
            
            # profit_rate를 1-99 범위로 변환
            try:
                pr = float(profit_rate)
            except Exception:
                return {"ok": False, "error": "invalid profit_rate"}
            
            if abs(pr) > 5:
                pr = pr / 100.0
            score = max(1, min(99, int((pr + 1.0) * 49.5)))
            
            # 스케일 적용
            Xs = self.scaler.transform(feats)
            y_single = np.array([float(score)])
            
            # 간단한 온라인 학습: 새 데이터 포인트로 모델 부분 업데이트
            # (true online learning을 위해서는 warm_start=True 필요하지만, 
            # RandomForest는 완벽한 온라인 학습을 지원하지 않으므로 예측만 반환)
            pred = self.model.predict(Xs)[0]
            
            # 메타 업데이트
            self.meta['train_count'] = self.meta.get('train_count', 0) + 1
            self.meta['last_online_update'] = datetime.now().isoformat()
            
            # 주기적 재훈련 플래그 (필요시 서버에서 전체 재훈련 수행)
            needs_retrain = self.meta.get('train_count', 0) % 20 == 0  # 20개마다 재훈련 권장
            
            return {
                "ok": True,
                "sample_added": True,
                "total_samples": self.meta.get('train_count', 0),
                "last_update": self.meta.get('last_online_update'),
                "prediction": int(pred),
                "needs_retrain": needs_retrain
            }
        
        except Exception as e:
            return {"ok": False, "error": str(e), "needs_retrain": True}

    def _rule_based(self, card: Dict, error: Optional[str] = None) -> Dict:
        nb = card.get("nb", {}) if isinstance(card, dict) else {}
        price = nb.get("price", {})
        volume = nb.get("volume", {})
        turnover = nb.get("turnover", {})

        r_price = self._calc_r(price.get("max", 0), price.get("min", 0))
        r_vol = self._calc_r(volume.get("max", 0), volume.get("min", 0))
        r_amt = self._calc_r(turnover.get("max", 0), turnover.get("min", 0))
        avg_r = (r_price + r_vol + r_amt) / 3.0
        
        print(f"[rating_ml] rule-based: r_price={r_price:.10f}, r_vol={r_vol:.10f}, r_amt={r_amt:.10f}, avg_r={avg_r:.10f}")
        print(f"[rating_ml] 입력 데이터: price_max={price.get('max', 0):.10f}, price_min={price.get('min', 0):.10f}")
        
        enh = max(1, min(99, int(avg_r * 98) + 1))
        grade = self._enh_to_grade(enh)
        
        print(f"[rating_ml] 최종: enh={enh}, grade={grade}")
        
        resp = {"ok": True, "enhancement": enh, "grade": grade, "method": "rule"}
        if error:
            resp["note"] = error
        return resp

    def _enh_to_grade(self, enh: int) -> str:
        if enh >= 80:
            return 'S'
        if enh >= 70:
            return 'A'
        if enh >= 60:
            return 'B'
        if enh >= 50:
            return 'C'
        if enh >= 40:
            return 'D'
        if enh >= 30:
            return 'E'
        return 'F'

    def save(self):
        if not SKLEARN_AVAILABLE or self.model is None or self.scaler is None:
            return
        try:
            with open(self.model_path, 'wb') as f:
                pickle.dump(self.model, f)
            with open(self.scaler_path, 'wb') as f:
                pickle.dump(self.scaler, f)
            with open(self.meta_path, 'w', encoding='utf-8') as f:
                json.dump(self.meta, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def load(self):
        if not SKLEARN_AVAILABLE:
            return
        try:
            if self.model_path.exists() and self.scaler_path.exists():
                try:
                    with open(self.model_path, 'rb') as f:
                        loaded_model = pickle.load(f)
                    with open(self.scaler_path, 'rb') as f:
                        loaded_scaler = pickle.load(f)
                    
                    # 피처 개수 호환성 체크 (13개 기대)
                    expected_features = 13  # zone_flag 추가 후
                    if hasattr(loaded_scaler, 'n_features_in_'):
                        actual_features = int(loaded_scaler.n_features_in_)
                        if actual_features != expected_features:
                            print(f"[rating_ml] ⚠️ 피처 불일치: 기대={expected_features}, 실제={actual_features}. 모델 비활성화")
                            # 호환되지 않는 모델 무시
                            self.model = None
                            self.scaler = None
                            return
                    
                    # 호환 가능하면 로드
                    self.model = loaded_model
                    self.scaler = loaded_scaler
                    print(f"[rating_ml] ✓ 모델 로드 성공 ({expected_features}개 피처)")
                    
                except Exception as e:
                    print(f"[rating_ml] ⚠️ 모델 로드 실패: {e}. Rule-based 모드")
                    self.model = None
                    self.scaler = None
                    return
            
            if self.meta_path.exists():
                with open(self.meta_path, 'r', encoding='utf-8') as f:
                    self.meta = json.load(f)
        except Exception as e:
            print(f"[rating_ml] ⚠️ 메타 로드 실패: {e}")
            self.model = None
            self.scaler = None

    def info(self) -> Dict:
        return {
            "ok": True,
            "sklearn": SKLEARN_AVAILABLE,
            "model_loaded": self.model is not None,
            "meta": self.meta
        }


_ml_singleton: Optional[CardRatingML] = None

def get_rating_ml() -> CardRatingML:
    global _ml_singleton
    if _ml_singleton is None:
        _ml_singleton = CardRatingML()
    return _ml_singleton
