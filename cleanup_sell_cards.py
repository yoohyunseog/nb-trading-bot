import json
import glob
import os

print("=" * 60)
print("📊 SELL CARDS 정리 작업 시작")
print("=" * 60)

# 1. 모든 sell_cards 파일 확인
sell_files = sorted(glob.glob('data/sell_cards/sell_cards_*.json'))
print(f"\n📂 총 {len(sell_files)}개 파일 발견:")

valid_cards = []
invalid_files = []

for file in sell_files:
    print(f"\n🔍 확인 중: {os.path.basename(file)}")
    try:
        with open(file, 'r', encoding='utf-8') as f:
            cards = json.load(f)
        
        if not isinstance(cards, list):
            print(f"   ❌ 배열 형식이 아님")
            invalid_files.append(file)
            continue
        
        print(f"   📋 카드 개수: {len(cards)}")
        
        for i, card in enumerate(cards):
            # nb 정보 유무 확인
            has_nb = 'nb' in card and 'price' in card.get('nb', {})
            has_max_min = False
            if has_nb:
                nb_price = card['nb']['price']
                has_max_min = 'max' in nb_price and 'min' in nb_price and 'values' in nb_price
            
            side = card.get('side', 'UNKNOWN')
            price = card.get('price', 0)
            uuid = card.get('uuid', 'NO-UUID')[:8]
            
            print(f"   - Card {i+1}: {side} @ {price:,.0f} KRW (uuid: {uuid}...)")
            print(f"     nb 정보: {'✅ 있음' if has_nb else '❌ 없음'}")
            print(f"     max/min: {'✅ 있음' if has_max_min else '❌ 없음'}")
            
            if has_nb and has_max_min:
                valid_cards.append({
                    'card': card,
                    'file': file
                })
            else:
                print(f"     ⚠️  nb 정보 불완전 - 제외")
    
    except Exception as e:
        print(f"   ❌ 에러: {e}")
        invalid_files.append(file)

print("\n" + "=" * 60)
print(f"✅ 유효한 카드: {len(valid_cards)}개")
print(f"❌ 제외된 파일: {len(invalid_files)}개")

# 2. 최신 파일에 모든 유효한 카드 병합
if valid_cards:
    # 가장 최신 파일 사용
    latest_file = sorted(sell_files)[-1]
    print(f"\n📝 병합 대상 파일: {os.path.basename(latest_file)}")
    
    # 중복 제거 (uuid 기준)
    unique_cards = {}
    for item in valid_cards:
        card = item['card']
        uuid = card.get('uuid')
        if uuid:
            # 같은 uuid면 최신 것만 유지 (ts 기준)
            if uuid not in unique_cards or card.get('ts', 0) > unique_cards[uuid].get('ts', 0):
                unique_cards[uuid] = card
    
    final_cards = list(unique_cards.values())
    # ts 기준 정렬 (오래된 것부터)
    final_cards.sort(key=lambda x: x.get('ts', 0))
    
    print(f"📦 중복 제거 후: {len(final_cards)}개")
    
    # 저장
    with open(latest_file, 'w', encoding='utf-8') as f:
        json.dump(final_cards, f, indent=2, ensure_ascii=False)
    
    print(f"✅ {os.path.basename(latest_file)} 업데이트 완료")
    
    # 3. 구버전 파일 삭제
    for file in sell_files:
        if file != latest_file:
            os.remove(file)
            print(f"🗑️  삭제: {os.path.basename(file)}")

print("\n" + "=" * 60)
print("🎉 정리 완료!")
print("=" * 60)
