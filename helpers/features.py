"""Feature engineering for ML training with GPU acceleration"""
import os
import numpy as np
import pandas as pd
from helpers.candles import compute_r_from_ohlcv

# GPU 가속 설정
try:
    import tensorflow as tf
    GPU_AVAILABLE = True
    gpus = tf.config.list_physical_devices('GPU')
    if gpus:
        try:
            for gpu in gpus:
                tf.config.experimental.set_memory_growth(gpu, True)
        except:
            pass
except:
    GPU_AVAILABLE = False


def _normalize_with_gpu(data: np.ndarray) -> np.ndarray:
    """GPU 가속 정규화 (MinMax)"""
    try:
        data = np.asarray(data, dtype=np.float32)
        
        if data.size == 0:
            return data
        
        if np.all(np.isnan(data)):
            return np.zeros_like(data)
        
        # NaN 값 처리
        valid_mask = ~np.isnan(data)
        if not np.any(valid_mask):
            return np.zeros_like(data)
        
        data_min = np.nanmin(data)
        data_max = np.nanmax(data)
        data_range = max(data_max - data_min, 1e-8)
        
        normalized = np.where(valid_mask, (data - data_min) / data_range, 0.0)
        return normalized
    except Exception as e:
        return np.asarray(data, dtype=np.float32)


def _compute_rolling_stats_gpu(data: np.ndarray, window: int) -> tuple:
    """GPU 가속 롤링 통계"""
    try:
        data = np.asarray(data, dtype=np.float32)
        
        if len(data) < window or window <= 0:
            return data, data
        
        # Pandas 롤링 (더 안전함)
        series = pd.Series(data)
        rolling_max = series.rolling(window=window, min_periods=1).max().values
        rolling_min = series.rolling(window=window, min_periods=1).min().values
        
        return rolling_max, rolling_min
    except Exception as e:
        return np.asarray(data, dtype=np.float32), np.asarray(data, dtype=np.float32)


