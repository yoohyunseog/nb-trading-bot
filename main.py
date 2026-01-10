import os
import time
import math
import numpy as np
import pandas as pd
from dataclasses import dataclass
from dotenv import load_dotenv
import pyupbit
from strategy import decide_signal
from trade import Trader, TradeConfig
import requests


@dataclass
class Config:
    access_key: str | None
    secret_key: str | None
    paper: bool
    market: str
    candle: str  # e.g., 'minute10', 'day'
    ema_fast: int
    ema_slow: int
    interval_sec: int
    order_krw: int


def load_config() -> Config:
    # Load .env first, then optional env.local (non-dotfile fallback)
    load_dotenv()
    load_dotenv("env.local", override=False)
    # Also load from this module's directory so running from project root still picks up bot/.env
    base_dir = os.path.dirname(__file__)
    try:
        load_dotenv(os.path.join(base_dir, ".env"), override=False)
        load_dotenv(os.path.join(base_dir, "env.local"), override=False)
    except Exception:
        pass
    return Config(
        access_key=os.getenv("UPBIT_ACCESS_KEY"),
        secret_key=os.getenv("UPBIT_SECRET_KEY"),
        paper=os.getenv("PAPER", "false").lower() == "true",
        market=os.getenv("MARKET", "KRW-BTC"),
        candle=os.getenv("CANDLE", "minute10"),
        ema_fast=int(os.getenv("EMA_FAST", "10")),
        ema_slow=int(os.getenv("EMA_SLOW", "30")),
        interval_sec=int(os.getenv("INTERVAL_SEC", "30")),
        order_krw=int(os.getenv("ORDER_KRW", "5000")),
    )


# Global cache for OHLCV data
_candles_cache = {}
_candles_cache_time = {}

def get_candles(market: str, candle: str, count: int = 200) -> pd.DataFrame:
    """Fetch OHLCV data from pyupbit with retry logic, caching, and better error handling."""
    import time
    
    cache_key = f"{market}_{candle}_{count}"
    now = time.time()
    
    # Check cache (valid for 5 seconds)
    if cache_key in _candles_cache and (now - _candles_cache_time.get(cache_key, 0)) < 5:
        return _candles_cache[cache_key]
    
    max_retries = 5
    retry_delay = 2.0  # Start with 2 seconds
    
    for attempt in range(max_retries):
        try:
            # PyUpbit uses parameter name 'ticker' not 'market'
            if candle.startswith("minute"):
                unit = int(candle.replace("minute", ""))
                interval_str = f"minute{unit}"
                data = pyupbit.get_ohlcv(ticker=market, interval=interval_str, count=count)
            else:
                interval_str = candle
                data = pyupbit.get_ohlcv(ticker=market, interval=candle, count=count)
            
            if data is None or data.empty:
                if attempt < max_retries - 1:
                    print(f"⚠️ Empty data received for {market} {interval_str} (count={count}), retrying... (attempt {attempt + 1}/{max_retries})")
                    time.sleep(retry_delay)
                    retry_delay *= 1.5  # increase delay
                    continue
                else:
                    # Return cached data if available, even if stale
                    if cache_key in _candles_cache:
                        print(f"⚠️ Using stale cache for {market} {candle}")
                        return _candles_cache[cache_key]
                    raise RuntimeError(f"Failed to fetch OHLCV data for {market} {candle} after {max_retries} attempts")
            
            # Cache the successful result
            _candles_cache[cache_key] = data
            _candles_cache_time[cache_key] = now
            return data
            
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"⚠️ Error fetching candles (attempt {attempt + 1}/{max_retries}): {str(e)}")
                time.sleep(retry_delay)
                retry_delay *= 1.5  # exponential backoff
            else:
                # Return cached data if available, even if stale
                if cache_key in _candles_cache:
                    print(f"⚠️ Using stale cache for {market} {candle} due to error")
                    return _candles_cache[cache_key]
                raise RuntimeError(f"Failed to fetch OHLCV: {str(e)}")
    
    raise RuntimeError("Failed to fetch OHLCV data")




def get_balance(upbit: pyupbit.Upbit, currency: str) -> float:
    bal = upbit.get_balance(currency)
    return float(bal) if bal is not None else 0.0


def place_order(upbit: pyupbit.Upbit | None, cfg: Config, side: str, price: float):
    if cfg.paper or upbit is None:
        size = cfg.order_krw / price
        print(f"[PAPER] {side} {cfg.market} size={size:.8f} price={price:.0f}")
        return {"side": side, "price": price, "size": size, "paper": True}
    if side == "BUY":
        return upbit.buy_market_order(cfg.market, cfg.order_krw)
    else:
        # sell KRW market: need coin size
        ticker = cfg.market.split("-")[-1]
        size = get_balance(upbit, ticker)
        size = math.floor(size * 1e8) / 1e8
        if size <= 0:
            print("No balance to sell")
            return None
        return upbit.sell_market_order(cfg.market, size)


def main():
    cfg = load_config()

    upbit = None
    if not cfg.paper and cfg.access_key and cfg.secret_key:
        upbit = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
        print("Live trading ENABLED")
    else:
        print("Paper trading mode (no real orders)")
    trader = Trader(upbit, TradeConfig(market=cfg.market, order_krw=cfg.order_krw, paper=cfg.paper))

    last_signal = "HOLD"
    while True:
        try:
            df = get_candles(cfg.market, cfg.candle, count=max(cfg.ema_slow + 5, 60))
            sig = decide_signal(df, cfg.ema_fast, cfg.ema_slow)
            price = float(df["close"].iloc[-1])
            print(f"{cfg.market} {cfg.candle} price={price:.0f} signal={sig}")

            if sig == "BUY" and last_signal != "BUY":
                o = trader.place("BUY", price)
                try:
                    # Notify UI server for marker display (best-effort)
                    requests.post("http://127.0.0.1:5057/api/order", json={
                        'ts': int(time.time()*1000),
                        'side': 'BUY',
                        'price': price,
                        'size': o.get('size') if isinstance(o, dict) else None,
                        'paper': cfg.paper,
                        'market': cfg.market,
                    }, timeout=1.5)
                except Exception:
                    pass
            elif sig == "SELL" and last_signal != "SELL":
                o = trader.place("SELL", price)
                try:
                    requests.post("http://127.0.0.1:5057/api/order", json={
                        'ts': int(time.time()*1000),
                        'side': 'SELL',
                        'price': price,
                        'size': o.get('size') if isinstance(o, dict) else None,
                        'paper': cfg.paper,
                        'market': cfg.market,
                    }, timeout=1.5)
                except Exception:
                    pass

            last_signal = sig
        except Exception as e:
            print("Error:", e)

        time.sleep(cfg.interval_sec)


if __name__ == "__main__":
    main()


