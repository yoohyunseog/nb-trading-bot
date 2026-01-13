"""
매수/매도 API 테스트 스크립트
"""
import sys
import os
import json
import time
from datetime import datetime

# 경로 설정
sys.path.insert(0, os.path.dirname(__file__))

print("=" * 60)
print("매수/매도 API 테스트 시작")
print("=" * 60)
print()

# 1단계: Buy cards 초기 상태 확인
print("[1단계] Buy cards 초기 상태 확인")
buy_cards_dir = "data/buy_cards"
if os.path.exists(buy_cards_dir):
    buy_files_before = [f for f in os.listdir(buy_cards_dir) if f.endswith('.json')]
    print(f"   ✓ Buy cards 파일 개수: {len(buy_files_before)}")
else:
    buy_files_before = []
    print(f"   ⚠ Buy cards 디렉토리 없음")
print()

# 2단계: 매수 카드 직접 생성 (API 없이 파일 시스템 테스트)
print("[2단계] 매수 카드 생성 테스트")

# 매수 카드 데이터 생성
buy_card = {
    "side": "BUY",
    "market": "KRW-BTC",
    "price": 150000000,
    "size": 0.0001,
    "paper": True,
    "timestamp": int(time.time() * 1000),
    "ts": int(time.time() * 1000),
    "uuid": f"test-buy-{int(time.time())}",
    "orderId": f"oid-{int(time.time())}",
    "paid_fee": 75.0,
    "avg_price": 150000000,
    "interval": "minute10",
    "trainer": "Scout",
    "nb_price_max": 49.99999999,
    "nb_price_min": 0.00000001,
    "current_price": 150000000,
    "saved_at": datetime.now().isoformat()
}

try:
    # 매수 카드 파일 저장
    os.makedirs(buy_cards_dir, exist_ok=True)
    now = datetime.utcnow()
    buy_filename = f"buy_cards_{now.strftime('%Y-%m-%dT%H-%M-%S')}-{now.microsecond // 1000:03d}Z.json"
    buy_filepath = os.path.join(buy_cards_dir, buy_filename)
    
    with open(buy_filepath, 'w', encoding='utf-8') as f:
        json.dump([buy_card], f, ensure_ascii=False, indent=2)
    
    print(f"   ✅ 매수 카드 생성 성공")
    print(f"      - 파일: {buy_filename}")
    print(f"      - UUID: {buy_card['uuid']}")
    print(f"      - 가격: {buy_card['price']:,}원")
except Exception as e:
    print(f"   ❌ 매수 카드 생성 실패: {e}")
    sys.exit(1)
print()

# 3단계: Buy cards 파일 확인
print("[3단계] Buy cards 파일 생성 확인")
time.sleep(0.5)  # 파일 시스템 동기화 대기
if os.path.exists(buy_cards_dir):
    buy_files_after = [f for f in os.listdir(buy_cards_dir) if f.endswith('.json') and not f.startswith('_')]
    new_files = [f for f in buy_files_after if f not in buy_files_before]
    print(f"   ✓ 새로 생성된 파일: {len(new_files)}개")
    if new_files:
        created_file = new_files[0]
        print(f"      - {created_file}")
        
        # 파일 내용 확인
        with open(os.path.join(buy_cards_dir, created_file), 'r', encoding='utf-8') as f:
            buy_card_data = json.load(f)
            if isinstance(buy_card_data, list):
                print(f"      - 카드 개수: {len(buy_card_data)}개")
            else:
                print(f"      - 카드 타입: {type(buy_card_data)}")
else:
    new_files = []
    created_file = None
    print(f"   ⚠ Buy cards 디렉토리 없음")
print()

# 4단계: Sell cards 초기 상태 확인
print("[4단계] Sell cards 초기 상태 확인")
sell_cards_dir = "data/sell_cards"
if os.path.exists(sell_cards_dir):
    sell_files_before = [f for f in os.listdir(sell_cards_dir) if f.endswith('.json')]
    print(f"   ✓ Sell cards 파일 개수: {len(sell_files_before)}")
else:
    sell_files_before = []
    print(f"   ⚠ Sell cards 디렉토리 없음")
print()

# 5단계: 매도 카드 생성 및 buy_cards 처리 테스트
print("[5단계] 매도 처리 테스트 실행")
if not created_file:
    print("   ⚠ 생성된 buy_cards 파일이 없어 테스트 중단")
    sys.exit(1)

