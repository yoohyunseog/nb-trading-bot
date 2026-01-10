#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ML 모델 V2 검증 스크립트
- 훈련된 모델의 실전 성능 검증
- trainer_storage.json의 최근 데이터로 테스트
"""

import json
from pathlib import Path
from typing import List, Dict
from rating_ml_v2 import MLRatingSystemV2


def load_validation_data(limit: int = 100) -> List[Dict]:
    """검증용 데이터 로드 (최근 거래)"""
    ts_path = Path("data/trainer_storage.json")
    
    if not ts_path.exists():
        print("[ERROR] trainer_storage.json not found!")
        return []
    
    with open(ts_path, encoding='utf-8') as f:
        ts_data = json.load(f)
    
    validation_data = []
    
    for trainer_name, trainer_info in ts_data.items():
        if not isinstance(trainer_info, dict) or 'trades' not in trainer_info:
            continue
        
        trades = trainer_info['trades']
        
        # 최근 거래부터 역순으로
        for trade in reversed(trades[-limit:]):
            tm = trade.get('trade_match', {})
            if tm.get('system_action') != 'SELL':
                continue
            
            profit_pct = tm.get('profit_percent', 0)
            buy_card = trade.get('buy_card', {})
            
            if not buy_card or 'nb' not in buy_card:
                continue
            
            validation_data.append({
                'card': buy_card,
                'actual_profit': profit_pct / 100.0 if abs(profit_pct) > 5 else profit_pct,
                'actual_zone': buy_card.get('insight', {}).get('zone_flag', 0)
            })
    
    return validation_data


def validate_models(system: MLRatingSystemV2, validation_data: List[Dict]) -> Dict:
    """모델 검증"""
    
    if not validation_data:
        return {"ok": False, "error": "no validation data"}
    
    zone_correct = 0
    zone_total = 0
    profit_errors = []
    
    for item in validation_data:
        card = item['card']
        actual_profit = item['actual_profit']
        actual_zone = item['actual_zone']
        
        # Zone 예측 검증
        zone_pred = system.zone_model.predict(card)
        if zone_pred.get("ok") and actual_zone != 0:
            pred_zone = zone_pred['zone_flag']
            if pred_zone == actual_zone:
                zone_correct += 1
            zone_total += 1
        
        # 수익률 예측 검증
        profit_pred = system.profit_model.predict(card)
        if profit_pred.get("ok"):
            pred_profit = profit_pred['profit_rate']
            error = abs(pred_profit - actual_profit)
            profit_errors.append(error)
    
    # 메트릭 계산
    zone_accuracy = zone_correct / zone_total if zone_total > 0 else 0
    profit_mae = sum(profit_errors) / len(profit_errors) if profit_errors else 0
    
    return {
        "ok": True,
        "zone_accuracy": zone_accuracy,
        "zone_correct": zone_correct,
        "zone_total": zone_total,
        "profit_mae": profit_mae,
        "validation_count": len(validation_data)
    }


def main():
    print("=" * 60)
    print("[ML Model V2 Validation]")
    print("=" * 60)
    print()
    
    # 1. 모델 로드
    print("[*] Loading models...")
    system = MLRatingSystemV2()
    
    status = system.get_status()
    if not status['zone_model']['loaded'] or not status['profit_model']['loaded']:
        print("[ERROR] Models not loaded!")
        print("Run train_ml_model_v2.py first")
        return
    
    print("[✓] Models loaded successfully")
    print()
    
    # 2. 검증 데이터 로드
    print("[*] Loading validation data...")
    validation_data = load_validation_data(limit=100)
    
    if not validation_data:
        print("[ERROR] No validation data available")
        return
    
    print(f"[✓] Loaded {len(validation_data)} validation samples")
    print()
    
    # 3. 검증 실행
    print("[*] Validating models...")
    result = validate_models(system, validation_data)
    
    if not result.get('ok'):
        print(f"[ERROR] Validation failed: {result.get('error')}")
        return
    
    # 4. 결과 출력
    print()
    print("=" * 60)
    print("[Validation Results]")
    print("=" * 60)
    
    print(f"\n[Zone Classification]")
    print(f"  Accuracy:      {result['zone_accuracy']:.2%}")
    print(f"  Correct:       {result['zone_correct']}/{result['zone_total']}")
    
    print(f"\n[Profit Prediction]")
    print(f"  MAE:           {result['profit_mae']:.4f}")
    
    print(f"\n[Overall]")
    print(f"  Samples:       {result['validation_count']}")
    
    # 5. 샘플 예측 테스트
    print("\n" + "=" * 60)
    print("[Sample Predictions]")
    print("=" * 60)
    
    for i, item in enumerate(validation_data[:5]):
        card = item['card']
        actual_profit = item['actual_profit']
        actual_zone = item['actual_zone']
        
        pred = system.predict(card, use_zone_prediction=True)
        
        print(f"\nSample {i+1}:")
        print(f"  Actual Zone:    {'BLUE' if actual_zone > 0 else 'ORANGE' if actual_zone < 0 else 'UNKNOWN'}")
        print(f"  Predicted Zone: {pred.get('zone', 'N/A')} ({pred.get('zone_confidence', 0):.2%})")
        print(f"  Actual Profit:  {actual_profit:+.4f}")
        print(f"  Predicted:      {pred.get('profit_rate', 0):+.4f}")
        print(f"  Score:          {pred.get('score', 0)} ({pred.get('grade', 'N/A')})")
    
    print("\n" + "=" * 60)
    print("[✓] Validation Complete")
    print("=" * 60)
    print()


if __name__ == '__main__':
    main()
