#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
딥러닝 기반 ML Rating 시스템 v3
- LSTM 시계열 예측 (TensorFlow/Keras with GPU acceleration)
- Zone + 가격 동시 예측
- N/B Wave 시퀀스 학습
- GPU 자동 감지 및 최적화
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
logger = setup_logger('ml_v3', log_dir='logs')
logger.info("=" * 60)
logger.info("[rating_ml_v3] 딥러닝 모듈 로드됨")
logger.info("=" * 60)

# Optional TensorFlow/Keras imports with GPU support
try:
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras.models import Sequential, Model
    from tensorflow.keras.layers import LSTM, Dense, Dropout, Input, Concatenate
    from tensorflow.keras.optimizers import Adam
    from sklearn.preprocessing import MinMaxScaler
    from sklearn.model_selection import train_test_split
    
    TF_AVAILABLE = True
    
    # GPU 설정
    gpus = tf.config.list_physical_devices('GPU')
    if gpus:
        try:
            for gpu in gpus:
                tf.config.experimental.set_memory_growth(gpu, True)
            logger.info(f"[ml_v3] ✅ GPU 활성화: {len(gpus)}개 GPU 감지")
            for i, gpu in enumerate(gpus):
                logger.info(f"  GPU {i}: {gpu.name}")
            USE_GPU = True
        except RuntimeError as e:
            logger.warning(f"[ml_v3] GPU 설정 오류: {e}")
            USE_GPU = False
    else:
        logger.warning("[ml_v3] ⚠️ GPU 없음 - CPU로 실행")
        USE_GPU = False
        
except ImportError:
    TF_AVAILABLE = False
    USE_GPU = False
    logger.warning("[ml_v3] ⚠️ TensorFlow 없음 - 딥러닝 기능 비활성화")


