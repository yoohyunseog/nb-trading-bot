#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ML 모델 V2 훈련 스크립트
- Zone 분류 모델 + 수익률 예측 모델
- trainer_storage.json의 거래 데이터 사용
"""

import json
from pathlib import Path
from rating_ml_v2 import MLRatingSystemV2


def collect_training_data():
    """trainer_storage.json에서 훈련 데이터 수집"""
    ts_path = Path("data/trainer_storage.json")
    training_data = []
    
    if not ts_path.exists():
        print("[ERROR] trainer_storage.json not found!")
        return training_data
    
    with open(ts_path, encoding='utf-8') as f:
        ts_data = json.load(f)
    
    print(f"[+] Loaded trainer_storage.json")
    
    # 각 trainer별 거래 데이터 수집
    for trainer_name, trainer_info in ts_data.items():
        if not isinstance(trainer_info, dict) or 'trades' not in trainer_info:
            continue
        
        trades = trainer_info['trades']
        
        for trade in trades:
            tm = trade.get('trade_match', {})
            if tm.get('system_action') != 'SELL':
                continue
            
            profit_pct = tm.get('profit_percent', 0)
            
            # Buy 시점의 카드 정보 추출 (가능하면)
            buy_card = trade.get('buy_card', {})
            
            # 실제 NB 데이터가 있으면 사용, 없으면 더미
            if not buy_card or 'nb' not in buy_card:
                # 더미 카드 (최소한의 정보)
                card = {
                    'nb': {
                        'price': {'max': 1, 'min': 0.5},
                        'volume': {'max': 100, 'min': 50},
                        'turnover': {'max': 1000, 'min': 500}
                    },
                    'current_price': tm.get('upbit_price', 0),
                    'interval': trade.get('interval', 'minute30'),
                    'insight': {
                        'zone_flag': 1 if profit_pct > 0 else -1
                    }
                }
            else:
                card = buy_card
                # Zone flag 보정 (profit에 따라)
                if 'insight' not in card:
                    card['insight'] = {}
                if 'zone_flag' not in card['insight']:
                    card['insight']['zone_flag'] = 1 if profit_pct > 0 else -1
            
            training_data.append({
                'card': card,
                'profit_rate': profit_pct / 100.0 if abs(profit_pct) > 5 else profit_pct
            })
    
    print(f"[+] Collected {len(training_data)} training samples")
    return training_data


def main():
    print("=" * 60)
    print("[ML Rating Model V2 Training]")
    print("=" * 60)
    print()
    
    # 1. 훈련 데이터 수집
    print("[*] Collecting training data...")
    training_data = collect_training_data()
    
    if not training_data:
        print("[ERROR] Failed to collect training data")
        return
    
    print()
    
    # 2. 모델 훈련
    print(f"[*] Training models with {len(training_data)} samples...")
    print()
    
    system = MLRatingSystemV2()
    result = system.train(training_data)
    
    if not result.get('ok'):
        print("\n[ERROR] Training failed")
        print(f"Zone Model:   {result.get('zone_model', {}).get('error', 'unknown error')}")
        print(f"Profit Model: {result.get('profit_model', {}).get('error', 'unknown error')}")
        return
    
    # 3. 결과 출력
    print("\n" + "=" * 60)
    print("[Training Results]")
    print("=" * 60)
    
    zone_res = result.get('zone_model', {})
    profit_res = result.get('profit_model', {})
    
    print("\n[Zone Classification Model]")
    print(f"  Train Samples:  {zone_res.get('train_count', 0)}")
    print(f"  Train Accuracy: {zone_res.get('train_acc', 0):.4f}")
    print(f"  Test Accuracy:  {zone_res.get('test_acc', 0):.4f}")
    print(f"  F1 Score:       {zone_res.get('f1_score', 0):.4f}")
    
    print("\n[Profit Prediction Model]")
    print(f"  Train Samples: {profit_res.get('train_count', 0)}")
    print(f"  Train MAE:     {profit_res.get('train_mae', 0):.4f}")
    print(f"  Test MAE:      {profit_res.get('test_mae', 0):.4f}")
    print(f"  Train R²:      {profit_res.get('train_r2', 0):.4f}")
    print(f"  Test R²:       {profit_res.get('test_r2', 0):.4f}")
    
    print("\n" + "=" * 60)
    print("[✓] Training Complete")
    print("=" * 60)
    print()


if __name__ == '__main__':
    main()
