#!/usr/bin/env python3
"""
Backfill existing sell_cards with orig_buy_* and realized_pnl data.
Uses FIFO matching against buy_cards to compute buy cost for each sell.
"""
import json
import os
import glob
from datetime import datetime

def load_buy_cards():
    """Load all buy cards sorted by time."""
    buy_files = sorted(glob.glob('data/buy_cards/buy_cards_*.json'), reverse=True)
    buys = []
    for f in buy_files:
        try:
            with open(f, 'r', encoding='utf-8') as fp:
                data = json.load(fp)
                if isinstance(data, list):
                    buys.extend(data)
                else:
                    buys.append(data)
        except Exception as e:
            print(f"⚠️ Failed to load {f}: {e}")
    return sorted([b for b in buys if isinstance(b, dict)], key=lambda x: int(x.get('ts', 0)))

def backfill_sell_cards():
    """Backfill sell_cards with orig_buy_* and realized_pnl."""
    buy_cards = load_buy_cards()
    if not buy_cards:
        print("❌ No buy cards found. Cannot backfill.")
        return
    
    print(f"📊 Loaded {len(buy_cards)} buy cards for FIFO matching.")
    
    sell_files = sorted(glob.glob('data/sell_cards/sell_cards_*.json'), reverse=True)
    total_updated = 0
    
    for sell_file in sell_files:
        print(f"\n🔄 Processing {os.path.basename(sell_file)}...")
        try:
            with open(sell_file, 'r', encoding='utf-8') as fp:
                sell_data = json.load(fp)
            
            if not isinstance(sell_data, list):
                sell_data = [sell_data]
            
            # Create fresh FIFO queue per file (independent FIFO matching)
            buy_queue = [
                {'size': float(b.get('size', 0)), 'price': float(b.get('price', 0))}
                for b in buy_cards
                if float(b.get('price', 0)) > 0 and float(b.get('size', 0)) > 0
            ]
            
            updated = 0
            for sell in sell_data:
                if not isinstance(sell, dict):
                    continue
                
                # Skip if already backfilled
                if sell.get('orig_buy_price') or sell.get('orig_buy_avg_price'):
                    print(f"  ✓ Already has orig_buy_* info")
                    continue
                
                sell_price = float(sell.get('price', 0))
                sell_size = float(sell.get('size', 0))
                sell_ts = int(sell.get('ts', 0))
                
                if sell_price <= 0 or sell_size <= 0:
                    continue
                
                # FIFO match
                realized_cost = 0.0
                realized_proceeds = 0.0
                remain = sell_size
                first_buy_price = None
                
                while remain > 1e-8 and buy_queue:
                    buy = buy_queue[0]
                    qty = min(remain, buy['size'])
                    realized_cost += buy['price'] * qty
                    realized_proceeds += sell_price * qty
                    if first_buy_price is None:
                        first_buy_price = buy['price']
                    buy['size'] -= qty
                    remain -= qty
                    if buy['size'] <= 1e-8:
                        buy_queue.pop(0)
                
                if remain > 1e-8:
                    # No more buys, treat as cost-free (unlikely in backtesting)
                    realized_proceeds += sell_price * remain
                
                # Populate fields
                sell['orig_buy_price'] = first_buy_price if first_buy_price else 0.0
                sell['orig_buy_avg_price'] = (realized_cost / sell_size) if sell_size > 0 else 0.0
                sell['orig_buy_size'] = sell_size
                sell['orig_buy_ts'] = sell_ts
                sell['orig_buy_uuid'] = sell.get('uuid', '')
                
                profit = realized_proceeds - realized_cost
                profit_pct = (profit / realized_cost * 100.0) if realized_cost > 0 else 0.0
                sell['realized_pnl'] = {'profit': profit, 'pct': profit_pct}
                
                updated += 1
                print(f"  ✓ Updated: avg_buy={sell['orig_buy_avg_price']:.0f}, profit={profit:.0f}, pct={profit_pct:.2f}%")
            
            if updated > 0:
                with open(sell_file, 'w', encoding='utf-8') as fp:
                    json.dump(sell_data, fp, indent=2, ensure_ascii=False)
                print(f"✅ Updated {updated} sell cards in {os.path.basename(sell_file)}")
                total_updated += updated
        except Exception as e:
            print(f"❌ Failed to process {sell_file}: {e}")
    
    print(f"\n✅ Backfill complete: {total_updated} sell cards updated.")

if __name__ == '__main__':
    backfill_sell_cards()
