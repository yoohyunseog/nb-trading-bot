"""Updater thread for live price and signal updates."""

def create_updater(state, load_config, get_candles, decide_signal, _prefill_nb_coins, _load_nb_coins, _load_npc_hashes):
    """Factory function to create updater with dependencies."""
    import time
    import pyupbit
    import os
    
    def updater():
        """Background thread to update price and signal state."""
        cfg = load_config()
        try:
            _load_nb_coins()
        except Exception:
            pass
        state["ema_fast"] = cfg.ema_fast
        state["ema_slow"] = cfg.ema_slow
        state["market"] = cfg.market
        state["candle"] = cfg.candle
        # Prefill N/B COIN buckets for recent candles
        try:
            _prefill_nb_coins(str(cfg.candle), str(cfg.market), how_many=120)
        except Exception:
            pass
        try:
            _load_npc_hashes()
        except Exception:
            pass
        # Initial seed with candles
        try:
            df = get_candles(cfg.market, cfg.candle, count=max(cfg.ema_slow + 60, 120))
            sig = decide_signal(df, cfg.ema_fast, cfg.ema_slow)
            tail = df.tail(60)
            for t, p in zip(tail.index, tail["close"].astype(float)):
                state["history"].append((int(t.timestamp()*1000), float(p)))
            state["price"] = float(tail["close"].iloc[-1])
            state["signal"] = sig
        except Exception:
            pass

        tick = 0
        tick_sec = int(os.getenv("UI_TICK_SEC", "1"))
        recalc_every = int(os.getenv("UI_RECALC_SEC", "30"))
        while True:
            try:
                # Live price via ticker
                cp = pyupbit.get_current_price(cfg.market)
                if cp:
                    now_ms = int(time.time() * 1000)
                    state["price"] = float(cp)
                    state["history"].append((now_ms, float(cp)))
                # Periodic recalc of signal from candles
                if tick % max(recalc_every, 1) == 0:
                    df = get_candles(cfg.market, cfg.candle, count=max(cfg.ema_slow + 5, 60))
                    state["signal"] = decide_signal(df, cfg.ema_fast, cfg.ema_slow)
            except Exception:
                pass
            tick += tick_sec
            time.sleep(tick_sec)
    
    return updater
