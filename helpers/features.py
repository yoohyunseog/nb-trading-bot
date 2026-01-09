"""Feature engineering for ML training"""
import os
import numpy as np
import pandas as pd
from helpers.candles import compute_r_from_ohlcv


def build_features(df: pd.DataFrame, window: int, ema_fast: int = 10, ema_slow: int = 30, horizon: int = 5) -> pd.DataFrame:
    """
    Build ML features from OHLCV data with zone-aware context
    
    Args:
        df: DataFrame with OHLCV data
        window: Window size for N/B calculations
        ema_fast: Fast EMA period
        ema_slow: Slow EMA period
        horizon: Forward-looking horizon for labels
        
    Returns:
        DataFrame with engineered features
    """
    out = pd.DataFrame(index=df.index)
    out['close'] = pd.to_numeric(df['close'], errors='coerce')
    out['high'] = pd.to_numeric(df['high'], errors='coerce')
    out['low'] = pd.to_numeric(df['low'], errors='coerce')
    
    # NB r-value
    r = compute_r_from_ohlcv(df, window)
    out['r'] = r
    out['w'] = (out['high'].rolling(window).max() - out['low'].rolling(window).min()) / ((out['high'] + out['low'])/2).replace(0, np.nan)
    
    # EMA features
    out['ema_f'] = out['close'].ewm(span=ema_fast, adjust=False).mean()
    out['ema_s'] = out['close'].ewm(span=ema_slow, adjust=False).mean()
    out['ema_diff'] = out['ema_f'] - out['ema_s']
    
    # r smoothed and slopes
    out['r_ema3'] = out['r'].ewm(span=3, adjust=False).mean()
    out['r_ema5'] = out['r'].ewm(span=5, adjust=False).mean()
    out['dr'] = out['r'].diff()
    out['ret1'] = out['close'].pct_change(1)
    out['ret3'] = out['close'].pct_change(3)
    out['ret5'] = out['close'].pct_change(5)
    
    # Zone thresholds
    try:
        HIGH = float(os.getenv('NB_HIGH', '0.55'))
        LOW = float(os.getenv('NB_LOW', '0.45'))
    except Exception:
        HIGH, LOW = 0.55, 0.45
    rng = max(1e-9, HIGH - LOW)
    
    # Zone-aware features
    zone_features = _compute_zone_features(r, out['close'], window, HIGH, LOW, rng)
    for key, values in zone_features.items():
        out[key] = pd.Series(values, index=out.index)
    
    # Time-of-day and weekly cycle features
    try:
        idx = out.index
        hours = pd.Index(getattr(idx, 'hour', pd.Series(idx).map(lambda x: getattr(x, 'hour', 0))))
        minutes = pd.Index(getattr(idx, 'minute', pd.Series(idx).map(lambda x: getattr(x, 'minute', 0))))
        tod_min = (hours.astype(int) * 60 + minutes.astype(int)).astype(float)
        out['tod_sin'] = np.sin(2 * np.pi * tod_min / (24*60))
        out['tod_cos'] = np.cos(2 * np.pi * tod_min / (24*60))
        
        dows = pd.Index(getattr(idx, 'dayofweek', pd.Series(idx).map(lambda x: getattr(x, 'dayofweek', 0)))).astype(float)
        out['dow_sin'] = np.sin(2 * np.pi * dows / 7.0)
        out['dow_cos'] = np.cos(2 * np.pi * dows / 7.0)
        
        h = hours.astype(int)
        out['sess_asia'] = ((h>=9) & (h<17)).astype(int)
        out['sess_eu'] = ((h>=16) | (h<0)).astype(int)
        out['sess_us'] = ((h>=22) | (h<6)).astype(int)
    except Exception:
        pass
    
    # forward return for labeling
    out['fwd'] = out['close'].shift(-horizon) / out['close'] - 1.0
    return out


