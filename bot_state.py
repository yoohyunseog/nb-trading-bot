"""
Shared bot state and auto-buy configuration.
Separate module to keep server.py lean.
"""

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
