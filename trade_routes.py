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
        """Get or update auto-buy configuration (persistent to file)."""
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
                    
                    # Save to file for persistence
                    save_fn = env.get('save_auto_buy_config')
                    if callable(save_fn):
                        save_fn()
                        logger.info(f"Auto-buy config updated and saved: enabled={AUTO_BUY_CONFIG.get('enabled')}")
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
        
        # ML Trust 기반 Zone 결정
        try:
            from helpers.storage import _load_trust_config
            trust_config = _load_trust_config() if callable(_load_trust_config) else {}
            ml_trust = float(trust_config.get('ml_trust', 50.0))
        except Exception:
            ml_trust = 50.0
        
        # ML Trust 값을 기반으로 Zone 구간 결정
        # ml_trust에 따라 HIGH/LOW 임계값 동적 조정 (겹침 없음)
        if nb_r_value is not None:
            try:
                r_val = float(nb_r_value)
                # ML Trust 값으로 HIGH/LOW 임계값 조정
                # ml_trust 낮을 수록 ORANGE 우대, 높을 수록 BLUE 우대
                LOW = (50.0 - ml_trust) / 100.0  # ml_trust=50 → LOW=0.0, ml_trust=0 → LOW=0.5
                HIGH = LOW + 0.5                  # 항상 LOW보다 0.5 이상 큼
                
                if r_val >= HIGH:
                    nb_zone = 'BLUE'
                elif r_val <= LOW:
                    nb_zone = 'ORANGE'
                else:
                    # LOW < r_val < HIGH: 중간값 (신호 불명확)
                    nb_zone = 'NEUTRAL'
                    
                logger.info(f"🎯 ML Trust Zone 결정: ml_trust={ml_trust:.1f}%, r_value={r_val:.3f}, LOW={LOW:.3f}, HIGH={HIGH:.3f}, zone={nb_zone}")
            except Exception as e:
                logger.warning(f"⚠️ ML Trust Zone 계산 실패: {e}")
                nb_zone = nb_zone or 'BLUE'
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
        # Zone Rule 제한 제거 - 항상 매수 허용
        # disable_zone_rule = str(os.getenv('DISABLE_ZONE_RULE', '0')).lower() in ('1', 'true', 'yes')
        # force_bypass = force
        # if not (disable_zone_rule or force_bypass or paper):
        #     try:
        #         th = float(os.getenv('ZONE100_TH', '80.0'))
        #     except Exception:
        #         th = 80.0
        #     z = str(ins.get('zone') or '').upper()
        #     pb = float(ins.get('pct_blue') or ins.get('pct_blue_raw') or 0.0)
        #     po = float(ins.get('pct_orange') or ins.get('pct_orange_raw') or 0.0)
        #     if not (z == 'BLUE' and max(pb, po) >= th):
        #         try:
        #             _record_nb_attempt(str(cfg.candle), str(cfg.market), 'BUY', ok=False, error='blocked_by_zone_rule', ts_ms=(bucket_ts_ms or int(time.time()*1000)), meta={'zone': z, 'pct_blue': pb, 'pct_orange': po})
        #         except Exception:
        #             pass
        #         return jsonify({'ok': False, 'error': 'blocked_by_zone_rule', 'zone': z, 'pct_blue': pb, 'pct_orange': po})
        
        # MAX_NB_COINS 제한 제거 - 무제한 매수 허용
        try:
            current_nb_coins = int(_nb_coin_counter.get(str(cfg.candle), 0))
            max_allowed = int(os.getenv('MAX_NB_COINS', '999999'))  # 사실상 무제한
            if False:  # 항상 통과
                try:
                    _record_nb_attempt(str(cfg.candle), str(cfg.market), 'BUY', ok=False, error='nb_coin_limit_exceeded', ts_ms=(bucket_ts_ms or int(time.time()*1000)), meta={'current_nb_coins': current_nb_coins, 'max_allowed': max_allowed})
                except Exception:
                    pass
                return jsonify({'ok': False, 'error': 'nb_coin_limit_exceeded', 'current_nb_coins': current_nb_coins, 'max_allowed': max_allowed})
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
            'uuid': str(o.get('uuid') or '') if isinstance(o, dict) else '',  # Upbit 주문 UUID
            'orderId': str(o.get('orderId') or o.get('order_id') or '') if isinstance(o, dict) else '',  # 거래소 주문 ID
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
                logger.info(f"✅ Trainer 저장소 업데이트: {trainer} BUY")
        except Exception as e:
            logger.warning(f"⚠️ Trainer 저장소 업데이트 실패: {e}")
        
        # ✅ 자동 손절매 로직: n/b_price_min 참고
        try:
            buy_price = float(order.get('price', price))
            nb_price_min = float(payload.get('nb_price_min') or meta.get('nb_price_min') or 0.0)
            
            if nb_price_min > 0 and buy_price > 0:
                stop_loss_percent = ((buy_price - nb_price_min) / buy_price) * 100
                if stop_loss_percent > 0:
                    order['stop_loss_price'] = float(nb_price_min)
                    order['stop_loss_percent'] = round(stop_loss_percent, 2)
                    logger.info(f"🛑 자동 손절매 설정: 매수={buy_price:.0f} → 손절가={nb_price_min:.0f} ({stop_loss_percent:.2f}%)")
        except Exception as e:
            logger.warning(f"⚠️ 손절매 설정 실패: {e}")
        
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
        
        # ✅ 매도 가격 유효성 검증 (0 이하면 거부)
        if price <= 0:
            logger.error(f"❌ 매도 실패: 현재가 조회 불가 (price={price})")
            try:
                _record_nb_attempt(str(cfg.candle), str(cfg.market), 'SELL', ok=False, error='invalid_price', ts_ms=(bucket_ts_ms or int(time.time()*1000)), meta={'price': price})
            except Exception:
                pass
            return jsonify({'ok': False, 'error': 'invalid_price'})
        
        # ✅ size_override 필수 검증
        if not size_override:
            logger.error(f"❌ 매도 실패: 매도 수량 미지정 (size_override={size_override})")
            try:
                _record_nb_attempt(str(cfg.candle), str(cfg.market), 'SELL', ok=False, error='missing_size', ts_ms=(bucket_ts_ms or int(time.time()*1000)), meta={'price': price})
            except Exception:
                pass
            return jsonify({'ok': False, 'error': 'missing_size'})
        
        try:
            size_override = float(size_override)
            if size_override <= 0:
                raise ValueError(f"Invalid size_override: {size_override}")
        except Exception as e:
            logger.error(f"❌ 매도 실패: 매도 수량 오류 ({e})")
            try:
                _record_nb_attempt(str(cfg.candle), str(cfg.market), 'SELL', ok=False, error='invalid_size', ts_ms=(bucket_ts_ms or int(time.time()*1000)), meta={'price': price, 'size': size_override})
            except Exception:
                pass
            return jsonify({'ok': False, 'error': 'invalid_size'})
        
        # ✅ 최소 주문 금액 검증
        order_amount = size_override * price
        if order_amount < 5000:
            logger.error(f"❌ 매도 실패: 최소 주문 금액 미달 ({order_amount} KRW < 5000 KRW)")
            try:
                _record_nb_attempt(str(cfg.candle), str(cfg.market), 'SELL', ok=False, error='min_notional', ts_ms=(bucket_ts_ms or int(time.time()*1000)), meta={'price': price, 'size': size_override, 'amount': order_amount})
            except Exception:
                pass
            return jsonify({'ok': False, 'error': 'min_notional'})
        
        attempt_size = size_override
        logger.info(f"📊 매도 준비: 수량={attempt_size} BTC, 가격={price:.0f} KRW, 금액={order_amount:.0f} KRW")
        
        # 실제 매도 실행
        if not paper:
            try:
                o = upbit.sell_market_order(market, attempt_size)
                if isinstance(o, dict): o['live_ok'] = True
                logger.info(f"✅ 실매도 실행: {o}")
            except Exception as e:
                logger.error(f"❌ 실매도 실행 실패: {e}")
                o = None
        else:
            # Paper trade: 모의거래
            o = {
                'uuid': f'paper-{int(time.time()*1000)}',
                'size': attempt_size,
                'live_ok': True
            }
            logger.info(f"📝 모의매도 실행: {o}")
        
        # ✅ 매도 실행 결과 검증
        if o is None or (not paper and not (isinstance(o, dict) and o.get('live_ok'))):
            logger.error(f"❌ 매도 주문 실패: {o}")
            try:
                _record_nb_attempt(str(cfg.candle), str(cfg.market), 'SELL', ok=False, error='sell_order_failed', ts_ms=(bucket_ts_ms or int(time.time()*1000)), meta={'price': price, 'size': float(attempt_size or 0.0)})
            except Exception:
                pass
            return jsonify({'ok': False, 'error': 'sell_order_failed'})
        try:
            window = int(load_nb_params().get('window', 50))
        except Exception:
            window = 50
        try:
            ins = _make_insight(df, window, cfg.ema_fast, cfg.ema_slow, cfg.candle, None)
        except Exception:
            ins = {}
        
        # ✅ 매도 주문 생성 (모든 필드 유효성 검증됨)
        order = {
            'ts': int(time.time()*1000),
            'side': 'SELL',
            'price': float(price),
            'size': float(attempt_size),  # 이미 유효성 검증됨
            'paper': bool(paper),
            'market': market,
            'live_ok': bool(o.get('live_ok')) if isinstance(o, dict) else False,
            'uuid': str(o.get('uuid') or '') if isinstance(o, dict) else '',
            'orderId': str(o.get('orderId') or o.get('order_id') or '') if isinstance(o, dict) else '',
            'insight': ins,
            'nb_price_max': float(payload.get('nb_price_max') or 0.0),  # 카드 n/b max
            'nb_price_min': float(payload.get('nb_price_min') or 0.0),  # 카드 n/b min
        }
        logger.info(f"✅ 매도 주문 생성: ts={order['ts']}, price={order['price']:.0f}, size={order['size']}, amount={order['price']*order['size']:.0f}")
        try:
            orders.append(order)
            logger.info(f"✅ 주문 기록 저장")
        except Exception as e:
            logger.warning(f"⚠️ 주문 기록 저장 실패: {e}")
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
                logger.info(f"✅ Trainer 저장소 업데이트: {trainer} SELL")
        except Exception as e:
            logger.warning(f"⚠️ Trainer 저장소 업데이트 실패: {e}")
        
        # ✅ 매도된 buy_cards 파일을 sell_cards로 이동 및 SELL 정보 추가
        try:
            # buy_cards 폴더에서 매칭되는 카드 검색 (여러 파일을 모두 스캔)
            import glob
            import shutil
            buy_cards_files = sorted(glob.glob('data/buy_cards/buy_cards_*.json'), reverse=True)

            # 클라이언트가 전달한 카드 식별 정보 추출
            card_timestamp = payload.get('card_timestamp')
            card_uuid = payload.get('card_uuid')
            nb_price_max = payload.get('nb_price_max')
            nb_price_min = payload.get('nb_price_min')

            logger.info(f"🔍 Buy card 매도 검색: nb_max={nb_price_max}, nb_min={nb_price_min}, uuid={card_uuid}, ts={card_timestamp}")

            target_card = None
            target_file = None
            remaining_cards = None

            for candidate_file in buy_cards_files:
                try:
                    with open(candidate_file, 'r', encoding='utf-8') as f:
                        buy_cards_list = json.load(f)
                except Exception as e:
                    logger.warning(f"⚠️ Buy cards 로드 실패 ({candidate_file}): {e}")
                    continue

                if not isinstance(buy_cards_list, list) or not buy_cards_list:
                    continue

                sell_price = float(order.get('price', 0))
                match_reason = ""
                target_card_index = -1

                for idx, card in enumerate(buy_cards_list):
                    card_market = str(card.get('market', 'KRW-BTC'))
                    card_ts = str(card.get('timestamp', card.get('ts', '')))
                    card_uuid_val = str(card.get('uuid', ''))
                    card_nb_max = card.get('nb_price_max', card.get('nb', {}).get('price', {}).get('max'))
                    card_nb_min = card.get('nb_price_min', card.get('nb', {}).get('price', {}).get('min'))

                    # 매칭 조건 (우선순위)
                    is_target_card = False

                    # 1순위: UUID 매칭
                    if card_uuid and card_uuid_val and card_uuid == card_uuid_val:
                        is_target_card = True
                        match_reason = f"UUID={card_uuid}"

                    # 2순위: nb_price_max/min 정확 매칭 (부동소수점 오차 ±0.0001%)
                    elif nb_price_max and card_nb_max:
                        try:
                            diff_max = abs(float(nb_price_max) - float(card_nb_max))
                            diff_min_val = abs(float(nb_price_min or 0) - float(card_nb_min or 0)) if nb_price_min and card_nb_min else 0
                            if diff_max < 0.00001 and (not nb_price_min or diff_min_val < 0.00001):
                                is_target_card = True
                                match_reason = f"nb_max={card_nb_max}"
                        except Exception as e:
                            logger.warning(f"⚠️ nb_price 매칭 오류: {e}")

                    # 3순위: timestamp 매칭
                    elif card_timestamp and card_ts and card_timestamp == card_ts:
                        is_target_card = True
                        match_reason = f"timestamp={card_ts}"

                    # 4순위: 시장 + 가격 범위 매칭 (±5%)
                    elif card_market == market:
                        card_price = float(card.get('current_price', card.get('price', 0)))
                        if card_price > 0 and 0.95 * card_price <= sell_price <= 1.05 * card_price:
                            is_target_card = True
                            match_reason = f"market+price @ {card_price}"

                    if is_target_card:
                        target_card_index = idx
                        target_card = card
                        target_file = candidate_file
                        remaining_cards = buy_cards_list[:idx] + buy_cards_list[idx+1:]
                        logger.info(f"✅ Buy card 매칭됨: {match_reason} (file={candidate_file})")
                        break

                if target_card is not None:
                    break

            if target_card is None:
                logger.warning(f"⚠️ Buy card 매칭 실패 (모든 buy_cards 스캔)")
                try:
                    _save_order_card(order, 'SELL')
                except Exception as e:
                    logger.warning(f"⚠️ 단독 매도 카드 자동 저장 실패: {e}")
            else:
                # ✅ 매칭된 buy 카드 처리: 먼저 남은 카드 재저장 → 그 다음 원본 아카이브
                
                # 1단계: 남은 카드가 있으면 원본 파일 업데이트, 없으면 삭제
                try:
                    if remaining_cards:
                        # 남은 카드를 원본 파일에 재저장
                        with open(target_file, 'w', encoding='utf-8') as f:
                            json.dump(remaining_cards, f, ensure_ascii=False, indent=2)
                        logger.info(f"✅ 남은 buy_cards {len(remaining_cards)}개 재저장: {target_file}")
                    else:
                        # 모든 카드가 매도되었으면 파일 삭제
                        if os.path.exists(target_file):
                            os.remove(target_file)
                            logger.info(f"✅ 모든 buy_cards 소진 → 파일 삭제: {os.path.basename(target_file)}")
                except Exception as e:
                    logger.warning(f"⚠️ 남은 buy_cards 재저장/삭제 실패: {e}")
                
                # 2단계: 원본 파일을 아카이브 (백업 목적)
                try:
                    # 원본 내용을 아카이브 폴더에 백업 저장
                    os.makedirs(os.path.join('data', 'sell_cards', '_moved_buy'), exist_ok=True)
                    archived_buy_file = os.path.join('data', 'sell_cards', '_moved_buy', os.path.basename(target_file))
                    
                    # 원본 파일이 아직 존재하면 복사 (이미 삭제되었을 수도 있음)
                    if os.path.exists(target_file):
                        shutil.copy2(target_file, archived_buy_file)
                        logger.info(f"✅ Buy cards 파일 백업 → {archived_buy_file}")
                    else:
                        # 파일이 이미 삭제되었으면 target_card만 저장
                        with open(archived_buy_file, 'w', encoding='utf-8') as f:
                            json.dump([target_card], f, ensure_ascii=False, indent=2)
                        logger.info(f"✅ 매도된 카드만 백업 → {archived_buy_file}")
                except Exception as e:
                    logger.warning(f"⚠️ Buy cards 백업 실패: {e}")

                # ✅ sell_cards로 파일 이동: target_card를 sell_cards 파일로 저장 (SELL 정보 추가)
                try:
                    os.makedirs('data/sell_cards', exist_ok=True)
                    now = datetime.utcnow()
                    sell_filename = f"sell_cards_{now.strftime('%Y-%m-%dT%H-%M-%S')}-{now.microsecond // 1000:03d}Z.json"
                    sell_file_path = os.path.join('data/sell_cards', sell_filename)

                    sell_card = target_card.copy()
                    sell_card['side'] = 'SELL'
                    sell_card['ts'] = int(order.get('ts', 0))
                    sell_card['price'] = float(order.get('price', 0))
                    sell_card['size'] = float(order.get('size', 0))
                    sell_card['paper'] = bool(order.get('paper', False))
                    sell_card['uuid'] = str(order.get('uuid', ''))
                    sell_card['orderId'] = str(order.get('orderId', ''))
                    sell_card['paid_fee'] = float(order.get('paid_fee', 0))
                    sell_card['avg_price'] = float(order.get('avg_price', order.get('price', 0)))
                    sell_card['insight'] = order.get('insight', {})
                    sell_card['saved_at'] = datetime.now().isoformat()

                    try:
                        sell_card['orig_buy_price'] = float(target_card.get('price', target_card.get('avg_price', target_card.get('current_price', 0))))
                    except Exception:
                        sell_card['orig_buy_price'] = float(target_card.get('avg_price', 0))
                    try:
                        sell_card['orig_buy_avg_price'] = float(target_card.get('avg_price', sell_card.get('orig_buy_price', 0)))
                    except Exception:
                        sell_card['orig_buy_avg_price'] = sell_card.get('orig_buy_price', 0)
                    try:
                        sell_card['orig_buy_size'] = float(target_card.get('size', 0))
                    except Exception:
                        sell_card['orig_buy_size'] = 0.0
                    try:
                        sell_card['orig_buy_ts'] = int(target_card.get('ts', 0))
                    except Exception:
                        sell_card['orig_buy_ts'] = 0
                    try:
                        sell_card['orig_buy_uuid'] = str(target_card.get('uuid', ''))
                    except Exception:
                        sell_card['orig_buy_uuid'] = ''

                    try:
                        sell_size = float(sell_card.get('size', 0))
                        buy_price = float(sell_card.get('orig_buy_avg_price') or sell_card.get('orig_buy_price') or 0)
                        sell_price = float(sell_card.get('price', 0))
                        cost = buy_price > 0 and sell_size > 0 and sell_price > 0 and (buy_price * sell_size) or 0.0
                        proceeds = sell_price * sell_size if sell_size > 0 else 0.0
                        profit = proceeds - cost
                        pct = (cost > 0) and ((profit / cost) * 100.0) or 0.0
                        sell_card['realized_pnl'] = {'profit': profit, 'pct': pct}
                    except Exception:
                        if 'realized_pnl' not in sell_card:
                            sell_card['realized_pnl'] = {'avg': 0, 'max': 0}

                    sell_card['nb_price_max'] = float(nb_price_max) if nb_price_max and nb_price_max > 0 else None
                    sell_card['nb_price_min'] = float(nb_price_min) if nb_price_min and nb_price_min > 0 else None

                    with open(sell_file_path, 'w', encoding='utf-8') as f:
                        json.dump([sell_card], f, indent=2, ensure_ascii=False)

                    logger.info(f"✅ Sell 카드 저장: {sell_file_path}")
                    logger.info(f"   BUY 가격: {sell_card.get('orig_buy_price')}, 수량: {sell_card.get('orig_buy_size')}")
                    logger.info(f"   SELL 가격: {sell_card.get('price')}, 수량: {sell_card.get('size')}")
                    logger.info(f"   실현 손익: {sell_card.get('realized_pnl')}")
                except Exception as e:
                    logger.warning(f"⚠️ Sell 카드 저장 실패: {e}")
        except Exception as e:
            logger.error(f"❌ Buy→Sell card 이동 중 오류: {e}")
            # ✅ 오류 발생 시에도 SELL 카드 저장
            try:
                _save_order_card(order, 'SELL')
            except Exception as e2:
                logger.warning(f"⚠️ 오류 시 매도 카드 자동 저장 실패: {e2}")
        
        return jsonify({'ok': True, 'order': order})

    return app
