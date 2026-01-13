import json
import glob

print("=" * 60)
print("📊 최종 상태 확인")
print("=" * 60)

print("\n1️⃣ BUY_CARDS:")
buy_files = glob.glob('data/buy_cards/*.json')
for f in buy_files:
    try:
        with open(f, 'r', encoding='utf-8') as file:
            cards = json.load(file)
            print(f"  ✅ {f.split('/')[-1]}: {len(cards)} cards")
    except Exception as e:
        print(f"  ❌ {f.split('/')[-1]}: 에러 - {e}")

print("\n2️⃣ SELL_CARDS:")
sell_files = glob.glob('data/sell_cards/*.json')
for f in sell_files:
    try:
        with open(f, 'r', encoding='utf-8') as file:
            cards = json.load(file)
            print(f"\n  ✅ {f.split('/')[-1]}: {len(cards)} cards")
            for i, card in enumerate(cards):
                side = card.get('side', 'UNKNOWN')
                price = card.get('price', 0)
                uuid = card.get('uuid', 'NO-UUID')[:8]
                has_nb = 'nb' in card and 'max' in card.get('nb', {}).get('price', {})
                print(f"     Card {i+1}: {side} @ {price:,.0f} KRW (uuid: {uuid}...) nb: {'✅' if has_nb else '❌'}")
    except Exception as e:
        print(f"  ❌ {f.split('/')[-1]}: 에러 - {e}")

print("\n" + "=" * 60)
