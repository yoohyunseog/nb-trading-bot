"""
Trade and auto-buy routes extracted from server.py for clarity.
We inject dependencies from server.py via register_trade_routes(app, env).
"""
from __future__ import annotations
from typing import Dict, Any
import os
import time
import math
import random
import json
from datetime import datetime

from flask import request, jsonify
import pyupbit


def register_trade_routes(app, env: Dict[str, Any]):
    """Register trade and auto-buy routes on the given Flask app.

    env: globals() from server.py to access shared helpers/state.
    """
    # Extract dependencies from server globals
    _resolve_config = env.get('_resolve_config')
    _get_runtime_keys = env.get('_get_runtime_keys')
    get_candles = env.get('get_candles')
    load_config = env.get('load_config')
    load_nb_params = env.get('load_nb_params')
    _make_insight = env.get('_make_insight')
    _record_nb_attempt = env.get('_record_nb_attempt')
    _nb_coin_counter = env.get('_nb_coin_counter')
    _mark_nb_coin = env.get('_mark_nb_coin')
    _apply_coin_accounting = env.get('_apply_coin_accounting')
    _save_order_card = env.get('_save_order_card')
    _update_trainer_storage = env.get('_update_trainer_storage')
    _get_current_btc_price = env.get('_get_current_btc_price')
    _load_bitcoin_items = env.get('_load_bitcoin_items')
    _save_bitcoin_items = env.get('_save_bitcoin_items')
    _bucket_ts_interval = env.get('_bucket_ts_interval')
    _interval_to_sec = env.get('_interval_to_sec')
    _ensure_nb_coin = env.get('_ensure_nb_coin')
    orders = env.get('orders')
    logger = env.get('logger')
    state = env.get('state')
    Trader = env.get('Trader')
    TradeConfig = env.get('TradeConfig')
    AUTO_BUY_CONFIG = env.get('AUTO_BUY_CONFIG')

    # ---- Auto-Buy ----
    @app.route('/api/auto-buy/config', methods=['GET', 'POST'])
    def api_auto_buy_config():
        """Get or update auto-buy configuration (in-memory)."""
        nonlocal AUTO_BUY_CONFIG
        try:
            if request.method == 'POST':
                data = request.get_json(force=True) if request.is_json else {}
                if isinstance(data, dict):
                    for k, v in data.items():
                        if k in AUTO_BUY_CONFIG:
                            AUTO_BUY_CONFIG[k] = v
                    # mirror interval/intervals for UI convenience
                    if 'intervals' in data and data.get('intervals'):
                        AUTO_BUY_CONFIG['interval'] = data['intervals'][0]
                    if 'interval' in data:
                        AUTO_BUY_CONFIG['intervals'] = [data['interval']]
            return jsonify({'ok': True, 'config': AUTO_BUY_CONFIG})
        except Exception as e:
            return jsonify({'ok': False, 'error': str(e)}), 500

    @app.route('/api/auto-buy/status', methods=['GET'])
    def api_auto_buy_status():
        """Return auto-buy status including server time and interval progress."""
        try:
            # Prefer server helper if available to keep logic in one place
            _payload_fn = env.get('_get_auto_buy_status_payload')
            if callable(_payload_fn):
                return jsonify(_payload_fn())
            # Fallback local computation
            enabled = bool(AUTO_BUY_CONFIG.get('enabled', False))
            market = AUTO_BUY_CONFIG.get('market', 'KRW-BTC')
            intervals = AUTO_BUY_CONFIG.get('intervals') or []
            interval = AUTO_BUY_CONFIG.get('interval') or 'minute10'
            if not intervals:
                intervals = [interval]
            server_time = int(time.time())
            try:
                sec = _interval_to_sec(intervals[0]) if _interval_to_sec else 60
            except Exception:
                sec = 60
            last_check = AUTO_BUY_CONFIG.get('last_check')
            last_poll_ts = int(last_check) if isinstance(last_check, (int, float)) and last_check > 0 else (server_time // sec) * sec
            return jsonify({
                'ok': True,
                'enabled': enabled,
                'market': market,
                'interval': interval,
                'intervals': intervals,
                'amount_krw': AUTO_BUY_CONFIG.get('amount_krw', 5000),
                'cooldown_sec': AUTO_BUY_CONFIG.get('cooldown_sec', 0),
                'last_check': AUTO_BUY_CONFIG.get('last_check'),
                'last_buy': AUTO_BUY_CONFIG.get('last_buy'),
                'server_time': server_time,
                'last_poll_ts': last_poll_ts,
            })
        except Exception as e:
            return jsonify({'ok': False, 'error': str(e)}), 500

    # ---- Trade Preflight ----
    @app.route('/api/trade/preflight', methods=['GET'])
    def api_trade_preflight():
        """Return whether live trading is feasible right now without placing an order."""
        try:
            cfg = _resolve_config()
            std_ak, std_sk, open_ak, open_sk = _get_runtime_keys()
            resp = {
                'paper': bool(cfg.paper),
                'has_keys': bool((std_ak and std_sk) or (open_ak and open_sk)),
                'has_std_keys': bool(std_ak and std_sk),
                'has_open_keys': bool(open_ak and open_sk),
                'market': cfg.market,
                'candle': cfg.candle,
            }
            price = 0.0
            try:
                price = float(pyupbit.get_current_price(cfg.market) or 0.0)
                if price > 0:
                    resp['price_source'] = 'ticker'
            except Exception:
                price = 0.0
            if price <= 0:
                try:
                    dfx = get_candles(cfg.market, cfg.candle, count=1)
                    if len(dfx):
                        price = float(dfx['close'].iloc[-1])
                        resp['price_source'] = 'candle'
                except Exception:
                    pass
            resp['price'] = price
            avail_krw = 0.0; coin_bal = 0.0
            if not cfg.paper and std_ak and std_sk:
                try:
                    up = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
                    avail_krw = float(up.get_balance('KRW') or 0.0)
                    coin = cfg.market.split('-')[-1]
                    coin_bal = float(up.get_balance(coin) or 0.0)
                except Exception:
                    pass
            else:
                if not cfg.paper and (not std_ak or not std_sk):
                    resp['reason'] = 'missing_standard_keys'
            resp['krw'] = avail_krw
            resp['coin_balance'] = coin_bal
            try:
                ratio = float(getattr(cfg, 'pnl_ratio', 0.0))
            except Exception:
                ratio = 0.0
            spend = None
            if ratio > 0 and avail_krw > 0:
                try:
                    spend = int(max(0, (avail_krw * (max(0.0, min(100.0, ratio)) / 100.0))))
                    spend = (spend // 1000) * 1000
                    spend = max(5000, min(spend, int(avail_krw)))
                except Exception:
                    spend = None
            fallback = int(getattr(cfg, 'order_krw', 5000))
            fallback = (fallback // 1000) * 1000
            if fallback < 5000:
                fallback = 5000
            buy_krw = spend if (spend and spend >= 5000) else fallback
            resp['planned_buy_krw'] = buy_krw
            sell_size = coin_bal
            if ratio > 0 and coin_bal > 0:
                sell_size = coin_bal * (max(0.0, min(100.0, ratio)) / 100.0)
            try:
                sell_size = math.floor(float(sell_size) * 1e8) / 1e8
            except Exception:
                pass
            resp['planned_sell_size'] = float(sell_size)
            min_ok_buy = (not cfg.paper) and bool(std_ak and std_sk) and (avail_krw >= 5000) and (buy_krw >= 5000)
            min_ok_sell = (not cfg.paper) and bool(std_ak and std_sk) and (price > 0) and (sell_size > 0) and ((sell_size * price) >= 5000)
            resp['can_buy'] = bool(min_ok_buy)
            resp['can_sell'] = bool(min_ok_sell)
            return jsonify({'ok': True, 'preflight': resp})
        except Exception as e:
            return jsonify({'ok': False, 'error': str(e)}), 500

    # ---- Trade Buy ----
    @app.route('/api/trade/buy', methods=['POST'])
    def api_trade_buy():
        try:
            payload = request.get_json(force=True) if request.is_json else request.form.to_dict()
        except Exception:
            payload = {}
        meta = payload.get('meta') if isinstance(payload.get('meta'), dict) else {}
        nb_price_max = payload.get('nb_price_max', meta.get('nb_price_max'))
        nb_price_min = payload.get('nb_price_min', meta.get('nb_price_min'))
        nb_price = payload.get('nb_price', meta.get('nb_price'))
        nb_price_values = payload.get('nb_price_values', meta.get('nb_price_values'))
        nb_volume_max = payload.get('nb_volume_max', meta.get('nb_volume_max'))
        nb_volume_min = payload.get('nb_volume_min', meta.get('nb_volume_min'))
        nb_volume_values = payload.get('nb_volume_values', meta.get('nb_volume_values'))
        nb_turnover_max = payload.get('nb_turnover_max', meta.get('nb_turnover_max'))
        nb_turnover_min = payload.get('nb_turnover_min', meta.get('nb_turnover_min'))
        nb_turnover_values = payload.get('nb_turnover_values', meta.get('nb_turnover_values'))
        nb_zone = payload.get('nb_zone', meta.get('nb_zone'))
        nb_r_value = payload.get('nb_r_value', meta.get('nb_r_value'))
        nb_w_value = payload.get('nb_w_value', meta.get('nb_w_value'))
        nbverse_path = payload.get('nbverse_path', meta.get('nbverse_path'))
        nbverse_interval = payload.get('nbverse_interval', meta.get('nbverse_interval'))
        nbverse_timestamp = payload.get('nbverse_timestamp', meta.get('nbverse_timestamp'))
        cfg = _resolve_config()
        market = str(payload.get('market') or cfg.market)
        try:
            krw = int(payload.get('krw')) if payload.get('krw') is not None else int(cfg.order_krw)
        except Exception:
            krw = int(cfg.order_krw)
        try:
            pnl_ratio = float(payload.get('pnl_ratio')) if payload.get('pnl_ratio') is not None else float(getattr(cfg, 'pnl_ratio', 0.0))
        except Exception:
            pnl_ratio = float(getattr(cfg, 'pnl_ratio', 0.0))
        paper = cfg.paper if ('paper' not in payload) else bool(payload.get('paper') in (True, 'true', '1', 1, 'True'))
        force = bool(payload.get('force') in (True, 'true', '1', 1, 'True'))
        if 'paper' not in payload:
            paper = True  # default to paper to allow immediate execution without keys
        try:
            if (not paper) and (not (cfg.access_key and cfg.secret_key)):
                paper = True
        except Exception:
            paper = True
        try:
            bucket_override = payload.get('bucket')
            bucket_ts_ms = int(bucket_override)*1000 if bucket_override is not None else None
        except Exception:
            bucket_ts_ms = None
        upbit = None
        if not paper and cfg.access_key and cfg.secret_key:
            upbit = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
        trader = Trader(upbit, TradeConfig(market=market, order_krw=krw, paper=paper, pnl_ratio=pnl_ratio,
                                           pnl_profit_ratio=float(getattr(cfg, 'pnl_profit_ratio', 0.0)),
                                           pnl_loss_ratio=float(getattr(cfg, 'pnl_loss_ratio', 0.0))))
        try:
            df = get_candles(market, cfg.candle, count=max(60, cfg.ema_slow+5))
            price = float(df['close'].iloc[-1]) if len(df) else 0.0
        except Exception:
            price = 0.0
        try:
            window = int(load_nb_params().get('window', 50))
        except Exception:
            window = 50
        try:
            ins = _make_insight(df, window, cfg.ema_fast, cfg.ema_slow, cfg.candle, None)
        except Exception:
            ins = {}
        disable_zone_rule = str(os.getenv('DISABLE_ZONE_RULE', '1')).lower() in ('1', 'true', 'yes')
        force_bypass = force
        if not (disable_zone_rule or force_bypass or paper):
            try:
                th = float(os.getenv('ZONE100_TH', '80.0'))
            except Exception:
                th = 80.0
            z = str(ins.get('zone') or '').upper()
            pb = float(ins.get('pct_blue') or ins.get('pct_blue_raw') or 0.0)
            po = float(ins.get('pct_orange') or ins.get('pct_orange_raw') or 0.0)
            if not (z == 'BLUE' and max(pb, po) >= th):
                try:
                    _record_nb_attempt(str(cfg.candle), str(cfg.market), 'BUY', ok=False, error='blocked_by_zone_rule', ts_ms=(bucket_ts_ms or int(time.time()*1000)), meta={'zone': z, 'pct_blue': pb, 'pct_orange': po})
                except Exception:
                    pass
                return jsonify({'ok': False, 'error': 'blocked_by_zone_rule', 'zone': z, 'pct_blue': pb, 'pct_orange': po})
        try:
            current_nb_coins = int(_nb_coin_counter.get(str(cfg.candle), 0))
            if current_nb_coins >= 1:
                try:
                    _record_nb_attempt(str(cfg.candle), str(cfg.market), 'BUY', ok=False, error='nb_coin_limit_exceeded', ts_ms=(bucket_ts_ms or int(time.time()*1000)), meta={'current_nb_coins': current_nb_coins, 'max_allowed': 1})
                except Exception:
                    pass
                return jsonify({'ok': False, 'error': 'nb_coin_limit_exceeded', 'current_nb_coins': current_nb_coins, 'max_allowed': 1})
        except Exception:
            pass
        attempt_krw = 0
        attempt_size = 0.0
        try:
            if pnl_ratio > 0:
                try:
                    avail_krw = float((upbit.get_balance('KRW') if upbit else 0.0) or 0.0)
                except Exception:
                    avail_krw = 0.0
                attempt_krw = int(max(0, (avail_krw * (max(0.0, min(100.0, pnl_ratio)) / 100.0))))
                attempt_krw = (attempt_krw // 1000) * 1000
                if attempt_krw < 5000:
                    attempt_krw = 5000
            else:
                attempt_krw = int(krw)
                attempt_krw = (attempt_krw // 1000) * 1000
                if attempt_krw < 5000:
                    attempt_krw = 5000
            attempt_size = (float(attempt_krw) / float(price)) if price > 0 else 0.0
        except Exception:
            attempt_krw = int(krw)
            attempt_size = 0.0
        o = trader.place('BUY', price)
        
        # NBverse 파일을 buy_cards에 복사 (매수 시점의 전체 카드 정보 보관)
        nbverse_buy_order = None
        try:
            if nb_price_max:
                # NBverse 경로 생성 (server.py의 create_nb_path와 동일)
                nb_str = str(nb_price_max)
                if '.' in nb_str:
                    int_part, dec_part = nb_str.split('.', 1)
                else:
                    int_part, dec_part = nb_str, ''
                int_part = int_part.replace('-', '')
                dec_part = dec_part.replace('-', '')
                path_parts = [int_part] + list(dec_part)
                nb_path = os.path.join(*path_parts)
                
                nbverse_file = os.path.join('data', 'nbverse', 'max', nb_path, 'this_pocket_card.json')
                if os.path.exists(nbverse_file):
                    import json
                    import shutil
                    with open(nbverse_file, 'r', encoding='utf-8') as f:
                        nbverse_data = json.load(f)
                    
                    # NBverse 데이터를 order에 병합 (모든 정보 보관)
                    nbverse_buy_order = nbverse_data
                    nbverse_buy_order['ts'] = int(time.time()*1000)
                    nbverse_buy_order['side'] = 'BUY'
                    nbverse_buy_order['price'] = float(price)
                    nbverse_buy_order['market'] = market
                    nbverse_buy_order['paper'] = True if o is None or (not paper and not (isinstance(o, dict) and o.get('live_ok'))) else bool(paper)
                    nbverse_buy_order['live_ok'] = False if o is None or (not paper and not (isinstance(o, dict) and o.get('live_ok'))) else bool(o.get('live_ok')) if isinstance(o, dict) else False
                    nbverse_buy_order['insight'] = ins
                    nbverse_buy_order['size'] = float(fallback_size) if o is None or (not paper and not (isinstance(o, dict) and o.get('live_ok'))) else float(o.get('size') or attempt_size) if isinstance(o, dict) else float(attempt_size)
                    
                    logger.info(f"✅ 매수 시점 NBverse 카드 정보 로드: {nbverse_file}")
        except Exception as e:
            logger.debug(f"⚠️ 매수 시점 NBverse 파일 로드 실패: {e}")
        
        if o is None or (not paper and not (isinstance(o, dict) and o.get('live_ok'))):
            try:
                fallback_size = (float(attempt_krw) / float(price)) if price > 0 else 0.0
            except Exception:
                fallback_size = 0.0
            
            # NBverse 데이터가 있으면 그걸 사용, 없으면 일반 order 생성
            if nbverse_buy_order:
                order = nbverse_buy_order
            else:
                order = {
                    'ts': int(time.time()*1000),
                    'side': 'BUY',
                    'price': float(price),
                    'size': float(fallback_size),
                    'paper': True,
                    'market': market,
                    'live_ok': False,
                    'insight': ins,
                    'fallback': True,
                    'nbverse_interval': nbverse_interval or None,
                    'nbverse_timestamp': nbverse_timestamp or None,
                    'nb_price_max': nb_price_max,
                    'nb_price_min': nb_price_min,
                    'nb_price': nb_price,
                    'nb_price_values': nb_price_values,
                    'nb_volume_max': nb_volume_max,
                    'nb_volume_min': nb_volume_min,
                    'nb_volume_values': nb_volume_values,
                    'nb_turnover_max': nb_turnover_max,
                    'nb_turnover_min': nb_turnover_min,
                    'nb_turnover_values': nb_turnover_values,
                    'nb_zone': nb_zone,
                    'nb_r_value': nb_r_value,
                    'nb_w_value': nb_w_value
                }
            try:
                orders.append(order)
            except Exception:
                pass
            try:
                _record_nb_attempt(str(cfg.candle), str(cfg.market), 'BUY', ok=False, error='buy_failed_fallback_paper', ts_ms=(bucket_ts_ms or order.get('ts')), meta={'price': price})
            except Exception:
                pass
            return jsonify({'ok': True, 'order': order})
        order = {
            'ts': int(time.time()*1000),
            'side': 'BUY',
            'price': float(price),
            'size': float(o.get('size') or attempt_size) if isinstance(o, dict) else float(attempt_size),
            'paper': bool(paper),
            'market': market,
            'live_ok': bool(o.get('live_ok')) if isinstance(o, dict) else False,
            'insight': ins,
            'nbverse_interval': nbverse_interval or None,
            'nbverse_timestamp': nbverse_timestamp or None,
            'nb_price_max': nb_price_max,
            'nb_price_min': nb_price_min,
            'nb_price': nb_price,
            'nb_price_values': nb_price_values,
            'nb_volume_max': nb_volume_max,
            'nb_volume_min': nb_volume_min,
            'nb_volume_values': nb_volume_values,
            'nb_turnover_max': nb_turnover_max,
            'nb_turnover_min': nb_turnover_min,
            'nb_turnover_values': nb_turnover_values,
            'nb_zone': nb_zone,
            'nb_r_value': nb_r_value,
            'nb_w_value': nb_w_value
        }
        
        # NBverse 데이터가 있으면 그걸 사용
        if nbverse_buy_order:
            order = nbverse_buy_order
        try:
            if (not paper) and isinstance(o, dict) and o.get('uuid') and upbit:
                uuid = o.get('uuid')
                detail = None
                for _ in range(6):
                    try:
                        detail = upbit.get_order(uuid)
                    except Exception:
                        detail = None
                    if detail and (detail.get('executed_volume') or detail.get('state') in ('done','cancel')):
                        break
                    time.sleep(0.3)
                if isinstance(detail, dict):
                    try:
                        ex_vol = float(detail.get('executed_volume') or 0.0)
                    except Exception:
                        ex_vol = 0.0
                    avg_price = 0.0
                    try:
                        avg_price = float(detail.get('avg_price') or 0.0)
                    except Exception:
                        avg_price = 0.0
                    if avg_price <= 0.0 and isinstance(detail.get('trades'), list) and len(detail['trades']) > 0:
                        try:
                            total_funds = 0.0
                            total_vol = 0.0
                            for t in detail['trades']:
                                p = float(t.get('price') or 0.0)
                                v = float(t.get('volume') or 0.0)
                                total_funds += p * v
                                total_vol += v
                            if total_vol > 0:
                                avg_price = total_funds / total_vol
                                ex_vol = total_vol if ex_vol <= 0 else ex_vol
                        except Exception:
                            pass
                    if ex_vol > 0:
                        order['size'] = float(ex_vol)
                    if avg_price > 0:
                        order['price'] = float(avg_price)
                    try:
                        order['uuid'] = uuid
                        order['paid_fee'] = float(detail.get('paid_fee') or 0.0)
                        order['avg_price'] = float(avg_price)
                    except Exception:
                        pass
        except Exception:
            pass
        try:
            orders.append(order)
        except Exception:
            pass
        try:
            _mark_nb_coin(str(cfg.candle), str(cfg.market), 'BUY', order.get('ts'), order)
        except Exception:
            pass
        try:
            _apply_coin_accounting(str(cfg.candle), float(order.get('price') or 0.0), 'BUY')
        except Exception:
            pass
        try:
            _record_nb_attempt(str(cfg.candle), str(cfg.market), 'BUY', ok=True, error=None, ts_ms=(bucket_ts_ms or order.get('ts')), meta={'price': order.get('price'), 'size': order.get('size')})
        except Exception:
            pass
        try:
            if order.get('side') == 'BUY' and 'BTC' in market.upper():
                size = float(order.get('size', 0))
                buy_price = float(order.get('price', price))
                purchase_price = buy_price * size if size > 0 else 0
                if purchase_price > 0 and size > 0:
                    current_price = _get_current_btc_price()
                    if current_price > 0:
                        item_id = f"btc_item_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{random.randint(1000, 9999)}"
                        current_value = current_price * size
                        profit_loss = current_value - purchase_price
                        profit_loss_percent = (profit_loss / purchase_price * 100) if purchase_price > 0 else 0
                        item = {
                            'item_id': item_id,
                            'item_name': '비트코인',
                            'item_type': 'crypto',
                            'purchase_price': purchase_price,
                            'purchase_amount': size,
                            'purchase_time': datetime.now().isoformat(),
                            'current_price': current_price,
                            'current_value': current_value,
                            'profit_loss': profit_loss,
                            'profit_loss_percent': round(profit_loss_percent, 2),
                            'status': 'active'
                        }
                        items_data = _load_bitcoin_items()
                        items_data['items'].append(item)
                        items_data['last_updated'] = datetime.now().isoformat()
                        _save_bitcoin_items(items_data)
                        print(f"✅ 비트코인 아이템 생성: {item_id} ({size:.8f} BTC, {purchase_price:,.0f} KRW)")
        except Exception as e:
            print(f"⚠️ 아이템 생성 처리 중 오류: {e}")
        try:
            trainer = payload.get('trainer', 'Scout')
            if trainer in ['Scout', 'Guardian', 'Analyst', 'Elder']:
                _update_trainer_storage(
                    trainer=trainer,
                    action='BUY',
                    price=float(order.get('price') or 0.0),
                    size=float(order.get('size') or 0.0)
                )
        except Exception:
            pass
        try:
            _save_order_card(order, 'BUY')
        except Exception as e:
            logger.warning(f"매수 카드 자동 저장 실패: {e}")
        return jsonify({'ok': True, 'order': order})

    # ---- Trade Sell ----
    @app.route('/api/trade/sell', methods=['POST'])
    def api_trade_sell():
        try:
            payload = request.get_json(force=True) if request.is_json else request.form.to_dict()
        except Exception:
            payload = {}
        cfg = _resolve_config()
        market = str(payload.get('market') or cfg.market)
        try:
            size_override = float(payload.get('size')) if payload.get('size') is not None else None
        except Exception:
            size_override = None
        try:
            pnl_ratio = float(payload.get('pnl_ratio')) if payload.get('pnl_ratio') is not None else float(getattr(cfg, 'pnl_ratio', 0.0))
        except Exception:
            pnl_ratio = float(getattr(cfg, 'pnl_ratio', 0.0))
        paper = cfg.paper if ('paper' not in payload) else bool(payload.get('paper') in (True, 'true', '1', 1, 'True'))
        force = bool(payload.get('force') in (True, 'true', '1', 1, 'True'))
        if 'paper' not in payload:
            paper = True  # default to paper for instant execution
        try:
            bucket_override = payload.get('bucket')
            bucket_ts_ms = int(bucket_override)*1000 if bucket_override is not None else None
        except Exception:
            bucket_ts_ms = None
        upbit = None
        if not paper and cfg.access_key and cfg.secret_key:
            upbit = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
        trader = Trader(upbit, TradeConfig(market=market, order_krw=int(cfg.order_krw), paper=paper, pnl_ratio=pnl_ratio,
                                           pnl_profit_ratio=float(getattr(cfg, 'pnl_profit_ratio', 0.0)),
                                           pnl_loss_ratio=float(getattr(cfg, 'pnl_loss_ratio', 0.0))))
        try:
            df = get_candles(market, cfg.candle, count=max(60, cfg.ema_slow+5))
            price = float(df['close'].iloc[-1]) if len(df) else 0.0
        except Exception:
            price = 0.0
        try:
            window = int(load_nb_params().get('window', 50))
        except Exception:
            window = 50
        try:
            ins = _make_insight(df, window, cfg.ema_fast, cfg.ema_slow, cfg.candle, None)
        except Exception:
            ins = {}
        if not force:
            try:
                th = float(os.getenv('ZONE100_TH', '99.95'))
            except Exception:
                th = 99.95
            z = str(ins.get('zone') or '').upper()
            pb = float(ins.get('pct_blue') or ins.get('pct_blue_raw') or 0.0)
            po = float(ins.get('pct_orange') or ins.get('pct_orange_raw') or 0.0)
            if not (z == 'ORANGE' and max(pb, po) >= th):
                try:
                    _record_nb_attempt(str(cfg.candle), str(cfg.market), 'SELL', ok=False, error='blocked_by_zone_rule', ts_ms=(bucket_ts_ms or int(time.time()*1000)), meta={'zone': z, 'pct_blue': pb, 'pct_orange': po})
                except Exception:
                    pass
                return jsonify({'ok': False, 'error': 'blocked_by_zone_rule', 'zone': z, 'pct_blue': pb, 'pct_orange': po})
        if not paper and size_override and price>0 and (size_override*price)>=5000:
            try:
                o = upbit.sell_market_order(market, size_override)
                if isinstance(o, dict): o['live_ok'] = True
            except Exception:
                o = None
        else:
            attempt_size = 0.0
            try:
                coin = market.split('-')[-1]
                bal = float((upbit.get_balance(coin) if upbit else 0.0) or 0.0)
            except Exception:
                bal = 0.0
            try:
                if size_override:
                    attempt_size = float(size_override)
                elif pnl_ratio > 0 and bal > 0:
                    attempt_size = bal * (max(0.0, min(100.0, pnl_ratio)) / 100.0)
                else:
                    attempt_size = bal
                attempt_size = math.floor(float(attempt_size) * 1e8) / 1e8
            except Exception:
                attempt_size = 0.0
            o = trader.place('SELL', price)
        if o is None or (not paper and not (isinstance(o, dict) and o.get('live_ok'))):
            try:
                _record_nb_attempt(str(cfg.candle), str(cfg.market), 'SELL', ok=False, error='sell_failed_or_min_notional', ts_ms=(bucket_ts_ms or int(time.time()*1000)), meta={'price': price, 'size': float(size_override or 0.0)})
            except Exception:
                pass
            return jsonify({'ok': False, 'error': 'sell_failed_or_min_notional'})
        try:
            window = int(load_nb_params().get('window', 50))
        except Exception:
            window = 50
        try:
            ins = _make_insight(df, window, cfg.ema_fast, cfg.ema_slow, cfg.candle, None)
        except Exception:
            ins = {}
        order = {
            'ts': int(time.time()*1000),
            'side': 'SELL',
            'price': float(price),
            'size': float(o.get('size') or (size_override if size_override else attempt_size)) if isinstance(o, dict) else float(size_override if size_override else attempt_size),
            'paper': bool(paper),
            'market': market,
            'live_ok': bool(o.get('live_ok')) if isinstance(o, dict) else False,
            'insight': ins,
        }
        try:
            orders.append(order)
        except Exception:
            pass
        try:
            _mark_nb_coin(str(cfg.candle), str(cfg.market), 'SELL', order.get('ts'), order)
        except Exception:
            pass
        try:
            _apply_coin_accounting(str(cfg.candle), float(order.get('price') or 0.0), 'SELL')
        except Exception:
            pass
        try:
            _record_nb_attempt(str(cfg.candle), str(cfg.market), 'SELL', ok=True, error=None, ts_ms=(bucket_ts_ms or order.get('ts')), meta={'price': order.get('price'), 'size': order.get('size')})
        except Exception:
            pass
        try:
            trainer = payload.get('trainer', 'Scout')
            if trainer in ['Scout', 'Guardian', 'Analyst', 'Elder']:
                _update_trainer_storage(
                    trainer=trainer,
                    action='SELL',
                    price=float(order.get('price') or 0.0),
                    size=float(order.get('size') or 0.0)
                )
        except Exception:
            pass
        try:
            _save_order_card(order, 'SELL')
        except Exception as e:
            logger.warning(f"매도 카드 자동 저장 실패: {e}")
        return jsonify({'ok': True, 'order': order})

    return app
