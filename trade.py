import math
from dataclasses import dataclass
import pyupbit


@dataclass
class TradeConfig:
    market: str
    order_krw: int
    paper: bool = True
    # Percentage (0~100) derived from UI Profit bar to scale order sizes
    # If > 0 in live mode: BUY uses available KRW * (pnl_ratio/100),
    # SELL uses coin balance * (pnl_ratio/100)
    pnl_ratio: float = 0.0
    # Optional: profit-driven BUY scaling and loss-driven SELL scaling
    pnl_profit_ratio: float = 0.0
    pnl_loss_ratio: float = 0.0
    # Keep at least this KRW notional of coin after SELL (to avoid full liquidation)
    min_coin_reserve_krw: float = 5000.0


class Trader:
    def __init__(self, upbit: pyupbit.Upbit | None, cfg: TradeConfig):
        self.upbit = upbit
        self.cfg = cfg
        # Track estimated open position size to avoid full-balance liquidation on SELL
        self._position_size_estimate = 0.0

    def place(self, side: str, price: float):
        if self.cfg.paper or self.upbit is None:
            size = self.cfg.order_krw / price if price > 0 else 0
            if side == "BUY":
                try:
                    self._position_size_estimate += float(size)
                except Exception:
                    pass
            elif side == "SELL":
                try:
                    # Sell up to current estimated position
                    sell_size = min(float(size), float(self._position_size_estimate)) if price > 0 else 0.0
                    size = sell_size
                    self._position_size_estimate = max(0.0, self._position_size_estimate - sell_size)
                except Exception:
                    pass
            # Return enriched paper order for UI marker
            return {"side": side, "price": price, "size": size, "paper": True, "market": self.cfg.market}
        if side == "BUY":
            # If pnl_ratio given, scale by available KRW; fallback to fixed order_krw
            try:
                ratio = max(0.0, min(100.0, float(self.cfg.pnl_ratio)))
            except Exception:
                ratio = 0.0
            spend = None
            if ratio > 0:
                try:
                    avail_krw = float(self.upbit.get_balance("KRW") or 0.0)
                except Exception:
                    avail_krw = 0.0
                # raw proportional spend
                spend = int(max(0, (avail_krw * (ratio / 100.0))))
                # Round down to nearest 1,000 KRW step to avoid API rejection and UI quirks
                spend = (spend // 1000) * 1000
                # Upbit min market order: 5,000 KRW. Also cap by available.
                spend = max(5000, min(spend, int(avail_krw))) if avail_krw > 0 else None
            # Fallback to configured fixed amount, but normalize to 1,000 steps and min 5,000
            fallback = int(self.cfg.order_krw)
            fallback = (fallback // 1000) * 1000
            if fallback < 5000:
                fallback = 5000
            amount_krw = (spend if spend and spend >= 5000 else fallback)
            # Update estimated position by KRW/price approximation
            try:
                self._position_size_estimate += float(amount_krw) / float(price) if price > 0 else 0.0
            except Exception:
                pass
            o = self.upbit.buy_market_order(self.cfg.market, amount_krw)
            try:
                if isinstance(o, dict): o['live_ok'] = True
            except Exception:
                pass
            return o
        ticker = self.cfg.market.split("-")[-1]
        # Live balance
        balance_size = float(self.upbit.get_balance(ticker) or 0)
        size = balance_size
        # If pnl_ratio given, sell only that fraction of holdings
        try:
            ratio = max(0.0, min(100.0, float(self.cfg.pnl_ratio)))
        except Exception:
            ratio = 0.0
        if ratio > 0:
            size = balance_size * (ratio / 100.0)
        else:
            # Default: sell estimated open position; if estimate unknown/zero, fallback to full balance
            try:
                est = float(self._position_size_estimate)
            except Exception:
                est = 0.0
            size = balance_size if est <= 0.0 else min(balance_size, est)
        # Enforce coin reserve: keep at least min_coin_reserve_krw worth after SELL
        try:
            min_reserve_krw = float(getattr(self.cfg, 'min_coin_reserve_krw', 5000.0))
            if price > 0 and min_reserve_krw > 0:
                min_reserve_size = float(min_reserve_krw) / float(price)
                max_sell = max(0.0, balance_size - min_reserve_size)
                size = min(size, max_sell)
        except Exception:
            pass
        # Ensure minimum sell notional ≈ 5,000 KRW; otherwise skip to avoid API error
        # Round size to 8 decimals per Upbit precision
        size = math.floor(float(size) * 1e8) / 1e8
        try:
            if price > 0 and (size * price) < 5000:
                return None
        except Exception:
            pass
        if size <= 0:
            return None
        try:
            o = self.upbit.sell_market_order(self.cfg.market, size)
            try:
                if isinstance(o, dict): o['live_ok'] = True
            except Exception:
                pass
        finally:
            # Reduce estimated position
            try:
                self._position_size_estimate = max(0.0, self._position_size_estimate - float(size))
            except Exception:
                pass
        return o


