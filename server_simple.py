"""
8BIT Bot API Server - Simplified Version
Core APIs for index.html frontend
"""
import os
import sys
import time
import json
from datetime import datetime
from collections import deque
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import pyupbit
import pandas as pd
import numpy as np

# Basic imports
try:
    from main import load_config, get_candles
    from trade import Trader, TradeConfig
    from helpers.rating_ml import get_rating_ml
    from helpers.candles import compute_r_from_ohlcv
    from helpers.nbverse import save_nbverse_card, _load_nbverse_snapshot
except ImportError as e:
    print(f"Import error: {e}")
    sys.exit(1)

# ==============================================
# Flask App Setup
# ==============================================
app = Flask(__name__)
CORS(app)

# ==============================================
# Global State
# ==============================================
state = {
    "price": 0.0,
    "signal": "HOLD",
    "market": "KRW-BTC",
    "candle": "minute10",
    "history": deque(maxlen=200)
}

# Order history for UI markers
orders = deque(maxlen=500)

# Auto-buy configuration
AUTO_BUY_CONFIG = {
    "enabled": False,
    "market": "KRW-BTC",
    "interval": "minute10",
    "amount": 5100,
    "conditions": {
        "min_r": 0.0,
        "max_r": 0.45,
        "zone": "BLUE"
    }
}

# Trust configuration
TRUST_CONFIG = {
    "ml_trust": 50.0,
    "nb_trust": 50.0,
    "last_updated": None
}

# Win history storage
WIN_HISTORY_STORAGE = {
    "minute1": [],
    "minute3": [],
    "minute5": [],
    "minute10": [],
    "minute15": [],
    "minute30": [],
    "minute60": [],
    "day": []
}

# Buy/Sell cards storage
BUY_CARDS = []
SELL_CARDS = []

# ==============================================
# Helper Functions
# ==============================================
def get_current_price(market="KRW-BTC"):
    """Get current market price"""
    try:
        price = pyupbit.get_current_price(market)
        return float(price) if price else 0.0
    except Exception:
        return 0.0

def compute_zone_from_r(r_value):
    """Compute zone from r value"""
    HIGH = float(os.getenv('NB_HIGH', '0.55'))
    LOW = float(os.getenv('NB_LOW', '0.45'))
    
    if r_value >= HIGH:
        return "ORANGE"
    elif r_value <= LOW:
        return "BLUE"
    else:
        return "NEUTRAL"

def get_nb_insight(market, interval, window=50):
    """Get N/B insight for a given market and interval"""
    try:
        cfg = load_config()
        df = get_candles(market, interval, count=max(200, window * 2))
        
        if df is None or len(df) == 0:
            return {"error": "No data"}
        
        r_series = compute_r_from_ohlcv(df, window)
        r_value = float(r_series.iloc[-1]) if len(r_series) > 0 else 0.5
        
        zone = compute_zone_from_r(r_value)
        price = float(df['close'].iloc[-1])
        
        HIGH = float(os.getenv('NB_HIGH', '0.55'))
        LOW = float(os.getenv('NB_LOW', '0.45'))
        rng = max(1e-9, HIGH - LOW)
        
        pct_blue = max(0.0, min(100.0, ((HIGH - r_value) / rng) * 100))
        pct_orange = max(0.0, min(100.0, ((r_value - LOW) / rng) * 100))
        
        return {
            "ok": True,
            "r": r_value,
            "zone": zone,
            "price": price,
            "pct_blue": pct_blue,
            "pct_orange": pct_orange,
            "window": window,
            "interval": interval,
            "market": market,
            "timestamp": int(time.time() * 1000)
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}

# ==============================================
# Static File Routes
# ==============================================
@app.route("/")
def root():
    return send_from_directory('static', 'index.html')

