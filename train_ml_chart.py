#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
실시간 차트 데이터로 ML 모델 훈련
- OHLCV 캔들 데이터 사용
- N/B Wave 계산
- 자동 재훈련
"""

import json
import requests
from pathlib import Path
from typing import List, Dict
import numpy as np


def fetch_chart_data(interval: str = '10m', limit: int = 200) -> Dict:
    """서버에서 차트 데이터 가져오기"""
    try:
        url = f'http://localhost:5057/api/ohlcv?market=KRW-BTC&interval={interval}&count={limit}'
        response = requests.get(url, timeout=10)
        if response.ok:
            return response.json()
        return None
    except Exception as e:
        print(f"[ERROR] 차트 데이터 가져오기 실패: {e}")
        return None


def calculate_nb_wave(candles: List[Dict], window: int = 120) -> List[Dict]:
    """캔들 데이터로 N/B Wave 계산"""
    if not candles or len(candles) < window:
        return []
    
    nb_data = []
    
    for i in range(window, len(candles)):
        window_data = candles[i-window:i]
        
        # Price N/B
        prices = [c['close'] for c in window_data]
        p_max = max(prices)
        p_min = min(prices)
        
        # Volume N/B
        volumes = [c['volume'] for c in window_data]
        v_max = max(volumes)
        v_min = min(volumes)
        
        # Turnover N/B
        turnovers = [c['close'] * c['volume'] for c in window_data]
        t_max = max(turnovers)
        t_min = min(turnovers)
        
        # r-value 계산
        def calc_r(mx, mn):
            if mx <= 0 or mn <= 0:
                return 0.0
            return (mx - mn) / (mx + mn) if (mx + mn) > 0 else 0.0
        
        r_price = calc_r(p_max, p_min)
        r_vol = calc_r(v_max, v_min)
        r_amt = calc_r(t_max, t_min)
        avg_r = (r_price + r_vol + r_amt) / 3.0
        
        # Zone 판정 (임계값 0.45/0.55)
        if avg_r > 0.55:
            zone_flag = 1  # BLUE
        elif avg_r < 0.45:
            zone_flag = -1  # ORANGE
        else:
            zone_flag = 0  # NEUTRAL
        
        # 미래 가격 변화 (다음 10개 캔들의 평균 수익률)
        future_start = i + 1
        future_end = min(i + 11, len(candles))
        if future_end > future_start:
            current_price = candles[i]['close']
            future_prices = [candles[j]['close'] for j in range(future_start, future_end)]
            avg_future_price = sum(future_prices) / len(future_prices)
            profit_rate = (avg_future_price - current_price) / current_price if current_price > 0 else 0
        else:
            continue  # 미래 데이터 없으면 스킵
        
        nb_data.append({
            'card': {
                'nb': {
                    'price': {'max': p_max, 'min': p_min},
                    'volume': {'max': v_max, 'min': v_min},
                    'turnover': {'max': t_max, 'min': t_min}
                },
                'current_price': candles[i]['close'],
                'interval': candles[i].get('interval', '10m'),
                'insight': {'zone_flag': zone_flag}
            },
            'profit_rate': profit_rate,
            'timestamp': candles[i].get('timestamp', '')
        })
    
    return nb_data


def collect_training_data_from_chart(intervals: List[str] = ['10m', '30m', '1h']) -> List[Dict]:
    """여러 타임프레임의 차트 데이터로 학습 샘플 생성"""
    all_samples = []
    
    for interval in intervals:
        print(f"[+] {interval} 차트 데이터 수집 중...")
        chart_data = fetch_chart_data(interval, limit=300)
        
        if not chart_data or not chart_data.get('candles'):
            print(f"[!] {interval} 데이터 없음")
            continue
        
        candles = chart_data['candles']
        print(f"[+] {interval}: {len(candles)}개 캔들 로드됨")
        
        # N/B Wave 계산 및 학습 샘플 생성
        samples = calculate_nb_wave(candles, window=120)
        print(f"[+] {interval}: {len(samples)}개 샘플 생성")
        
        all_samples.extend(samples)
    
    return all_samples


def train_with_chart_data():
    """차트 데이터로 모델 훈련"""
    print("=" * 60)
    print("[ML V2 Training with Chart Data]")
    print("=" * 60)
    print()
    
    # 1. 차트 데이터 수집
    print("[1/2] 차트 데이터 수집...")
    training_data = collect_training_data_from_chart(['10m', '30m', '1h'])
    
    if not training_data:
        print("[ERROR] 학습 데이터 없음")
        return
    
    print(f"[+] 총 {len(training_data)}개 샘플 수집 완료")
    print()
    
    # 2. API 호출하여 훈련
    print("[2/2] 모델 훈련 중...")
    try:
        response = requests.post(
            'http://localhost:5057/api/ml/rating/v2/train',
            json={'training_data': training_data},
            timeout=120
        )
        
        if response.ok:
            result = response.json()
            
            print()
            print("=" * 60)
            print("[Training Results]")
            print("=" * 60)
            
            if result.get('ok'):
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
            else:
                print(f"\n[ERROR] 훈련 실패: {result.get('error')}")
        else:
            print(f"[ERROR] API 호출 실패: {response.status_code}")
    
    except Exception as e:
        print(f"[ERROR] 훈련 중 오류: {e}")


if __name__ == '__main__':
    train_with_chart_data()
