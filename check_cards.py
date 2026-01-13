import json
import glob

# 모든 buy_cards 파일에서 카드 수 확인
buy_files = sorted(glob.glob('data/buy_cards/buy_cards_*.json'))

print("📊 Buy cards 파일별 카드 현황:")
for f in buy_files:
    with open(f, 'r', encoding='utf-8') as file:
        data = json.load(file)
        if isinstance(data, list):
            print(f"  {f.split('/')[-1]}: {len(data)}장")
            for i, card in enumerate(data[:3]):  # 처음 3장만
                code = card.get('card_rating', {}).get('code', 'N/A')
                price = card.get('price', 0)
                print(f"    {i+1}. {code} - {price:,}원")
        else:
            print(f"  {f.split('/')[-1]}: 오류")

# sell_cards 파일 확인
sell_files = sorted(glob.glob('data/sell_cards/sell_cards_*.json'))
print(f"\n📊 Sell cards 파일 현황:")
for f in sell_files:
    with open(f, 'r', encoding='utf-8') as file:
        data = json.load(file)
        if isinstance(data, list):
            print(f"  {f.split('/')[-1]}: {len(data)}장")