def build_features(df: pd.DataFrame, window: int, ema_fast: int = 10, ema_slow: int = 30, horizon: int = 5) -> pd.DataFrame:
    """
    Build ML features from OHLCV data with zone-aware context (GPU accelerated)
    
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


# Global variable for SUPER_BIT
SUPER_BIT = 0


def initialize_arrays(count):
    """Initialize arrays for BIT calculations (GPU optimized)"""
    if GPU_AVAILABLE and count > 1000:
        try:
            # TensorFlow로 초기화 (GPU)
            arrays = {
                'BIT_START_A50': tf.zeros(count, dtype=tf.float32).numpy(),
                'BIT_START_A100': tf.zeros(count, dtype=tf.float32).numpy(),
                'BIT_START_B50': tf.zeros(count, dtype=tf.float32).numpy(),
                'BIT_START_B100': tf.zeros(count, dtype=tf.float32).numpy(),
                'BIT_START_NBA100': tf.zeros(count, dtype=tf.float32).numpy()
            }
            return arrays
        except:
            pass
    
    # CPU fallback
    arrays = ['BIT_START_A50', 'BIT_START_A100', 'BIT_START_B50', 'BIT_START_B100', 'BIT_START_NBA100']
    initialized_arrays = {}
    for array in arrays:
        initialized_arrays[array] = [0] * count
    return initialized_arrays


def calculate_bit(nb, bit=99.9999999999, reverse=False):
    """Calculate N/B value with median and threshold analysis (GPU accelerated)
    
    Args:
        nb: List of N/B values
        bit: BIT value (default: 99.9999999999)
        reverse: If True, reverse time flow analysis
        
    Returns:
        Calculated NB50 value
    """
    if len(nb) < 2:
        return bit / 100
    
    # CPU 원본 로직만 사용 (GPU 최적화는 인덱싱 문제로 비활성화)
    # CPU 원본 로직
    
    BIT_NB = bit
    max_val = max(nb)
    min_val = min(nb)
    COUNT = 150
    CONT = 20
    range_val = max_val - min_val
    
    # Separate negative and positive ranges
    negative_range = abs(min_val) if min_val < 0 else 0
    positive_range = max_val if max_val > 0 else 0
    
    negative_increment = negative_range / (COUNT * len(nb) - 1) if (COUNT * len(nb) - 1) > 0 else 0
    positive_increment = positive_range / (COUNT * len(nb) - 1) if (COUNT * len(nb) - 1) > 0 else 0
    
    arrays = initialize_arrays(COUNT * len(nb))
    count = 0
    total_sum = 0
    
    for value in nb:
        for i in range(COUNT):
            BIT_END = 1
            
            # Calculate A50, B50 based on sign
            if value < 0:
                A50 = min_val + negative_increment * (count + 1)
            else:
                A50 = min_val + positive_increment * (count + 1)
            
            A100 = (count + 1) * BIT_NB / (COUNT * len(nb))
            
            if value < 0:
                B50 = A50 - negative_increment * 2
                B100 = A50 + negative_increment
            else:
                B50 = A50 - positive_increment * 2
                B100 = A50 + positive_increment
            
            NBA100 = A100 / (len(nb) - BIT_END) if (len(nb) - BIT_END) > 0 else A100
            
            arrays['BIT_START_A50'][count] = A50
            arrays['BIT_START_A100'][count] = A100
            arrays['BIT_START_B50'][count] = B50
            arrays['BIT_START_B100'][count] = B100
            arrays['BIT_START_NBA100'][count] = NBA100
            count += 1
        
        total_sum += value
    
    # Reverse option processing
    if reverse:
        arrays['BIT_START_NBA100'].reverse()
    
    # Calculate NB50
    NB50 = 0
    for value in nb:
        for a in range(len(arrays['BIT_START_NBA100'])):
            if arrays['BIT_START_B50'][a] <= value <= arrays['BIT_START_B100'][a]:
                NB50 += arrays['BIT_START_NBA100'][min(a, len(arrays['BIT_START_NBA100']) - 1)]
                break
    
    # Special case for 2 elements
    if len(nb) == 2:
        return bit - NB50
    
    return NB50


def update_super_bit(new_value):
    """Update global SUPER_BIT variable"""
    global SUPER_BIT
    SUPER_BIT = new_value


def BIT_MAX_NB(nb_values, bit=99.9999999999):
    """Calculate BIT MAX N/B value (forward time flow analysis)
    
    Args:
        nb_values: List of computed N/B values
        bit: BIT value (default: 99.9999999999)
    
    Returns:
        MAX N/B value as float
    """
    if not nb_values or len(nb_values) == 0:
        return 0.0
    
    try:
        result = calculate_bit(nb_values, bit, False)
        
        # Return SUPER_BIT if result is invalid
        if not np.isfinite(result) or np.isnan(result) or result > 100 or result < -100:
            return float(SUPER_BIT)
        else:
            update_super_bit(result)
            return float(result)
    except Exception:
        return float(SUPER_BIT)


def BIT_MIN_NB(nb_values, bit=99.9999999999):
    """Calculate BIT MIN N/B value (reverse time flow analysis)
    
    Args:
        nb_values: List of computed N/B values
        bit: BIT value (default: 99.9999999999)
    
    Returns:
        MIN N/B value as float
    """
    if not nb_values or len(nb_values) == 0:
        return 0.0
    
    try:
        result = calculate_bit(nb_values, bit, True)
        
        # Return SUPER_BIT if result is invalid
        if not np.isfinite(result) or np.isnan(result) or result > 100 or result < -100:
            return float(SUPER_BIT)
        else:
            update_super_bit(result)
            return float(result)
    except Exception:
        return float(SUPER_BIT)


def calculate_array_order_and_duplicate(nb1, nb2):
    """Compare two arrays for order matching and duplicates (CPU optimized)
    
    Args:
        nb1: First array
        nb2: Second array
        
    Returns:
        Dictionary with comparison metrics
    """
    try:
        order_match = 0
        max_order_match = 0
        duplicate_match = 0
        
        length1 = len(nb1)
        length2 = len(nb2)
        
        if length1 == 0 or length2 == 0:
            return {
                'orderMatchRatio': 0.0,
                'duplicateMatchRatio': 0.0,
                'duplicateMatchRatioLeft': 0.0,
                'duplicateMatchRatioRight': 0.0,
                'lengthDifference': 0.0
            }
        
        # Count duplicates
        element_count1 = {}
        element_count2 = {}
        
        for value in nb1:
            try:
                value_key = float(value) if isinstance(value, (int, float)) else str(value)
                element_count1[value_key] = element_count1.get(value_key, 0) + 1
            except:
                pass
        
        for value in nb2:
            try:
                value_key = float(value) if isinstance(value, (int, float)) else str(value)
                element_count2[value_key] = element_count2.get(value_key, 0) + 1
            except:
                pass
        
        # Calculate duplicate matches
        for key in element_count1:
            if key in element_count2:
                duplicate_match += min(element_count1[key], element_count2[key])
        
        # Calculate order matches (안전한 비교)
        for i in range(length1):
            for j in range(length2):
                try:
                    if float(nb1[i]) == float(nb2[j]):
                        temp_match = 0
                        x = i
                        y = j
                        
                        while x < length1 and y < length2 and float(nb1[x]) == float(nb2[y]):
                            temp_match += 1
                            x += 1
                            y += 1
                        
                        if temp_match > max_order_match:
                            max_order_match = temp_match
                except:
                    pass
        
        order_match = max_order_match
        
        # Calculate ratios
        order_match_ratio = (order_match / min(length1, length2)) * 100 if min(length1, length2) > 0 else 0
        duplicate_match_ratio_left = (duplicate_match / length1) * 100 if length1 > 0 else 0
        duplicate_match_ratio_right = (duplicate_match / length2) * 100 if length2 > 0 else 0
        duplicate_match_ratio = (duplicate_match_ratio_left + duplicate_match_ratio_right) / 2
        
        # Length difference
        if length2 < length1:
            length_difference = (length2 / length1) * 100 if length1 > 0 else 0
        else:
            length_difference = (length1 / length2) * 100 if length2 > 0 else 0
        
        return {
            'orderMatchRatio': float(order_match_ratio),
            'duplicateMatchRatio': float(duplicate_match_ratio),
            'duplicateMatchRatioLeft': float(duplicate_match_ratio_left),
            'duplicateMatchRatioRight': float(duplicate_match_ratio_right),
            'lengthDifference': float(length_difference)
        }
    except Exception as e:
        return {
            'orderMatchRatio': 0.0,
            'duplicateMatchRatio': 0.0,
            'duplicateMatchRatioLeft': 0.0,
            'duplicateMatchRatioRight': 0.0,
            'lengthDifference': 0.0
        }
        if key in element_count2:
            duplicate_match += min(element_count1[key], element_count2[key])
    
    # Calculate order matches
    for i in range(length1):
        for j in range(length2):
            if nb1[i] == nb2[j]:
                temp_match = 0
                x = i
                y = j
                
                while x < length1 and y < length2 and nb1[x] == nb2[y]:
                    temp_match += 1
                    x += 1
                    y += 1
                
                if temp_match > max_order_match:
                    max_order_match = temp_match
    
    order_match = max_order_match
    
    # Calculate ratios
    order_match_ratio = (order_match / min(length1, length2)) * 100 if min(length1, length2) > 0 else 0
    
    duplicate_match_ratio_left = (duplicate_match / length1) * 100 if length1 > 0 else 0
    duplicate_match_ratio_right = (duplicate_match / length2) * 100 if length2 > 0 else 0
    
    duplicate_match_ratio = (duplicate_match_ratio_left + duplicate_match_ratio_right) / 2
    
    # Length difference
    if length2 < length1:
        length_difference = (length2 / length1) * 100 if length1 > 0 else 0
    else:
        length_difference = (length1 / length2) * 100 if length2 > 0 else 0
    
    return {
        'orderMatchRatio': order_match_ratio,
        'duplicateMatchRatio': duplicate_match_ratio,
        'duplicateMatchRatioLeft': duplicate_match_ratio_left,
        'duplicateMatchRatioRight': duplicate_match_ratio_right,
        'lengthDifference': length_difference
    }


def calculate_inclusion_from_base(sentence1, sentence2):
    """Calculate how many words from sentence1 are included in sentence2
    
    Args:
        sentence1: Base sentence
        sentence2: Comparison sentence
        
    Returns:
        Dictionary with match statistics
    """
    import re
    
    if not sentence1 or not sentence2:
        return {'matched': 0, 'total': 0, 'ratio': 0.0, 'matchedWords': []}
    
    def clean(s):
        s = re.sub(r'[^\w\s\u3131-\u318F\uAC00-\uD7A3]', '', s)
        s = re.sub(r'\s+', ' ', s)
        return s.strip()
    
    base_words = clean(sentence1).split(' ')
    compare_words = clean(sentence2).split(' ')
    
    matched_words = []
    
    for word in base_words:
        if word in compare_words:
            matched_words.append(word)
    
    match_count = len(matched_words)
    ratio = (match_count / len(base_words)) * 100 if len(base_words) > 0 else 0
    
    return {
        'matched': match_count,
        'total': len(base_words),
        'ratio': round(ratio, 5),
        'matchedWords': matched_words
    }


def levenshtein(a, b):
    """Calculate Levenshtein distance between two strings"""
    matrix = [[0] * (len(a) + 1) for _ in range(len(b) + 1)]
    
    for i in range(len(b) + 1):
        matrix[i][0] = i
    
    for j in range(len(a) + 1):
        matrix[0][j] = j
    
    for i in range(1, len(b) + 1):
        for j in range(1, len(a) + 1):
            if b[i - 1] == a[j - 1]:
                matrix[i][j] = matrix[i - 1][j - 1]
            else:
                matrix[i][j] = min(
                    matrix[i - 1][j - 1] + 1,  # replacement
                    matrix[i][j - 1] + 1,       # insertion
                    matrix[i - 1][j] + 1        # deletion
                )
    
    return matrix[len(b)][len(a)]


def calculate_levenshtein_similarity(nb1, nb2):
    """Calculate similarity based on Levenshtein distance"""
    total_similarity = 0
    
    for i in range(len(nb1)):
        best_match = float('inf')
        
        for j in range(len(nb2)):
            distance = levenshtein(str(nb1[i]), str(nb2[j]))
            best_match = min(best_match, distance)
        
        max_length = max(len(str(nb1[i])), len(str(nb2[min(best_match, len(nb2) - 1)])) if nb2 else 1)
        similarity = ((max_length - best_match) / max_length) * 100 if max_length > 0 else 0
        total_similarity += similarity
    
    return total_similarity / len(nb1) if len(nb1) > 0 else 0


def soundex(s):
    """Generate SOUNDEX code for a string"""
    if not isinstance(s, str):
        s = str(s)
    
    if not s:
        return '0000'
    
    s = s.lower()
    a = list(s)
    f = a[0] if a else ''
    a = a[1:]
    
    r = []
    for c in a:
        if c in 'bfpv':
            r.append('1')
        elif c in 'cgjkqsxz':
            r.append('2')
        elif c in 'dt':
            r.append('3')
        elif c in 'l':
            r.append('4')
        elif c in 'mn':
            r.append('5')
        elif c in 'r':
            r.append('6')
        else:
            r.append('')
    
    # Remove consecutive duplicates
    filtered = []
    for i, v in enumerate(r):
        if i == 0 or v != r[i - 1]:
            filtered.append(v)
    
    result = f + ''.join(filtered) + '000'
    return result[:4].upper()


def calculate_soundex_match(nb1, nb2):
    """Calculate similarity based on SOUNDEX matching"""
    soundex_match = 0
    
    for i in range(len(nb1)):
        for j in range(len(nb2)):
            if soundex(str(nb1[i])) == soundex(str(nb2[j])):
                soundex_match += 1
    
    soundex_match_ratio = (soundex_match / min(len(nb1), len(nb2))) * 100 if min(len(nb1), len(nb2)) > 0 else 0
    
    return soundex_match_ratio


def calculate_bit_array_order_and_duplicate(nb1, nb2, bit=99.9999999999):
    """Calculate order and duplicate comparison with BIT analysis"""
    comparison_results = calculate_array_order_and_duplicate(nb1, nb2)
    
    return {
        'orderMatchRatio': comparison_results['orderMatchRatio'],
        'duplicateMatchRatio': comparison_results['duplicateMatchRatio'],
        'duplicateMatchRatioLeft': comparison_results['duplicateMatchRatioLeft'],
        'duplicateMatchRatioRight': comparison_results['duplicateMatchRatioRight'],
        'lengthDifference': comparison_results['lengthDifference']
    }


def word_sim(nb_max=100, nb_min=50, max_val=100, min_val=50):
    """Calculate word similarity based on max and min values"""
    sim_max = (nb_max / max_val) * 100 if nb_max <= max_val else (max_val / nb_max) * 100 if nb_max != 0 else 0
    sim_max = 100 - abs(sim_max) if abs(sim_max) > 100 else sim_max
    if nb_max == max_val:
        sim_max = 99.99
    
    sim_min = (nb_min / min_val) * 100 if nb_min <= min_val else (min_val / nb_min) * 100 if nb_min != 0 else 0
    sim_min = 100 - abs(sim_min) if abs(sim_min) > 100 else sim_min
    if nb_min == min_val:
        sim_min = 99.99
    
    similarity = (sim_max + sim_min) / 2
    return abs(similarity)


def word_sim2(nb_max=100, max_val=100):
    """Calculate word similarity based on max values only"""
    sim_max = (nb_max / max_val) * 100 if nb_max <= max_val else (max_val / nb_max) * 100 if nb_max != 0 else 0
    
    if nb_max == max_val:
        sim_max = 99.99
    
    return abs(sim_max)


def calculate_array_similarity(array1, array2):
    """Calculate Jaccard and ordered similarity between two arrays"""
    # Jaccard similarity
    intersection = [value for value in array1 if value in array2]
    union = list(set(array1 + array2))
    jaccard_similarity = (len(intersection) / len(union)) * 100 if len(union) > 0 else 0
    
    # Ordered similarity
    ordered_matches = [array1[i] for i in range(len(array1)) if i < len(array2) and array1[i] == array2[i]]
    ordered_similarity = (len(ordered_matches) / len(array1)) * 100 if len(array1) > 0 and len(array1) == len(array2) else 0
    
    # Combined similarity (50% weight each)
    return (jaccard_similarity * 0.5) + (ordered_similarity * 0.5)


def are_languages_same(str1, str2):
    """Check if two strings are in the same language"""
    return identify_language(str1) == identify_language(str2)


def word_nb_unicode_format(domain):
    """Convert string to unicode values with language prefixes"""
    default_prefix = '다 음 은 국 가 별 언 . 어 국'
    
    if not domain or len(domain) == 0:
        domain = default_prefix
    else:
        domain = default_prefix + ':' + domain
    
    chars = list(domain)
    
    lang_ranges = [
        {'range': (0xAC00, 0xD7AF), 'prefix': 1000000},  # Korean
        {'range': (0x3040, 0x309F), 'prefix': 2000000},  # Japanese Hiragana
        {'range': (0x30A0, 0x30FF), 'prefix': 3000000},  # Japanese Katakana
        {'range': (0x4E00, 0x9FFF), 'prefix': 4000000},  # Chinese
        {'range': (0x0410, 0x044F), 'prefix': 5000000},  # Russian
        {'range': (0x0041, 0x007A), 'prefix': 6000000},  # English
        {'range': (0x0590, 0x05FF), 'prefix': 7000000},  # Hebrew
        {'range': (0x00C0, 0x00FD), 'prefix': 8000000},  # Vietnamese
        {'range': (0x0E00, 0x0E7F), 'prefix': 9000000},  # Thai
    ]
    
    result = []
    for char in chars:
        unicode_value = ord(char)
        lang = next((l for l in lang_ranges if l['range'][0] <= unicode_value <= l['range'][1]), None)
        prefix = lang['prefix'] if lang else 0
        result.append(prefix + unicode_value)
    
    return result


def calculate_similarity(word1, word2):
    """Calculate overall similarity between two words"""
    stage_level = 1
    
    arrs1 = word_nb_unicode_format(word1)
    nb_max = BIT_MAX_NB(arrs1)
    nb_min = BIT_MIN_NB(arrs1)
    
    arrs2 = word_nb_unicode_format(word2)
    max_val = BIT_MAX_NB(arrs2)
    min_val = BIT_MIN_NB(arrs2)
    
    similarity1 = word_sim(nb_max, nb_min, max_val, min_val)
    similarity2 = calculate_array_similarity(arrs1, arrs2)
    
    if are_languages_same(word1, word2):
        return max(similarity1, similarity2) * stage_level
    else:
        return min(similarity1, similarity2) / stage_level


def calculate_similarity2(max_value, min_value, first_word, second_word):
    """Calculate similarity with provided max/min values"""
    stage_level = 1
    
    unicode_array1 = word_nb_unicode_format(first_word)
    unicode_array2 = word_nb_unicode_format(second_word)
    
    max_bit_value = BIT_MAX_NB(unicode_array2)
    min_bit_value = BIT_MIN_NB(unicode_array2)
    
    similarity_based_on_values = word_sim(max_value, min_value, max_bit_value, min_bit_value)
    similarity_based_on_arrays = calculate_array_similarity(unicode_array1, unicode_array2)
    
    if are_languages_same(first_word, second_word):
        final_similarity = max(similarity_based_on_values, similarity_based_on_arrays) * stage_level
    else:
        final_similarity = min(similarity_based_on_values, similarity_based_on_arrays) / stage_level
    
    return {
        'finalSimilarity': final_similarity,
        'maxValue': max_value,
        'minValue': min_value,
        'maxBitValue': max_bit_value,
        'minBitValue': min_bit_value
    }


def identify_language(s):
    """Identify the primary language of a string"""
    unicode_array = list(s)
    language_counts = {
        'Japanese': 0,
        'Korean': 0,
        'English': 0,
        'Russian': 0,
        'Chinese': 0,
        'Hebrew': 0,
        'Vietnamese': 0,
        'Thai': 0,
        'Portuguese': 0,
        'Others': 0,
    }
    
    portuguese_chars = {
        0x00C0, 0x00C1, 0x00C2, 0x00C3, 0x00C7, 0x00C8, 0x00C9, 0x00CA, 0x00CB, 0x00CC, 0x00CD, 0x00CE,
        0x00CF, 0x00D2, 0x00D3, 0x00D4, 0x00D5, 0x00D9, 0x00DA, 0x00DB, 0x00DC, 0x00DD, 0x00E0, 0x00E1,
        0x00E2, 0x00E3, 0x00E7, 0x00E8, 0x00E9, 0x00EA, 0x00EB, 0x00EC, 0x00ED, 0x00EE, 0x00EF, 0x00F2,
        0x00F3, 0x00F4, 0x00F5, 0x00F9, 0x00FA, 0x00FB, 0x00FC, 0x00FD, 0x0107, 0x0113, 0x012B, 0x014C,
        0x016B, 0x1ECD, 0x1ECF, 0x1ED1, 0x1ED3, 0x1ED5, 0x1ED7, 0x1ED9, 0x1EDB, 0x1EDD, 0x1EDF, 0x1EE1,
        0x1EE3, 0x1EE5, 0x1EE7, 0x1EE9, 0x1EEB, 0x1EED, 0x1EEF, 0x1EF1,
    }
    
    for char in unicode_array:
        unicode_value = ord(char)
        
        if unicode_value in portuguese_chars:
            language_counts['Portuguese'] += 1
            language_counts['Portuguese'] *= 10
        elif 0xAC00 <= unicode_value <= 0xD7AF:
            language_counts['Korean'] += 1
            language_counts['Korean'] *= 100
        elif (0x3040 <= unicode_value <= 0x309F) or (0x30A0 <= unicode_value <= 0x30FF) or (0x4E00 <= unicode_value <= 0x9FFF):
            language_counts['Japanese'] += 1
            language_counts['Japanese'] *= 10
        elif 0x4E00 <= unicode_value <= 0x9FFF:
            language_counts['Chinese'] += 1
        elif (0x0041 <= unicode_value <= 0x005A) or (0x0061 <= unicode_value <= 0x007A):
            language_counts['English'] += 1
        elif (0x00C0 <= unicode_value <= 0x00FF) or (0x0102 <= unicode_value <= 0x01B0):
            language_counts['Vietnamese'] += 1
            language_counts['Vietnamese'] *= 10
        elif 0x0410 <= unicode_value <= 0x044F:
            language_counts['Russian'] += 1
            language_counts['Russian'] *= 10
        elif 0x0590 <= unicode_value <= 0x05FF:
            language_counts['Hebrew'] += 1
            language_counts['Hebrew'] *= 10
        elif 0x0E00 <= unicode_value <= 0x0E7F:
            language_counts['Thai'] += 1
            language_counts['Thai'] *= 10
        else:
            language_counts['Others'] += 1
    
    total_characters = sum(language_counts.values())
    language_ratios = {}
    
    for key, value in language_counts.items():
        language_ratios[key] = value / total_characters if total_characters > 0 else 0
    
    sorted_languages = sorted(language_ratios.items(), key=lambda x: x[1], reverse=True)
    identified_language = sorted_languages[0][0]
    max_ratio = sorted_languages[0][1]
    
    if identified_language == 'Others' or max_ratio == 0:
        if len(sorted_languages) > 1:
            second_language = sorted_languages[1][0]
            second_ratio = sorted_languages[1][1]
            return 'None' if second_ratio == 0 else second_language
        else:
            return 'None'
    
    return identified_language


def calculate_sentence_bits(sentence):
    """Calculate BIT MAX and MIN for a sentence"""
    unicode_array = word_nb_unicode_format(sentence)
    bit_max = BIT_MAX_NB(unicode_array)
    bit_min = BIT_MIN_NB(unicode_array)
    return {'bitMax': bit_max, 'bitMin': bit_min}


def remove_special_chars_and_spaces(input_str):
    """Remove special characters and normalize spaces"""
    import re
    
    if input_str is None or input_str == '':
        return ''
    
    # Normalize multiple spaces to single space
    normalized_spaces = re.sub(r'\s+', ' ', input_str)
    
    # Remove special characters except [] and #
    return re.sub(r'[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\s\[\]#]', '', normalized_spaces).strip()


def cosine_similarity(vec1, vec2):
    """Calculate cosine similarity between two vectors"""
    try:
        if len(vec1) != len(vec2) or len(vec1) == 0:
            return 0.0
        
        vec1 = np.asarray(vec1, dtype=np.float32)
        vec2 = np.asarray(vec2, dtype=np.float32)
        
        # NaN 처리
        if np.any(np.isnan(vec1)) or np.any(np.isnan(vec2)):
            return 0.0
        
        # 내적
        dot_product = np.dot(vec1, vec2)
        
        # 크기 계산
        magnitude1 = np.linalg.norm(vec1)
        magnitude2 = np.linalg.norm(vec2)
        
        if magnitude1 == 0 or magnitude2 == 0:
            return 0.0
        
        result = dot_product / (magnitude1 * magnitude2)
        return float(result) if np.isfinite(result) else 0.0
    except Exception:
        return 0.0


def calculate_array_similarity(array1, array2):
    """Calculate Jaccard and ordered similarity between two arrays"""
    try:
        if not array1 or not array2:
            return 0.0
        
        # Jaccard similarity
        intersection = [value for value in array1 if value in array2]
        union = list(set(array1 + array2))
        jaccard_similarity = (len(intersection) / len(union)) * 100 if len(union) > 0 else 0
        
        # Ordered similarity
        ordered_matches = sum(1 for i in range(min(len(array1), len(array2))) if array1[i] == array2[i])
        ordered_similarity = (ordered_matches / max(len(array1), len(array2))) * 100 if max(len(array1), len(array2)) > 0 else 0
        
        # Combined similarity (50% weight each)
        return float((jaccard_similarity * 0.5) + (ordered_similarity * 0.5))
    except Exception:
        return 0.0
