import json

# 1. buy_cards에서 첫 번째 카드 읽기
with open('data/buy_cards/buy_cards_2026-01-10T16-54-23-992Z.json', 'r', encoding='utf-8') as f:
    buy_cards = json.load(f)

buy_card = buy_cards[0]  # 첫 번째 카드 (133643000.0)
print(f"✅ BUY 카드 찾음: price={buy_card['current_price']}, uuid={buy_card['uuid']}")

# 2. SELL 카드에 전체 정보 복사 및 SELL 정보로 업데이트
sell_card = buy_card.copy()
sell_card['side'] = 'SELL'
sell_card['ts'] = 1768179656861
sell_card['price'] = 134349000.0
sell_card['current_price'] = 134349000.0
sell_card['size'] = 3.744e-05
sell_card['uuid'] = 'b718bd7b-27da-4160-aa37-64b3826f7886'
sell_card['orderId'] = ''
sell_card['paid_fee'] = 0
sell_card['avg_price'] = 134349000.0

# insight는 SELL 시점것으로 업데이트
sell_card['insight'] = {
    "r": 0.5000077047476572,
    "zone_flag": -1,
    "zone": "ORANGE",
    "zone_conf": 0.0,
    "dist_high": 0.0,
    "dist_low": 0.0,
    "extreme_gap": 0.0,
    "zone_min_r": 0.0,
    "zone_max_r": 1.0,
    "zone_extreme_r": 0.5000077047476572,
    "zone_extreme_age": 54,
    "zone_min_price": 134150000.0,
    "zone_max_price": 134150000.0,
    "zone_extreme_price": 134150000.0,
    "w": 0.00854327459832047,
    "ema_diff": 69684.31998835504,
    "pct_blue_raw": 49.992295252342814,
    "pct_orange_raw": 50.00770474765718,
    "pct_blue": 50.03329263075068,
    "pct_orange": 49.96670736924932
}

# 3. sell_cards 파일 업데이트
with open('data/sell_cards/sell_cards_2026-01-12T01-01-00-402Z.json', 'w', encoding='utf-8') as f:
    json.dump([sell_card], f, indent=2, ensure_ascii=False)

print(f"✅ SELL 카드 업데이트 완료: ts={sell_card['ts']}, price={sell_card['price']}")

# 4. buy_cards에서 첫 번째 카드 제거
buy_cards_remaining = buy_cards[1:]
with open('data/buy_cards/buy_cards_2026-01-10T16-54-23-992Z.json', 'w', encoding='utf-8') as f:
    json.dump(buy_cards_remaining, f, indent=2, ensure_ascii=False)

print(f"✅ BUY 카드 제거 완료: {len(buy_cards)} → {len(buy_cards_remaining)}개")
print("🎉 완료!")