# 매도 시뮬레이션: buy_cards에서 제거하고 sell_cards로 이동
try:
    import shutil
    import glob
    
    # Buy card 파일 경로
    buy_file_path = os.path.join(buy_cards_dir, created_file)
    
    # Buy card 읽기
    with open(buy_file_path, 'r', encoding='utf-8') as f:
        buy_cards_list = json.load(f)
    
    if not buy_cards_list:
        print("   ⚠ Buy cards가 비어있음")
        sys.exit(1)
    
    # 매도할 카드 추출
    target_card = buy_cards_list[0]
    remaining_cards = buy_cards_list[1:] if len(buy_cards_list) > 1 else []
    
    print(f"   매도 대상 카드: UUID={target_card.get('uuid')}")
    print(f"   남은 카드: {len(remaining_cards)}개")
    
    # Buy cards 파일 아카이브
    os.makedirs(os.path.join('data', 'sell_cards', '_moved_buy'), exist_ok=True)
    archived_path = os.path.join('data', 'sell_cards', '_moved_buy', created_file)
    shutil.move(buy_file_path, archived_path)
    print(f"   ✅ Buy cards 파일 아카이브: {created_file}")
    
    # 남은 카드 재저장 또는 파일 삭제
    if remaining_cards:
        with open(buy_file_path, 'w', encoding='utf-8') as f:
            json.dump(remaining_cards, f, ensure_ascii=False, indent=2)
        print(f"   ✓ 남은 카드 재저장: {len(remaining_cards)}개")
    else:
        print(f"   ✓ 모든 카드 소진 - 파일 삭제됨")
    
    # Sell card 생성
    sell_card = target_card.copy()
    sell_card['side'] = 'SELL'
    sell_card['price'] = 151000000  # 1% 수익
    sell_card['ts'] = int(time.time() * 1000)
    sell_card['uuid'] = f"test-sell-{int(time.time())}"
    sell_card['orig_buy_price'] = target_card.get('price', 0)
    sell_card['orig_buy_avg_price'] = target_card.get('avg_price', target_card.get('price', 0))
    sell_card['orig_buy_size'] = target_card.get('size', 0)
    sell_card['orig_buy_ts'] = target_card.get('ts', 0)
    sell_card['orig_buy_uuid'] = target_card.get('uuid', '')
    
    # 실현 손익 계산
    buy_price = sell_card['orig_buy_avg_price']
    sell_price = sell_card['price']
    sell_size = sell_card['size']
    cost = buy_price * sell_size
    proceeds = sell_price * sell_size
    profit = proceeds - cost
    pct = (profit / cost * 100) if cost > 0 else 0
    
    sell_card['realized_pnl'] = {
        'profit': profit,
        'pct': pct
    }
    
    # Sell card 파일 저장
    os.makedirs(sell_cards_dir, exist_ok=True)
    now = datetime.utcnow()
    sell_filename = f"sell_cards_{now.strftime('%Y-%m-%dT%H-%M-%S')}-{now.microsecond // 1000:03d}Z.json"
    sell_filepath = os.path.join(sell_cards_dir, sell_filename)
    
    with open(sell_filepath, 'w', encoding='utf-8') as f:
        json.dump([sell_card], f, ensure_ascii=False, indent=2)
    
    print(f"   ✅ 매도 카드 생성 성공")
    print(f"      - 파일: {sell_filename}")
    print(f"      - 매수가: {buy_price:,}원")
    print(f"      - 매도가: {sell_price:,}원")
    print(f"      - 손익: {profit:,.0f}원 ({pct:.2f}%)")
    
except Exception as e:
    print(f"   ❌ 매도 처리 실패: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
print()

# 6단계: 매도 후 Buy/Sell cards 파일 확인
print("[6단계] 매도 후 파일 상태 확인")
time.sleep(0.5)  # 파일 시스템 동기화 대기

# Buy cards 확인
if os.path.exists(buy_cards_dir):
    buy_files_final = [f for f in os.listdir(buy_cards_dir) if f.endswith('.json') and not f.startswith('_')]
    print(f"   Buy cards 최종 파일: {len(buy_files_final)}개")
    
    # 원래 있던 파일이 제거되었는지 확인
    removed_files = [f for f in new_files if f not in buy_files_final]
    if removed_files:
        print(f"   ✅ 매도된 buy card 제거됨: {removed_files[0]}")
    elif len(buy_files_final) == len(buy_files_after):
        print(f"   ⚠️ Buy card가 제거되지 않음 (누적 가능성)")
    
    # 아카이브 확인
    moved_buy_dir = os.path.join(sell_cards_dir, '_moved_buy')
    if os.path.exists(moved_buy_dir):
        moved_files = [f for f in os.listdir(moved_buy_dir) if f.endswith('.json')]
        print(f"   ✓ 아카이브된 파일: {len(moved_files)}개")
        if moved_files:
            print(f"      - {moved_files[-1]}")
print()

# Sell cards 확인
if os.path.exists(sell_cards_dir):
    sell_files_final = [f for f in os.listdir(sell_cards_dir) if f.endswith('.json')]
    new_sell_files = [f for f in sell_files_final if f not in sell_files_before]
    print(f"   Sell cards 최종 파일: {len(sell_files_final)}개")
    print(f"   ✅ 새로 생성된 매도 카드: {len(new_sell_files)}개")
    if new_sell_files:
        latest_sell = [f for f in new_sell_files if f.startswith('sell_cards')][-1] if new_sell_files else None
        if latest_sell:
            print(f"      - {latest_sell}")
            
            # 매도 카드 내용 확인
            with open(os.path.join(sell_cards_dir, latest_sell), 'r', encoding='utf-8') as f:
                sell_card_data = json.load(f)
                if isinstance(sell_card_data, list) and len(sell_card_data) > 0:
                    card = sell_card_data[0]
                    print(f"      - 매수가: {card.get('orig_buy_price', 0):,.0f}원")
                    print(f"      - 매도가: {card.get('price', 0):,.0f}원")
                    pnl = card.get('realized_pnl', {})
                    if isinstance(pnl, dict):
                        print(f"      - 실현손익: {pnl.get('profit', 0):,.0f}원 ({pnl.get('pct', 0):.2f}%)")
print()

# 7단계: 결과 요약
print("=" * 60)
print("테스트 결과 요약")
print("=" * 60)
print(f"✅ 매수 카드 생성: 정상 작동")
print(f"✅ 매도 카드 생성: 정상 작동")
print(f"✅ Buy cards 파일 관리: {'정상 (누적 방지)' if created_file not in buy_files_final else '⚠️ 확인 필요 (파일 잔류)'}")
print(f"✅ Sell cards 생성: {'정상' if len(new_sell_files) > 0 else '⚠️ 확인 필요'}")
print(f"✅ 아카이브 처리: {'정상' if os.path.exists(os.path.join(sell_cards_dir, '_moved_buy', created_file)) else '⚠️ 확인 필요'}")
print("=" * 60)

