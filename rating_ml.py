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
        try:
            mx = float(mx)
            mn = float(mn)
            if mx == 0:
                return 0.0
            return max(0.0, min(1.0, (mx - mn) / mx))
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

            feats = [
                p_max, p_min, v_max, v_min, t_max, t_min,
                r_price, r_vol, r_amt, avg_r,
                current_price, interval_hash
            ]
            return np.array(feats, dtype=float).reshape(1, -1)
        except Exception:
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
                "r_price", "r_vol", "r_amt", "avg_r", "current_price", "interval_hash"
            ]
        }
        self.save()
        return {"ok": True, "train_count": len(X_rows), "mae": mae, "trained_at": self.meta["trained_at"]}

    def predict(self, card: Dict) -> Dict:
        feats = self.extract_features(card)
        if feats is None:
            return {"ok": False, "error": "invalid card"}

        if not SKLEARN_AVAILABLE or self.model is None or self.scaler is None:
            return self._rule_based(card)

        try:
            Xs = self.scaler.transform(feats)
            enh = int(self.model.predict(Xs)[0])
            enh = max(1, min(99, enh))
            grade = self._enh_to_grade(enh)
            return {"ok": True, "enhancement": enh, "grade": grade, "method": "ml"}
        except Exception as e:
            return self._rule_based(card, error=str(e))

    def _rule_based(self, card: Dict, error: Optional[str] = None) -> Dict:
        nb = card.get("nb", {}) if isinstance(card, dict) else {}
        price = nb.get("price", {})
        volume = nb.get("volume", {})
        turnover = nb.get("turnover", {})

        r_price = self._calc_r(price.get("max", 0), price.get("min", 0))
        r_vol = self._calc_r(volume.get("max", 0), volume.get("min", 0))
        r_amt = self._calc_r(turnover.get("max", 0), turnover.get("min", 0))
        avg_r = (r_price + r_vol + r_amt) / 3.0
        enh = max(1, min(99, int(avg_r * 98) + 1))
        grade = self._enh_to_grade(enh)
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
                with open(self.model_path, 'rb') as f:
                    self.model = pickle.load(f)
                with open(self.scaler_path, 'rb') as f:
                    self.scaler = pickle.load(f)
            if self.meta_path.exists():
                with open(self.meta_path, 'r', encoding='utf-8') as f:
                    self.meta = json.load(f)
        except Exception:
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
