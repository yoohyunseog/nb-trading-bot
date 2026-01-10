#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ML 모델 재훈련 스크립트
trainer_storage.json의 거래 데이터를 사용하여 모델 훈련
"""

import json
import requests
from pathlib import Path

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
        if isinstance(trainer_info, dict) and 'trades' in trainer_info:
            trades = trainer_info['trades']
            
            for trade in trades:
                tm = trade.get('trade_match', {})
                if tm.get('system_action') == 'SELL':
                    profit_pct = tm.get('profit_percent', 0)
                    
                    # 더미 card 생성 (실제 NB 데이터는 없음, profit_rate만 사용)
                    dummy_card = {
                        'nb': {
                            'price': {'max': 1, 'min': 0.5},
                            'volume': {'max': 100, 'min': 50},
                            'turnover': {'max': 1000, 'min': 500}
                        },
                        'current_price': tm.get('upbit_price', 0),
                        'interval': 'minute30',
                        'insight': {'zone_flag': -1 if profit_pct < 0 else 1}
                    }
                    
                    training_data.append({
                        'card': dummy_card,
                        'profit_rate': profit_pct
                    })
    
    print(f"[+] Collected {len(training_data)} training samples")
    return training_data

def train_model(training_data):
    """API를 통해 모델 훈련"""
    if not training_data:
        print("[ERROR] No training data!")
        return None
    
    url = 'http://localhost:5057/api/ml/rating/train'
    payload = {'samples': training_data}
    
    print(f"[+] Sending training request to {url}")
    
    try:
        response = requests.post(url, json=payload, timeout=60)
        result = response.json()
        return result
    except Exception as e:
        print(f"[ERROR] API call failed: {e}")
        return None

def main():
    print("=" * 60)
    print("[ML Rating Model Training]")
    print("=" * 60)
    print()
    
    # 1. 훈련 데이터 수집
    training_data = collect_training_data()
    
    if not training_data:
        print("[ERROR] Failed to collect training data")
        return
    
    print()
    
    # 2. 모델 훈련
    print(f"[*] Training model with {len(training_data)} samples...")
    result = train_model(training_data)
    
    if not result:
        print("[ERROR] Training failed")
        return
    
    print()
    print("=" * 60)
    print("[Training Result]")
    print("=" * 60)
    
    if result.get('ok'):
        print(f"Status:      OK")
        print(f"Train count: {result.get('train_count')}")
        print(f"MAE:         {result.get('mae'):.4f}" if result.get('mae') else "MAE:         N/A")
        print(f"Trained at:  {result.get('trained_at')}")
    else:
        print(f"Status: FAILED")
        print(f"Error:  {result.get('error')}")
    
    print()

if __name__ == '__main__':
    main()
