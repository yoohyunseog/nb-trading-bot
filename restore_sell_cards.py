import json
import glob
from datetime import datetime

# 1. 4개 buy_cards 파일에서 카드 추출
buy_files = sorted(glob.glob('data/buy_cards/buy_cards_*.json'))
all_buy_cards = []

for f in buy_files:
    with open(f, 'r', encoding='utf-8') as file:
        data = json.load(file)
        if isinstance(data, list):
            all_buy_cards.extend(data)

print(f"📊 총 {len(all_buy_cards)}장의 BUY 카드 발견")

# 2. 마지막 2장을 SELL 카드로 변환
sell_cards = []

if len(all_buy_cards) >= 2:
    # 가장 최근의 2장 (마지막 2개)
    for i in range(len(all_buy_cards)-2, len(all_buy_cards)):
        buy_card = all_buy_cards[i]
        sell_card = buy_card.copy()
        
        # SELL 정보로 업데이트
        sell_card['side'] = 'SELL'
        sell_card['ts'] = int(datetime.now().timestamp() * 1000)
        sell_card['price'] = float(buy_card['price']) + 1000  # 매도가 = 매수가 + 1000원
        sell_card['current_price'] = sell_card['price']
        sell_card['uuid'] = buy_card['uuid']
        sell_card['orderId'] = ''
        sell_card['paid_fee'] = 0
        sell_card['avg_price'] = sell_card['price']
        
        sell_cards.append(sell_card)
        
        code = buy_card.get('card_rating', {}).get('code', 'N/A')
        buy_price = buy_card['price']
        sell_price = sell_card['price']
        pnl = sell_price - buy_price
        
        print(f"\n✅ SELL 카드 생성:")
        print(f"   {code}")
        print(f"   BUY:  {buy_price:,}원")
        print(f"   SELL: {sell_price:,}원")
        print(f"   PnL:  +{pnl:,}원")

# 3. 새 sell_cards 파일로 저장
new_sell_file = f"data/sell_cards/sell_cards_{datetime.now().strftime('%Y-%m-%dT%H-%M-%S-%f')[:-3]}Z.json"
with open(new_sell_file, 'w', encoding='utf-8') as f:
    json.dump(sell_cards, f, indent=2, ensure_ascii=False)

print(f"\n✅ Sell cards 파일 생성: {new_sell_file.split('/')[-1]}")
print(f"🎉 {len(sell_cards)}장의 SELL 카드 저장 완료!")
