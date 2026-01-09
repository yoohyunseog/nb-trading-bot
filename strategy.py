from dataclasses import dataclass
import pandas as pd


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


@dataclass
class EMACrossoverConfig:
    fast: int = 10
    slow: int = 30


class EMACrossoverStrategy:
    def __init__(self, cfg: EMACrossoverConfig):
        self.cfg = cfg

    def decide(self, df: pd.DataFrame) -> str:
        fast_ema = ema(df["close"], self.cfg.fast)
        slow_ema = ema(df["close"], self.cfg.slow)
        if len(df) < self.cfg.slow + 2:
            return "HOLD"
        prev_cross = fast_ema.iloc[-2] - slow_ema.iloc[-2]
        curr_cross = fast_ema.iloc[-1] - slow_ema.iloc[-1]
        if prev_cross <= 0 and curr_cross > 0:
            return "BUY"
        if prev_cross >= 0 and curr_cross < 0:
            return "SELL"
        return "HOLD"


def decide_signal(df: pd.DataFrame, fast: int, slow: int) -> str:
    return EMACrossoverStrategy(EMACrossoverConfig(fast=fast, slow=slow)).decide(df)