class LSTMPredictionModel:
    """LSTM 기반 Zone + 가격 예측 모델"""
    
    def __init__(self, model_dir: str = "models"):
        self.model_dir = Path(model_dir)
        self.model_dir.mkdir(parents=True, exist_ok=True)
        
        self.model: Optional[Model] = None
        self.scaler_x: Optional[MinMaxScaler] = None
        self.scaler_y: Optional[MinMaxScaler] = None
        
        # GPU 스케일러 (TensorFlow ops 사용)
        self.scaler_x_min = None
        self.scaler_x_range = None
        self.scaler_y_min = None
        self.scaler_y_range = None
        
        self.meta: Dict = {}
        
        self.sequence_length = 30  # 30개 시점 시퀀스
        self.prediction_horizon = 10  # 10개 미래 예측
        
        self.model_path = self.model_dir / "lstm_model.h5"
        self.scaler_x_path = self.model_dir / "lstm_scaler_x.pkl"
        self.scaler_y_path = self.model_dir / "lstm_scaler_y.pkl"
        self.meta_path = self.model_dir / "lstm_meta.json"
        
        self.load()
    
    def prepare_sequences(self, data: List[Dict]) -> Tuple[np.ndarray, np.ndarray]:
        """시계열 시퀀스 준비 (GPU 가속)"""
        if len(data) < self.sequence_length + self.prediction_horizon:
            return None, None
        
        # 데이터를 NumPy 배열로 변환하여 GPU에서 처리 가능하게
        sequences_x = []
        sequences_y = []
        
        for i in range(len(data) - self.sequence_length - self.prediction_horizon + 1):
            # 입력: 과거 30개 시점의 NB Wave + 가격
            seq_x = []
            for j in range(i, i + self.sequence_length):
                card = data[j].get('card', {})
                nb = card.get('nb', {})
                
                # Feature 추출 (빠른 계산)
                p_max = float(nb.get('price', {}).get('max', 0))
                p_min = float(nb.get('price', {}).get('min', 0))
                v_max = float(nb.get('volume', {}).get('max', 0))
                v_min = float(nb.get('volume', {}).get('min', 0))
                t_max = float(nb.get('turnover', {}).get('max', 0))
                t_min = float(nb.get('turnover', {}).get('min', 0))
                
                current_price = float(card.get('current_price', 0))
                zone_flag = float(card.get('insight', {}).get('zone_flag', 0))
                
                seq_x.append([p_max, p_min, v_max, v_min, t_max, t_min, current_price, zone_flag])
            
            sequences_x.append(seq_x)
            
            # 출력: 미래 10개 시점의 zone + 가격
            seq_y = []
            for j in range(i + self.sequence_length, i + self.sequence_length + self.prediction_horizon):
                if j < len(data):
                    card = data[j].get('card', {})
                    future_price = float(card.get('current_price', 0))
                    future_zone = float(card.get('insight', {}).get('zone_flag', 0))
                    seq_y.append([future_zone, future_price])
                else:
                    break
            
            if len(seq_y) == self.prediction_horizon:
                sequences_y.append(seq_y)
            else:
                sequences_x.pop()  # 불완전한 시퀀스 제거
        
        if not sequences_x or not sequences_y:
            return None, None
        
        return np.array(sequences_x), np.array(sequences_y)
    
    def build_model(self, input_shape):
        """LSTM 모델 구축 (GPU 최적화)"""
        # GPU 있을 경우 더 큰 모델 사용
        if USE_GPU:
            model = Sequential([
                Input(shape=input_shape),
                LSTM(256, return_sequences=True, activation='relu'),
                Dropout(0.3),
                LSTM(128, return_sequences=True, activation='relu'),
                Dropout(0.3),
                LSTM(64, return_sequences=False, activation='relu'),
                Dropout(0.2),
                Dense(128, activation='relu'),
                Dropout(0.2),
                Dense(64, activation='relu'),
                Dense(self.prediction_horizon * 2)  # 10개 시점 * (zone + price)
            ])
            logger.info("[LSTM] 🚀 GPU 최적화 모델 생성 (큰 모델)")
        else:
            # CPU 버전: 작은 모델
            model = Sequential([
                Input(shape=input_shape),
                LSTM(128, return_sequences=True),
                Dropout(0.2),
                LSTM(64, return_sequences=False),
                Dropout(0.2),
                Dense(64, activation='relu'),
                Dropout(0.2),
                Dense(self.prediction_horizon * 2)
            ])
            logger.info("[LSTM] CPU 모델 생성 (소형 모델)")
        
        # GPU 경우 더 높은 학습률 사용 가능
        learning_rate = 0.001 if USE_GPU else 0.0005
        
        model.compile(
            optimizer=Adam(learning_rate=learning_rate),
            loss='mse',
            metrics=['mae'],
            run_eagerly=False  # GPU 최적화
        )
        
        return model
    
    def train(self, training_data: List[Dict]) -> Dict:
        """LSTM 모델 훈련"""
        logger.info("[LSTM] 훈련 시작")
        
        if not TF_AVAILABLE:
            logger.error("[LSTM] TensorFlow 없음")
            return {"ok": False, "error": "TensorFlow not available"}
        
        # 시퀀스 준비
        X, y = self.prepare_sequences(training_data)
        
        if X is None or y is None:
            logger.warning(f"[LSTM] 시퀀스 생성 실패: 데이터 {len(training_data)}개")
            return {"ok": False, "error": "insufficient data for sequences"}
        
        if len(X) < 10:
            logger.warning(f"[LSTM] 시퀀스 부족: {len(X)}개")
            return {"ok": False, "error": f"not enough sequences (need >=10, got {len(X)})"}
        
        logger.info(f"[LSTM] 시퀀스: {len(X)}개 (입력 shape: {X.shape}, 출력 shape: {y.shape})")
        
        # GPU 가속 스케일링 (TensorFlow ops 사용)
        n_samples, n_timesteps, n_features = X.shape
        
        if USE_GPU and TF_AVAILABLE:
            logger.info("[LSTM] 🚀 GPU 가속 스케일링 시작")
            
            # TensorFlow Tensor로 변환 (자동으로 GPU 사용)
            X_tf = tf.constant(X, dtype=tf.float32)
            y_tf = tf.constant(y, dtype=tf.float32)
            
            # GPU에서 정규화 (수동 MinMax)
            X_reshaped = tf.reshape(X_tf, [-1, n_features])
            X_min = tf.reduce_min(X_reshaped, axis=0)
            X_max = tf.reduce_max(X_reshaped, axis=0)
            X_range = X_max - X_min + 1e-8
            
            X_scaled = (X_reshaped - X_min) / X_range
            X_scaled = tf.reshape(X_scaled, [n_samples, n_timesteps, n_features])
            
            y_reshaped = tf.reshape(y_tf, [-1, 2])
            y_min = tf.reduce_min(y_reshaped, axis=0)
            y_max = tf.reduce_max(y_reshaped, axis=0)
            y_range = y_max - y_min + 1e-8
            
            y_scaled = (y_reshaped - y_min) / y_range
            y_scaled = tf.reshape(y_scaled, [n_samples, -1])
            
            # NumPy로 변환 (학습용)
            X_scaled = X_scaled.numpy()
            y_scaled = y_scaled.numpy()
            
            # 스케일러 저장 (역변환용)
            self.scaler_x_min = X_min.numpy()
            self.scaler_x_range = X_range.numpy()
            self.scaler_y_min = y_min.numpy()
            self.scaler_y_range = y_range.numpy()
            
            logger.info("[LSTM] ✓ GPU 스케일링 완료")
        else:
            logger.info("[LSTM] CPU 스케일링")
            
            # CPU: sklearn 사용
            X_reshaped = X.reshape(-1, n_features)
            self.scaler_x = MinMaxScaler()
            X_scaled = self.scaler_x.fit_transform(X_reshaped)
            X_scaled = X_scaled.reshape(n_samples, n_timesteps, n_features)
            
            y_reshaped = y.reshape(-1, 2)
            self.scaler_y = MinMaxScaler()
            y_scaled = self.scaler_y.fit_transform(y_reshaped)
            y_scaled = y_scaled.reshape(n_samples, -1)
        
        # Train/Test split
        X_train, X_test, y_train, y_test = train_test_split(
            X_scaled, y_scaled, test_size=0.2, random_state=42
        )
        
        # 모델 구축
        self.model = self.build_model((n_timesteps, n_features))
        logger.info(f"[LSTM] 모델 구조: {X_train.shape} → {y_train.shape}")
        
        # GPU 최적화 훈련 파라미터
        if USE_GPU:
            epochs = 100
            batch_size = 64  # GPU는 큰 배치 사이즈 효율적
            logger.info("[LSTM] 🚀 GPU 모드: epochs=100, batch_size=64")
        else:
            epochs = 50
            batch_size = 16
            logger.info("[LSTM] CPU 모드: epochs=50, batch_size=16")
        
        # 훈련
        history = self.model.fit(
            X_train, y_train,
            validation_data=(X_test, y_test),
            epochs=epochs,
            batch_size=batch_size,
            verbose=0
        )
        
        # 평가
        train_loss = history.history['loss'][-1]
        test_loss = history.history['val_loss'][-1]
        train_mae = history.history['mae'][-1]
        test_mae = history.history['val_mae'][-1]
        
        self.meta = {
            "trained_at": datetime.now().isoformat(),
            "train_count": len(X),
            "train_loss": float(train_loss),
            "test_loss": float(test_loss),
            "train_mae": float(train_mae),
            "test_mae": float(test_mae),
            "sequence_length": self.sequence_length,
            "prediction_horizon": self.prediction_horizon,
            "gpu_enabled": USE_GPU,
            "epochs": epochs,
            "batch_size": batch_size
        }
        
        self.save()
        
        logger.info(f"[LSTM] ✓ 훈련 완료")
        logger.info(f"[LSTM]   Train Loss: {train_loss:.4f}, MAE: {train_mae:.4f}")
        logger.info(f"[LSTM]   Test Loss: {test_loss:.4f}, MAE: {test_mae:.4f}")
        
        return {
            "ok": True,
            "train_loss": float(train_loss),
            "test_loss": float(test_loss),
            "train_mae": float(train_mae),
            "test_mae": float(test_mae),
            "train_count": len(X)
        }
    
    def predict(self, sequence_data: List[Dict]) -> Dict:
        """미래 Zone + 가격 예측"""
        if not TF_AVAILABLE or self.model is None:
            return {"ok": False, "error": "model not available"}
        
        if len(sequence_data) < self.sequence_length:
            return {"ok": False, "error": f"need {self.sequence_length} sequence points"}
        
        # 최근 30개 시퀀스 준비
        seq_x = []
        recent = sequence_data[-self.sequence_length:]
        
        for data in recent:
            card = data.get('card', {})
            nb = card.get('nb', {})
            
            p_max = float(nb.get('price', {}).get('max', 0))
            p_min = float(nb.get('price', {}).get('min', 0))
            v_max = float(nb.get('volume', {}).get('max', 0))
            v_min = float(nb.get('volume', {}).get('min', 0))
            t_max = float(nb.get('turnover', {}).get('max', 0))
            t_min = float(nb.get('turnover', {}).get('min', 0))
            
            current_price = float(card.get('current_price', 0))
            zone_flag = float(card.get('insight', {}).get('zone_flag', 0))
            
            seq_x.append([p_max, p_min, v_max, v_min, t_max, t_min, current_price, zone_flag])
        
        X = np.array([seq_x])
        
        # GPU 가속 스케일링 및 예측
        if USE_GPU and TF_AVAILABLE and hasattr(self, 'scaler_x_min'):
            logger.debug("[LSTM] 🚀 GPU 가속 예측")
            
            # TensorFlow에서 정규화
            X_tf = tf.constant(X, dtype=tf.float32)
            X_reshaped = tf.reshape(X_tf, [-1, X.shape[-1]])
            X_scaled = (X_reshaped - self.scaler_x_min) / (self.scaler_x_range + 1e-8)
            X_scaled = tf.reshape(X_scaled, [1, self.sequence_length, -1])
            
            # 예측 (GPU에서 수행)
            y_pred = self.model.predict(X_scaled, verbose=0)
            
            # GPU에서 역정규화
            y_pred_tf = tf.constant(y_pred, dtype=tf.float32)
            y_pred_reshaped = tf.reshape(y_pred_tf, [-1, 2])
            y_inversed = (y_pred_reshaped * (self.scaler_y_range + 1e-8)) + self.scaler_y_min
            y_inversed = y_inversed.numpy()
            
        else:
            # CPU 예측
            X_reshaped = X.reshape(-1, X.shape[-1])
            if hasattr(self, 'scaler_x'):
                X_scaled = self.scaler_x.transform(X_reshaped)
            else:
                X_scaled = X_reshaped  # 스케일러 없으면 원본 사용
            X_scaled = X_scaled.reshape(1, self.sequence_length, -1)
            
            # 예측
            y_pred = self.model.predict(X_scaled, verbose=0)
            
            # 역스케일링
            y_pred_reshaped = y_pred.reshape(-1, 2)
            if hasattr(self, 'scaler_y'):
                y_inversed = self.scaler_y.inverse_transform(y_pred_reshaped)
            else:
                y_inversed = y_pred_reshaped
        
        # 결과 파싱
        predictions = []
        for i in range(self.prediction_horizon):
            zone_flag = int(np.clip(y_inversed[i][0], -1, 1))
            price = float(y_inversed[i][1])
            
            # NB value 계산 (zone에 따라)
            if zone_flag > 0:
                nb_value = 0.6  # BLUE
            elif zone_flag < 0:
                nb_value = 0.4  # ORANGE
            else:
                nb_value = 0.5  # NEUTRAL
            
            predictions.append({
                "index": i,
                "zone_flag": zone_flag,
                "zone": "BLUE" if zone_flag > 0 else "ORANGE" if zone_flag < 0 else "NEUTRAL",
                "predicted_price": price,
                "nb_value": nb_value,
                "confidence": 0.7  # LSTM 기본 신뢰도
            })
        
        return {
            "ok": True,
            "predictions": predictions,
            "count": len(predictions)
        }
    
    def save(self):
        """모델 저장"""
        try:
            saved_files = []
            
            if self.model and TF_AVAILABLE:
                self.model.save(str(self.model_path))
                if self.model_path.exists():
                    size = self.model_path.stat().st_size
                    saved_files.append(f"{self.model_path.name} ({size} bytes)")
            
            if self.scaler_x:
                with open(self.scaler_x_path, 'wb') as f:
                    pickle.dump(self.scaler_x, f)
                if self.scaler_x_path.exists():
                    size = self.scaler_x_path.stat().st_size
                    saved_files.append(f"{self.scaler_x_path.name} ({size} bytes)")
            
            if self.scaler_y:
                with open(self.scaler_y_path, 'wb') as f:
                    pickle.dump(self.scaler_y, f)
                if self.scaler_y_path.exists():
                    size = self.scaler_y_path.stat().st_size
                    saved_files.append(f"{self.scaler_y_path.name} ({size} bytes)")
            
            if self.meta:
                with open(self.meta_path, 'w', encoding='utf-8') as f:
                    json.dump(self.meta, f, indent=2, ensure_ascii=False)
                if self.meta_path.exists():
                    size = self.meta_path.stat().st_size
                    saved_files.append(f"{self.meta_path.name} ({size} bytes)")
            
            logger.info(f"[LSTM] 저장 완료: {', '.join(saved_files)}")
        except Exception as e:
            logger.error(f"[LSTM] 저장 실패: {e}")
    
    def load(self):
        """모델 로드"""
        try:
            if self.model_path.exists() and TF_AVAILABLE:
                self.model = keras.models.load_model(str(self.model_path))
            
            if self.scaler_x_path.exists():
                with open(self.scaler_x_path, 'rb') as f:
                    self.scaler_x = pickle.load(f)
            
            if self.scaler_y_path.exists():
                with open(self.scaler_y_path, 'rb') as f:
                    self.scaler_y = pickle.load(f)
            
            if self.meta_path.exists():
                with open(self.meta_path, 'r', encoding='utf-8') as f:
                    self.meta = json.load(f)
            
            if self.model:
                logger.info(f"[LSTM] 로드 완료: {self.meta.get('trained_at', 'unknown')}")
        except Exception as e:
            logger.error(f"[LSTM] 로드 실패: {e}")


# 전역 인스턴스
_lstm_model = None


def get_lstm_model() -> LSTMPredictionModel:
    """전역 LSTM 모델 인스턴스 가져오기"""
    global _lstm_model
    if _lstm_model is None:
        _lstm_model = LSTMPredictionModel()
    return _lstm_model


if __name__ == "__main__":
    # 간단한 테스트
    model = LSTMPredictionModel()
    print(f"\n모델 상태:")
    print(f"  Loaded: {model.model is not None}")
    print(f"  Meta: {json.dumps(model.meta, indent=2, ensure_ascii=False)}")