def _compute_zone_features(r: pd.Series, close: pd.Series, window: int, HIGH: float, LOW: float, rng: float) -> dict:
    """Compute zone-aware features (BLUE/ORANGE extrema tracking)"""
    zone_flag = []
    dist_high = []
    dist_low = []
    extreme_gap = []
    zone_conf = []
    zone_min_r_list = []
    zone_max_r_list = []
    zone_min_price_list = []
    zone_max_price_list = []
    zone_extreme_r_list = []
    zone_extreme_price_list = []
    zone_extreme_age_list = []
    
    cur_zone = None
    cur_zone_min_r = None
    cur_zone_max_r = None
    cur_zone_min_idx = None
    cur_zone_max_idx = None
    cur_extreme_idx = None
    zone_start_idx = 0
    zmin_prev = None
    zmax_prev = None
    
    zmin_slope_list = []
    zmax_slope_list = []
    zone_len_list = []
    zone_pos_list = []
    prev_blue_min_completed = None
    prev_orange_max_completed = None
    zmin_vs_prev_list = []
    zmax_vs_prev_list = []
    blue_min_last_list = []
    orange_max_last_list = []
    blue_min_cur_list = []
    orange_max_cur_list = []
    
    close_vals = close.astype(float).fillna(method='bfill').fillna(method='ffill').fillna(0.0).values.tolist()
    r_vals = r.fillna(0.5).astype(float).values.tolist()
    
    for i, rv in enumerate(r_vals):
        # Initialize zone
        if cur_zone not in ('BLUE','ORANGE'):
            cur_zone = 'ORANGE' if rv >= 0.5 else 'BLUE'
            cur_zone_min_r = rv
            cur_zone_max_r = rv
            cur_zone_min_idx = i
            cur_zone_max_idx = i
            cur_extreme_idx = i
            zone_start_idx = i
        
        # Zone transitions
        if cur_zone == 'BLUE' and rv >= HIGH:
            try:
                prev_blue_min_completed = float(cur_zone_min_r if cur_zone_min_r is not None else rv)
            except Exception:
                prev_blue_min_completed = float(rv)
            cur_zone = 'ORANGE'
            cur_zone_min_r = rv
            cur_zone_max_r = rv
            cur_zone_min_idx = i
            cur_zone_max_idx = i
            cur_extreme_idx = i
            zone_start_idx = i
        elif cur_zone == 'ORANGE' and rv <= LOW:
            try:
                prev_orange_max_completed = float(cur_zone_max_r if cur_zone_max_r is not None else rv)
            except Exception:
                prev_orange_max_completed = float(rv)
            cur_zone = 'BLUE'
            cur_zone_min_r = rv
            cur_zone_max_r = rv
            cur_zone_min_idx = i
            cur_zone_max_idx = i
            cur_extreme_idx = i
            zone_start_idx = i
        
        # Track extrema
        cur_zone_min_r = rv if cur_zone_min_r is None else min(cur_zone_min_r, rv)
        cur_zone_max_r = rv if cur_zone_max_r is None else max(cur_zone_max_r, rv)
        if cur_zone_min_r == rv:
            cur_zone_min_idx = i
        if cur_zone_max_r == rv:
            cur_zone_max_idx = i
        
        if cur_zone == 'BLUE':
            cur_extreme_idx = cur_zone_min_idx if cur_zone_min_idx is not None else i
            zone_flag.append(1)
            zone_conf.append(max(0.0, (HIGH - rv) / rng))
        else:
            cur_extreme_idx = cur_zone_max_idx if cur_zone_max_idx is not None else i
            zone_flag.append(-1)
            zone_conf.append(max(0.0, (rv - LOW) / rng))
        
        dist_high.append(max(0.0, rv - HIGH))
        dist_low.append(max(0.0, LOW - rv))
        
        cur_extreme_r = (cur_zone_min_r if cur_zone == 'BLUE' else cur_zone_max_r)
        extreme_gap.append(abs(rv - float(cur_extreme_r)))
        
        # Slopes
        try:
            zmin_slope = (0.0 if zmin_prev is None else float(cur_zone_min_r) - float(zmin_prev))
        except Exception:
            zmin_slope = 0.0
        try:
            zmax_slope = (0.0 if zmax_prev is None else float(cur_zone_max_r) - float(zmax_prev))
        except Exception:
            zmax_slope = 0.0
        zmin_prev = float(cur_zone_min_r if cur_zone_min_r is not None else rv)
        zmax_prev = float(cur_zone_max_r if cur_zone_max_r is not None else rv)
        zmin_slope_list.append(zmin_slope)
        zmax_slope_list.append(zmax_slope)
        
        # Zone length and position
        try:
            zone_len_list.append(int(i - zone_start_idx))
        except Exception:
            zone_len_list.append(0)
        
        try:
            win_start = max(0, i - window + 1)
            z_start = max(zone_start_idx, win_start)
            z_end = i
            denom = max(1, (i - win_start))
            zone_mid = (z_start + z_end) / 2.0
            zone_pos = (zone_mid - win_start) / denom
            if not np.isfinite(zone_pos): zone_pos = 0.5
        except Exception:
            zone_pos = 0.5
        zone_pos_list.append(float(max(0.0, min(1.0, zone_pos))))
        
        # Compare current vs previous extrema
        if cur_zone == 'BLUE':
            try:
                zmin_vs_prev = (float(cur_zone_min_r) - float(prev_blue_min_completed)) if prev_blue_min_completed is not None else 0.0
            except Exception:
                zmin_vs_prev = 0.0
            zmax_vs_prev = 0.0
        else:
            try:
                zmax_vs_prev = (float(cur_zone_max_r) - float(prev_orange_max_completed)) if prev_orange_max_completed is not None else 0.0
            except Exception:
                zmax_vs_prev = 0.0
            zmin_vs_prev = 0.0
        zmin_vs_prev_list.append(zmin_vs_prev)
        zmax_vs_prev_list.append(zmax_vs_prev)
        
        # Track both BLUE and ORANGE extrema
        try:
            blue_min_last = float(prev_blue_min_completed) if prev_blue_min_completed is not None else float(zmin_prev)
        except Exception:
            blue_min_last = float(rv)
        try:
            orange_max_last = float(prev_orange_max_completed) if prev_orange_max_completed is not None else float(zmax_prev)
        except Exception:
            orange_max_last = float(rv)
        blue_min_last_list.append(blue_min_last)
        orange_max_last_list.append(orange_max_last)
        
        try:
            blue_min_cur = float(cur_zone_min_r) if cur_zone == 'BLUE' and cur_zone_min_r is not None else blue_min_last
        except Exception:
            blue_min_cur = blue_min_last
        try:
            orange_max_cur = float(cur_zone_max_r) if cur_zone == 'ORANGE' and cur_zone_max_r is not None else orange_max_last
        except Exception:
            orange_max_cur = orange_max_last
        blue_min_cur_list.append(blue_min_cur)
        orange_max_cur_list.append(orange_max_cur)
        
        # Zone-wide extrema and prices
        zone_min_r_list.append(float(cur_zone_min_r if cur_zone_min_r is not None else rv))
        zone_max_r_list.append(float(cur_zone_max_r if cur_zone_max_r is not None else rv))
        zmin_px = float(close_vals[cur_zone_min_idx]) if cur_zone_min_idx is not None else float(close_vals[i])
        zmax_px = float(close_vals[cur_zone_max_idx]) if cur_zone_max_idx is not None else float(close_vals[i])
        zone_min_price_list.append(zmin_px)
        zone_max_price_list.append(zmax_px)
        zone_extreme_r_list.append(float(cur_extreme_r))
        zext_px = float(close_vals[cur_extreme_idx]) if cur_extreme_idx is not None else float(close_vals[i])
        zone_extreme_price_list.append(zext_px)
        zone_extreme_age_list.append(int(i - (cur_extreme_idx if cur_extreme_idx is not None else i)))
    
    return {
        'zone_flag': zone_flag,
        'dist_high': dist_high,
        'dist_low': dist_low,
        'extreme_gap': extreme_gap,
        'zone_conf': zone_conf,
        'zone_min_r': zone_min_r_list,
        'zone_max_r': zone_max_r_list,
        'zone_min_price': zone_min_price_list,
        'zone_max_price': zone_max_price_list,
        'zone_extreme_r': zone_extreme_r_list,
        'zone_extreme_price': zone_extreme_price_list,
        'zone_extreme_age': zone_extreme_age_list,
        'zmin_slope': zmin_slope_list,
        'zmax_slope': zmax_slope_list,
        'zone_len': zone_len_list,
        'zone_pos': zone_pos_list,
        'zmin_vs_prev': zmin_vs_prev_list,
        'zmax_vs_prev': zmax_vs_prev_list,
        'blue_min_last': blue_min_last_list,
        'orange_max_last': orange_max_last_list,
        'blue_min_cur': blue_min_cur_list,
        'orange_max_cur': orange_max_cur_list
    }


