"""
Training Data Generator for Card Rating ML
- BUY 카드와 SELL 거래를 매칭하여 학습 데이터 생성
- Zone flag 정보 포함하여 더 정확한 예측 가능
"""
import json
from pathlib import Path
from datetime import datetime

def load_buy_cards():
    """Buy cards에서 zone 정보 추출"""
    buy_cards_dir = Path('data/buy_cards')
    buy_cards_data = {}
    
    if not buy_cards_dir.exists():
        print(f"⚠️ {buy_cards_dir} 디렉토리가 없습니다.")
        return buy_cards_data
    
    print("✓ buy_cards에서 zone 정보 추출 중...")
    card_count = 0
    
    for json_file in sorted(buy_cards_dir.glob('*.json'), reverse=True):
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                cards = json.load(f)
                if isinstance(cards, list):
                    for card in cards:
                        if isinstance(card, dict):
                            market = card.get('market', '')
                            insight = card.get('insight', {})
                            zone_flag = insight.get('zone_flag')
                            if market and zone_flag is not None:
                                if market not in buy_cards_data:
                                    buy_cards_data[market] = []
                                buy_cards_data[market].append(card)
                                card_count += 1
        except Exception as e:
            print(f"⚠️ {json_file.name} 파일 읽기 오류: {e}")
            continue
    
    print(f'✓ {len(buy_cards_data)} 마켓, 총 {card_count} 카드 로드')
    return buy_cards_data

def load_sell_trades():
    """trainer_storage.json에서 SELL 거래 추출"""
    storage_path = Path('data/trainer_storage.json')
    
    if not storage_path.exists():
        print(f"⚠️ {storage_path} 파일이 없습니다.")
        return []
    
    print("\n✓ trainer_storage.json에서 SELL 거래 추출 중...")
    sell_trades = []
    
    try:
        with open(storage_path, 'r', encoding='utf-8') as f:
            storage = json.load(f)
        
        for trainer_name, trainer_data in storage.items():
            trades = trainer_data.get('trades', [])
            for trade in trades:
                if trade.get('action') == 'REAL_TRADE':
                    match = trade.get('trade_match', {})
                    if match.get('system_action') == 'SELL':
                        profit_pct = match.get('profit_percent')
                        if profit_pct is not None:
                            sell_trades.append({
                                'ts': trade.get('ts'),
                                'profit_rate': profit_pct,  # 이미 분수 형식 (-1..1)
                                'trainer': trainer_name,
                                'upbit_time': match.get('upbit_time')
                            })
    except Exception as e:
        print(f"⚠️ trainer_storage.json 읽기 오류: {e}")
        return []
    
    print(f'✓ {len(sell_trades)} SELL 거래 추출')
    return sell_trades

def match_buy_sell(buy_cards_data, sell_trades):
    """BUY 카드와 SELL 거래 매칭"""
    print("\n✓ BUY 카드와 SELL 거래 매칭 중...")
    training_data = []
    matched_count = 0
    skipped_count = 0
    
    for sell in sell_trades:
        sell_ts = sell['ts']
        trainer = sell['trainer']
        
        # 거래 trainer의 BTC 시장 데이터 찾기
        if 'KRW-BTC' not in buy_cards_data:
            skipped_count += 1
            continue
        
        # sell_ts보다 전에 발생한 BUY 카드 중 가장 가까운 것
        candidates = [c for c in buy_cards_data['KRW-BTC'] if c.get('ts', 0) < sell_ts]
        if not candidates:
            skipped_count += 1
            continue
        
        buy_card = max(candidates, key=lambda c: c.get('ts', 0))
        
        # card 페이로드 생성 (zone_flag 포함)
        insight = buy_card.get('insight', {})
        nb = buy_card.get('nb', {})
        
        # 데이터 검증
        if not nb or not insight:
            skipped_count += 1
            continue
        
        card_payload = {
            'nb': nb,
            'current_price': buy_card.get('price'),
            'interval': buy_card.get('nbverse_interval') or buy_card.get('interval'),
            'insight': insight  # zone_flag 포함
        }
        
        training_data.append({
            'card': card_payload,
            'profit_rate': sell['profit_rate'],
            'buy_ts': buy_card.get('ts'),
            'sell_ts': sell_ts,
            'trainer': trainer
        })
        matched_count += 1
    
    print(f'✓ 매칭 완료: {matched_count}개 샘플 (스킵: {skipped_count}개)')
    return training_data

