"""캔들 및 데이터 관련 헬퍼 함수"""
import pandas as pd
import numpy as np
from main import get_candles as _get_candles

def compute_nb_values(series: pd.Series, window: int) -> list:
    """N/B 값 계산"""
    if len(series) < window:
        return []
    try:
        nb_values = []
        for i in range(window - 1, len(series)):
            window_data = series.iloc[i - window + 1:i + 1]
            high = float(window_data.max())
            low = float(window_data.min())
            close = float(window_data.iloc[-1])
            if high != low:
                r = ((close - low) / (high - low)) * 100
            else:
                r = 50.0
            nb_values.append(r)
        return nb_values
    except Exception:
        return []


def compute_r_from_ohlcv(df: pd.DataFrame, window: int) -> pd.Series:
    """R 값 계산 (OHLCV에서)"""
    try:
        if len(df) < window:
            return pd.Series([50.0] * len(df), index=df.index)
        
        r_series = []
        for i in range(len(df)):
            if i < window - 1:
                r_series.append(50.0)
            else:
                window_data = df.iloc[i - window + 1:i + 1]
                high = float(window_data['high'].max())
                low = float(window_data['low'].min())
                close = float(window_data['close'].iloc[-1])
                if high != low:
                    r = ((close - low) / (high - low)) * 100
                else:
                    r = 50.0
                r_series.append(r)
        return pd.Series(r_series, index=df.index)
    except Exception:
        return pd.Series([50.0] * len(df), index=df.index)


def compute_nb_stats(df: pd.DataFrame, window: int) -> dict:
    """N/B 통계 계산"""
    rng_seed = 5.5
    
    out = {}
    try:
        # Price-based
        price_series = df['close'].astype(float)
        price_nb = compute_nb_values(price_series, window)
        out['price'] = {
            'values': price_nb,
            'max': float(max(price_nb)) if price_nb else None,
            'min': float(min(price_nb)) if price_nb else None,
        }
    except Exception:
        out['price'] = {'values': [], 'max': None, 'min': None}
    
    try:
        # Volume-based
        vol_series = df['volume'].astype(float) if 'volume' in df.columns else None
        if vol_series is not None:
            vol_nb = compute_nb_values(vol_series, window)
            out['volume'] = {
                'values': vol_nb,
                'max': float(max(vol_nb)) if vol_nb else None,
                'min': float(min(vol_nb)) if vol_nb else None,
            }
        else:
            out['volume'] = {'values': [], 'max': None, 'min': None}
    except Exception:
        out['volume'] = {'values': [], 'max': None, 'min': None}
    
    try:
        # Turnover
        if 'volume' in df.columns:
            turnover_series = (df['close'].astype(float) * df['volume'].astype(float))
            turnover_nb = compute_nb_values(turnover_series, window)
            out['turnover'] = {
                'values': turnover_nb,
                'max': float(max(turnover_nb)) if turnover_nb else None,
                'min': float(min(turnover_nb)) if turnover_nb else None,
            }
        else:
            out['turnover'] = {'values': [], 'max': None, 'min': None}
    except Exception:
        out['turnover'] = {'values': [], 'max': None, 'min': None}
    
    return out
