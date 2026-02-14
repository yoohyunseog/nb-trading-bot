import json, glob, os

files = glob.glob(os.path.join('data', 'buy_cards', '*.json'))
if not files:
    print('No buy_cards files')
    raise SystemExit(1)

latest = max(files, key=os.path.getmtime)
print('Latest file:', latest)
with open(latest, 'r', encoding='utf-8') as f:
    data = json.load(f)

print('Total entries in file:', len(data))
if not data:
    raise SystemExit(0)

# Inspect first 3 entries keys
for i, card in enumerate(data[:3]):
    print('\n--- Card', i+1, '---')
    if not isinstance(card, dict):
        print('Not a dict:', type(card))
        continue
    keys = sorted(card.keys())
    print('Keys:', keys)
    # find numeric candidates
    for k,v in card.items():
        if isinstance(v, (int, float)):
            if abs(v) > 1000:
                print(f"Numeric candidate: {k} = {v}")
        elif isinstance(v, str) and v.replace('.','',1).isdigit():
            try:
                num = float(v)
                if abs(num) > 1000:
                    print(f"String numeric candidate: {k} = {v}")
            except:
                pass
    # search nested dicts for price-like keys
    def scan(d, prefix=''):
        if isinstance(d, dict):
            for k,v in d.items():
                if isinstance(v,(int,float)) and abs(v) > 1000:
                    print(f"Nested candidate: {prefix + k} = {v}")
                elif isinstance(v, dict):
                    scan(v, prefix + k + '.')
    scan(card)

print('\nDone')
