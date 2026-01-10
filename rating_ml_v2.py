#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
리팩토링된 ML Rating 시스템 v2
- Zone 예측 모델 추가 (Classification)
- 수익률 예측 모델 개선 (Regression)
- 검증 메트릭 강화 (Accuracy, F1, MAE, R2)
"""

import os
import json
import pickle
import numpy as np
from typing import Dict, List, Optional, Tuple
from pathlib import Path
from datetime import datetime
from utils.logger import setup_logger

# Logger 설정
logger = setup_logger('ml_v2', log_dir='logs')
logger.info("=" * 60)
logger.info("[rating_ml_v2] 모듈 로드됨")
logger.info("=" * 60)

# Optional scikit-learn imports
try:
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, r2_score
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("[rating_ml_v2] ⚠️ scikit-learn not available - ML features disabled")


class ZonePredictionModel:
    """ORANGE/BLUE Zone 예측 모델 (분류)"""
    
    def __init__(self, model_dir: str = "models"):
        self.model_dir = Path(model_dir)
        self.model_dir.mkdir(parents=True, exist_ok=True)
        
        self.model: Optional[RandomForestClassifier] = None
        self.scaler: Optional[StandardScaler] = None
        self.meta: Dict = {}
        
        self.model_path = self.model_dir / "zone_model.pkl"
        self.scaler_path = self.model_dir / "zone_scaler.pkl"
        self.meta_path = self.model_dir / "zone_meta.json"
        
        self.load()
    
    def extract_features(self, card: Dict) -> Optional[np.ndarray]:
        """Zone 예측용 Feature 추출 (zone_flag 제외)"""
        try:
            nb = card.get("nb", {})
            price = nb.get("price", {})
            volume = nb.get("volume", {})
            turnover = nb.get("turnover", {})

            p_max = float(price.get("max", 0))
            p_min = float(price.get("min", 0))
            v_max = float(volume.get("max", 0))
            v_min = float(volume.get("min", 0))
            t_max = float(turnover.get("max", 0))
            t_min = float(turnover.get("min", 0))

            # N/B Wave r 계산
            def calc_r(mx, mn):
                if mx <= 0 or mn <= 0:
                    return 0.0
                return (mx - mn) / (mx + mn) if (mx + mn) > 0 else 0.0

            r_price = calc_r(p_max, p_min)
            r_vol = calc_r(v_max, v_min)
            r_amt = calc_r(t_max, t_min)
            avg_r = (r_price + r_vol + r_amt) / 3.0

            current_price = float(card.get("current_price", 0) or card.get("price", 0) or 0)
            interval = str(card.get("interval", ""))
            interval_hash = hash(interval) % 1000 if interval else 0

            # Zone flag는 포함하지 않음 (예측 대상이므로)
            feats = [
                p_max, p_min, v_max, v_min, t_max, t_min,
                r_price, r_vol, r_amt, avg_r,
                current_price, interval_hash
            ]
            
            if any(np.isnan(f) or np.isinf(f) for f in feats):
                logger.warning("[ZoneModel] Feature에 NaN/Inf 포함")
                return None
            
            return np.array(feats, dtype=float).reshape(1, -1)
        except Exception as e:
            logger.error(f"[ZoneModel] Feature 추출 실패: {e}")
            return None
    
    def train(self, training_data: List[Dict]) -> Dict:
        """Zone 분류 모델 훈련"""
        logger.info("[ZoneModel] 훈련 시작")
        
        if not SKLEARN_AVAILABLE:
            logger.error("[ZoneModel] scikit-learn 없음")
            return {"ok": False, "error": "scikit-learn not installed"}
        
        X_rows, y_rows = [], []
        
        for item in training_data:
            card = item.get("card")
            if not card:
                continue
            
            feats = self.extract_features(card)
            if feats is None:
                continue
            
            # Zone label 추출 (ORANGE=-1, BLUE=1)
            insight = card.get("insight", {})
            zone_flag = insight.get("zone_flag", 0) if isinstance(insight, dict) else 0
            
            if zone_flag == 0:
                continue  # 미분류 zone은 제외
            
            # -1(ORANGE) → 0, 1(BLUE) → 1로 변환
            zone_label = 1 if zone_flag > 0 else 0
            
            X_rows.append(feats[0])
            y_rows.append(zone_label)
        
        if len(X_rows) < 10:
            logger.warning(f"[ZoneModel] 샘플 부족: {len(X_rows)}개 (최소 10개 필요)")
            return {"ok": False, "error": f"not enough samples (need >=10, got {len(X_rows)})"}
        
        logger.info(f"[ZoneModel] 훈련 데이터: {len(X_rows)}개 샘플")
        
        X = np.array(X_rows, dtype=float)
        y = np.array(y_rows, dtype=int)
        
        # Train/Test split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        
        # Scaling
        self.scaler = StandardScaler()
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)
        
        # Model training
        self.model = RandomForestClassifier(
            n_estimators=150,
            max_depth=10,
            min_samples_split=5,
            random_state=42,
            n_jobs=-1,
            class_weight='balanced'
        )
        self.model.fit(X_train_scaled, y_train)
        
        # Evaluation
        y_pred_train = self.model.predict(X_train_scaled)
        y_pred_test = self.model.predict(X_test_scaled)
        
        train_acc = accuracy_score(y_train, y_pred_train)
        test_acc = accuracy_score(y_test, y_pred_test)
        f1 = f1_score(y_test, y_pred_test, average='weighted')
        
        self.meta = {
            "trained_at": datetime.now().isoformat(),
            "train_count": len(X_rows),
            "train_acc": float(train_acc),
            "test_acc": float(test_acc),
            "f1_score": float(f1),
            "feature_count": X.shape[1]
        }
        
        self.save()
        
        logger.info(f"[ZoneModel] ✓ 훈련 완료")
        logger.info(f"[ZoneModel]   Train Accuracy: {train_acc:.4f}")
        logger.info(f"[ZoneModel]   Test Accuracy:  {test_acc:.4f}")
        logger.info(f"[ZoneModel]   F1 Score:       {f1:.4f}")
        
        return {
            "ok": True,
            "train_acc": float(train_acc),
            "test_acc": float(test_acc),
            "f1_score": float(f1),
            "train_count": len(X_rows)
        }
    
    def predict(self, card: Dict) -> Dict:
        """Zone 예측 (ORANGE/BLUE)"""
        if not SKLEARN_AVAILABLE or self.model is None or self.scaler is None:
            return {"ok": False, "error": "model not available"}
        
        feats = self.extract_features(card)
        if feats is None:
            return {"ok": False, "error": "invalid features"}
        
        try:
            feats_scaled = self.scaler.transform(feats)
            zone_class = int(self.model.predict(feats_scaled)[0])
            zone_proba = self.model.predict_proba(feats_scaled)[0]
            
            zone_name = "BLUE" if zone_class == 1 else "ORANGE"
            confidence = float(zone_proba[zone_class])
            
            return {
                "ok": True,
                "zone": zone_name,
                "zone_flag": 1 if zone_class == 1 else -1,
                "confidence": confidence
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}
    
    def save(self):
        """모델 저장"""
        try:
            saved_files = []
            
            if self.model:
                with open(self.model_path, 'wb') as f:
                    pickle.dump(self.model, f)
                if self.model_path.exists():
                    size = self.model_path.stat().st_size
                    saved_files.append(f"{self.model_path.name} ({size} bytes)")
            
            if self.scaler:
                with open(self.scaler_path, 'wb') as f:
                    pickle.dump(self.scaler, f)
                if self.scaler_path.exists():
                    size = self.scaler_path.stat().st_size
                    saved_files.append(f"{self.scaler_path.name} ({size} bytes)")
            
            if self.meta:
                with open(self.meta_path, 'w', encoding='utf-8') as f:
                    json.dump(self.meta, f, indent=2, ensure_ascii=False)
                if self.meta_path.exists():
                    size = self.meta_path.stat().st_size
                    saved_files.append(f"{self.meta_path.name} ({size} bytes)")
            
            logger.info(f"[ZoneModel] 저장 완료: {', '.join(saved_files)}")
        except Exception as e:
            logger.error(f"[ZoneModel] 저장 실패: {e}")
    
    def load(self):
        """모델 로드"""
        try:
            if self.model_path.exists():
                with open(self.model_path, 'rb') as f:
                    self.model = pickle.load(f)
            if self.scaler_path.exists():
                with open(self.scaler_path, 'rb') as f:
                    self.scaler = pickle.load(f)
            if self.meta_path.exists():
                with open(self.meta_path, 'r', encoding='utf-8') as f:
                    self.meta = json.load(f)
            if self.model:
                logger.info(f"[ZoneModel] 로드 완료: {self.meta.get('trained_at', 'unknown')}")
        except Exception as e:
            logger.error(f"[ZoneModel] 로드 실패: {e}")


class ProfitPredictionModel:
    """수익률 예측 모델 (회귀) - Zone 정보 포함"""
    
    def __init__(self, model_dir: str = "models"):
        self.model_dir = Path(model_dir)
        self.model_dir.mkdir(parents=True, exist_ok=True)
        
        self.model: Optional[RandomForestRegressor] = None
        self.scaler: Optional[StandardScaler] = None
        self.meta: Dict = {}
        
        self.model_path = self.model_dir / "profit_model.pkl"
        self.scaler_path = self.model_dir / "profit_scaler.pkl"
        self.meta_path = self.model_dir / "profit_meta.json"
        
        self.load()
    
    def extract_features(self, card: Dict) -> Optional[np.ndarray]:
        """수익률 예측용 Feature 추출 (zone_flag 포함)"""
        try:
            nb = card.get("nb", {})
            price = nb.get("price", {})
            volume = nb.get("volume", {})
            turnover = nb.get("turnover", {})

            p_max = float(price.get("max", 0))
            p_min = float(price.get("min", 0))
            v_max = float(volume.get("max", 0))
            v_min = float(volume.get("min", 0))
            t_max = float(turnover.get("max", 0))
            t_min = float(turnover.get("min", 0))

            def calc_r(mx, mn):
                if mx <= 0 or mn <= 0:
                    return 0.0
                return (mx - mn) / (mx + mn) if (mx + mn) > 0 else 0.0

            r_price = calc_r(p_max, p_min)
            r_vol = calc_r(v_max, v_min)
            r_amt = calc_r(t_max, t_min)
            avg_r = (r_price + r_vol + r_amt) / 3.0

            current_price = float(card.get("current_price", 0) or card.get("price", 0) or 0)
            interval = str(card.get("interval", ""))
            interval_hash = hash(interval) % 1000 if interval else 0

            # Zone flag 포함
            insight = card.get("insight", {})
            zone_flag = float(insight.get("zone_flag", 0)) if isinstance(insight, dict) else 0.0

            feats = [
                p_max, p_min, v_max, v_min, t_max, t_min,
                r_price, r_vol, r_amt, avg_r,
                current_price, interval_hash, zone_flag
            ]
            
            if any(np.isnan(f) or np.isinf(f) for f in feats):
                logger.warning("[ProfitModel] Feature에 NaN/Inf 포함")
                return None
            
            return np.array(feats, dtype=float).reshape(1, -1)
        except Exception as e:
            logger.error(f"[ProfitModel] Feature 추출 실패: {e}")
            return None
    
    def train(self, training_data: List[Dict]) -> Dict:
        """수익률 예측 모델 훈련"""
        logger.info("[ProfitModel] 훈련 시작")
        
        if not SKLEARN_AVAILABLE:
            logger.error("[ProfitModel] scikit-learn 없음")
            return {"ok": False, "error": "scikit-learn not installed"}
        
        X_rows, y_rows = [], []
        
        for item in training_data:
            card = item.get("card")
            profit_rate = item.get("profit_rate")
            
            if not card or profit_rate is None:
                continue
            
            feats = self.extract_features(card)
            if feats is None:
                continue
            
            try:
                pr = float(profit_rate)
                # Normalize to -1..1 range if needed
                if abs(pr) > 5:
                    pr = pr / 100.0
                
                X_rows.append(feats[0])
                y_rows.append(pr)
            except Exception:
                continue
        
        if len(X_rows) < 10:
            logger.warning(f"[ProfitModel] 샘플 부족: {len(X_rows)}개 (최소 10개 필요)")
            return {"ok": False, "error": f"not enough samples (need >=10, got {len(X_rows)})"}
        
        logger.info(f"[ProfitModel] 훈련 데이터: {len(X_rows)}개 샘플")
        
        X = np.array(X_rows, dtype=float)
        y = np.array(y_rows, dtype=float)
        
        # Train/Test split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
        
        # Scaling
        self.scaler = StandardScaler()
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)
        
        # Model training
        self.model = RandomForestRegressor(
            n_estimators=150,
            max_depth=10,
            min_samples_split=5,
            random_state=42,
            n_jobs=-1
        )
        self.model.fit(X_train_scaled, y_train)
        
        # Evaluation
        y_pred_train = self.model.predict(X_train_scaled)
        y_pred_test = self.model.predict(X_test_scaled)
        
        train_mae = mean_absolute_error(y_train, y_pred_train)
        test_mae = mean_absolute_error(y_test, y_pred_test)
        train_r2 = r2_score(y_train, y_pred_train)
        test_r2 = r2_score(y_test, y_pred_test)
        
        self.meta = {
            "trained_at": datetime.now().isoformat(),
            "train_count": len(X_rows),
            "train_mae": float(train_mae),
            "test_mae": float(test_mae),
            "train_r2": float(train_r2),
            "test_r2": float(test_r2),
            "feature_count": X.shape[1]
        }
        
        self.save()
        
        logger.info(f"[ProfitModel] ✓ 훈련 완료")
        logger.info(f"[ProfitModel]   Train MAE: {train_mae:.4f}")
        logger.info(f"[ProfitModel]   Test MAE:  {test_mae:.4f}")
        logger.info(f"[ProfitModel]   Train R²:  {train_r2:.4f}")
        logger.info(f"[ProfitModel]   Test R²:   {test_r2:.4f}")
        
        return {
            "ok": True,
            "train_mae": float(train_mae),
            "test_mae": float(test_mae),
            "train_r2": float(train_r2),
            "test_r2": float(test_r2),
            "train_count": len(X_rows)
        }
    
    def predict(self, card: Dict) -> Dict:
        """수익률 예측"""
        if not SKLEARN_AVAILABLE or self.model is None or self.scaler is None:
            return {"ok": False, "error": "model not available"}
        
        feats = self.extract_features(card)
        if feats is None:
            return {"ok": False, "error": "invalid features"}
        
        try:
            feats_scaled = self.scaler.transform(feats)
            profit_rate = float(self.model.predict(feats_scaled)[0])
            
            # Convert to 1~99 score
            score = max(1, min(99, int((profit_rate + 1.0) * 49.5)))
            
            return {
                "ok": True,
                "profit_rate": profit_rate,
                "score": score
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}
    
    def save(self):
        """모델 저장"""
        try:
            saved_files = []
            
            if self.model:
                with open(self.model_path, 'wb') as f:
                    pickle.dump(self.model, f)
                if self.model_path.exists():
                    size = self.model_path.stat().st_size
                    saved_files.append(f"{self.model_path.name} ({size} bytes)")
            
            if self.scaler:
                with open(self.scaler_path, 'wb') as f:
                    pickle.dump(self.scaler, f)
                if self.scaler_path.exists():
                    size = self.scaler_path.stat().st_size
                    saved_files.append(f"{self.scaler_path.name} ({size} bytes)")
            
            if self.meta:
                with open(self.meta_path, 'w', encoding='utf-8') as f:
                    json.dump(self.meta, f, indent=2, ensure_ascii=False)
                if self.meta_path.exists():
                    size = self.meta_path.stat().st_size
                    saved_files.append(f"{self.meta_path.name} ({size} bytes)")
            
            logger.info(f"[ProfitModel] 저장 완료: {', '.join(saved_files)}")
        except Exception as e:
            logger.error(f"[ProfitModel] 저장 실패: {e}")
    
    def load(self):
        """모델 로드"""
        try:
            if self.model_path.exists():
                with open(self.model_path, 'rb') as f:
                    self.model = pickle.load(f)
            if self.scaler_path.exists():
                with open(self.scaler_path, 'rb') as f:
                    self.scaler = pickle.load(f)
            if self.meta_path.exists():
                with open(self.meta_path, 'r', encoding='utf-8') as f:
                    self.meta = json.load(f)
            if self.model:
                logger.info(f"[ProfitModel] 로드 완료: {self.meta.get('trained_at', 'unknown')}")
        except Exception as e:
            logger.error(f"[ProfitModel] 로드 실패: {e}")


class MLRatingSystemV2:
    """통합 ML Rating 시스템 v2"""
    
    def __init__(self, model_dir: str = "models"):
        self.zone_model = ZonePredictionModel(model_dir)
        self.profit_model = ProfitPredictionModel(model_dir)
    
    def train(self, training_data: List[Dict]) -> Dict:
        """두 모델 모두 훈련"""
        logger.info("=" * 60)
        logger.info("[ML Rating System V2 Training]")
        logger.info("=" * 60)
        logger.info(f"[ML V2] 훈련 데이터: {len(training_data)}개 샘플")
        
        # Zone 모델 훈련
        logger.info("\n[1/2] Zone 분류 모델 훈련...")
        zone_result = self.zone_model.train(training_data)
        
        # Profit 모델 훈련
        logger.info("\n[2/2] 수익률 예측 모델 훈련...")
        profit_result = self.profit_model.train(training_data)
        
        logger.info("\n" + "=" * 60)
        logger.info("[Training Complete]")
        logger.info("=" * 60)
        
        # 저장된 모델 파일 확인
        logger.info("\n[저장된 모델 파일]")
        for model_type, model in [('Zone', self.zone_model), ('Profit', self.profit_model)]:
            for path_name, path in [('model', model.model_path), ('scaler', model.scaler_path), ('meta', model.meta_path)]:
                if path.exists():
                    size = path.stat().st_size
                    logger.info(f"  ✓ {model_type} {path_name}: {path.name} ({size} bytes)")
                else:
                    logger.warning(f"  ✗ {model_type} {path_name}: 파일 없음")
        
        return {
            "ok": zone_result.get("ok") and profit_result.get("ok"),
            "zone_model": zone_result,
            "profit_model": profit_result
        }
    
    def predict(self, card: Dict, use_zone_prediction: bool = False) -> Dict:
        """
        카드 평가 예측
        
        Args:
            card: 평가할 카드
            use_zone_prediction: True면 zone도 예측, False면 카드의 zone 사용
        """
        logger.debug(f"[ML V2] 예측 시작 (use_zone_prediction={use_zone_prediction})")
        
        result = {
            "ok": True,
            "method": "ml_v2"
        }
        
        # Zone 예측 (선택적)
        if use_zone_prediction:
            zone_pred = self.zone_model.predict(card)
            if zone_pred.get("ok"):
                result["zone"] = zone_pred["zone"]
                result["zone_confidence"] = zone_pred["confidence"]
                # 예측된 zone을 카드에 임시 적용
                card_copy = card.copy()
                if "insight" not in card_copy:
                    card_copy["insight"] = {}
                card_copy["insight"]["zone_flag"] = zone_pred["zone_flag"]
                card = card_copy
            else:
                result["zone_prediction_error"] = zone_pred.get("error")
        
        # 수익률 예측
        profit_pred = self.profit_model.predict(card)
        if profit_pred.get("ok"):
            result["profit_rate"] = profit_pred["profit_rate"]
            result["score"] = profit_pred["score"]
            result["enhancement"] = profit_pred["score"]  # 기존 시스템 호환
            result["grade"] = self._score_to_grade(profit_pred["score"])
        else:
            result["ok"] = False
            result["error"] = profit_pred.get("error")
        
        return result
    
    def _score_to_grade(self, score: int) -> str:
        """점수를 등급으로 변환"""
        if score >= 90:
            return 'S'
        elif score >= 80:
            return 'A'
        elif score >= 70:
            return 'B'
        elif score >= 60:
            return 'C'
        elif score >= 50:
            return 'D'
        else:
            return 'F'
    
    def get_status(self) -> Dict:
        """모델 상태 반환"""
        return {
            "zone_model": {
                "loaded": self.zone_model.model is not None,
                "meta": self.zone_model.meta
            },
            "profit_model": {
                "loaded": self.profit_model.model is not None,
                "meta": self.profit_model.meta
            }
        }


# 전역 인스턴스 (기존 시스템 호환용)
_ml_system_v2 = None


def get_ml_system_v2() -> MLRatingSystemV2:
    """전역 ML 시스템 인스턴스 가져오기"""
    global _ml_system_v2
    if _ml_system_v2 is None:
        _ml_system_v2 = MLRatingSystemV2()
    return _ml_system_v2


if __name__ == "__main__":
    # 간단한 테스트
    system = MLRatingSystemV2()
    print(f"\n모델 상태:")
    print(json.dumps(system.get_status(), indent=2, ensure_ascii=False))
