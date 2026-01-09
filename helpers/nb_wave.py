"""
N/B Wave Calculation Module
Computes N/B wave data from OHLCV candles using BIT calculation
"""
import numpy as np
from typing import List, Dict, Any, Tuple
from helpers.features import BIT_MAX_NB, BIT_MIN_NB


def compute_nb_wave_from_ohlcv(
    ohlcv_rows: List[Dict[str, Any]], 
    window: int = 50
) -> Dict[str, Any]:
    """
    Compute N/B wave data from OHLCV rows.
    
    Args:
        ohlcv_rows: List of dicts with keys: time, open, high, low, close, volume
        window: Window size for BIT calculation (default: 50)
    
    Returns:
        Dict with:
            - ok: bool
            - wave_data: List[Dict] with time, value, ratio, zone, max_bit, min_bit
            - base: float (middle price of last window)
            - summary: Dict with statistics
    """
    if not ohlcv_rows or len(ohlcv_rows) < window:
        return {
            'ok': False,
            'error': f'Insufficient data: need at least {window} rows, got {len(ohlcv_rows) if ohlcv_rows else 0}'
        }
    
    try:
        # Calculate base (middle of last window) FIRST - used as reference for all zones
        last_win = ohlcv_rows[-window:]
        last_highs = [float(row['high']) for row in last_win]
        last_lows = [float(row['low']) for row in last_win]
        base = (max(last_highs) + min(last_lows)) / 2
        
        wave_data = []
        
        # Process each window
        for i in range(window - 1, len(ohlcv_rows)):
            win = ohlcv_rows[i - window + 1:i + 1]
            
            # Extract OHLC values
            highs = [float(row['high']) for row in win]
            lows = [float(row['low']) for row in win]
            closes = [float(row['close']) for row in win]
            
            # Calculate price range
            hi = max(highs)
            lo = min(lows)
            span = max(hi - lo, 1e-9)
            
            # Calculate price changes
            changes = []
            for k in range(1, len(closes)):
                prev = closes[k - 1]
                cur = closes[k]
                if prev > 0:
                    change_pct = ((cur - prev) / prev) * 100
                    changes.append(change_pct)
            
            if len(changes) < 2:
                continue
            
            # Calculate BIT scores
            try:
                score_max = BIT_MAX_NB(changes)
                score_min = BIT_MIN_NB(changes)
            except Exception:
                score_max = 50
                score_min = 50
            
            # Clamp to 0-100
            score_max = max(0, min(100, score_max))
            score_min = max(0, min(100, score_min))
            
            # Calculate wave value
            ratio = score_max / (score_max + score_min) if (score_max + score_min) > 0 else 0.5
            wave_val = lo + span * ratio
            
            # Calculate base for this window
            win_hi = max(highs)
            win_lo = min(lows)
            win_base = (win_hi + win_lo) / 2
            
            # Determine zone based on wave position relative to base (swapped color logic)
            zone = 'BLUE' if wave_val > win_base else 'ORANGE'
            
            # Get timestamp (convert ms to seconds)
            timestamp = win[-1]['time']
            if timestamp > 10000000000:  # If in milliseconds
                timestamp = timestamp // 1000
            
            wave_data.append({
                'time': int(timestamp),
                'value': float(wave_val),
                'ratio': float(ratio),
                'zone': zone,
                'max_bit': float(score_max),
                'min_bit': float(score_min),
                'bit_diff': float(score_max - score_min)
            })
        
        if not wave_data:
            return {
                'ok': False,
                'error': 'No wave data generated'
            }
        
        # Calculate base (middle of last window)
        last_win = ohlcv_rows[-window:]
        last_highs = [float(row['high']) for row in last_win]
        last_lows = [float(row['low']) for row in last_win]
        base = (max(last_highs) + min(last_lows)) / 2
        
        # Calculate summary statistics
        blue_count = sum(1 for w in wave_data if w['zone'] == 'BLUE')
        orange_count = sum(1 for w in wave_data if w['zone'] == 'ORANGE')
        
        avg_max_bit = np.mean([w['max_bit'] for w in wave_data])
        avg_min_bit = np.mean([w['min_bit'] for w in wave_data])
        avg_ratio = np.mean([w['ratio'] for w in wave_data])
        
        current_zone = wave_data[-1]['zone']
        current_ratio = wave_data[-1]['ratio']
        
        summary = {
            'blue': blue_count,
            'orange': orange_count,
            'total': len(wave_data),
            'current_zone': current_zone,
            'current_ratio': float(current_ratio),
            'avg_max_bit': float(avg_max_bit),
            'avg_min_bit': float(avg_min_bit),
            'avg_ratio': float(avg_ratio)
        }
        
        return {
            'ok': True,
            'wave_data': wave_data,
            'base': float(base),
            'summary': summary,
            'window': window
        }
        
    except Exception as e:
        return {
            'ok': False,
            'error': f'Wave calculation error: {str(e)}'
        }


