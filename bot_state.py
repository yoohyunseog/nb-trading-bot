"""
Shared bot state and auto-buy configuration.
Separate module to keep server.py lean.
"""

import json
import os
from pathlib import Path

# Auto-buy config file path
AUTO_BUY_CONFIG_FILE = Path('data/auto_buy.json')

# Auto-sell config file path
AUTO_SELL_CONFIG_FILE = Path('data/auto_sell.json')

# Default auto-buy configuration
AUTO_BUY_CONFIG = {
    'enabled': False,
    'market': 'KRW-BTC',
    'interval': 'minute10',
    'intervals': [],
    'amount_krw': 5000,
    'cooldown_sec': 0,
    'last_check': None,
    'last_buy': None
}

def load_auto_buy_config():
    """Load auto-buy configuration from file."""
    global AUTO_BUY_CONFIG
    try:
        if AUTO_BUY_CONFIG_FILE.exists():
            with open(AUTO_BUY_CONFIG_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, dict):
                    # Update only existing keys to prevent injection
                    for key in AUTO_BUY_CONFIG.keys():
                        if key in data:
                            AUTO_BUY_CONFIG[key] = data[key]
                    print(f"✅ Auto-buy config loaded: enabled={AUTO_BUY_CONFIG.get('enabled')}, intervals={AUTO_BUY_CONFIG.get('intervals')}")
                    return True
        else:
            print(f"⚠️ Auto-buy config file not found: {AUTO_BUY_CONFIG_FILE}")
            # Create default file
            save_auto_buy_config()
    except Exception as e:
        print(f"❌ Failed to load auto-buy config: {e}")
    return False

def save_auto_buy_config():
    """Save auto-buy configuration to file."""
    try:
        # Ensure data directory exists
        AUTO_BUY_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        
        with open(AUTO_BUY_CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(AUTO_BUY_CONFIG, f, indent=2, ensure_ascii=False)
        print(f"💾 Auto-buy config saved: enabled={AUTO_BUY_CONFIG.get('enabled')}")
        return True
    except Exception as e:
        print(f"❌ Failed to save auto-buy config: {e}")
        return False

# Default auto-sell configuration
AUTO_SELL_CONFIG = {
    'enabled': False,
    'market': 'KRW-BTC',
    'target_profit_rate': 1.0,
    'sell_mode': 'profit_first',
    'sell_count': 1,
    'cooldown_sec': 300,
    'zone_condition': False,
    'ml_trust_adjust': False,
    'last_check': None,
    'last_sell': None
}

def load_auto_sell_config():
    """Load auto-sell configuration from file."""
    global AUTO_SELL_CONFIG
    try:
        if AUTO_SELL_CONFIG_FILE.exists():
            with open(AUTO_SELL_CONFIG_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, dict):
                    for key in AUTO_SELL_CONFIG.keys():
                        if key in data:
                            AUTO_SELL_CONFIG[key] = data[key]
                    print(f"✅ Auto-sell config loaded: enabled={AUTO_SELL_CONFIG.get('enabled')}, target={AUTO_SELL_CONFIG.get('target_profit_rate')}%")
                    return True
        else:
            print(f"⚠️ Auto-sell config file not found: {AUTO_SELL_CONFIG_FILE}")
            save_auto_sell_config()
    except Exception as e:
        print(f"❌ Failed to load auto-sell config: {e}")
    return False

def save_auto_sell_config():
    """Save auto-sell configuration to file."""
    try:
        AUTO_SELL_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(AUTO_SELL_CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(AUTO_SELL_CONFIG, f, indent=2, ensure_ascii=False)
        print(f"💾 Auto-sell config saved: enabled={AUTO_SELL_CONFIG.get('enabled')}")
        return True
    except Exception as e:
        print(f"❌ Failed to save auto-sell config: {e}")
        return False

# Load config on module import
load_auto_buy_config()
load_auto_sell_config()

# Bot controller for start/stop from UI
bot_ctrl = {
    'running': False,
    'thread': None,
    'last_signal': 'HOLD',
    'last_order': None,
    'nb_zone': 'ORANGE',  # 'BLUE' or 'ORANGE'
    'ml_zone': 'ORANGE',  # 'BLUE' or 'ORANGE'
    'r_value': 0.5,  # Current r value
    'position': 'FLAT',  # 'FLAT' or 'LONG' (single-cycle enforcement)
    'cfg_override': {  # values can be overridden via /api/bot/config
        'paper': None,
        'order_krw': None,
        'pnl_ratio': None,
        'pnl_profit_ratio': None,
        'pnl_loss_ratio': None,
        'ema_fast': None,
        'ema_slow': None,
        'candle': None,
        'market': None,
        'interval_sec': None,
        'require_ml': None,  # if true, require ML confirmation to place orders
        'zone100_only': None,  # if true, place orders only when zone prob is 100%
        'require_group': None,  # if true, require multi-timeframe group consensus
        'group_intervals': None,  # e.g., ["minute1","minute3","minute5"]
        'group_buy_th': None,    # 0~100
        'group_sell_th': None,   # 0~100
        'min_order_gap_sec': None, # enforce minimal seconds between orders
        'require_pullback': None,   # require pullback from extreme before ordering
        'pullback_r': None,         # minimum extreme_gap in r (e.g., 0.02)
        'pullback_bars': None,      # minimum bars since extreme (zone_extreme_age)
        # Enforce side by zone: ONLY BUY in BLUE, ONLY SELL in ORANGE
        'enforce_zone_side': None,
        'nb_force': None,  # if true, place order immediately on NB signal (skip ML/pullback/group/zone100)
        # NB window override from UI to align server signals with chart
        'nb_window': None,
        # runtime key injection (avoid restarting server)
        'access_key': None,
        'secret_key': None,
        'open_api_access_key': None,
        'open_api_secret_key': None,
    }
}
