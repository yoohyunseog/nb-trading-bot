"""ML helper functions for model loading and insight generation."""

import os
import time
import joblib
import numpy as np
import pandas as pd


def load_ml_model(model_path_func, ensure_models_dir_func, state_dict, load_config_func, ml_model_path_fallback):
    """Load ML model from disk."""
    ensure_models_dir_func()
    try:
        path = model_path_func(state_dict.get('candle') or load_config_func().candle)
    except Exception:
        path = ml_model_path_fallback
    if os.path.exists(path):
        return joblib.load(path)
    # Backward compatibility fallback
    if os.path.exists(ml_model_path_fallback):
        return joblib.load(ml_model_path_fallback)
    return None


def make_insight(df, window, ema_fast, ema_slow, interval, pack, build_features_func, compute_r_func, record_observation_func):
    """Generate insight from dataframe."""
    try:
        feat = build_features_func(df, window, ema_fast, ema_slow, 5).dropna().copy()
        if feat.empty:
            return {}
        last = feat.iloc[-1]
        zone_flag = int(round(float(last.get('zone_flag', 0))))
        zone = 'BLUE' if zone_flag == 1 else ('ORANGE' if zone_flag == -1 else 'UNKNOWN')
        try:
            HIGH = float(os.getenv('NB_HIGH', '0.55'))
            LOW = float(os.getenv('NB_LOW', '0.45'))
        except Exception:
            HIGH, LOW = 0.55, 0.45
        rng = max(1e-9, HIGH - LOW)
        rv = float(last.get('r', 0.5))
        p_blue_raw = max(0.0, min(1.0, (HIGH - rv) / rng))
        p_orange_raw = max(0.0, min(1.0, (rv - LOW) / rng))
        s0 = p_blue_raw + p_orange_raw
        if s0 > 0:
            p_blue_raw, p_orange_raw = p_blue_raw/s0, p_orange_raw/s0
        # Trend weighting
        try:
            trend_k = int(os.getenv('NB_TREND_K', '30'))
            trend_alpha = float(os.getenv('NB_TREND_ALPHA', '0.5'))
        except Exception:
            trend_k, trend_alpha = 30, 0.5
        p_blue, p_orange = p_blue_raw, p_orange_raw
        try:
            r_series = compute_r_func(df, window).astype(float)
            if len(r_series) >= trend_k*2:
                tail_now = r_series.iloc[-trend_k:]
                tail_prev = r_series.iloc[-trend_k*2:-trend_k]
                zmax_now, zmax_prev = float(tail_now.max()), float(tail_prev.max())
                zmin_now, zmin_prev = float(tail_now.min()), float(tail_prev.min())
                trend_orange = max(0.0, (zmax_prev - zmax_now) / rng)
                trend_blue = max(0.0, (zmin_now - zmin_prev) / rng)
                p_orange = max(0.0, min(1.0, p_orange_raw * (1.0 - trend_alpha * trend_orange)))
                p_blue = max(0.0, min(1.0, p_blue_raw * (1.0 - trend_alpha * trend_blue)))
                s = p_blue + p_orange
                if s > 0:
                    p_blue, p_orange = p_blue/s, p_orange/s
        except Exception:
            pass
        ins = {
            'r': rv,
            'zone_flag': zone_flag,
            'zone': zone,
            'zone_conf': float(last.get('zone_conf', 0.0)),
            'dist_high': float(last.get('dist_high', 0.0)),
            'dist_low': float(last.get('dist_low', 0.0)),
            'extreme_gap': float(last.get('extreme_gap', 0.0)),
            'zone_min_r': float(last.get('zone_min_r', rv)),
            'zone_max_r': float(last.get('zone_max_r', rv)),
            'zone_extreme_r': float(last.get('zone_extreme_r', rv)),
            'zone_extreme_age': int(last.get('zone_extreme_age', 0)),
            'zone_min_price': float(last.get('zone_min_price', last.get('close', 0.0))),
            'zone_max_price': float(last.get('zone_max_price', last.get('close', 0.0))),
            'zone_extreme_price': float(last.get('zone_extreme_price', last.get('close', 0.0))),
            'w': float(last.get('w', 0.0)),
            'ema_diff': float(last.get('ema_diff', 0.0)),
            'pct_blue_raw': float(p_blue_raw*100.0),
            'pct_orange_raw': float(p_orange_raw*100.0),
            'pct_blue': float(p_blue*100.0),
            'pct_orange': float(p_orange*100.0),
        }
        # record observation bucket for grouping
        try:
            record_observation_func(interval, window, rv, ins['pct_blue'], ins['pct_orange'], int(time.time()*1000))
        except Exception:
            pass
        return ins
    except Exception:
        return {}


def simulate_pnl_from_preds(prices: pd.Series, preds: np.ndarray, fee_bps: float = 10.0) -> dict:
    """Simulate PnL from predictions."""
    pos = 0
    entry = 0.0
    pnl = 0.0
    wins = 0
    trades = 0
    for p, y in zip(prices.astype(float).values, preds.tolist()):
        if pos == 0 and y > 0:
            pos = 1
            entry = float(p)
            trades += 1
        elif pos == 1 and y < 0:
            ret = float(p) - entry
            ret -= abs(entry) * (fee_bps / 10000.0)
            ret -= abs(p) * (fee_bps / 10000.0)
            pnl += ret
            if ret > 0:
                wins += 1
            pos = 0
            entry = 0.0
    if pos == 1:
        p = float(prices.iloc[-1])
        ret = p - entry
        ret -= abs(entry) * (fee_bps / 10000.0)
        ret -= abs(p) * (fee_bps / 10000.0)
        pnl += ret
        if ret > 0:
            wins += 1
        pos = 0
    win_rate = (wins / trades * 100.0) if trades else 0.0
    return { 'pnl': float(pnl), 'trades': int(trades), 'wins': int(wins), 'win_rate': float(win_rate) }