def compute_nb_wave_zones_from_ohlcv(
    ohlcv_rows: List[Dict[str, Any]], 
    window: int = 50
) -> Dict[str, Any]:
    """
    Compute N/B wave zones in the format compatible with /api/nb-wave.
    
    Args:
        ohlcv_rows: List of dicts with keys: time, open, high, low, close, volume
        window: Window size for BIT calculation (default: 50)
    
    Returns:
        Dict matching /api/nb-wave format with:
            - ok: bool
            - zones: List[Dict] with zone, strength, volume, r_value, max_bit, min_bit, bit_diff
            - labels: List[str] time labels
            - summary: Dict with statistics
    """
    if not ohlcv_rows or len(ohlcv_rows) < window:
        return {
            'ok': False,
            'error': f'Insufficient data: need at least {window} rows, got {len(ohlcv_rows) if ohlcv_rows else 0}'
        }
    
    try:
        zones = []
        labels = []
        
        # Process each window
        for i in range(len(ohlcv_rows)):
            if i >= window - 1:
                win = ohlcv_rows[i - window + 1:i + 1]
                
                # Calculate price changes
                closes = [float(row['close']) for row in win]
                changes = []
                for k in range(1, len(closes)):
                    prev = closes[k - 1]
                    cur = closes[k]
                    if prev > 0:
                        change_pct = ((cur - prev) / prev) * 100
                        changes.append(change_pct)
                
                if changes:
                    # Calculate BIT scores
                    try:
                        max_bit = BIT_MAX_NB(changes)
                        min_bit = BIT_MIN_NB(changes)
                    except Exception:
                        max_bit = 50.0
                        min_bit = 50.0
                    
                    # Clamp to 0-100
                    max_bit = max(0, min(100, max_bit))
                    min_bit = max(0, min(100, min_bit))
                    
                    # Determine zone
                    zone = 'BLUE' if max_bit > min_bit else 'ORANGE'
                    
                    # Calculate r_value (ratio)
                    r_value = max_bit / (max_bit + min_bit) if (max_bit + min_bit) > 0 else 0.5
                else:
                    zone = 'BLUE'
                    max_bit = 50.0
                    min_bit = 50.0
                    r_value = 0.5
            else:
                # Not enough data for window
                zone = 'BLUE'
                max_bit = 50.0
                min_bit = 50.0
                r_value = 0.5
            
            # Calculate strength (distance from neutral)
            strength = abs(r_value - 0.5) * 2  # 0 to 1
            
            # Use close price as volume proxy
            volume = float(ohlcv_rows[i].get('close', 0))
            
            zones.append({
                'zone': zone,
                'strength': float(strength),
                'volume': float(volume),
                'r_value': float(r_value),
                'max_bit': float(max_bit),
                'min_bit': float(min_bit),
                'bit_diff': float(max_bit - min_bit)
            })
            
            # Create time labels (show every 20th)
            if i % 20 == 0 or i == len(ohlcv_rows) - 1:
                timestamp = ohlcv_rows[i]['time']
                if timestamp > 10000000000:  # milliseconds
                    timestamp = timestamp // 1000
                from datetime import datetime
                labels.append(datetime.fromtimestamp(timestamp).strftime('%H:%M'))
            else:
                labels.append('')
        
        # Calculate summary
        orange_count = sum(1 for z in zones if z['zone'] == 'ORANGE')
        blue_count = sum(1 for z in zones if z['zone'] == 'BLUE')
        current_price = float(ohlcv_rows[-1].get('close', 0))
        
        avg_max_bit = np.mean([z['max_bit'] for z in zones])
        avg_min_bit = np.mean([z['min_bit'] for z in zones])
        avg_bit_diff = np.mean([z['bit_diff'] for z in zones])
        
        summary = {
            'orange': orange_count,
            'blue': blue_count,
            'current_price': current_price,
            'total_bars': len(zones),
            'avg_max_bit': float(avg_max_bit),
            'avg_min_bit': float(avg_min_bit),
            'avg_bit_diff': float(avg_bit_diff)
        }
        
        return {
            'ok': True,
            'zones': zones,
            'labels': labels,
            'summary': summary,
            'window': window
        }
        
    except Exception as e:
        return {
            'ok': False,
            'error': f'Zone calculation error: {str(e)}'
        }