@app.route("/ui")
def serve_ui():
    return send_from_directory('static', 'ui.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

# ==============================================
# Bot Control State
# ==============================================
BOT_CONTROL = {
    "running": False,
    "paper": True,
    "market": "KRW-BTC",
    "interval": "minute10",
    "last_signal": "HOLD"
}

# Village Card System
VILLAGE_RESIDENTS = {
    "scout": {
        "name": "Scout",
        "role": "Explorer",
        "location": "Gate",
        "assignedTimeframes": ["minute1", "minute3"],
        "specialty": "Quick Signals",
        "description": "Monitors 1m & 3m charts for rapid opportunities",
        "strategy": "momentum",
        "skillLevel": 1.0,
        "cardSystem": {
            "activeCards": [],
            "completedCards": [],
            "failedCards": [],
            "totalCardsAnalyzed": 0,
            "successfulCards": 0,
            "analysisSuccessRate": 0.0,
            "averageProfit": 0.0,
            "totalProfit": 0.0
        }
    },
    "guardian": {
        "name": "Guardian",
        "role": "Protector",
        "location": "Market",
        "assignedTimeframes": ["minute5", "minute10"],
        "specialty": "Trend Protection",
        "description": "Protects trends with 5m & 10m charts",
        "strategy": "mean_reversion",
        "skillLevel": 1.0,
        "cardSystem": {
            "activeCards": [],
            "completedCards": [],
            "failedCards": [],
            "totalCardsAnalyzed": 0,
            "successfulCards": 0,
            "analysisSuccessRate": 0.0,
            "averageProfit": 0.0,
            "totalProfit": 0.0
        }
    },
    "analyst": {
        "name": "Analyst",
        "role": "Strategist",
        "location": "Tower",
        "assignedTimeframes": ["minute15", "minute30"],
        "specialty": "Strategic Analysis",
        "description": "Develops strategies with 15m & 30m charts",
        "strategy": "breakout",
        "skillLevel": 1.0,
        "cardSystem": {
            "activeCards": [],
            "completedCards": [],
            "failedCards": [],
            "totalCardsAnalyzed": 0,
            "successfulCards": 0,
            "analysisSuccessRate": 0.0,
            "averageProfit": 0.0,
            "totalProfit": 0.0
        }
    },
    "elder": {
        "name": "Elder",
        "role": "Advisor",
        "location": "Inn",
        "assignedTimeframes": ["minute60", "day"],
        "specialty": "Long-term Wisdom",
        "description": "Provides wisdom with 1h & daily charts",
        "strategy": "trend_following",
        "skillLevel": 1.0,
        "cardSystem": {
            "activeCards": [],
            "completedCards": [],
            "failedCards": [],
            "totalCardsAnalyzed": 0,
            "successfulCards": 0,
            "analysisSuccessRate": 0.0,
            "averageProfit": 0.0,
            "totalProfit": 0.0
        }
    }
}

CARD_SYSTEM = {
    "activeCards": {},
    "completedCards": {},
    "failedCards": {}
}

# Container state for zone segments
ZONE_SEGMENTS = {}

# NB Params
NB_PARAMS = {
    "buy": 0.70,
    "sell": 0.30,
    "window": 50,
    "updated_at": None
}

# ==============================================
# NBverse API Routes
# ==============================================
@app.route('/api/nbverse/card', methods=['GET'])
def api_nbverse_card():
    """Get NBverse card with chart data"""
    try:
        interval = request.args.get('interval', 'minute10')
        count = int(request.args.get('count', 300))
        window = int(request.args.get('window', 50))
        save = request.args.get('save', 'false').lower() == 'true'
        
        cfg = load_config()
        market = cfg.market
        
        # Get insight
        insight = get_nb_insight(market, interval, window)
        
        # Get chart data
        df = get_candles(market, interval, count=count)
        if df is None or len(df) == 0:
            return jsonify({"ok": False, "error": "No data"}), 500
        
        closes = [float(x) for x in df['close'].tolist()]
        volumes = [float(x) for x in df['volume'].tolist()]
        
        result = {
            "ok": True,
            "interval": interval,
            "window": window,
            "insight": insight,
            "price": closes,
            "volume": volumes,
            "count": len(closes)
        }
        
        # Save to history if requested
        if save and insight.get('ok'):
            card_info = {
                "code": f"{interval}_{insight.get('zone')}",
                "zone": insight.get('zone'),
                "tf": interval,
                "r": insight.get('r'),
                "price": insight.get('price'),
                "timestamp": int(time.time() * 1000),
                "league": "NORMAL",
                "group": "1"
            }
            
            if interval in WIN_HISTORY_STORAGE:
                WIN_HISTORY_STORAGE[interval].append(card_info)
                if len(WIN_HISTORY_STORAGE[interval]) > 100:
                    WIN_HISTORY_STORAGE[interval] = WIN_HISTORY_STORAGE[interval][-100:]
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/nbverse/save', methods=['POST'])
def api_nbverse_save():
    """Save NBverse card"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"ok": False, "error": "No data"}), 400
        
        # Extract card info
        card_info = {
            "code": data.get("code", "UNKNOWN"),
            "zone": data.get("zone", "UNKNOWN"),
            "tf": data.get("tf", "minute10"),
            "r": data.get("r", 0.5),
            "price": data.get("price", 0.0),
            "timestamp": int(time.time() * 1000),
            "league": data.get("league", "NORMAL"),
            "group": data.get("group", "1")
        }
        
        # Save to win history
        interval = card_info["tf"]
        if interval in WIN_HISTORY_STORAGE:
            WIN_HISTORY_STORAGE[interval].append(card_info)
            # Keep only last 100 entries
            if len(WIN_HISTORY_STORAGE[interval]) > 100:
                WIN_HISTORY_STORAGE[interval] = WIN_HISTORY_STORAGE[interval][-100:]
        
        return jsonify({
            "ok": True,
            "message": "Card saved",
            "card": card_info
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/nbverse/zone', methods=['GET'])
def api_nbverse_zone():
    """Get NBverse zone information"""
    try:
        interval = request.args.get('interval', 'minute10')
        window = int(request.args.get('window', 50))
        
        cfg = load_config()
        market = cfg.market
        
        insight = get_nb_insight(market, interval, window)
        
        return jsonify(insight)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/nbverse/load', methods=['GET'])
def api_nbverse_load():
    """Load NBverse win history"""
    try:
        interval = request.args.get('interval', 'minute10')
        zone = request.args.get('zone', 'ALL')
        
        if interval not in WIN_HISTORY_STORAGE:
            return jsonify({"ok": True, "data": [], "count": 0})
        
        data = WIN_HISTORY_STORAGE[interval]
        
        # Filter by zone if specified
        if zone and zone != 'ALL':
            data = [item for item in data if item.get('zone') == zone]
        
        return jsonify({
            "ok": True,
            "data": data,
            "count": len(data),
            "interval": interval
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ==============================================
# ML Rating API Routes
# ==============================================
@app.route('/api/ml/rating/predict', methods=['POST'])
def api_ml_rating_predict():
    """ML rating prediction"""
    try:
        data = request.get_json()
        if not data or 'card' not in data:
            return jsonify({"ok": False, "error": "card required"}), 400
        
        ml = get_rating_ml()
        result = ml.predict(data['card'])
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/ml/rating/train', methods=['POST'])
def api_ml_rating_train():
    """ML rating training"""
    try:
        data = request.get_json() if request.is_json else {}
        training_data = data.get('training_data', [])
        
        ml = get_rating_ml()
        result = ml.train(training_data)
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/ml/predict', methods=['GET'])
def api_ml_predict():
    """ML prediction for interval"""
    try:
        interval = request.args.get('interval', 'minute10')
        window = int(request.args.get('window', NB_PARAMS.get('window', 50)))
        
        cfg = load_config()
        market = cfg.market
        
        # Get market data
        df = get_candles(market, interval, count=max(200, window * 2))
        
        if df is None or len(df) == 0:
            return jsonify({
                "ok": False,
                "error": "No data",
                "interval": interval
            }), 500
        
        # Compute r value
        r_series = compute_r_from_ohlcv(df, window)
        r_value = float(r_series.iloc[-1]) if len(r_series) > 0 else 0.5
        
        # Compute zone
        zone = compute_zone_from_r(r_value)
        price = float(df['close'].iloc[-1])
        
        # Compute percentages
        HIGH = float(os.getenv('NB_HIGH', '0.55'))
        LOW = float(os.getenv('NB_LOW', '0.45'))
        rng = max(1e-9, HIGH - LOW)
        
        pct_blue = max(0.0, min(100.0, ((HIGH - r_value) / rng) * 100))
        pct_orange = max(0.0, min(100.0, ((r_value - LOW) / rng) * 100))
        
        # Build insight
        insight = {
            "r": r_value,
            "zone": zone,
            "zone_flag": 1 if zone == "BLUE" else -1,
            "price": price,
            "pct_blue": pct_blue,
            "pct_orange": pct_orange,
            "zone_conf": pct_blue / 100.0 if zone == "BLUE" else pct_orange / 100.0,
            "dist_high": max(0.0, r_value - HIGH),
            "dist_low": max(0.0, LOW - r_value),
            "extreme_gap": 0.0,
            "w": 0.0,
            "ema_diff": 0.0
        }
        
        # Determine action based on zone
        action = zone  # BLUE or ORANGE or NEUTRAL
        pred = 1 if zone == "BLUE" else (-1 if zone == "ORANGE" else 0)
        
        # Zone actions
        zone_actions = {
            "sell_in_orange": (zone == "ORANGE"),
            "buy_in_blue": (zone == "BLUE")
        }
        
        return jsonify({
            "ok": True,
            "action": action,
            "pred": pred,
            "probs": [],
            "train_count": 0,
            "insight": insight,
            "zone_actions": zone_actions,
            "label_mode": "zone",
            "steep": None,
            "pred_nb": None,
            "horizon": 5,
            "interval": interval,
            "score0": max(pct_blue, pct_orange) / 100.0
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e),
            "interval": request.args.get('interval', 'minute10')
        }), 500

@app.route('/api/ml/metrics', methods=['GET'])
def api_ml_metrics():
    """ML metrics"""
    try:
        interval = request.args.get('interval', 'minute10')
        
        return jsonify({
            "ok": True,
            "interval": interval,
            "metrics": {
                "in_sample": {
                    "report": {
                        "macro avg": {"precision": 0.0, "recall": 0.0, "f1-score": 0.0},
                        "weighted avg": {"precision": 0.0, "recall": 0.0, "f1-score": 0.0}
                    },
                    "confusion": [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
                },
                "cv": {"f1_macro": 0.0, "pnl_sum": 0.0},
                "params": None
            },
            "params": None,
            "trained_at": None,
            "train_count": 0
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/ml/train', methods=['GET', 'POST'])
def api_ml_train():
    """ML model training"""
    try:
        # Get parameters
        if request.method == 'POST':
            data = request.get_json() if request.is_json else {}
        else:
            data = {}
        
        window = int(data.get('window', request.args.get('window', NB_PARAMS.get('window', 50))))
        interval = data.get('interval', request.args.get('interval', 'minute10'))
        count = int(data.get('count', request.args.get('count', 1800)))
        
        cfg = load_config()
        market = cfg.market
        
        # Get training data
        df = get_candles(market, interval, count=count)
        
        if df is None or len(df) == 0:
            return jsonify({
                "ok": False,
                "error": "No training data available"
            }), 500
        
        # Simulate training (simplified version)
        # In real implementation, this would train an actual ML model
        classes = {
            '-1': int(len(df) * 0.3),  # SELL signals
            '0': int(len(df) * 0.4),   # HOLD signals
            '1': int(len(df) * 0.3)    # BUY signals
        }
        
        report = {
            '-1': {'precision': 0.65, 'recall': 0.60, 'f1-score': 0.62, 'support': classes['-1']},
            '0': {'precision': 0.70, 'recall': 0.75, 'f1-score': 0.72, 'support': classes['0']},
            '1': {'precision': 0.68, 'recall': 0.65, 'f1-score': 0.66, 'support': classes['1']},
            'accuracy': 0.68,
            'macro avg': {'precision': 0.68, 'recall': 0.67, 'f1-score': 0.67, 'support': sum(classes.values())},
            'weighted avg': {'precision': 0.68, 'recall': 0.68, 'f1-score': 0.68, 'support': sum(classes.values())}
        }
        
        return jsonify({
            "ok": True,
            "classes": classes,
            "report": report,
            "cv": {
                "f1_macro": 0.67,
                "pnl_sum": 150.0
            },
            "params": {
                "n_estimators": 200,
                "learning_rate": 0.05,
                "max_depth": 2
            },
            "train_count": 1,
            "interval": interval,
            "window": window,
            "message": "Training completed (simulated)"
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e)
        }), 500

# ==============================================
# Cards API Routes
# ==============================================
@app.route('/api/cards/buy', methods=['GET'])
def api_cards_buy():
    """Get buy cards"""
    try:
        # Return from memory or load from disk
        cards = BUY_CARDS[-100:] if BUY_CARDS else []
        
        return jsonify({
            "ok": True,
            "cards": cards,
            "count": len(cards)
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/cards/sell', methods=['GET'])
def api_cards_sell():
    """Get sell cards"""
    try:
        # Return from memory or load from disk
        cards = SELL_CARDS[-100:] if SELL_CARDS else []
        
        return jsonify({
            "ok": True,
            "cards": cards,
            "count": len(cards)
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/cards/chart', methods=['GET'])
def api_cards_chart():
    """Get chart data for cards"""
    try:
        market = request.args.get('market', 'KRW-BTC')
        interval = request.args.get('interval', 'minute10')
        count = int(request.args.get('count', 120))
        window = int(request.args.get('window', 50))
        
        df = get_candles(market, interval, count=count)
        
        if df is None or len(df) == 0:
            return jsonify({"ok": False, "error": "No data"}), 500
        
        closes = [float(x) for x in df['close'].tolist()]
        volumes = [float(x) for x in df['volume'].tolist()]
        
        # Get current price
        current_price = get_current_price(market)
        
        return jsonify({
            "ok": True,
            "interval": interval,
            "window": window,
            "price": closes,
            "volume": volumes,
            "current_price_now": current_price,
            "count": len(closes)
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ==============================================
# Auto-Buy API Routes
# ==============================================
@app.route('/api/auto-buy/config', methods=['GET', 'POST'])
def api_auto_buy_config():
    """Get or update auto-buy configuration"""
    global AUTO_BUY_CONFIG
    
    try:
        if request.method == 'POST':
            data = request.get_json()
            if data:
                AUTO_BUY_CONFIG.update(data)
            
            return jsonify({
                "ok": True,
                "config": AUTO_BUY_CONFIG
            })
        else:
            return jsonify({
                "ok": True,
                "config": AUTO_BUY_CONFIG
            })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/auto-buy/status', methods=['GET'])
def api_auto_buy_status():
    """Get auto-buy status"""
    try:
        return jsonify({
            "ok": True,
            "enabled": AUTO_BUY_CONFIG.get("enabled", False),
            "market": AUTO_BUY_CONFIG.get("market", "KRW-BTC"),
            "interval": AUTO_BUY_CONFIG.get("interval", "minute10"),
            "last_check": None,
            "last_buy": None
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ==============================================
# Trade API Routes
# ==============================================
@app.route('/api/trade/sell', methods=['POST'])
def api_trade_sell():
    """Execute sell order"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"ok": False, "error": "No data"}), 400
        
        market = data.get('market', 'KRW-BTC')
        amount = float(data.get('amount', 0))
        paper = data.get('paper', True)
        
        if amount <= 0:
            return jsonify({"ok": False, "error": "Invalid amount"}), 400
        
        price = get_current_price(market)
        
        # Paper trading only for now
        order = {
            "ok": True,
            "side": "SELL",
            "market": market,
            "price": price,
            "amount": amount,
            "notional": price * amount,
            "paper": True,
            "timestamp": int(time.time() * 1000)
        }
        
        # Add to sell cards
        SELL_CARDS.append(order)
        if len(SELL_CARDS) > 200:
            SELL_CARDS.pop(0)
        
        return jsonify(order)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/trade/buy', methods=['POST'])
def api_trade_buy():
    """Execute buy order"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"ok": False, "error": "No data"}), 400
        
        market = data.get('market', 'KRW-BTC')
        amount_krw = float(data.get('amount_krw', 0))
        paper = data.get('paper', True)
        
        if amount_krw <= 0:
            return jsonify({"ok": False, "error": "Invalid amount"}), 400
        
        price = get_current_price(market)
        amount = amount_krw / price if price > 0 else 0
        
        meta = data.get('meta', {}) if isinstance(data.get('meta', {}), dict) else {}
        nb_price_max = data.get('nb_price_max', meta.get('nb_price_max'))
        nb_price_min = data.get('nb_price_min', meta.get('nb_price_min'))
        nb_price = data.get('nb_price', meta.get('nb_price'))
        nb_price_values = data.get('nb_price_values', meta.get('nb_price_values'))
        nb_volume_max = data.get('nb_volume_max', meta.get('nb_volume_max'))
        nb_volume_min = data.get('nb_volume_min', meta.get('nb_volume_min'))
        nb_volume_values = data.get('nb_volume_values', meta.get('nb_volume_values'))
        nb_turnover_max = data.get('nb_turnover_max', meta.get('nb_turnover_max'))
        nb_turnover_min = data.get('nb_turnover_min', meta.get('nb_turnover_min'))
        nb_turnover_values = data.get('nb_turnover_values', meta.get('nb_turnover_values'))
        nb_zone = data.get('nb_zone', meta.get('nb_zone'))
        nb_r_value = data.get('nb_r_value', meta.get('nb_r_value'))
        nb_w_value = data.get('nb_w_value', meta.get('nb_w_value'))
        nbverse_path = data.get('nbverse_path', meta.get('nbverse_path'))
        nbverse_interval = data.get('nbverse_interval', meta.get('nbverse_interval'))
        nbverse_timestamp = data.get('nbverse_timestamp', meta.get('nbverse_timestamp'))

        # Paper trading only for now
        order = {
            "ok": True,
            "side": "BUY",
            "market": market,
            "price": price,
            "amount": amount,
            "notional": amount_krw,
            "paper": True,
            "timestamp": int(time.time() * 1000),
            "nb_price_max": nb_price_max,
            "nb_price_min": nb_price_min,
            "nb_price": nb_price,
            "nb_price_values": nb_price_values,
            "nb_volume_max": nb_volume_max,
            "nb_volume_min": nb_volume_min,
            "nb_volume_values": nb_volume_values,
            "nb_turnover_max": nb_turnover_max,
            "nb_turnover_min": nb_turnover_min,
            "nb_turnover_values": nb_turnover_values,
            "nb_zone": nb_zone,
            "nb_r_value": nb_r_value,
            "nb_w_value": nb_w_value,
            "nbverse_path": nbverse_path,
            "nbverse_interval": nbverse_interval,
            "nbverse_timestamp": nbverse_timestamp
        }
        
        # Add to buy cards
        BUY_CARDS.append(order)
        if len(BUY_CARDS) > 200:
            BUY_CARDS.pop(0)
        
        return jsonify(order)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ==============================================
# Trust Config API Routes
# ==============================================
@app.route('/api/trust/config', methods=['GET', 'POST'])
def api_trust_config():
    """Get or update trust configuration"""
    global TRUST_CONFIG
    
    try:
        if request.method == 'POST':
            data = request.get_json()
            if data:
                if 'ml_trust' in data:
                    TRUST_CONFIG['ml_trust'] = float(data['ml_trust'])
                if 'nb_trust' in data:
                    TRUST_CONFIG['nb_trust'] = float(data['nb_trust'])
                TRUST_CONFIG['last_updated'] = int(time.time() * 1000)
            
            return jsonify({
                "ok": True,
                "config": TRUST_CONFIG
            })
        else:
            return jsonify({
                "ok": True,
                "config": TRUST_CONFIG
            })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ==============================================
# OHLCV Data Routes
# ==============================================
@app.route('/api/ohlcv', methods=['GET'])
def api_ohlcv():
    """Get OHLCV data"""
    try:
        cfg = load_config()
        market = request.args.get('market', cfg.market)
        interval = request.args.get('interval', cfg.candle)
        count = int(request.args.get('count', 300))
        
        df = get_candles(market, interval, count=count)
        
        if df is None or len(df) == 0:
            return jsonify({
                'market': market,
                'candle': interval,
                'data': [],
                'error': 'No data available'
            })
        
        # Drop any rows with NaN values BEFORE iteration
        df = df.dropna(subset=['open', 'high', 'low', 'close'])
        
        # Reset index after dropping
        df = df.reset_index()
        
        if len(df) == 0:
            return jsonify({
                'market': market,
                'candle': interval,
                'data': [],
                'error': 'No valid data after filtering NaN'
            })
        
        data = []
        for idx, row in df.iterrows():
            try:
                # Get timestamp - handle both datetime index and column
                if 'index' in row:
                    ts = row['index']
                elif hasattr(row.name, 'timestamp'):
                    ts = row.name
                else:
                    continue
                
                # Ensure all values are valid floats
                open_val = float(row['open'])
                high_val = float(row['high'])
                low_val = float(row['low'])
                close_val = float(row['close'])
                volume_val = float(row['volume']) if 'volume' in row else 0.0
                
                # Double-check for NaN (in case dropna missed something)
                if not all(np.isfinite([open_val, high_val, low_val, close_val])):
                    continue
                
                # Skip if any price value is <= 0
                if any(v <= 0 for v in [open_val, high_val, low_val, close_val]):
                    continue
                
                # Ensure high >= low (fix if reversed)
                if high_val < low_val:
                    high_val, low_val = low_val, high_val
                
                # Ensure open and close are within high/low range
                open_val = max(low_val, min(high_val, open_val))
                close_val = max(low_val, min(high_val, close_val))
                
                # Convert timestamp to milliseconds
                if hasattr(ts, 'timestamp'):
                    time_ms = int(ts.timestamp() * 1000)
                else:
                    time_ms = int(pd.Timestamp(ts).timestamp() * 1000)
                
                # Round values and ensure they're not None
                rounded_open = round(open_val, 2)
                rounded_high = round(high_val, 2)
                rounded_low = round(low_val, 2)
                rounded_close = round(close_val, 2)
                rounded_volume = round(volume_val, 8)
                
                # Final check - ensure no None/NaN in rounded values
                if any(x is None or (isinstance(x, float) and not np.isfinite(x)) for x in [rounded_open, rounded_high, rounded_low, rounded_close]):
                    continue
                
                data.append({
                    'time': time_ms,
                    'open': rounded_open,
                    'high': rounded_high,
                    'low': rounded_low,
                    'close': rounded_close,
                    'volume': rounded_volume
                })
            except (ValueError, TypeError, KeyError, AttributeError) as e:
                # Skip invalid rows
                continue
        
        # Ensure we have data
        if not data:
            return jsonify({
                'market': market,
                'candle': interval,
                'data': [],
                'error': 'No valid data after filtering'
            })
        
        # Final sanitization: convert to JSON and back to catch any edge cases
        # This ensures no NaN/Infinity values slip through
        data_json = json.loads(json.dumps(data, allow_nan=False))
        
        return jsonify({
            'market': market,
            'candle': interval,
            'data': data_json,
            'count': len(data_json)
        })
    except Exception as e:
        return jsonify({
            'error': str(e),
            'market': request.args.get('market', 'KRW-BTC'),
            'candle': request.args.get('interval', 'minute10'),
            'data': []
        }), 500

# ==============================================
# State Routes
# ==============================================
@app.route('/api/state', methods=['GET'])
def api_state():
    """Get current state"""
    try:
        cfg = load_config()
        
        return jsonify({
            "price": state.get("price", 0.0),
            "signal": state.get("signal", "HOLD"),
            "market": cfg.market,
            "candle": cfg.candle,
            "history": list(state.get("history", []))
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==============================================
# Orders Routes
# ==============================================
@app.route('/api/orders', methods=['GET'])
def api_orders():
    """Get order history"""
    try:
        return jsonify({
            'ok': True,
            'market': state.get('market', 'KRW-BTC'),
            'data': list(orders)
        })
    except Exception as e:
        return jsonify({'error': str(e), 'data': []}), 500

@app.route('/api/orders/clear', methods=['POST'])
def api_orders_clear():
    """Clear order history"""
    try:
        orders.clear()
        return jsonify({"ok": True, "message": "Orders cleared"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ==============================================
# Balance Route
# ==============================================
@app.route('/api/balance', methods=['GET'])
def api_balance():
    """Get balance information"""
    try:
        cfg = load_config()
        
        # Paper trading mode
        if cfg.paper or not cfg.access_key or not cfg.secret_key:
            return jsonify({
                "ok": True,
                "paper": True,
                "krw": 1000000.0,
                "btc": 0.0,
                "total_krw": 1000000.0
            })
        
        # Real trading mode
        try:
            upbit = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
            krw = float(upbit.get_balance('KRW') or 0.0)
            btc = float(upbit.get_balance('BTC') or 0.0)
            btc_price = get_current_price('KRW-BTC')
            total_krw = krw + (btc * btc_price)
            
            return jsonify({
                "ok": True,
                "paper": False,
                "krw": krw,
                "btc": btc,
                "btc_price": btc_price,
                "total_krw": total_krw
            })
        except Exception as e:
            return jsonify({
                "ok": False,
                "error": f"Failed to get balance: {str(e)}"
            }), 500
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ==============================================
# Bot Control Routes
# ==============================================
@app.route('/api/bot/config', methods=['GET', 'POST'])
def api_bot_config():
    """Get or update bot configuration"""
    global BOT_CONTROL
    
    try:
        if request.method == 'POST':
            data = request.get_json()
            if data:
                BOT_CONTROL.update(data)
            
            return jsonify({
                "ok": True,
                "config": BOT_CONTROL
            })
        else:
            return jsonify({
                "ok": True,
                "config": BOT_CONTROL
            })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/bot/status', methods=['GET'])
def api_bot_status():
    """Get bot status"""
    try:
        return jsonify({
            "ok": True,
            "running": BOT_CONTROL.get("running", False),
            "paper": BOT_CONTROL.get("paper", True),
            "market": BOT_CONTROL.get("market", "KRW-BTC"),
            "interval": BOT_CONTROL.get("interval", "minute10"),
            "last_signal": BOT_CONTROL.get("last_signal", "HOLD")
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/bot/start', methods=['POST'])
def api_bot_start():
    """Start bot"""
    global BOT_CONTROL
    
    try:
        BOT_CONTROL["running"] = True
        return jsonify({
            "ok": True,
            "message": "Bot started (paper mode only)",
            "running": True
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/bot/stop', methods=['POST'])
def api_bot_stop():
    """Stop bot"""
    global BOT_CONTROL
    
    try:
        BOT_CONTROL["running"] = False
        return jsonify({
            "ok": True,
            "message": "Bot stopped",
            "running": False
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ==============================================
# NB Params Routes
# ==============================================
@app.route('/api/nb/params', methods=['GET', 'POST'])
def api_nb_params():
    """Get or update NB parameters"""
    global NB_PARAMS
    
    try:
        if request.method == 'POST':
            data = request.get_json()
            if data:
                NB_PARAMS.update(data)
                NB_PARAMS['updated_at'] = int(time.time() * 1000)
            
            return jsonify({
                "ok": True,
                "params": NB_PARAMS
            })
        else:
            return jsonify({
                "ok": True,
                "params": NB_PARAMS
            })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ==============================================
# Village Card System Routes
# ==============================================
@app.route('/api/village/card-system/status', methods=['GET'])
def api_village_card_status():
    """Get village card system status"""
    try:
        # Build members response with full structure
        members_data = {}
        for member_name, member in VILLAGE_RESIDENTS.items():
            card_system = member.get("cardSystem", {})
            members_data[member_name] = {
                "memberName": member.get("name", member_name),
                "role": member.get("role", "Unknown"),
                "location": member.get("location", "Unknown"),
                "assignedTimeframes": member.get("assignedTimeframes", []),
                "specialty": member.get("specialty", ""),
                "description": member.get("description", ""),
                "strategy": member.get("strategy", ""),
                "skillLevel": member.get("skillLevel", 1.0),
                "activeCards": len(card_system.get("activeCards", [])),
                "completedCards": len(card_system.get("completedCards", [])),
                "failedCards": len(card_system.get("failedCards", [])),
                "totalCardsAnalyzed": card_system.get("totalCardsAnalyzed", 0),
                "successfulCards": card_system.get("successfulCards", 0),
                "analysisSuccessRate": card_system.get("analysisSuccessRate", 0.0),
                "averageProfit": card_system.get("averageProfit", 0.0),
                "totalProfit": card_system.get("totalProfit", 0.0),
                "currentAnalysis": None
            }
        
        return jsonify({
            "ok": True,
            "totalCards": 25,
            "activeCards": len(CARD_SYSTEM.get("activeCards", {})),
            "completedCards": len(CARD_SYSTEM.get("completedCards", {})),
            "failedCards": len(CARD_SYSTEM.get("failedCards", {})),
            "removedCards": 0,
            "cardCounter": 0,
            "lastUpdate": None,
            "activeCardsList": [],
            "stateCounts": {},
            "actionCounts": {},
            "members": members_data
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/village/update-current-interval', methods=['POST'])
def api_village_update_interval():
    """Update current interval for village system"""
    try:
        data = request.get_json()
        if data and 'interval' in data:
            BOT_CONTROL['interval'] = data['interval']
        
        return jsonify({
            "ok": True,
            "interval": BOT_CONTROL.get('interval', 'minute10')
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ==============================================
# NBverse Search Route
# ==============================================
@app.route('/api/nbverse/search', methods=['GET'])
def api_nbverse_search():
    """Search NBverse cards with flexible criteria
    
    Query params:
    - type: 'max' or 'min' (default: both)
    - interval: 'minute1', 'minute3', etc. (filter by interval)
    - price_min: minimum nb.price.max or nb.price.min value
    - price_max: maximum nb.price.max or nb.price.min value
    - current_price_min: minimum current_price
    - current_price_max: maximum current_price
    - limit: max results (default: 100, max: 500)
    - offset: skip results (default: 0)
    - sort: 'timestamp' or 'price' or 'nb_price' (default: timestamp)
    - order: 'asc' or 'desc' (default: desc)
    """
    try:
        # Parse query params
        nb_type = request.args.get('type', None)  # 'max', 'min', or None (both)
        interval_filter = request.args.get('interval', None)
        price_min = request.args.get('price_min', type=float)
        price_max = request.args.get('price_max', type=float)
        current_price_min = request.args.get('current_price_min', type=float)
        current_price_max = request.args.get('current_price_max', type=float)
        limit = min(int(request.args.get('limit', 100)), 500)
        offset = int(request.args.get('offset', 0))
        sort_by = request.args.get('sort', 'timestamp')
        order = request.args.get('order', 'desc')
        
        # Determine types to search
        types_to_search = []
        if nb_type == 'max':
            types_to_search = ['max']
        elif nb_type == 'min':
            types_to_search = ['min']
        else:
            types_to_search = ['max', 'min']
        
        results = []
        nbverse_base = os.path.join(os.getcwd(), 'data', 'nbverse')
        
        # Walk through NBverse directories
        for nb_type_dir in types_to_search:
            type_path = os.path.join(nbverse_base, nb_type_dir)
            if not os.path.exists(type_path):
                continue
            
            # Walk recursively through all subdirectories
            for root, dirs, files in os.walk(type_path):
                for file in files:
                    if file != 'this_pocket_card.json':
                        continue
                    
                    card_path = os.path.join(root, file)
                    
                    try:
                        with open(card_path, 'r', encoding='utf-8') as f:
                            card = json.load(f)
                        
                        # Extract path relative to nbverse base
                        rel_path = os.path.relpath(card_path, nbverse_base)
                        rel_path = rel_path.replace('\\', '/')
                        
                        # Apply filters
                        # Interval filter
                        if interval_filter and card.get('interval') != interval_filter:
                            continue
                        
                        # Price filters (nb.price.max or nb.price.min)
                        nb_price = card.get('nb', {}).get('price', {})
                        if nb_type_dir == 'max':
                            nb_price_val = nb_price.get('max')
                        else:
                            nb_price_val = nb_price.get('min')
                        
                        if price_min is not None and (nb_price_val is None or nb_price_val < price_min):
                            continue
                        if price_max is not None and (nb_price_val is None or nb_price_val > price_max):
                            continue
                        
                        # Current price filters
                        current_price = card.get('current_price')
                        if current_price_min is not None and (current_price is None or current_price < current_price_min):
                            continue
                        if current_price_max is not None and (current_price is None or current_price > current_price_max):
                            continue
                        
                        # Build result
                        result = {
                            "type": nb_type_dir,
                            "path": rel_path,
                            "interval": card.get('interval'),
                            "timestamp": card.get('timestamp'),
                            "saved_at": card.get('saved_at'),
                            "current_price": current_price,
                            "current_volume": card.get('current_volume'),
                            "nb_price": nb_price_val,
                            "nb_price_max": nb_price.get('max'),
                            "nb_price_min": nb_price.get('min')
                        }
                        
                        results.append(result)
                    
                    except Exception as e:
                        # Skip corrupted files
                        continue
        
        # Sort results
        if sort_by == 'timestamp':
            results.sort(key=lambda x: x.get('timestamp', ''), reverse=(order == 'desc'))
        elif sort_by == 'price':
            results.sort(key=lambda x: x.get('current_price') or 0, reverse=(order == 'desc'))
        elif sort_by == 'nb_price':
            results.sort(key=lambda x: x.get('nb_price') or 0, reverse=(order == 'desc'))
        
        # Apply pagination
        total = len(results)
        paginated = results[offset:offset + limit]
        
        return jsonify({
            "ok": True,
            "results": paginated,
            "total": total,
            "limit": limit,
            "offset": offset,
            "returned": len(paginated)
        })
    
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e)
        }), 500

# ==============================================
# Container State Routes
# ==============================================
@app.route('/api/container-state/save-zone-segments', methods=['POST'])
def api_save_zone_segments():
    """Save zone segments state"""
    global ZONE_SEGMENTS
    
    try:
        data = request.get_json()
        if data:
            interval = data.get('interval', 'minute10')
            segments = data.get('segments', [])
            ZONE_SEGMENTS[interval] = segments
        
        return jsonify({
            "ok": True,
            "message": "Zone segments saved"
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ==============================================
# Trade Preflight Route
# ==============================================
@app.route('/api/trade/preflight', methods=['GET'])
def api_trade_preflight():
    """Trade preflight check"""
    try:
        cfg = load_config()
        market = request.args.get('market', cfg.market)
        
        price = get_current_price(market)
        
        return jsonify({
            "ok": True,
            "market": market,
            "price": price,
            "paper": BOT_CONTROL.get("paper", True),
            "can_trade": True
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ==============================================
# Stream Route (SSE)
# ==============================================
@app.route('/api/stream')
def api_stream():
    """Server-Sent Events stream for real-time updates"""
    def generate():
        try:
            while True:
                try:
                    # Send heartbeat every 2 seconds
                    price = get_current_price(BOT_CONTROL.get("market", "KRW-BTC"))
                    
                    # Ensure price is valid
                    if price is None or not np.isfinite(price) or price <= 0:
                        price = 0.0
                    
                    data = {
                        "timestamp": int(time.time() * 1000),
                        "price": round(float(price), 2),
                        "signal": BOT_CONTROL.get("last_signal", "HOLD")
                    }
                    yield f"data: {json.dumps(data)}\n\n"
                    time.sleep(2)
                except Exception as e:
                    # Log error but continue streaming
                    error_data = {
                        "timestamp": int(time.time() * 1000),
                        "error": str(e),
                        "signal": "ERROR"
                    }
                    yield f"data: {json.dumps(error_data)}\n\n"
                    time.sleep(2)
        except GeneratorExit:
            pass
    
    return app.response_class(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    )

# ==============================================
# Health Check
# ==============================================
@app.route('/api/health', methods=['GET'])
def api_health():
    """Health check endpoint"""
    return jsonify({
        "ok": True,
        "status": "running",
        "timestamp": int(time.time() * 1000)
    })

# ==============================================
# Error Handlers
# ==============================================
@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500

# ==============================================
# Main Entry Point
# ==============================================
if __name__ == '__main__':
    print("=" * 50)
    print("8BIT Bot API Server - Simple Version")
    print("=" * 50)
    print(f"Starting server...")
    print(f"Frontend: http://localhost:5100/")
    print(f"API: http://localhost:5100/api/")
    print("=" * 50)
    
    app.run(
        host='0.0.0.0',
        port=5100,
        debug=True,
        threaded=True
    )