def BIT_MAX_NB(nb_values, rng_seed=5.5):
    """Calculate BIT MAX N/B value from a list of N/B values using seed-based algorithm.
    
    Args:
        nb_values: List of computed N/B values (price changes in percent)
        rng_seed: Random seed based on window size (5.5 + window%95 * 0.5)
    
    Returns:
        MAX N/B value as float (0-100 scale)
    """
    if not nb_values or len(nb_values) == 0:
        return 50.0
    
    try:
        # Convert to numpy array
        nb_arr = np.array(nb_values, dtype=float)
        
        # 고정된 알고리즘: 마지막 값부터 역순으로 가중 합계 계산
        weights = np.array([1.0 / (i+1) for i in range(len(nb_arr))], dtype=float)
        weights = weights / weights.sum()  # 정규화
        
        # 역순 가중합
        weighted_sum = np.sum(nb_arr[::-1] * weights)
        
        # 최댓값과 평균값 혼합
        max_val = np.max(nb_arr)
        mean_val = np.mean(nb_arr)
        
        # 결과 계산 (최댓값 60% + 가중합 40%)
        result = (max_val * 0.6 + weighted_sum * 0.4)
        
        # 0-100 스케일로 변환
        scaled = 50 + result * 10  # -5% ~ +5% 변화를 0~100으로 매핑
        
        return float(max(0.0, min(100.0, scaled)))
        
    except Exception:
        return float(50.0 + np.max(nb_values) * 10 if len(nb_values) > 0 else 50.0)


def BIT_MIN_NB(nb_values, rng_seed=5.5):
    """Calculate BIT MIN N/B value from a list of N/B values using seed-based algorithm.
    
    Args:
        nb_values: List of computed N/B values (price changes in percent)
        rng_seed: Random seed based on window size (5.5 + window%95 * 0.5)
    
    Returns:
        MIN N/B value as float (0-100 scale)
    """
    if not nb_values or len(nb_values) == 0:
        return 50.0
    
    try:
        # Convert to numpy array
        nb_arr = np.array(nb_values, dtype=float)
        
        # 고정된 알고리즘: 최솟값과 평균값 혼합
        min_val = np.min(nb_arr)
        mean_val = np.mean(nb_arr)
        
        # 최솟값과 평균값의 혼합 (최솟값 40% + 평균 60%)
        result = (min_val * 0.4 + mean_val * 0.6)
        
        # 0-100 스케일로 변환
        scaled = 50 + result * 10  # -5% ~ +5% 변화를 0~100으로 매핑
        
        return float(max(0.0, min(100.0, scaled)))
        
    except Exception:
        return float(50.0 + np.min(nb_values) * 10 if len(nb_values) > 0 else 50.0)