def save_training_data(training_data):
    """training_data.json 저장"""
    print("\n✓ training_data.json 저장 중...")
    
    output_file = Path('training_data.json')
    
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump({'training_data': training_data}, f, ensure_ascii=False, indent=2)
        
        print(f'✅ 완료! {output_file} 저장됨')
        return True
    except Exception as e:
        print(f'❌ 저장 실패: {e}')
        return False

def print_summary(training_data):
    """학습 데이터 요약 출력"""
    print(f'\n📊 학습 데이터 요약:')
    print(f'   - 샘플 수: {len(training_data)}')
    
    if training_data:
        # 수익률 통계
        profit_rates = [item['profit_rate'] for item in training_data]
        avg_profit = sum(profit_rates) / len(profit_rates)
        max_profit = max(profit_rates)
        min_profit = min(profit_rates)
        
        print(f'   - 평균 수익률: {avg_profit:.4f} ({avg_profit*100:.2f}%)')
        print(f'   - 최대 수익률: {max_profit:.4f} ({max_profit*100:.2f}%)')
        print(f'   - 최소 수익률: {min_profit:.4f} ({min_profit*100:.2f}%)')
        
        # Zone flag 분포
        zone_flags = [item['card']['insight'].get('zone_flag') for item in training_data]
        blue_count = sum(1 for zf in zone_flags if zf == 1)
        orange_count = sum(1 for zf in zone_flags if zf == -1)
        neutral_count = sum(1 for zf in zone_flags if zf == 0)
        
        print(f'   - Zone 분포: BLUE={blue_count}, ORANGE={orange_count}, NEUTRAL={neutral_count}')
        
        # 예시
        sample = training_data[0]
        print(f'\n   📝 예시 1:')
        print(f'      - 수익률: {sample["profit_rate"]:.4f} ({sample["profit_rate"]*100:.2f}%)')
        print(f'      - Zone flag: {sample["card"]["insight"].get("zone_flag")}')
        print(f'      - Trainer: {sample.get("trainer", "N/A")}')
        
        if len(training_data) > 1:
            sample2 = training_data[-1]
            print(f'\n   📝 예시 2:')
            print(f'      - 수익률: {sample2["profit_rate"]:.4f} ({sample2["profit_rate"]*100:.2f}%)')
            print(f'      - Zone flag: {sample2["card"]["insight"].get("zone_flag")}')
            print(f'      - Trainer: {sample2.get("trainer", "N/A")}')

def main():
    """메인 실행 함수"""
    print("=" * 60)
    print("Training Data Generator for Card Rating ML")
    print("=" * 60)
    print()
    
    # 1. Buy cards 로드
    buy_cards_data = load_buy_cards()
    if not buy_cards_data:
        print("❌ Buy cards 데이터가 없습니다.")
        return
    
    # 2. Sell trades 로드
    sell_trades = load_sell_trades()
    if not sell_trades:
        print("❌ Sell trades 데이터가 없습니다.")
        return
    
    # 3. 매칭
    training_data = match_buy_sell(buy_cards_data, sell_trades)
    if not training_data:
        print("❌ 매칭된 데이터가 없습니다.")
        return
    
    # 4. 저장
    if save_training_data(training_data):
        # 5. 요약 출력
        print_summary(training_data)
    else:
        print("❌ Training data 저장 실패")

if __name__ == '__main__':
    main()

print(f'\n다음 단계: curl로 /api/ml/rating/train 호출하기')
print(f'명령어:')
print(f'  curl -X POST http://localhost:5057/api/ml/rating/train \\')
print(f'    -H "Content-Type: application/json" \\')
print(f'    -d @training_data.json')
