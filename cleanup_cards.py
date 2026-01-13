import json
from datetime import datetime
import glob
import os

# 1. buy_cards 최신 파일 확인
buy_files = sorted(glob.glob('data/buy_cards/buy_cards_*.json'), reverse=True)
if buy_files:
    with open(buy_files[0], 'r', encoding='utf-8') as f:
        buy_cards = json.load(f)
    
    print(f"📊 Buy cards 현황: {len(buy_cards)}장")
    if len(buy_cards) > 0:
        for i, card in enumerate(buy_cards):
            print(f"  {i+1}. {card.get('card_rating', {}).get('code', 'N/A')} - {card.get('price'):,}원")
    
    # buy_cards 3장만 유지 (3장 이상이면 앞의 것부터 제거)
    if len(buy_cards) > 3:
        print(f"⚠️ Buy cards 정리: {len(buy_cards)}장 → 3장")
        buy_cards = buy_cards[-3:]  # 마지막 3장만 유지
        with open(buy_files[0], 'w', encoding='utf-8') as f:
            json.dump(buy_cards, f, indent=2, ensure_ascii=False)
        print(f"✅ Buy cards 정리 완료: 3장 유지")

# 2. sell_cards 전부 삭제하고 새로 초기화
sell_files = glob.glob('data/sell_cards/sell_cards_*.json')
print(f"\n📊 Sell cards 현황: {len(sell_files)}개 파일")
for f in sell_files:
    os.remove(f)
    print(f"  🗑️ 삭제: {os.path.basename(f)}")

# 새로운 sell_cards 파일 생성 (빈 배열)
new_sell_file = f"data/sell_cards/sell_cards_{datetime.now().strftime('%Y-%m-%dT%H-%M-%S-%f')[:-3]}Z.json"
with open(new_sell_file, 'w', encoding='utf-8') as f:
    json.dump([], f, indent=2, ensure_ascii=False)

print(f"✅ Sell cards 초기화 완료: {os.path.basename(new_sell_file)}")
print(f"\n🎉 정리 완료!")
