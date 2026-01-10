import os
import sys
import math
import threading
import time
from collections import deque
from dataclasses import asdict
from flask import Flask, jsonify, Response, request, send_from_directory
from flask_cors import CORS
import json
import pyupbit
import pandas as pd
import numpy as np
import joblib
import uuid
import requests
import hashlib
import random
from datetime import datetime, timedelta

# 새로운 유틸리티 시스템 임포트
try:
    from utils.logger import setup_logger, get_logger, safe_print
    from utils.responses import success_response, error_response, handle_exception
    from utils.exceptions import (
        ApiException, ValidationError, AuthenticationError, 
        NotFoundError, InternalServerError, ExternalApiError
    )
    from config import config
except ImportError:
    # 상대 임포트가 실패하면 절대 임포트 시도
    import sys
    import os
    sys.path.insert(0, os.path.dirname(__file__))
    from utils.logger import setup_logger, get_logger, safe_print
    from utils.responses import success_response, error_response, handle_exception
    from utils.exceptions import (
        ApiException, ValidationError, AuthenticationError, 
        NotFoundError, InternalServerError, ExternalApiError
    )
    from config import config

# 로거 초기화
logger = setup_logger('8bit_bot', log_dir='logs', level=config.server.log_level)

# 기존 safe_print 호환성 유지 (utils.logger에서 임포트됨)

from main import load_config, get_candles
from dotenv import load_dotenv
from strategy import decide_signal

# ===== 모델 초기화 (온라인 러닝 지원) =====
# rating_ml.py의 load() 메서드에서 호환성 검사 수행
# 호환되는 모델은 유지, 호환 안 되면 자동으로 폴백
try:
    from pathlib import Path
    model_dir = Path('models')
    model_dir.mkdir(exist_ok=True)
    logger.info("✓ 모델 디렉토리 준비 완료 (온라인 학습 지원)")
except Exception as e:
    logger.warning(f"⚠️ 모델 디렉토리 초기화 중 오류: {e}")
from trade import Trader, TradeConfig
from rating_ml import get_rating_ml
from bot_state import bot_ctrl, AUTO_BUY_CONFIG

# BIT calculation functions
from helpers.features import BIT_MAX_NB, BIT_MIN_NB

# ===== 8BIT 마을 시스템 =====

# 마을 에너지 시스템
VILLAGE_ENERGY = 150
MAX_VILLAGE_ENERGY = 100
ENERGY_ACCUMULATED = 150

# 촌장의 신뢰도 시스템
MAYOR_TRUST_SYSTEM = {
    "ML_Model_Trust": 40,    # 🤖 ML 모델 신뢰도
    "NB_Guild_Trust": 82,    # 🏛️ N/B 길드 신뢰도 (82개 히스토리)
    "last_guidance": None,
    "guidance_history": [],
    "auto_learning_enabled": True,  # 자동 촌장 지침 학습 활성화
    "last_learning_time": None,     # 마지막 학습 시간
    "learning_interval": 3600       # 학습 간격 (1시간)
}

# ===== 마을 출입 일지 시스템 =====
VILLAGE_ENTRY_EXIT_LOG = {
    "total_residents": 10,  # 총 주민 수
    "current_in_village": 4,  # 현재 마을 내 주민 수
    "current_in_orange": 3,   # 현재 ORANGE 구역 주민 수
    "current_in_blue": 3,     # 현재 BLUE 구역 주민 수
    "zone_logs": {
        "ORANGE": {
            "residents": [],  # ORANGE 구역 주민 목록
            "activities": [], # ORANGE 구역 활동 기록
            "entry_exit_log": []  # ORANGE 구역 출입 기록
        },
        "BLUE": {
            "residents": [],  # BLUE 구역 주민 목록
            "activities": [], # BLUE 구역 활동 기록
            "entry_exit_log": []  # BLUE 구역 출입 기록
        },
        "VILLAGE": {
            "residents": [],  # 마을 내 주민 목록
            "activities": [], # 마을 내 활동 기록
            "entry_exit_log": []  # 마을 출입 기록
        }
    },
    "resident_status": {}  # 각 주민별 현재 상태
}

# 마을 주민 시스템 (Guild Members) - 카드 기반 시스템
VILLAGE_RESIDENTS = {
    "scout": {
        "name": "Scout",
        "hp": 85,
        "maxHp": 100,
        "stamina": 70,
        "maxStamina": 100,
        "location": "Gate",
        "role": "Explorer",
        "assignedTimeframes": ["minute1", "minute3"],  # 담당 분봉
        "specialty": "Quick Signals",
        "description": "Monitors 1m & 3m charts for rapid opportunities",
        "skillLevel": 2.9,
        "experience": 0,
        "learningRate": 0.1,
        "autoTradingEnabled": True,
        "lastAutoTrade": None,
        "tradeFrequency": 0.6,
        "strategy": "momentum",
        
        # 카드 시스템
        "cardSystem": {
            "activeCards": [],  # 활성 카드 ID들
            "completedCards": [],  # 완료된 카드 ID들
            "failedCards": [],  # 실패한 카드 ID들
            "cardAnalysisHistory": [],  # 카드 분석 히스토리
            "currentAnalysis": None,  # 현재 분석 중인 카드
            "analysisSuccessRate": 0.0,  # 분석 성공률
            "totalCardsAnalyzed": 0,  # 총 분석한 카드 수
            "successfulCards": 0,  # 성공한 카드 수
            "averageProfit": 0.0,  # 평균 수익률
            "totalProfit": 0.0,  # 총 수익
            "totalVolume": 0.0,  # 총 거래량
            "totalFees": 0.0  # 총 수수료
        },
        
        # 기존 시스템 (호환성 유지)
        "nbCoins": 0.001,
        "totalNbCoinsEarned": 0.0,
        "totalNbCoinsLost": 0.0,
        "openPosition": None,
        "positionHistory": [],
        "averagePrice": 0.0,
        "totalPositionSize": 0.0
    },
    "guardian": {
        "name": "Guardian",
        "hp": 95,
        "maxHp": 100,
        "stamina": 80,
        "maxStamina": 100,
        "location": "Market",
        "role": "Protector",
        "assignedTimeframes": ["minute5", "minute10"],  # 담당 분봉
        "specialty": "Trend Protection",
        "description": "Protects trends with 5m & 10m charts",
        "skillLevel": 1.0,
        "experience": 0,
        "learningRate": 0.15,
        "autoTradingEnabled": True,
        "lastAutoTrade": None,
        "tradeFrequency": 0.4,
        "strategy": "mean_reversion",
        
        # 카드 시스템
        "cardSystem": {
            "activeCards": [],
            "completedCards": [],
            "failedCards": [],
            "cardAnalysisHistory": [],
            "currentAnalysis": None,
            "analysisSuccessRate": 0.0,
            "totalCardsAnalyzed": 0,
            "successfulCards": 0,
            "averageProfit": 0.0,
            "totalProfit": 0.0,
            "totalVolume": 0.0,
            "totalFees": 0.0
        },
        
        # 기존 시스템 (호환성 유지)
        "nbCoins": 0.001,
        "totalNbCoinsEarned": 0.0,
        "totalNbCoinsLost": 0.0,
        "openPosition": None,
        "positionHistory": [],
        "averagePrice": 0.0,
        "totalPositionSize": 0.0
    },
    "analyst": {
        "name": "Analyst",
        "hp": 60,
        "maxHp": 100,
        "stamina": 90,
        "maxStamina": 100,
        "location": "Tower",
        "role": "Strategist",
        "assignedTimeframes": ["minute15", "minute30"],  # 담당 분봉
        "specialty": "Strategic Analysis",
        "description": "Develops strategies with 15m & 30m charts",
        "skillLevel": 1.0,
        "experience": 0,
        "learningRate": 0.12,
        "autoTradingEnabled": True,
        "lastAutoTrade": None,
        "tradeFrequency": 0.3,
        "strategy": "breakout",
        
        # 카드 시스템
        "cardSystem": {
            "activeCards": [],
            "completedCards": [],
            "failedCards": [],
            "cardAnalysisHistory": [],
            "currentAnalysis": None,
            "analysisSuccessRate": 0.0,
            "totalCardsAnalyzed": 0,
            "successfulCards": 0,
            "averageProfit": 0.0,
            "totalProfit": 0.0,
            "totalVolume": 0.0,
            "totalFees": 0.0
        },
        
        # 기존 시스템 (호환성 유지)
        "nbCoins": 0.001,
        "totalNbCoinsEarned": 0.0,
        "totalNbCoinsLost": 0.0,
        "openPosition": None,
        "positionHistory": [],
        "averagePrice": 0.0,
        "totalPositionSize": 0.0
    },
    "elder": {
        "name": "Elder",
        "hp": 75,
        "maxHp": 100,
        "stamina": 85,
        "maxStamina": 100,
        "location": "Inn",
        "role": "Advisor",
        "assignedTimeframes": ["minute60", "day"],  # 담당 분봉
        "specialty": "Long-term Wisdom",
        "description": "Provides wisdom with 1h & daily charts",
        "skillLevel": 1.0,
        "experience": 0,
        "learningRate": 0.08,
        "autoTradingEnabled": True,
        "lastAutoTrade": None,
        "tradeFrequency": 0.2,
        "strategy": "trend_following",
        
        # 카드 시스템
        "cardSystem": {
            "activeCards": [],
            "completedCards": [],
            "failedCards": [],
            "cardAnalysisHistory": [],
            "currentAnalysis": None,
            "analysisSuccessRate": 0.0,
            "totalCardsAnalyzed": 0,
            "successfulCards": 0,
            "averageProfit": 0.0,
            "totalProfit": 0.0,
            "totalVolume": 0.0,
            "totalFees": 0.0
        },
        
        # 기존 시스템 (호환성 유지)
        "nbCoins": 0.001,
        "totalNbCoinsEarned": 0.0,
        "totalNbCoinsLost": 0.0,
        "openPosition": None,
        "positionHistory": [],
        "averagePrice": 0.0,
        "totalPositionSize": 0.0
    }
}

# 카드 상태 머신 상수 정의
CARD_STATE = {
    "NEW": "STATE_NEW",           # 생성 직후
    "WATCH": "STATE_WATCH",       # 관망하며 점수만 갱신
    "LONG": "STATE_LONG",         # 보유(매수 진입 완료)
    "SHORT": "STATE_SHORT",       # 보유(매도 진입 완료)
    "EXITED": "STATE_EXITED",     # 청산 완료(거래 종료)
    "REMOVED": "STATE_REMOVED"    # 제거 완료(운영 제외)
}

CARD_ACTION = {
    "BUY": "BUY",                      # 매수 진입
    "SELL_SHORT": "SELL_SHORT",        # 매도 진입(숏)
    "SELL_TO_CLOSE": "SELL_TO_CLOSE",  # 롱 청산
    "BUY_TO_CLOSE": "BUY_TO_CLOSE",    # 숏 청산
    "WAIT": "WAIT",                    # 대기
    "REMOVE_CARD": "REMOVE_CARD"       # 카드 제거
}

# 카드 시스템 전역 변수
CARD_SYSTEM = {
    "totalCards": 25,  # 총 카드 수
    "activeCards": {},  # 활성 카드들 (임시)
    "completedCards": {},  # 완성된 카드들
    "failedCards": {},  # 실패한 카드들
    "removedCards": {},  # 제거된 카드들
    "cardCounter": 0,  # 카드 ID 카운터
    "lastCardUpdate": None  # 마지막 카드 업데이트 시간
}

# 카드 시스템 함수들
def format_elapsed_time(seconds):
    """경과 시간을 읽기 쉬운 형식으로 변환"""
    if seconds < 60:
        return f"{int(seconds)}초"
    elif seconds < 3600:
        minutes = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{minutes}분 {secs}초"
    elif seconds < 86400:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        return f"{hours}시간 {minutes}분"
    else:
        days = int(seconds // 86400)
        hours = int((seconds % 86400) // 3600)
        return f"{days}일 {hours}시간"

def get_card_elapsed_time(card):
    """카드 생성 후 경과 시간 계산"""
    if "createdAt" not in card:
        return 0, "0초"
    
    elapsed = time.time() - card["createdAt"]
    formatted = format_elapsed_time(elapsed)
    return elapsed, formatted

def create_card(member_name, timeframe, pattern_data):
    """새로운 카드 생성"""
    global CARD_SYSTEM
    
    CARD_SYSTEM["cardCounter"] += 1
    card_id = CARD_SYSTEM["cardCounter"]
    
    card = {
        "cardId": card_id,
        "memberName": member_name,
        "timeframe": timeframe,
        "state": CARD_STATE["NEW"],  # 상태 머신 상태
        "action": CARD_ACTION["WAIT"],  # 현재 액션
        "patternData": pattern_data,
        "createdAt": time.time(),
        "createdAtFormatted": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "buyInfo": None,
        "sellInfo": None,
        "performance": None,
        "strategy": None,
        # 상태 머신 관련 필드
        "score": 0.0,  # 현재 점수
        "dataQuality": "DATA_OK",  # DATA_OK, DATA_WARN, DATA_BAD
        "dataQualityCount": 0,  # 연속 데이터 이상 횟수
        "trend": "TREND_NEUTRAL",  # TREND_UP, TREND_DOWN, TREND_NEUTRAL
        "momentum": "MOM_NEUTRAL",  # MOM_UP, MOM_DOWN, MOM_NEUTRAL
        "structure": "STRUCTURE_NONE",  # BREAK_UP, BREAK_DOWN, RETEST_OK, STRUCTURE_NONE
        "volumeConfirm": False,  # VOLM_CONFIRM
        "riskStatus": "RISK_OK",  # RISK_OK, RISK_WIDE_STOP, RISK_BAD_RR
        "stopLoss": None,  # 손절가
        "takeProfit": None,  # 목표가
        "entryPrice": None,  # 진입가
        "currentPrice": None,  # 현재가
        "pnl": 0.0,  # 현재 손익률
        "pnlPercent": 0.0,  # 현재 손익률(%)
        "removedAt": None,  # 제거 시간
        "removeReason": None,  # 제거 사유
        "lastScore": None,  # 마지막 점수
        "pnlSummary": None,  # 손익 요약
        "stateHistory": [],  # 상태 변경 이력
        "actionHistory": []  # 액션 실행 이력
    }
    
    # 활성 카드에 추가
    CARD_SYSTEM["activeCards"][card_id] = card
    
    # 주민의 활성 카드 목록에 추가
    if member_name in VILLAGE_RESIDENTS:
        VILLAGE_RESIDENTS[member_name]["cardSystem"]["activeCards"].append(card_id)
    
    print(f"🃏 카드 생성: {member_name} - {timeframe} (ID: {card_id}, STATE={CARD_STATE['NEW']})")
    return card_id

def analyze_card(card_id, member_name):
    """카드 분석 및 매수/매도 전략 생성"""
    if card_id not in CARD_SYSTEM["activeCards"]:
        return None
    
    card = CARD_SYSTEM["activeCards"][card_id]
    member = VILLAGE_RESIDENTS.get(member_name)
    
    if not member:
        return None
    
    # 주민의 전문성에 따른 전략 생성
    strategy = generate_trading_strategy(member, card["timeframe"], card["patternData"])
    
    # 카드 업데이트
    card["status"] = "analyzing"
    card["strategy"] = strategy
    card["analyzedAt"] = time.time()
    
    # 주민의 현재 분석 상태 업데이트
    member["cardSystem"]["currentAnalysis"] = card_id
    member["cardSystem"]["cardAnalysisHistory"].append({
        "cardId": card_id,
        "timeframe": card["timeframe"],
        "strategy": strategy,
        "analyzedAt": time.time()
    })
    
    print(f"🔍 카드 분석 완료: {member_name} - 카드 {card_id}")
    return strategy

def execute_card_action(card_id, action, action_data=None):
    """
    카드 액션 실행 함수
    상태 머신에 따라 액션을 실행하고 상태를 전환
    
    Args:
        card_id: 카드 ID
        action: 실행할 액션 (BUY, SELL_SHORT, SELL_TO_CLOSE, BUY_TO_CLOSE, REMOVE_CARD)
        action_data: 액션 실행에 필요한 데이터
    
    Returns:
        성공 여부
    """
    if card_id not in CARD_SYSTEM["activeCards"]:
        return False
    
    card = CARD_SYSTEM["activeCards"][card_id]
    member_name = card["memberName"]
    old_state = card.get("state")
    old_action = card.get("action")
    
    if action == CARD_ACTION["BUY"]:
        # 매수 진입
        buy_info = action_data or {}
        card["buyInfo"] = buy_info
        card["entryPrice"] = buy_info.get("price", 0)
        card["state"] = CARD_STATE["LONG"]
        card["action"] = CARD_ACTION["BUY"]
        card["buyCompletedAt"] = time.time()
        
        # 손절/목표가 설정
        if buy_info.get("stopLoss"):
            card["stopLoss"] = buy_info["stopLoss"]
        if buy_info.get("takeProfit"):
            card["takeProfit"] = buy_info["takeProfit"]
        
        # 상태 이력 기록
        card["stateHistory"].append({
            "from": old_state,
            "to": CARD_STATE["LONG"],
            "at": time.time(),
            "reason": "buy_entry"
        })
        
        # 주민의 창고에 임시 배치
        if member_name in VILLAGE_RESIDENTS:
            member = VILLAGE_RESIDENTS[member_name]
            member["cardSystem"]["totalVolume"] += buy_info.get("amount", 0)
            member["cardSystem"]["totalFees"] += buy_info.get("fee", 0)
        
        print(f"💰 [BUY] 카드 {card_id} - {member_name} - 가격: {card['entryPrice']}")
        return True
    
    elif action == CARD_ACTION["SELL_SHORT"]:
        # 매도 진입 (숏)
        sell_info = action_data or {}
        card["buyInfo"] = sell_info  # 숏의 경우 매도가 진입
        card["entryPrice"] = sell_info.get("price", 0)
        card["state"] = CARD_STATE["SHORT"]
        card["action"] = CARD_ACTION["SELL_SHORT"]
        card["sellShortAt"] = time.time()
        
        # 손절/목표가 설정
        if sell_info.get("stopLoss"):
            card["stopLoss"] = sell_info["stopLoss"]
        if sell_info.get("takeProfit"):
            card["takeProfit"] = sell_info["takeProfit"]
        
        # 상태 이력 기록
        card["stateHistory"].append({
            "from": old_state,
            "to": CARD_STATE["SHORT"],
            "at": time.time(),
            "reason": "sell_short_entry"
        })
        
        print(f"📉 [SELL_SHORT] 카드 {card_id} - {member_name} - 가격: {card['entryPrice']}")
        return True
    
    elif action == CARD_ACTION["SELL_TO_CLOSE"]:
        # 롱 청산
        sell_info = action_data or {}
        card["sellInfo"] = sell_info
        card["state"] = CARD_STATE["EXITED"]
        card["action"] = CARD_ACTION["SELL_TO_CLOSE"]
        card["sellCompletedAt"] = time.time()
        
        # 손익 계산
        entry_price = card.get("entryPrice", 0)
        exit_price = sell_info.get("price", 0)
        if entry_price > 0 and exit_price > 0:
            card["pnlPercent"] = ((exit_price - entry_price) / entry_price) * 100
            card["pnl"] = exit_price - entry_price
        
        # 상태 이력 기록
        card["stateHistory"].append({
            "from": old_state,
            "to": CARD_STATE["EXITED"],
            "at": time.time(),
            "reason": "sell_to_close"
        })
        
        print(f"🔴 [SELL_TO_CLOSE] 카드 {card_id} - {member_name} - 손익: {card.get('pnlPercent', 0):.2f}%")
        return True
    
    elif action == CARD_ACTION["BUY_TO_CLOSE"]:
        # 숏 청산
        buy_info = action_data or {}
        card["sellInfo"] = buy_info  # 숏의 경우 매수가 청산
        card["state"] = CARD_STATE["EXITED"]
        card["action"] = CARD_ACTION["BUY_TO_CLOSE"]
        card["buyToCloseAt"] = time.time()
        
        # 손익 계산
        entry_price = card.get("entryPrice", 0)
        exit_price = buy_info.get("price", 0)
        if entry_price > 0 and exit_price > 0:
            card["pnlPercent"] = ((entry_price - exit_price) / entry_price) * 100
            card["pnl"] = entry_price - exit_price
        
        # 상태 이력 기록
        card["stateHistory"].append({
            "from": old_state,
            "to": CARD_STATE["EXITED"],
            "at": time.time(),
            "reason": "buy_to_close"
        })
        
        print(f"🟢 [BUY_TO_CLOSE] 카드 {card_id} - {member_name} - 손익: {card.get('pnlPercent', 0):.2f}%")
        return True
    
    elif action == CARD_ACTION["REMOVE_CARD"]:
        # 카드 제거
        return remove_card(card_id, action_data)
    
    elif action == CARD_ACTION["WAIT"]:
        # 대기 (상태 유지)
        card["action"] = CARD_ACTION["WAIT"]
        return True
    
    return False

def remove_card(card_id, remove_reason=None):
    """
    카드 제거 함수
    운영에서 제외하고 기록 저장
    """
    if card_id not in CARD_SYSTEM["activeCards"]:
        return False
    
    card = CARD_SYSTEM["activeCards"][card_id]
    member_name = card["memberName"]
    
    # 제거 정보 저장
    card["removedAt"] = time.time()
    card["removeReason"] = remove_reason or "manual_remove"
    card["lastScore"] = card.get("score", 0)
    card["state"] = CARD_STATE["REMOVED"]
    card["action"] = CARD_ACTION["REMOVE_CARD"]
    
    # 손익 요약 생성
    if card.get("entryPrice") and card.get("currentPrice"):
        entry = card["entryPrice"]
        exit_price = card.get("currentPrice", entry)
        if card.get("state") == CARD_STATE["LONG"]:
            pnl_pct = ((exit_price - entry) / entry) * 100
        else:  # SHORT
            pnl_pct = ((entry - exit_price) / entry) * 100
        
        card["pnlSummary"] = {
            "entryPrice": entry,
            "exitPrice": exit_price,
            "pnlPercent": pnl_pct,
            "lossCount": 1 if pnl_pct < 0 else 0,
            "totalLoss": pnl_pct if pnl_pct < 0 else 0
        }
    
    # 상태 이력 기록
    card["stateHistory"].append({
        "from": card.get("state"),
        "to": CARD_STATE["REMOVED"],
        "at": time.time(),
        "reason": remove_reason or "manual_remove"
    })
    
    # 제거된 카드로 이동
    CARD_SYSTEM["removedCards"][card_id] = card
    del CARD_SYSTEM["activeCards"][card_id]
    
    # 주민 통계 업데이트
    if member_name in VILLAGE_RESIDENTS:
        member = VILLAGE_RESIDENTS[member_name]
        if card_id in member["cardSystem"]["activeCards"]:
            member["cardSystem"]["activeCards"].remove(card_id)
    
    print(f"🗑️ [REMOVE_CARD] 카드 {card_id} - {member_name} - 사유: {remove_reason}")
    return True

# 기존 함수들 호환성 유지 (레거시 지원)
def execute_card_buy(card_id, buy_info):
    """카드 매수 실행 (레거시 호환)"""
    return execute_card_action(card_id, CARD_ACTION["BUY"], buy_info)

def execute_card_sell(card_id, sell_info):
    """카드 매도 실행 및 완성 (레거시 호환)"""
    # 기존 로직 유지 (EXITED 상태로 전환)
    if card_id not in CARD_SYSTEM["activeCards"]:
        return False
    
    card = CARD_SYSTEM["activeCards"][card_id]
    member_name = card["memberName"]
    
    # 매도 정보 저장
    card["sellInfo"] = sell_info
    card["state"] = CARD_STATE["EXITED"]
    card["sellCompletedAt"] = time.time()
    
    # 성과 계산
    performance = calculate_card_performance(card)
    card["performance"] = performance
    
    # 완성된 카드로 이동
    CARD_SYSTEM["completedCards"][card_id] = card
    del CARD_SYSTEM["activeCards"][card_id]
    
    # 주민 통계 업데이트
    if member_name in VILLAGE_RESIDENTS:
        member = VILLAGE_RESIDENTS[member_name]
        member["cardSystem"]["activeCards"].remove(card_id)
        member["cardSystem"]["completedCards"].append(card_id)
        
        # 성과 업데이트
        member["cardSystem"]["totalCardsAnalyzed"] += 1
        if performance["success"]:
            member["cardSystem"]["successfulCards"] += 1
            member["cardSystem"]["totalProfit"] += performance["profit"]
        else:
            member["cardSystem"]["failedCards"].append(card_id)
        
        # 성공률 계산
        total_analyzed = member["cardSystem"]["totalCardsAnalyzed"]
        successful = member["cardSystem"]["successfulCards"]
        if total_analyzed > 0:
            member["cardSystem"]["analysisSuccessRate"] = successful / total_analyzed
            member["cardSystem"]["averageProfit"] = member["cardSystem"]["totalProfit"] / total_analyzed
        
        # 현재 분석 상태 초기화
        member["cardSystem"]["currentAnalysis"] = None
    
    print(f"✅ 카드 완성: {member_name} - 카드 {card_id} (수익: {performance['profit']:.2f}%)")
    return True

def generate_trading_strategy(member, timeframe, pattern_data):
    """주민의 전문성에 따른 거래 전략 생성"""
    strategy = {
        "timeframe": timeframe,
        "memberRole": member["role"],
        "specialty": member["specialty"],
        "confidence": 0.0,
        "buyCondition": "",
        "sellCondition": "",
        "stopLoss": "",
        "takeProfit": "",
        "expectedProfit": 0.0,
        "expectedRisk": 0.0
    }
    
    # 주민별 전략 생성
    if member["role"] == "Explorer":  # Scout
        strategy.update({
            "buyCondition": "RSI < 25 && volume_spike > 200%",
            "sellCondition": "profit >= 1.5% || RSI > 75",
            "stopLoss": "loss >= -0.8%",
            "takeProfit": "profit >= 2%",
            "expectedProfit": 1.5,
            "expectedRisk": -0.8,
            "confidence": 0.85
        })
    elif member["role"] == "Protector":  # Guardian
        strategy.update({
            "buyCondition": "MACD_crossover && support_level",
            "sellCondition": "resistance_level || profit >= 2.5%",
            "stopLoss": "loss >= -1.2%",
            "takeProfit": "profit >= 3%",
            "expectedProfit": 2.5,
            "expectedRisk": -1.2,
            "confidence": 0.80
        })
    elif member["role"] == "Strategist":  # Analyst
        strategy.update({
            "buyCondition": "price_breakout_above_resistance",
            "sellCondition": "trend_exhaustion || profit >= 3%",
            "stopLoss": "loss >= -1.5%",
            "takeProfit": "profit >= 4%",
            "expectedProfit": 3.0,
            "expectedRisk": -1.5,
            "confidence": 0.75
        })
    elif member["role"] == "Advisor":  # Elder
        strategy.update({
            "buyCondition": "strong_uptrend_confirmation",
            "sellCondition": "trend_reversal || profit >= 4%",
            "stopLoss": "loss >= -2%",
            "takeProfit": "profit >= 5%",
            "expectedProfit": 4.0,
            "expectedRisk": -2.0,
            "confidence": 0.70
        })
    
    return strategy

def evaluate_card_state_machine(card, market_data=None):
    """
    카드 상태 머신 평가 함수
    우선순위 규칙에 따라 상태와 액션을 결정
    
    Args:
        card: 카드 객체
        market_data: 시장 데이터 (가격, 지표 등)
    
    Returns:
        (new_state, action, reason)
    """
    current_state = card.get("state", CARD_STATE["NEW"])
    current_price = market_data.get("price", 0) if market_data else card.get("currentPrice", 0)
    card["currentPrice"] = current_price
    
    # 우선순위 1: 데이터 이상이면 무조건 정지
    if card.get("dataQuality") in ["DATA_BAD", "DATA_WARN"]:
        data_quality_count = card.get("dataQualityCount", 0)
        if data_quality_count >= 3:  # 연속 3회 이상
            if current_state in [CARD_STATE["LONG"], CARD_STATE["SHORT"]]:
                # 포지션 있으면 즉시 청산 후 제거
                if current_state == CARD_STATE["LONG"]:
                    return CARD_STATE["EXITED"], CARD_ACTION["SELL_TO_CLOSE"], "data_bad_force_close"
                else:
                    return CARD_STATE["EXITED"], CARD_ACTION["BUY_TO_CLOSE"], "data_bad_force_close"
            else:
                # 포지션 없으면 바로 제거
                return CARD_STATE["REMOVED"], CARD_ACTION["REMOVE_CARD"], "data_bad_no_position"
    
    # 우선순위 2: 리스크 실패면 진입 금지
    if card.get("riskStatus") in ["RISK_WIDE_STOP", "RISK_BAD_RR"]:
        if current_state in [CARD_STATE["NEW"], CARD_STATE["WATCH"]]:
            # 진입 금지, WATCH 유지 또는 제거 조건 검사
            if card.get("score", 0) < 40:  # 점수가 너무 낮으면 제거
                return CARD_STATE["REMOVED"], CARD_ACTION["REMOVE_CARD"], "risk_fail_low_score"
            return CARD_STATE["WATCH"], CARD_ACTION["WAIT"], "risk_fail_wait"
    
    # 우선순위 3: 손절 조건은 최우선 청산 (포지션 보유 중일 때만)
    if current_state == CARD_STATE["LONG"]:
        # 롱 포지션 손절 체크
        entry_price = card.get("entryPrice", 0)
        stop_loss = card.get("stopLoss", 0)
        if entry_price > 0 and stop_loss > 0:
            if current_price <= stop_loss:
                return CARD_STATE["EXITED"], CARD_ACTION["SELL_TO_CLOSE"], "stop_loss_hit"
        
        # 점수 급락 체크
        if card.get("score", 0) < 55:  # 청산 임계치
            return CARD_STATE["EXITED"], CARD_ACTION["SELL_TO_CLOSE"], "score_drop"
    
    if current_state == CARD_STATE["SHORT"]:
        # 숏 포지션 손절 체크
        entry_price = card.get("entryPrice", 0)
        stop_loss = card.get("stopLoss", 0)
        if entry_price > 0 and stop_loss > 0:
            if current_price >= stop_loss:
                return CARD_STATE["EXITED"], CARD_ACTION["BUY_TO_CLOSE"], "stop_loss_hit"
        
        # 점수 급락 체크
        if card.get("score", 0) < 55:  # 청산 임계치
            return CARD_STATE["EXITED"], CARD_ACTION["BUY_TO_CLOSE"], "score_drop"
    
    # 상태별 규칙 평가
    if current_state == CARD_STATE["NEW"]:
        # NEW -> WATCH로 전환
        return CARD_STATE["WATCH"], CARD_ACTION["WAIT"], "initial_watch"
    
    elif current_state == CARD_STATE["WATCH"]:
        # 매수 규칙 평가
        if (card.get("dataQuality") == "DATA_OK" and
            card.get("trend") == "TREND_UP" and
            card.get("momentum") in ["MOM_UP", "MOM_NEUTRAL"] and
            card.get("structure") in ["BREAK_UP", "RETEST_OK"] and
            card.get("score", 0) >= 70 and
            card.get("riskStatus") == "RISK_OK"):
            return CARD_STATE["LONG"], CARD_ACTION["BUY"], "buy_signal"
        
        # 매도 규칙 평가 (숏 진입)
        if (card.get("dataQuality") == "DATA_OK" and
            card.get("trend") == "TREND_DOWN" and
            card.get("momentum") in ["MOM_DOWN", "MOM_NEUTRAL"] and
            card.get("structure") in ["BREAK_DOWN", "RETEST_OK"] and
            card.get("score", 0) >= 70 and
            card.get("riskStatus") == "RISK_OK"):
            return CARD_STATE["SHORT"], CARD_ACTION["SELL_SHORT"], "sell_short_signal"
        
        # WATCH 유지
        return CARD_STATE["WATCH"], CARD_ACTION["WAIT"], "watch_continue"
    
    elif current_state == CARD_STATE["LONG"]:
        # 롱 청산 규칙 평가
        entry_price = card.get("entryPrice", 0)
        take_profit = card.get("takeProfit", 0)
        
        # 1. TAKE_PROFIT 도달
        if entry_price > 0 and take_profit > 0 and current_price >= take_profit:
            return CARD_STATE["EXITED"], CARD_ACTION["SELL_TO_CLOSE"], "take_profit_hit"
        
        # 2. TREND가 DOWN으로 전환 또는 BREAK_DOWN 발생
        if card.get("trend") == "TREND_DOWN" or card.get("structure") == "BREAK_DOWN":
            return CARD_STATE["EXITED"], CARD_ACTION["SELL_TO_CLOSE"], "trend_reversal"
        
        # 3. MOM이 DOWN으로 강하게 꺾임
        if card.get("momentum") == "MOM_DOWN":
            return CARD_STATE["EXITED"], CARD_ACTION["SELL_TO_CLOSE"], "momentum_down"
        
        # 4. SCORE가 청산 임계치 이하로 하락
        if card.get("score", 0) < 55:
            return CARD_STATE["EXITED"], CARD_ACTION["SELL_TO_CLOSE"], "score_below_threshold"
        
        # LONG 유지
        return CARD_STATE["LONG"], CARD_ACTION["WAIT"], "long_hold"
    
    elif current_state == CARD_STATE["SHORT"]:
        # 숏 청산 규칙 평가
        entry_price = card.get("entryPrice", 0)
        take_profit = card.get("takeProfit", 0)
        
        # 1. TAKE_PROFIT 도달
        if entry_price > 0 and take_profit > 0 and current_price <= take_profit:
            return CARD_STATE["EXITED"], CARD_ACTION["BUY_TO_CLOSE"], "take_profit_hit"
        
        # 2. TREND가 UP으로 전환 또는 BREAK_UP 발생
        if card.get("trend") == "TREND_UP" or card.get("structure") == "BREAK_UP":
            return CARD_STATE["EXITED"], CARD_ACTION["BUY_TO_CLOSE"], "trend_reversal"
        
        # 3. MOM이 UP으로 강하게 전환
        if card.get("momentum") == "MOM_UP":
            return CARD_STATE["EXITED"], CARD_ACTION["BUY_TO_CLOSE"], "momentum_up"
        
        # 4. SCORE가 청산 임계치 이하로 하락
        if card.get("score", 0) < 55:
            return CARD_STATE["EXITED"], CARD_ACTION["BUY_TO_CLOSE"], "score_below_threshold"
        
        # SHORT 유지
        return CARD_STATE["SHORT"], CARD_ACTION["WAIT"], "short_hold"
    
    elif current_state == CARD_STATE["EXITED"]:
        # EXITED 상태에서는 제거 조건만 평가
        return evaluate_remove_conditions(card)
    
    # 기본값: 현재 상태 유지
    return current_state, CARD_ACTION["WAIT"], "no_change"

def evaluate_remove_conditions(card):
    """
    카드 제거 조건 평가
    제거는 "거래 액션"이 아니라 "운영 액션"
    """
    current_state = card.get("state", CARD_STATE["NEW"])
    
    # 1. EXITED 이후 성과가 기준 미달
    if current_state == CARD_STATE["EXITED"]:
        pnl_summary = card.get("pnlSummary", {})
        if pnl_summary:
            loss_count = pnl_summary.get("lossCount", 0)
            total_loss = pnl_summary.get("totalLoss", 0)
            
            # 연속 K회 손실 (예: 3회)
            if loss_count >= 3:
                return CARD_STATE["REMOVED"], CARD_ACTION["REMOVE_CARD"], "loss_streak"
            
            # 누적 손실률이 LIMIT 초과 (예: -5%)
            if total_loss <= -5.0:
                return CARD_STATE["REMOVED"], CARD_ACTION["REMOVE_CARD"], "cumulative_loss"
    
    # 2. 시간 만료 (TTL 초과)
    created_at = card.get("createdAt", 0)
    if created_at > 0:
        elapsed = time.time() - created_at
        ttl_hours = 24  # 24시간 TTL
        if elapsed > (ttl_hours * 3600):
            return CARD_STATE["REMOVED"], CARD_ACTION["REMOVE_CARD"], "ttl_expired"
    
    # 3. 신호 품질 불량
    score = card.get("score", 0)
    if score < 40:
        # 낮은 점수가 M분 이상 지속 (예: 30분)
        low_score_start = card.get("lowScoreStartTime", None)
        if low_score_start:
            if time.time() - low_score_start > 1800:  # 30분
                return CARD_STATE["REMOVED"], CARD_ACTION["REMOVE_CARD"], "low_score_duration"
        else:
            card["lowScoreStartTime"] = time.time()
    
    # 4. 데이터 이상 반복
    if card.get("dataQuality") == "DATA_WARN":
        warn_count = card.get("dataWarnCount", 0)
        if warn_count >= 5:  # 경고가 5회 이상
            return CARD_STATE["REMOVED"], CARD_ACTION["REMOVE_CARD"], "data_warn_repeated"
    
    # 5. 중복 카드 정리 (같은 timeframe에서 하위 점수 카드 제거)
    # 이는 외부에서 처리해야 함
    
    # 제거 조건 미충족
    return current_state, CARD_ACTION["WAIT"], "keep_active"

def calculate_card_performance(card):
    """카드 성과 계산"""
    if not card.get("buyInfo") or not card.get("sellInfo"):
        return {"success": False, "profit": 0.0, "reason": "거래 정보 부족"}
    
    buy_price = card["buyInfo"]["price"]
    sell_price = card["sellInfo"]["price"]
    buy_time = card["buyInfo"]["time"]
    sell_time = card["sellInfo"]["time"]
    
    # 수익률 계산
    profit_percent = ((sell_price - buy_price) / buy_price) * 100
    
    # 성공 여부 판단
    success = profit_percent > 0
    
    # 거래 시간 계산
    duration = sell_time - buy_time
    
    return {
        "success": success,
        "profit": profit_percent,
        "buyPrice": buy_price,
        "sellPrice": sell_price,
        "duration": duration,
        "reason": "목표 달성" if success else "손실 발생"
    }

def update_card_state_machine(card_id, market_data=None):
    """
    카드 상태 머신 업데이트
    상태를 평가하고 필요한 액션을 실행
    """
    if card_id not in CARD_SYSTEM["activeCards"]:
        return False
    
    card = CARD_SYSTEM["activeCards"][card_id]
    
    # 상태 머신 평가
    new_state, action, reason = evaluate_card_state_machine(card, market_data)
    
    # 상태 변경이 있으면 액션 실행
    if new_state != card.get("state") or action != card.get("action"):
        # 액션 실행
        action_data = None
        if action in [CARD_ACTION["BUY"], CARD_ACTION["SELL_SHORT"]]:
            # 진입 액션: 가격 정보 필요
            action_data = {
                "price": market_data.get("price", 0) if market_data else card.get("currentPrice", 0),
                "amount": market_data.get("amount", 0) if market_data else 0,
                "fee": market_data.get("fee", 0) if market_data else 0,
                "stopLoss": card.get("stopLoss"),
                "takeProfit": card.get("takeProfit")
            }
        elif action in [CARD_ACTION["SELL_TO_CLOSE"], CARD_ACTION["BUY_TO_CLOSE"]]:
            # 청산 액션: 가격 정보 필요
            action_data = {
                "price": market_data.get("price", 0) if market_data else card.get("currentPrice", 0),
                "amount": market_data.get("amount", 0) if market_data else 0,
                "fee": market_data.get("fee", 0) if market_data else 0
            }
        elif action == CARD_ACTION["REMOVE_CARD"]:
            # 제거 액션: 사유 전달
            action_data = reason
        
        execute_card_action(card_id, action, action_data)
        
        # 액션 이력 기록
        card["actionHistory"].append({
            "action": action,
            "state": new_state,
            "reason": reason,
            "at": time.time()
        })
        
        return True
    
    return False

def update_all_cards_state_machine(market_data_dict=None):
    """
    모든 활성 카드의 상태 머신 업데이트
    market_data_dict: {card_id: market_data} 형식의 딕셔너리
    """
    updated_count = 0
    for card_id in list(CARD_SYSTEM["activeCards"].keys()):
        market_data = market_data_dict.get(card_id) if market_data_dict else None
        if update_card_state_machine(card_id, market_data):
            updated_count += 1
    return updated_count

def get_member_card_status(member_name):
    """주민의 카드 상태 조회"""
    if member_name not in VILLAGE_RESIDENTS:
        return None
    
    member = VILLAGE_RESIDENTS[member_name]
    card_system = member["cardSystem"]
    
    return {
        "memberName": member_name,
        "role": member["role"],
        "assignedTimeframes": member["assignedTimeframes"],
        "activeCards": len(card_system["activeCards"]),
        "completedCards": len(card_system["completedCards"]),
        "failedCards": len(card_system["failedCards"]),
        "analysisSuccessRate": card_system["analysisSuccessRate"],
        "totalCardsAnalyzed": card_system["totalCardsAnalyzed"],
        "successfulCards": card_system["successfulCards"],
        "averageProfit": card_system["averageProfit"],
        "totalProfit": card_system["totalProfit"],
        "currentAnalysis": card_system["currentAnalysis"]
    }

# 트레이너 창고 시스템 (카드 기반으로 개선)
TRAINER_WAREHOUSES = {}

def initialize_trainer_warehouses():
    """트레이너 창고 초기화"""
    for trainer_name, trainer_data in VILLAGE_RESIDENTS.items():
        TRAINER_WAREHOUSES[trainer_name] = {
            "location": f"{trainer_data['location']} Warehouse",
            "capacity": "무제한",
            "real_time_storage": True,
            "trade_records": {
                "real_trades": [],
                "mock_trades": [],
                "current_position": None
            },
            "profit_loss_history": {
                "total_profit": 0,
                "win_rate": 0,
                "total_trades": 0,
                "profitable_trades": 0,
                "losing_trades": 0
            },
            "learning_data": {
                "successful_patterns": [],
                "failed_patterns": [],
                "market_conditions": [],
                "strategy_effectiveness": {}
            },
            # 거래 일지 시스템 추가
            "trade_journal": {
                "recent_entries": [],  # 최근 10개 거래 일지
                "zone_entries": {      # 구역별 거래 일지
                    "ORANGE": [],
                    "BLUE": []
                },
                "mayor_guidance_log": [],  # 촌장 지침 기록
                "ml_model_decisions": []   # ML 모델 판단 기록
            },
            # AI 분석 결과 저장 시스템 추가
            "ai_analysis": {
                "current": None,  # 현재 분석 결과
                "history": [],    # 분석 히스토리 (최대 50개)
                "last_updated": None  # 마지막 업데이트 시간
            }
        }

# 비트카 에너지 시스템
BITCAR_ENERGY_SYSTEM = {
    "scout": {"energy": 70, "bitcar_model": "Quick Signal Runner"},
    "guardian": {"energy": 80, "bitcar_model": "Trend Protector"},
    "analyst": {"energy": 90, "bitcar_model": "Strategic Analyzer"},
    "elder": {"energy": 85, "bitcar_model": "Wisdom Keeper"}
}

# 마을 시스템 초기화
initialize_trainer_warehouses()

# ===== 8BIT 마을 시스템 함수들 =====

def mayor_trust_guidance():
    """촌장의 신뢰도 기반 지침 생성"""
    global MAYOR_TRUST_SYSTEM
    
    guidance = {
        "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "location": "Town Hall",
        "announcement": "마을 주민 여러분, 신뢰도 기반 지침을 전달합니다.",
        
        "trust_analysis": {
            "ml_model_trust": MAYOR_TRUST_SYSTEM["ML_Model_Trust"],
            "nb_guild_trust": MAYOR_TRUST_SYSTEM["NB_Guild_Trust"],
            "interpretation": "신뢰도 분석 결과"
        },
        
        "guidance": {
            "zone": "ORANGE",
            "official_strategy": "신중한 방어적 접근",
            "trust_adjusted_strategy": "개인 판단 우선, ML 모델 참고",
            "energy_requirement": "최소 50 에너지",
            "special_instructions": "신뢰도 시스템 준수"
        }
    }
    
    MAYOR_TRUST_SYSTEM["last_guidance"] = guidance
    MAYOR_TRUST_SYSTEM["guidance_history"].append(guidance)
    
    return guidance

def generate_ai_trading_explanation(trainer_name, current_action, current_zone, r_value, confidence, position_status):
    """AI 거래 판단 설명 생성"""
    
    explanations = {
        "BUY": {
            "BLUE": {
                "reason": "✅ 촌장 지침 준수: BLUE 구역에서 BUY 허용",
                "timing": "🕐 즉시 실행 가능 (구역 조건 충족)",
                "confidence": f"🤖 ML 모델 신뢰도: {confidence}%",
                "zone_status": f"📊 현재 r값: {r_value:.3f} (BLUE 구역 유지)",
                "strategy": "📈 공격적 매수 전략 (BLUE 구역 특성)"
            },
            "ORANGE": {
                "reason": "❌ 촌장 지침 위반: ORANGE 구역에서 BUY 금지",
                "timing": "⏳ BLUE 구역 전환 대기 필요 (r값 0.45 이하)",
                "confidence": f"🤖 ML 모델 신뢰도: {confidence}% (낮음)",
                "zone_status": f"📊 현재 r값: {r_value:.3f} (ORANGE 구역)",
                "strategy": "⚠️ 개인 판단 우선 (촌장 지침 무시)"
            }
        },
        "SELL": {
            "BLUE": {
                "reason": "❌ 촌장 지침 위반: BLUE 구역에서 SELL 금지",
                "timing": "⏳ ORANGE 구역 전환 대기 필요 (r값 0.55 이상)",
                "confidence": f"🤖 ML 모델 신뢰도: {confidence}% (낮음)",
                "zone_status": f"📊 현재 r값: {r_value:.3f} (BLUE 구역)",
                "strategy": "⚠️ 개인 판단 우선 (촌장 지침 무시)"
            },
            "ORANGE": {
                "reason": "✅ 촌장 지침 준수: ORANGE 구역에서 SELL 허용",
                "timing": "🕐 즉시 실행 가능 (구역 조건 충족)",
                "confidence": f"🤖 ML 모델 신뢰도: {confidence}%",
                "zone_status": f"📊 현재 r값: {r_value:.3f} (ORANGE 구역 유지)",
                "strategy": "📉 방어적 매도 전략 (ORANGE 구역 특성)"
            }
        },
        "HOLD": {
            "BLUE": {
                "reason": "⏸️ BLUE 구역에서 관망 (BUY 대기)",
                "timing": "🕐 적절한 진입 시점 대기",
                "confidence": f"🤖 ML 모델 신뢰도: {confidence}%",
                "zone_status": f"📊 현재 r값: {r_value:.3f} (BLUE 구역)",
                "strategy": "👀 관망 전략 (더 나은 진입점 대기)"
            },
            "ORANGE": {
                "reason": "⏸️ ORANGE 구역에서 관망 (SELL 대기)",
                "timing": "🕐 적절한 청산 시점 대기",
                "confidence": f"🤖 ML 모델 신뢰도: {confidence}%",
                "zone_status": f"📊 현재 r값: {r_value:.3f} (ORANGE 구역)",
                "strategy": "👀 관망 전략 (더 나은 청산점 대기)"
            }
        }
    }
    
    # 포지션 상태에 따른 추가 설명
    position_explanation = ""
    if position_status == "HAS_POSITION":
        if current_action == "SELL":
            position_explanation = "💼 포지션 보유 중 - 청산 시점 판단"
        elif current_action == "BUY":
            position_explanation = "💼 포지션 보유 중 - 추가 매수 고려"
        elif current_action == "HOLD":
            position_explanation = "💼 포지션 보유 중 - 관망 전략"
    else:
        position_explanation = "💼 포지션 없음 - 진입 시점 판단"
    
    base_explanation = explanations.get(current_action, {}).get(current_zone, {})
    
    # 기본값 설정으로 "알 수 없음" 방지
    default_reason = f"현재 {current_zone} 구역에서 {current_action} 판단"
    default_timing = "적절한 시점 모니터링 중"
    default_confidence = f"🤖 ML 모델 신뢰도: {confidence}%"
    default_zone_status = f"📊 현재 r값: {r_value:.3f} ({current_zone} 구역)"
    default_strategy = f"기본 {current_action} 전략"
    
    return {
        "trainer": trainer_name,
        "current_action": current_action,
        "current_zone": current_zone,
        "r_value": r_value,
        "confidence": confidence,
        "position_status": position_status,
        "explanation": {
            "reason": base_explanation.get("reason", default_reason),
            "timing": base_explanation.get("timing", default_timing),
            "confidence": base_explanation.get("confidence", default_confidence),
            "zone_status": base_explanation.get("zone_status", default_zone_status),
            "strategy": base_explanation.get("strategy", default_strategy),
            "position": position_explanation
        },
        "timestamp": datetime.now().isoformat()
    }

def auto_mayor_guidance_learning():
    """자동 촌장 지침 학습 실행 - 개선된 클래스 균형 처리"""
    global MAYOR_TRUST_SYSTEM
    
    try:
        # 자동 학습이 비활성화되어 있으면 스킵
        if not MAYOR_TRUST_SYSTEM.get("auto_learning_enabled", True):
            return
        
        current_time = time.time()
        last_learning_time = MAYOR_TRUST_SYSTEM.get("last_learning_time")
        learning_interval = MAYOR_TRUST_SYSTEM.get("learning_interval", 3600)  # 1시간
        
        # 학습 간격 체크
        if last_learning_time and (current_time - last_learning_time) < learning_interval:
            return
        
        print("🏛️ 자동 촌장 지침 학습 시작...")
        
        # 촌장 지침 학습 모델 훈련 실행
        cfg = load_config()
        window = 50
        ema_fast = 10
        ema_slow = 30
        horizon = 5
        count = 1800
        interval = cfg.candle
        
        df = get_candles(cfg.market, interval, count=count)
        
        if df is None or len(df) < 200:
            print(f"❌ 자동 촌장 지침 학습 실패: 데이터 부족 (현재: {len(df) if df is not None else 0})")
            return
        
        # 촌장 지침 기반 특성 생성
        feat = _build_features(df, window, ema_fast, ema_slow, horizon)
        if 'fwd' not in feat.columns:
            print("❌ 자동 촌장 지침 학습 실패: fwd 컬럼 없음")
            return
        
        feat = feat.dropna(subset=['fwd']).copy()
        
        if len(feat) < 100:
            print(f"❌ 자동 촌장 지침 학습 실패: 유효 데이터 부족 (현재: {len(feat)})")
            return
        
        # 촌장 지침 라벨링: 동적 임계값 기반
        r = _compute_r_from_ohlcv(df, window)
        HIGH = float(os.getenv('NB_HIGH', '0.55'))
        LOW = float(os.getenv('NB_LOW', '0.45'))
        
        r_vals = r.values if hasattr(r, 'values') else np.array(r)
        r_vals = r_vals[~np.isnan(r_vals)]  # NaN 제거
        
        if len(r_vals) < 100:
            print(f"❌ 자동 촌장 지침 학습 실패: r 값 부족 (현재: {len(r_vals)})")
            return
        
        # 동적 임계값: r 값의 분위수 기반
        r_mean = float(np.mean(r_vals))
        r_std = float(np.std(r_vals))
        
        # std가 0이면 기본값 사용
        if r_std < 1e-6:
            r_std = 0.01
        
        # 25%, 50%, 75% 분위수로 3개 클래스 분류
        LOW_DYNAMIC = float(np.percentile(r_vals, 33))
        HIGH_DYNAMIC = float(np.percentile(r_vals, 67))
        
        print(f"[AUTO] r 분포 - mean={r_mean:.4f}, std={r_std:.6f}")
        print(f"[AUTO] 동적 임계값 - low={LOW_DYNAMIC:.4f}, high={HIGH_DYNAMIC:.4f}")
        
        labels = np.zeros(len(df), dtype=int)
        
        # 동적 임계값으로 분류
        for i in range(len(df)):
            rv = float(r_vals[i]) if i < len(r_vals) else r_mean
            
            if rv >= HIGH_DYNAMIC:
                labels[i] = -1  # SELL (ORANGE)
            elif rv <= LOW_DYNAMIC:
                labels[i] = 1   # BUY (BLUE)
            else:
                labels[i] = 0   # HOLD (중간)
        
        idx_map = { ts: i for i, ts in enumerate(df.index) }
        y = np.array([ labels[idx_map.get(ts, 0)] for ts in feat.index ], dtype=int)
        
        # 클래스 균형 확인
        unique_classes = np.unique(y)
        class_counts = {cls: int(np.sum(y == cls)) for cls in unique_classes}
        
        print(f"[AUTO] 클래스 분포 - {class_counts}")
        
        if len(unique_classes) < 2:
            print(f"❌ 자동 촌장 지침 학습 실패: 클래스 부족 (필요: 2+, 현재: {len(unique_classes)}, 값: {unique_classes.tolist()})")
            return
        
        # 소수 클래스 샘플 수 확인
        min_class_count = min(class_counts.values())
        if min_class_count < 5:
            print(f"⚠️ 클래스 불균형 경고: 최소 클래스 샘플 수 {min_class_count}개")
        
        # 모델 훈련
        from sklearn.ensemble import GradientBoostingClassifier
        from sklearn.metrics import classification_report
        from sklearn.impute import SimpleImputer
        
        # 특성 선택 (사용 가능한 특성만)
        available_features = ['r', 'w', 'ema_diff', 'zone_flag', 'dist_high', 'dist_low', 'zone_conf']
        feature_cols = [col for col in available_features if col in feat.columns]
        
        if len(feature_cols) == 0:
            print("❌ 자동 촌장 지침 학습 실패: 사용 가능한 특성 없음")
            return
        
        X = feat[feature_cols].copy()
        
        # NaN 값 처리 - 중요!
        # 먼저 NaN 행 제거
        valid_idx = ~X.isna().any(axis=1) & ~pd.Series(y, index=X.index).isna()
        X_clean = X[valid_idx].copy()
        y_clean = y[valid_idx.values]
        
        print(f"🏛️ NaN 제거 전: X.shape={X.shape}, 제거 후: X_clean.shape={X_clean.shape}")
        
        if len(X_clean) < 50:
            print(f"❌ 자동 촌장 지침 학습 실패: 유효 데이터 부족 (현재: {len(X_clean)}, 필요: 50+)")
            return
        
        # 혹시 모를 NaN이 남아 있으면 보완 처리
        imputer = SimpleImputer(strategy='median')
        X_imputed = pd.DataFrame(
            imputer.fit_transform(X_clean),
            columns=feature_cols,
            index=X_clean.index
        )
        
        # 최종 검증: NaN 확인
        if X_imputed.isna().any().any():
            print("⚠️ 경고: 여전히 NaN이 존재합니다. 드롭 처리...")
            valid_final = ~X_imputed.isna().any(axis=1)
            X_imputed = X_imputed[valid_final]
            y_clean = y_clean[valid_final.values]
        
        print(f"🏛️ 최종 훈련 데이터: X.shape={X_imputed.shape}, y.shape={y_clean.shape}")
        
        # 모델 훈련 (클래스 가중치 적용)
        model = GradientBoostingClassifier(
            random_state=42, 
            n_estimators=150, 
            learning_rate=0.05, 
            max_depth=4,
            min_samples_split=10,
            min_samples_leaf=5
        )
        
        try:
            model.fit(X_imputed.values, y_clean)
        except Exception as fit_err:
            print(f"❌ 자동 촌장 지침 학습 실패: 모델 훈련 오류 - {fit_err}")
            return
        
        # 평가
        yhat = model.predict(X_imputed.values)
        report = classification_report(y_clean, yhat, output_dict=True, zero_division=0)
        
        # 모델 저장
        pack = {
            'model': model,
            'window': window,
            'ema_fast': ema_fast,
            'ema_slow': ema_slow,
            'horizon': horizon,
            'interval': interval,
            'label_mode': 'mayor_guidance',
            'trained_at': int(current_time * 1000),
            'feature_names': feature_cols,
            'metrics': {
                'report': report
            }
        }
        
        # 모델 저장
        try:
            joblib.dump(pack, _model_path_for(interval))
            print(f"✅ 자동 촌장 지침 학습 완료 - 모델 저장됨")
        except Exception as e:
            print(f"⚠️ 모델 저장 실패 (fallback): {e}")
            try:
                joblib.dump(pack, ML_MODEL_PATH)
                print("✅ 모델 fallback 경로 저장 완료")
            except Exception as fb_err:
                print(f"❌ 모델 저장 완전 실패: {fb_err}")
                return
        
        # 학습 시간 업데이트
        MAYOR_TRUST_SYSTEM["last_learning_time"] = current_time
        
        # 학습 결과 로그
        classes = {
            '-1': int((y_clean==-1).sum()),  # SELL (ORANGE)
            '0': int((y_clean==0).sum()),    # HOLD
            '1': int((y_clean==1).sum())     # BUY (BLUE)
        }
        print(f"📊 자동 학습 결과 - BUY: {classes['1']}, HOLD: {classes['0']}, SELL: {classes['-1']}")
        
        # 정확도 로그
        accuracy = report.get('accuracy', 0)
        print(f"🎯 모델 정확도: {accuracy:.2%}")
        
    except Exception as e:
        import traceback
        print(f"❌ 자동 촌장 지침 학습 실패: {e}")
        print(traceback.format_exc())

def calculate_weighted_confidence(personal_confidence, ml_trust, nb_guild_trust):
    """신뢰도 가중 평균 계산"""
    return (personal_confidence * 0.6) + (ml_trust * 0.2) + (nb_guild_trust * 0.2)

def real_time_trade_recording(trainer_name, trade_data):
    """실시간 거래 기록 저장"""
    global TRAINER_WAREHOUSES
    
    if trainer_name not in TRAINER_WAREHOUSES:
        return {"error": "트레이너를 찾을 수 없습니다."}
    
    warehouse = TRAINER_WAREHOUSES[trainer_name]
    
    # 거래 기록 저장
    trade_record = {
        'timestamp': trade_data.get('timestamp', datetime.now().isoformat()),
        'action': trade_data.get('action'),
        'price': trade_data.get('price'),
        'quantity': trade_data.get('quantity', 0),
        'pnl': trade_data.get('pnl', 0),
        'strategy': trade_data.get('strategy'),
        'zone': trade_data.get('zone'),
        'confidence': trade_data.get('confidence', 0),
        'trainer': trainer_name
    }
    
    if trade_data.get('is_real', False):
        warehouse['trade_records']['real_trades'].append(trade_record)
    else:
        warehouse['trade_records']['mock_trades'].append(trade_record)
    
    # 수익/손실 업데이트
    update_profit_loss_history(warehouse, trade_data)
    
    # 학습 데이터 수집
    collect_learning_data(warehouse, trade_data)
    
    return {"message": f"{trainer_name}의 거래 기록이 창고에 저장되었습니다."}

def update_profit_loss_history(warehouse, trade_data):
    """수익/손실 기록 업데이트"""
    history = warehouse['profit_loss_history']
    
    # 거래 수 증가
    history['total_trades'] += 1
    
    pnl = trade_data.get('pnl', 0)
    
    # 수익/손실 계산
    if pnl > 0:
        history['profitable_trades'] += 1
        history['total_profit'] += pnl
    else:
        history['losing_trades'] += 1
        history['total_profit'] += pnl
    
    # 승률 계산
    if history['total_trades'] > 0:
        history['win_rate'] = (history['profitable_trades'] / history['total_trades']) * 100

def collect_learning_data(warehouse, trade_data):
    """학습 데이터 수집"""
    learning_data = warehouse['learning_data']
    
    pattern_data = {
        'market_condition': trade_data.get('market_condition', 'unknown'),
        'strategy': trade_data.get('strategy', 'unknown'),
        'timing': trade_data.get('timing', 'unknown'),
        'confidence': trade_data.get('confidence', 0),
        'zone': trade_data.get('zone', 'unknown'),
        'timestamp': trade_data.get('timestamp', datetime.now().isoformat())
    }
    
    # 성공 패턴 수집
    if trade_data.get('pnl', 0) > 0:
        learning_data['successful_patterns'].append(pattern_data)
    else:
        # 실패 패턴 수집
        pattern_data['lesson_learned'] = trade_data.get('lesson_learned', '분석 필요')
        learning_data['failed_patterns'].append(pattern_data)

def inject_village_energy_to_bitcar(trainer_name, energy_amount):
    """마을 에너지를 비트카에 주입"""
    global VILLAGE_ENERGY, BITCAR_ENERGY_SYSTEM
    
    if VILLAGE_ENERGY >= energy_amount:
        if trainer_name in BITCAR_ENERGY_SYSTEM:
            BITCAR_ENERGY_SYSTEM[trainer_name]["energy"] = energy_amount
            VILLAGE_ENERGY -= energy_amount
            return f"{trainer_name}의 비트카에 {energy_amount} 에너지 주입 완료"
        else:
            return f"{trainer_name} 트레이너를 찾을 수 없습니다."
    else:
        return "마을 에너지 부족"

def get_trainer_warehouse_status(trainer_name):
    """트레이너 창고 상태 조회"""
    global TRAINER_WAREHOUSES
    
    if trainer_name not in TRAINER_WAREHOUSES:
        return {"error": "트레이너를 찾을 수 없습니다."}
    
    warehouse = TRAINER_WAREHOUSES[trainer_name]
    
    return {
        "trainer": trainer_name,
        "warehouse_location": warehouse["location"],
        "storage_usage": f"{len(warehouse['trade_records']['real_trades']) + len(warehouse['trade_records']['mock_trades'])} 거래 기록",
        "data_integrity": "100%",
        "last_backup": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "real_time_sync": "활성화",
        "profit_loss_summary": warehouse['profit_loss_history']
    }

def analyze_warehouse_data(trainer_name):
    """창고 데이터 기반 전략 분석"""
    global TRAINER_WAREHOUSES
    
    if trainer_name not in TRAINER_WAREHOUSES:
        return {"error": "트레이너를 찾을 수 없습니다."}
    
    warehouse = TRAINER_WAREHOUSES[trainer_name]
    
    analysis = {
        "trainer": trainer_name,
        "profitability_analysis": {
            "total_profit": warehouse['profit_loss_history']['total_profit'],
            "win_rate": warehouse['profit_loss_history']['win_rate'],
            "total_trades": warehouse['profit_loss_history']['total_trades']
        },
        "strategy_effectiveness": {
            "successful_patterns_count": len(warehouse['learning_data']['successful_patterns']),
            "failed_patterns_count": len(warehouse['learning_data']['failed_patterns'])
        },
        "recommendations": generate_strategy_recommendations(warehouse)
    }
    
    return analysis

def generate_strategy_recommendations(warehouse):
    """전략 개선 권장사항 생성"""
    successful_count = len(warehouse['learning_data']['successful_patterns'])
    failed_count = len(warehouse['learning_data']['failed_patterns'])
    
    if successful_count > failed_count:
        return "현재 전략이 효과적입니다. 계속 유지하세요."
    elif failed_count > successful_count:
        return "전략 개선이 필요합니다. 실패 패턴을 분석해보세요."
    else:
        return "전략이 균형을 이루고 있습니다. 더 많은 데이터를 수집해보세요."

# ===== 거래 일지 시스템 =====

def add_trade_journal_entry(trainer_name, entry_data):
    """거래 일지 항목 추가"""
    global TRAINER_WAREHOUSES
    
    if trainer_name not in TRAINER_WAREHOUSES:
        return {"error": "트레이너를 찾을 수 없습니다."}
    
    warehouse = TRAINER_WAREHOUSES[trainer_name]
    journal = warehouse['trade_journal']
    
    # 기본 일지 항목 생성
    journal_entry = {
        'timestamp': entry_data.get('timestamp', datetime.now().isoformat()),
        'trainer': trainer_name,
        'action': entry_data.get('action', 'UNKNOWN'),
        'zone': entry_data.get('zone', 'UNKNOWN'),
        'price': entry_data.get('price', 0),
        'pnl': entry_data.get('pnl', 0),
        'strategy': entry_data.get('strategy', 'unknown'),
        'confidence': entry_data.get('confidence', 0),
        'mayor_guidance': entry_data.get('mayor_guidance', ''),
        'ml_decision': entry_data.get('ml_decision', ''),
        'reasoning': entry_data.get('reasoning', ''),
        'lesson_learned': entry_data.get('lesson_learned', ''),
        'trade_type': entry_data.get('trade_type', 'mock')  # 'real' or 'mock'
    }
    
    # 최근 일지에 추가 (최대 10개 유지)
    journal['recent_entries'].append(journal_entry)
    if len(journal['recent_entries']) > 10:
        journal['recent_entries'] = journal['recent_entries'][-10:]
    
    # 구역별 일지에 추가
    zone = entry_data.get('zone', 'UNKNOWN')
    if zone in journal['zone_entries']:
        journal['zone_entries'][zone].append(journal_entry)
        if len(journal['zone_entries'][zone]) > 10:
            journal['zone_entries'][zone] = journal['zone_entries'][zone][-10:]
    
    # 촌장 지침 기록
    if entry_data.get('mayor_guidance'):
        mayor_entry = {
            'timestamp': journal_entry['timestamp'],
            'trainer': trainer_name,
            'guidance': entry_data['mayor_guidance'],
            'zone': zone,
            'action': entry_data.get('action', 'UNKNOWN')
        }
        journal['mayor_guidance_log'].append(mayor_entry)
        if len(journal['mayor_guidance_log']) > 10:
            journal['mayor_guidance_log'] = journal['mayor_guidance_log'][-10:]
    
    # ML 모델 판단 기록
    if entry_data.get('ml_decision'):
        ml_entry = {
            'timestamp': journal_entry['timestamp'],
            'trainer': trainer_name,
            'decision': entry_data['ml_decision'],
            'confidence': entry_data.get('confidence', 0),
            'zone': zone,
            'action': entry_data.get('action', 'UNKNOWN')
        }
        journal['ml_model_decisions'].append(ml_entry)
        if len(journal['ml_model_decisions']) > 10:
            journal['ml_model_decisions'] = journal['ml_model_decisions'][-10:]
    
    return {"message": f"{trainer_name}의 거래 일지에 항목이 추가되었습니다.", "entry": journal_entry}

def get_trade_journal(trainer_name, journal_type="recent", zone=None):
    """거래 일지 조회"""
    global TRAINER_WAREHOUSES
    
    if trainer_name not in TRAINER_WAREHOUSES:
        return {"error": "트레이너를 찾을 수 없습니다."}
    
    warehouse = TRAINER_WAREHOUSES[trainer_name]
    journal = warehouse['trade_journal']
    
    if journal_type == "recent":
        return {
            "trainer": trainer_name,
            "journal_type": "recent",
            "entries": journal['recent_entries'],
            "count": len(journal['recent_entries'])
        }
    elif journal_type == "zone" and zone:
        if zone in journal['zone_entries']:
            return {
                "trainer": trainer_name,
                "journal_type": "zone",
                "zone": zone,
                "entries": journal['zone_entries'][zone],
                "count": len(journal['zone_entries'][zone])
            }
        else:
            return {"error": f"구역 {zone}의 일지를 찾을 수 없습니다."}
    elif journal_type == "mayor_guidance":
        return {
            "trainer": trainer_name,
            "journal_type": "mayor_guidance",
            "entries": journal['mayor_guidance_log'],
            "count": len(journal['mayor_guidance_log'])
        }
    elif journal_type == "ml_decisions":
        return {
            "trainer": trainer_name,
            "journal_type": "ml_decisions",
            "entries": journal['ml_model_decisions'],
            "count": len(journal['ml_model_decisions'])
        }
    else:
        return {"error": "지원하지 않는 일지 유형입니다."}

def create_mayor_guidance_entry(trainer_name, zone, action, reasoning):
    """촌장 지침 기반 거래 일지 생성"""
    guidance_messages = {
        "ORANGE": {
            "BUY": "ORANGE 구역에서 촌장의 방어적 지침을 무시하고 개인 확신으로 BUY 실행",
            "SELL": "ORANGE 구역에서 촌장의 지침에 따라 신중한 SELL 실행",
            "HOLD": "ORANGE 구역에서 촌장의 방어적 지침에 따라 HOLD 결정"
        },
        "BLUE": {
            "BUY": "BLUE 구역에서 촌장의 공격적 지침에 따라 자신감 있는 BUY 실행",
            "SELL": "BLUE 구역에서 촌장의 지침을 무시하고 개인 판단으로 SELL 실행",
            "HOLD": "BLUE 구역에서 촌장의 공격적 지침을 고려하되 HOLD 결정"
        }
    }
    
    guidance = guidance_messages.get(zone, {}).get(action, "촌장의 지침을 고려한 거래 결정")
    
    return {
        'timestamp': datetime.now().isoformat(),
        'trainer': trainer_name,
        'action': action,
        'zone': zone,
        'mayor_guidance': guidance,
        'reasoning': reasoning,
        'trade_type': 'mock'
    }

def create_ml_decision_entry(trainer_name, zone, action, ml_confidence, personal_confidence):
    """ML 모델 판단 기반 거래 일지 생성"""
    ml_trust = MAYOR_TRUST_SYSTEM["ML_Model_Trust"]
    
    if ml_confidence < ml_trust:
        decision = f"ML 모델 신뢰도({ml_confidence}%)가 낮아 개인 판단({personal_confidence}%) 우선"
    else:
        decision = f"ML 모델 신뢰도({ml_confidence}%)가 높아 ML 판단 채택"
    
    return {
        'timestamp': datetime.now().isoformat(),
        'trainer': trainer_name,
        'action': action,
        'zone': zone,
        'ml_decision': decision,
        'ml_confidence': ml_confidence,
        'personal_confidence': personal_confidence,
        'trade_type': 'mock'
    }

# ===== 마을 출입 일지 시스템 함수들 =====

def generate_resident_activity_log(resident_name, zone, activity_type, duration=None):
    """주민 활동 일지 생성 (AI 자동 작성)"""
    activities = {
        "ORANGE": {
            "rest": [
                f"{resident_name}이 ORANGE 구역에서 {duration}간 휴식을 취하며 시장 상황을 관찰했습니다.",
                f"{resident_name}이 ORANGE 구역의 적대적 환경에서 {duration}간 안전한 휴식을 취했습니다.",
                f"{resident_name}이 ORANGE 구역에서 {duration}간 신중한 관찰을 통해 시장 동향을 파악했습니다."
            ],
            "training": [
                f"{resident_name}이 ORANGE 구역에서 {duration}간 방어적 트레이닝을 수행했습니다.",
                f"{resident_name}이 ORANGE 구역에서 {duration}간 신중한 거래 연습을 했습니다.",
                f"{resident_name}이 ORANGE 구역에서 {duration}간 베타 관계 형성에 주의하며 트레이닝했습니다."
            ],
            "observation": [
                f"{resident_name}이 ORANGE 구역에서 {duration}간 적대적 시장 환경을 관찰했습니다.",
                f"{resident_name}이 ORANGE 구역에서 {duration}간 빠른 수익 실현 기회를 모색했습니다.",
                f"{resident_name}이 ORANGE 구역에서 {duration}간 방어적 입장을 유지하며 시장을 분석했습니다."
            ]
        },
        "BLUE": {
            "rest": [
                f"{resident_name}이 BLUE 구역에서 {duration}간 편안한 휴식을 취하며 시장 기회를 기다렸습니다.",
                f"{resident_name}이 BLUE 구역의 우호적 환경에서 {duration}간 여유로운 휴식을 취했습니다.",
                f"{resident_name}이 BLUE 구역에서 {duration}간 자신감을 회복하며 휴식을 취했습니다."
            ],
            "training": [
                f"{resident_name}이 BLUE 구역에서 {duration}간 공격적 트레이닝을 수행했습니다.",
                f"{resident_name}이 BLUE 구역에서 {duration}간 자신감 있는 거래 연습을 했습니다.",
                f"{resident_name}이 BLUE 구역에서 {duration}간 알파 접근법으로 트레이닝했습니다."
            ],
            "observation": [
                f"{resident_name}이 BLUE 구역에서 {duration}간 우호적 시장 환경을 관찰했습니다.",
                f"{resident_name}이 BLUE 구역에서 {duration}간 강한 매수 기회를 모색했습니다.",
                f"{resident_name}이 BLUE 구역에서 {duration}간 공격적 입장을 유지하며 시장을 분석했습니다."
            ]
        },
        "VILLAGE": {
            "rest": [
                f"{resident_name}이 마을에서 {duration}간 편안한 휴식을 취했습니다.",
                f"{resident_name}이 마을에서 {duration}간 동료들과 대화하며 경험을 나눴습니다.",
                f"{resident_name}이 마을에서 {duration}간 촌장의 지침을 받으며 휴식을 취했습니다."
            ],
            "training": [
                f"{resident_name}이 마을에서 {duration}간 이론적 트레이닝을 수행했습니다.",
                f"{resident_name}이 마을에서 {duration}간 동료들과 함께 전략을 논의했습니다.",
                f"{resident_name}이 마을에서 {duration}간 촌장의 멘토링을 받으며 학습했습니다."
            ],
            "observation": [
                f"{resident_name}이 마을에서 {duration}간 시장 동향을 분석했습니다.",
                f"{resident_name}이 마을에서 {duration}간 창고의 거래 기록을 검토했습니다.",
                f"{resident_name}이 마을에서 {duration}간 향후 전략을 계획했습니다."
            ]
        }
    }
    
    import random
    activity_list = activities.get(zone, {}).get(activity_type, [f"{resident_name}이 {zone}에서 활동했습니다."])
    return random.choice(activity_list)

def record_resident_entry_exit(resident_name, from_zone, to_zone, activity_type="training", duration="몇 시간"):
    """주민 출입 기록"""
    global VILLAGE_ENTRY_EXIT_LOG
    
    timestamp = datetime.now().isoformat()
    
    # 출입 기록 생성
    entry_exit_record = {
        'timestamp': timestamp,
        'resident': resident_name,
        'from_zone': from_zone,
        'to_zone': to_zone,
        'activity_type': activity_type,
        'duration': duration,
        'activity_description': generate_resident_activity_log(resident_name, from_zone, activity_type, duration)
    }
    
    # 출발 구역에서 제거
    if from_zone in VILLAGE_ENTRY_EXIT_LOG['zone_logs']:
        if resident_name in VILLAGE_ENTRY_EXIT_LOG['zone_logs'][from_zone]['residents']:
            VILLAGE_ENTRY_EXIT_LOG['zone_logs'][from_zone]['residents'].remove(resident_name)
        VILLAGE_ENTRY_EXIT_LOG['zone_logs'][from_zone]['entry_exit_log'].append(entry_exit_record)
        if len(VILLAGE_ENTRY_EXIT_LOG['zone_logs'][from_zone]['entry_exit_log']) > 10:
            VILLAGE_ENTRY_EXIT_LOG['zone_logs'][from_zone]['entry_exit_log'] = VILLAGE_ENTRY_EXIT_LOG['zone_logs'][from_zone]['entry_exit_log'][-10:]
    
    # 도착 구역에 추가
    if to_zone in VILLAGE_ENTRY_EXIT_LOG['zone_logs']:
        if resident_name not in VILLAGE_ENTRY_EXIT_LOG['zone_logs'][to_zone]['residents']:
            VILLAGE_ENTRY_EXIT_LOG['zone_logs'][to_zone]['residents'].append(resident_name)
        VILLAGE_ENTRY_EXIT_LOG['zone_logs'][to_zone]['entry_exit_log'].append(entry_exit_record)
        if len(VILLAGE_ENTRY_EXIT_LOG['zone_logs'][to_zone]['entry_exit_log']) > 10:
            VILLAGE_ENTRY_EXIT_LOG['zone_logs'][to_zone]['entry_exit_log'] = VILLAGE_ENTRY_EXIT_LOG['zone_logs'][to_zone]['entry_exit_log'][-10:]
    
    # 주민 상태 업데이트
    VILLAGE_ENTRY_EXIT_LOG['resident_status'][resident_name] = {
        'current_zone': to_zone,
        'last_activity': activity_type,
        'last_update': timestamp,
        'duration_in_current_zone': duration
    }
    
    # 구역별 인원 수 업데이트
    _update_zone_population_counts()
    
    return entry_exit_record

def _update_zone_population_counts():
    """구역별 인원 수 업데이트"""
    global VILLAGE_ENTRY_EXIT_LOG
    
    VILLAGE_ENTRY_EXIT_LOG['current_in_village'] = len(VILLAGE_ENTRY_EXIT_LOG['zone_logs']['VILLAGE']['residents'])
    VILLAGE_ENTRY_EXIT_LOG['current_in_orange'] = len(VILLAGE_ENTRY_EXIT_LOG['zone_logs']['ORANGE']['residents'])
    VILLAGE_ENTRY_EXIT_LOG['current_in_blue'] = len(VILLAGE_ENTRY_EXIT_LOG['zone_logs']['BLUE']['residents'])

def get_zone_entry_exit_log(zone):
    """구역별 출입 일지 조회"""
    global VILLAGE_ENTRY_EXIT_LOG
    
    if zone not in VILLAGE_ENTRY_EXIT_LOG['zone_logs']:
        return {"error": f"구역 {zone}를 찾을 수 없습니다."}
    
    return {
        "zone": zone,
        "current_residents": VILLAGE_ENTRY_EXIT_LOG['zone_logs'][zone]['residents'],
        "entry_exit_log": VILLAGE_ENTRY_EXIT_LOG['zone_logs'][zone]['entry_exit_log'],
        "total_entries": len(VILLAGE_ENTRY_EXIT_LOG['zone_logs'][zone]['entry_exit_log'])
    }

def get_all_residents_status():
    """모든 주민 상태 조회"""
    global VILLAGE_ENTRY_EXIT_LOG
    
    return {
        "total_residents": VILLAGE_ENTRY_EXIT_LOG['total_residents'],
        "current_in_village": VILLAGE_ENTRY_EXIT_LOG['current_in_village'],
        "current_in_orange": VILLAGE_ENTRY_EXIT_LOG['current_in_orange'],
        "current_in_blue": VILLAGE_ENTRY_EXIT_LOG['current_in_blue'],
        "resident_status": VILLAGE_ENTRY_EXIT_LOG['resident_status']
    }

def simulate_resident_movement():
    """주민 이동 시뮬레이션 (자동화된 시스템)"""
    import random
    import time
    
    # 주민 목록 (10명)
    residents = [
        "Scout", "Guardian", "Analyst", "Elder",
        "Trader_A", "Trader_B", "Trader_C", "Trader_D", "Trader_E", "Trader_F"
    ]
    
    zones = ["VILLAGE", "ORANGE", "BLUE"]
    activities = ["rest", "training", "observation"]
    durations = ["몇 시간", "하루", "며칠", "일주일", "몇 주", "한 달"]
    
    # 랜덤 주민 선택
    resident = random.choice(residents)
    
    # 현재 상태 확인
    current_zone = VILLAGE_ENTRY_EXIT_LOG['resident_status'].get(resident, {}).get('current_zone', 'VILLAGE')
    
    # 새로운 구역 선택 (현재 구역과 다른 곳)
    available_zones = [z for z in zones if z != current_zone]
    new_zone = random.choice(available_zones)
    
    # 활동 유형과 기간 선택
    activity = random.choice(activities)
    duration = random.choice(durations)
    
    # 출입 기록
    record = record_resident_entry_exit(resident, current_zone, new_zone, activity, duration)
    
    return record

# ===== 8BIT 마을 API 엔드포인트 (Flask 앱 정의 후에 이동됨) =====
def get_village_status():
    """마을 전체 상태 조회"""
    return jsonify({
        "village_name": "8BIT 마을",
        "mayor": "촌장 (N/B 길드 지점장)",
        "village_energy": VILLAGE_ENERGY,
        "max_village_energy": MAX_VILLAGE_ENERGY,
        "energy_accumulated": ENERGY_ACCUMULATED,
        "residents_count": len(VILLAGE_RESIDENTS),
        "warehouses_count": len(TRAINER_WAREHOUSES),
        "current_time": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    })

# 중복 라우트 제거됨 - Flask 앱 정의 이후로 이동됨

# ===== 기존 코드 계속 =====

# Flask 앱 생성 (새로운 팩토리 사용 또는 기존 방식 유지)
app = Flask(__name__)

# CORS 설정 개선
if config.server.cors_origins == '*':
    CORS(app)
else:
    origins = [origin.strip() for origin in config.server.cors_origins.split(',')]
    CORS(app, origins=origins)

# 에러 핸들러 등록
@app.errorhandler(ApiException)
def handle_api_exception(e: ApiException):
    """API 예외 처리"""
    return handle_exception(e)

@app.errorhandler(404)
def handle_not_found(e):
    """404 에러 처리"""
    return error_response("Resource not found", status_code=404, error_code="NotFound")

@app.errorhandler(410)
def handle_gone(e):
    """410 Gone 에러 처리 - 클라이언트 요청이 있는데 410을 반환하지 않도록 함"""
    logger.warning(f"410 Gone error at {request.path} - returning 503 instead")
    return error_response("Service temporarily unavailable", status_code=503, error_code="ServiceUnavailable")

@app.errorhandler(500)
def handle_internal_error(e):
    """500 에러 처리"""
    logger.error(f"Internal server error: {e}", exc_info=True)
    return handle_exception(e)

@app.errorhandler(Exception)
def handle_generic_exception(e: Exception):
    """일반 예외 처리"""
    return handle_exception(e)

# 요청 전/후 처리
@app.before_request
def before_request():
    """요청 전 처리"""
    logger.debug(f"Request: {request.method} {request.path}")

@app.after_request
def after_request(response):
    """요청 후 처리"""
    logger.debug(f"Response: {response.status_code}")
    return response

@app.route("/")
def root():
    # 루트 경로에서 UI로 리다이렉트
    from flask import redirect
    return redirect("/ui", code=302)


@app.route("/ui")
def serve_ui():
    # Serve the embedded chart UI from bot/static/ui.html
    return send_from_directory('static', 'ui.html')

@app.route("/game")
def serve_game():
    # Serve the village simulator from bot/game/village.html
    return send_from_directory('game', 'village.html')

@app.route('/static/<path:filename>')
def serve_static(filename: str):
    return send_from_directory('static', filename)

@app.route('/api/save-chart-data', methods=['POST'])
def save_chart_data():
    """차트 데이터 저장 API (개선된 버전)"""
    try:
        from .utils.validators import validate_request
        import re
        
        # 입력 검증
        from utils.validators import validate_request
        data = validate_request(
            required_fields=['filename', 'data'],
            field_validators={
                'filename': lambda x: x if isinstance(x, str) and re.match(r'^chart_data_[a-zA-Z0-9_-]+\.json$', x) else None
            }
        )
        
        filename = data['filename']
        chart_data = data['data']
        
        if not isinstance(chart_data, dict):
            raise ValidationError("'data' must be a dictionary")
        
        # Create data directory structure
        base_dir = os.path.dirname(__file__)
        data_dir = os.path.join(base_dir, '..', 'data', 'chart_data')
        os.makedirs(data_dir, exist_ok=True)
        
        # Create subdirectories by date
        date_str = datetime.now().strftime('%Y-%m-%d')
        date_dir = os.path.join(data_dir, date_str)
        os.makedirs(date_dir, exist_ok=True)
        
        # Create subdirectories by interval
        interval = chart_data.get('interval', 'unknown')
        interval_dir = os.path.join(date_dir, interval)
        os.makedirs(interval_dir, exist_ok=True)
        
        # Full file path
        filepath = os.path.join(interval_dir, filename)
        
        # Write JSON data with pretty formatting
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(chart_data, f, indent=2, ensure_ascii=False)
        
        # Get file size
        file_size = os.path.getsize(filepath)
        
        logger.info(f"Chart data saved: {filename} ({file_size} bytes)")
        
        return success_response({
            'filename': filename,
            'filepath': filepath,
            'fileSize': file_size,
            'totalCandles': chart_data.get('totalCandles', 0),
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }, message="Chart data saved successfully")
        
    except ValidationError as e:
        return handle_exception(e)
    except Exception as e:
        logger.error(f"Error saving chart data: {e}", exc_info=True)
        return handle_exception(e)

# ===== 8BIT 마을 API 엔드포인트 =====

@app.route('/api/village/status')
def get_village_status():
    """마을 전체 상태 조회 (개선된 버전)"""
    try:
        return success_response({
            "village_name": "8BIT 마을",
            "mayor": "촌장 (N/B 길드 지점장)",
            "village_energy": VILLAGE_ENERGY,
            "max_village_energy": MAX_VILLAGE_ENERGY,
            "energy_accumulated": ENERGY_ACCUMULATED,
            "residents_count": len(VILLAGE_RESIDENTS),
            "warehouses_count": len(TRAINER_WAREHOUSES),
            "current_time": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        })
    except Exception as e:
        logger.error(f"Error getting village status: {e}", exc_info=True)
        return handle_exception(e)

@app.route('/api/village/mayor/guidance')
def get_mayor_guidance():
    """촌장의 신뢰도 기반 지침 조회"""
    return jsonify(mayor_trust_guidance())

@app.route('/api/village/residents')
def get_village_residents():
    """마을 주민 정보 조회"""
    return jsonify({
        "residents": VILLAGE_RESIDENTS,
        "total_count": len(VILLAGE_RESIDENTS)
    })

@app.route('/api/village/resident/<trainer_name>')
def get_resident_info(trainer_name):
    """특정 주민 정보 조회"""
    if trainer_name not in VILLAGE_RESIDENTS:
        return jsonify({"error": "주민을 찾을 수 없습니다."}), 404
    
    return jsonify({
        "resident": VILLAGE_RESIDENTS[trainer_name],
        "warehouse_status": get_trainer_warehouse_status(trainer_name)
    })

@app.route('/api/village/warehouse/<trainer_name>')
def get_warehouse_info(trainer_name):
    """트레이너 창고 정보 조회"""
    if trainer_name not in TRAINER_WAREHOUSES:
        return jsonify({"error": "창고를 찾을 수 없습니다."}), 404
    
    return jsonify({
        "warehouse": TRAINER_WAREHOUSES[trainer_name],
        "status": get_trainer_warehouse_status(trainer_name)
    })

@app.route('/api/village/warehouse/<trainer_name>/analysis')
def get_warehouse_analysis(trainer_name):
    """창고 데이터 분석 조회"""
    return jsonify(analyze_warehouse_data(trainer_name))

@app.route('/api/village/bitcar/energy', methods=['POST'])
def inject_bitcar_energy():
    """비트카 에너지 주입"""
    data = request.get_json()
    trainer_name = data.get('trainer_name')
    energy_amount = data.get('energy_amount', 50)
    
    if not trainer_name:
        return jsonify({"error": "트레이너 이름이 필요합니다."}), 400
    
    result = inject_village_energy_to_bitcar(trainer_name, energy_amount)
    return jsonify({"message": result})

@app.route('/api/village/trade/record', methods=['POST'])
def record_trade():
    """거래 기록 저장"""
    data = request.get_json()
    trainer_name = data.get('trainer_name')
    
    if not trainer_name:
        return jsonify({"error": "트레이너 이름이 필요합니다."}), 400
    
    result = real_time_trade_recording(trainer_name, data)
    return jsonify(result)

@app.route('/api/village/trust/calculate', methods=['POST'])
def calculate_trust():
    """신뢰도 가중 평균 계산"""
    data = request.get_json()
    personal_confidence = data.get('personal_confidence', 0)
    ml_trust = data.get('ml_trust', MAYOR_TRUST_SYSTEM["ML_Model_Trust"])
    nb_guild_trust = data.get('nb_guild_trust', MAYOR_TRUST_SYSTEM["NB_Guild_Trust"])
    
    weighted_confidence = calculate_weighted_confidence(personal_confidence, ml_trust, nb_guild_trust)
    
    return jsonify({
        "personal_confidence": personal_confidence,
        "ml_trust": ml_trust,
        "nb_guild_trust": nb_guild_trust,
        "weighted_confidence": weighted_confidence,
        "weights": {
            "personal": 0.6,
            "ml_model": 0.2,
            "nb_guild": 0.2
        }
    })

@app.route('/api/village/system/overview')
def get_system_overview():
    """마을 시스템 전체 개요"""
    return jsonify({
        "system_name": "8BIT 마을 트레이딩 시스템",
        "description": "촌장의 지침에 따라 운영되는 AI 트레이더 마을",
        "components": {
            "mayor_system": "촌장 신뢰도 기반 지침 시스템",
            "residents": "10명의 트레이너 주민",
            "warehouses": "실시간 거래 기록 창고",
            "bitcar_system": "비트카 에너지 주입 시스템",
            "auto_learning": "자동 촌장 지침 학습 시스템"
        },
        "current_status": {
            "village_energy": VILLAGE_ENERGY,
            "residents_count": len(VILLAGE_RESIDENTS),
            "warehouses_count": len(TRAINER_WAREHOUSES),
            "auto_learning_enabled": MAYOR_TRUST_SYSTEM.get("auto_learning_enabled", True)
        }
    })

@app.route('/api/village/scout/status')
def get_scout_status():
    """Scout의 현재 상태 조회 (특별 API)"""
    if 'scout' not in VILLAGE_RESIDENTS:
        return jsonify({"error": "Scout를 찾을 수 없습니다."}), 404
    
    scout = VILLAGE_RESIDENTS['scout']
    warehouse = TRAINER_WAREHOUSES['scout']
    
    # Scout의 현재 포지션 정보 (예시)
    current_position = {
        "entry_time": "2025-01-27 08:15:00",
        "entry_price": 161000000,
        "current_price": 161401000,
        "pnl": "+0.25%",
        "duration": "12분",
        "strategy": "momentum"
    }
    
    # 거래 일지 정보 추가
    recent_journal = get_trade_journal('scout', "recent")
    mayor_journal = get_trade_journal('scout', "mayor_guidance")
    ml_journal = get_trade_journal('scout', "ml_decisions")
    
    return jsonify({
        "trainer": "Scout",
        "status": {
            "name": scout['name'],
            "hp": scout['hp'],
            "stamina": scout['stamina'],
            "location": scout['location'],
            "role": scout['role'],
            "specialty": scout['specialty'],
            "skillLevel": scout['skillLevel'],
            "strategy": scout['strategy'],
            "nbCoins": scout['nbCoins']
        },
        "current_position": current_position,
        "warehouse_summary": {
            "total_trades": warehouse['profit_loss_history']['total_trades'],
            "total_profit": warehouse['profit_loss_history']['total_profit'],
            "win_rate": warehouse['profit_loss_history']['win_rate'],
            "successful_patterns": len(warehouse['learning_data']['successful_patterns']),
            "failed_patterns": len(warehouse['learning_data']['failed_patterns'])
        },
        "mayor_guidance": {
            "ml_model_trust": MAYOR_TRUST_SYSTEM["ML_Model_Trust"],
            "nb_guild_trust": MAYOR_TRUST_SYSTEM["NB_Guild_Trust"],
            "current_zone": "ORANGE",
            "guidance": "신중한 방어적 접근, 개인 판단 우선"
        },
        "trade_journal": {
            "recent_entries_count": recent_journal.get("count", 0),
            "mayor_guidance_count": mayor_journal.get("count", 0),
            "ml_decisions_count": ml_journal.get("count", 0),
            "latest_entry": recent_journal.get("entries", [])[-1] if recent_journal.get("entries") else None
        }
    })

# UI에서 전송된 현재 차트 간격을 저장할 전역 변수
UI_CURRENT_INTERVAL = 'minute10'  # 기본값

def parse_interval_to_object(interval_str):
    """간격 문자열을 객체로 변환"""
    try:
        if interval_str.startswith('minute'):
            minute_value = int(interval_str.replace('minute', ''))
            return {'minute': minute_value}
        elif interval_str.startswith('second'):
            second_value = int(interval_str.replace('second', ''))
            return {'second': second_value}
        elif interval_str == 'hour':
            return {'hour': 1}
        elif interval_str == 'day':
            return {'day': 1}
        elif interval_str == 'week':
            return {'week': 1}
        elif interval_str == 'month':
            return {'month': 1}
        else:
            return {'unknown': interval_str}
    except:
        return {'error': interval_str}

@app.route('/api/village/update-current-interval', methods=['POST'])
def update_current_interval():
    """UI에서 현재 선택된 차트 간격을 서버에 전송"""
    global UI_CURRENT_INTERVAL
    
    try:
        payload = request.get_json(force=True) if request.is_json else request.form.to_dict()
        current_interval = payload.get('current_interval', 'minute10')
        
        # 유효한 간격인지 확인
        valid_intervals = ['minute1', 'minute3', 'minute5', 'minute10', 'minute15', 'minute30', 'minute60', 'minute240', 'day', 'week', 'month']
        if current_interval not in valid_intervals:
            return jsonify({'ok': False, 'error': f'유효하지 않은 간격: {current_interval}'}), 400
        
        UI_CURRENT_INTERVAL = current_interval
        print(f"🎯 UI 차트 간격 업데이트: {current_interval}")
        
        return jsonify({
            'ok': True,
            'current_interval': current_interval,
            'message': f'차트 간격이 {current_interval}로 업데이트되었습니다.'
        })
        
    except Exception as e:
        return jsonify({'ok': False, 'error': f'간격 업데이트 실패: {str(e)}'}), 500

@app.route('/api/village/current-zone')
def get_current_zone():
    """현재 구역 정보 조회 - 최소 연산으로 즉시 응답"""
    try:
        # 최소 의존성의 정적/캐시 값만 반환하여 타임아웃 방지
        return jsonify({
            'current_zone': bot_ctrl.get('nb_zone', 'ORANGE'),
            'nb_zone': bot_ctrl.get('nb_zone', 'ORANGE'),
            'ml_zone': bot_ctrl.get('nb_zone', 'ORANGE'),
            'last_signal': bot_ctrl.get('last_signal', 'HOLD'),
            'position': bot_ctrl.get('position', 'FLAT'),
            'r_value': bot_ctrl.get('r_value', 0.5),
            'ml_trust': MAYOR_TRUST_SYSTEM.get("ML_Model_Trust", 40),
            'nb_trust': MAYOR_TRUST_SYSTEM.get("NB_Guild_Trust", 82),
            'win_rate': 0,
            'history_count': 0,
            'candle_data': {'note': 'candle fetch disabled for latency'},
            'timestamp': int(time.time() * 1000)
        })
    except Exception as e:
        return jsonify({'error': f'구역 정보 조회 실패: {str(e)}'}), 500

@app.route('/api/village/auto-learning/toggle', methods=['POST'])
def toggle_auto_learning():
    """자동 촌장 지침 학습 토글"""
    global MAYOR_TRUST_SYSTEM
    
    try:
        # 현재 상태 토글
        current_status = MAYOR_TRUST_SYSTEM.get("auto_learning_enabled", True)
        MAYOR_TRUST_SYSTEM["auto_learning_enabled"] = not current_status
        
        return jsonify({
            'ok': True,
            'auto_learning_enabled': MAYOR_TRUST_SYSTEM["auto_learning_enabled"],
            'message': f"자동 촌장 지침 학습이 {'활성화' if MAYOR_TRUST_SYSTEM['auto_learning_enabled'] else '비활성화'}되었습니다.",
            'learning_interval': MAYOR_TRUST_SYSTEM.get("learning_interval", 3600),
            'last_learning_time': MAYOR_TRUST_SYSTEM.get("last_learning_time")
        })
        
    except Exception as e:
        return jsonify({'ok': False, 'error': f'자동 학습 토글 실패: {str(e)}'}), 500

@app.route('/api/ml/train-mayor-guidance', methods=['POST'])
def train_mayor_guidance_model():
    """AI 학습 기능 제거됨"""
    return jsonify({'error': 'AI 학습 기능이 제거되었습니다.'}), 410
    """촌장 지침 학습 모델 훈련"""
    try:
        payload = request.get_json(force=True) if request.is_json else request.form.to_dict()
        
        # 촌장 지침 학습 파라미터
        window = int(payload.get('window', 50))
        ema_fast = int(payload.get('ema_fast', 10))
        ema_slow = int(payload.get('ema_slow', 30))
        horizon = int(payload.get('horizon', 5))
        count = int(payload.get('count', 1800))
        interval = payload.get('interval') or load_config().candle
        
        cfg = load_config()
        df = get_candles(cfg.market, interval, count=count)
        
        # 촌장 지침 기반 특성 생성
        feat = _build_features(df, window, ema_fast, ema_slow, horizon).dropna().copy()
        
        # 촌장 지침 라벨링: Zone-Side Only
        r = _compute_r_from_ohlcv(df, window)
        HIGH = float(os.getenv('NB_HIGH', '0.55'))
        LOW = float(os.getenv('NB_LOW', '0.45'))
        labels = np.zeros(len(df), dtype=int)
        zone = None
        r_vals = r.values.tolist()
        
        for i in range(len(df)):
            rv = r_vals[i] if i < len(r_vals) else 0.5
            if zone not in ('BLUE','ORANGE'):
                zone = 'ORANGE' if rv >= 0.5 else 'BLUE'
            # hysteresis updates
            if zone == 'BLUE' and rv >= HIGH:
                zone = 'ORANGE'
            elif zone == 'ORANGE' and rv <= LOW:
                zone = 'BLUE'
            
            # 촌장 지침: BUY@BLUE / SELL@ORANGE
            if zone == 'BLUE':
                labels[i] = 1  # BUY
            elif zone == 'ORANGE':
                labels[i] = -1  # SELL
            else:
                labels[i] = 0  # HOLD
        
        idx_map = { ts: i for i, ts in enumerate(df.index) }
        y = np.array([ labels[idx_map.get(ts, 0)] for ts in feat.index ], dtype=int)
        
        # 모델 훈련
        from sklearn.ensemble import GradientBoostingClassifier
        from sklearn.model_selection import TimeSeriesSplit, GridSearchCV
        from sklearn.metrics import classification_report, confusion_matrix
        
        # 특성 선택
        X = feat[['r', 'w', 'ema_diff', 'zone_flag', 'dist_high', 'dist_low', 'zone_conf']]
        
        # 시계열 교차 검증
        tscv = TimeSeriesSplit(n_splits=3)
        model = GradientBoostingClassifier(random_state=42, n_estimators=200, learning_rate=0.05, max_depth=3)
        
        # 훈련
        model.fit(X.values, y)
        
        # 평가
        yhat = model.predict(X.values)
        report = classification_report(y, yhat, output_dict=True, zero_division=0)
        cm = confusion_matrix(y, yhat, labels=[-1,0,1]).tolist()
        
        # 모델 저장
        pack = {
            'model': model,
            'window': window,
            'ema_fast': ema_fast,
            'ema_slow': ema_slow,
            'horizon': horizon,
            'interval': interval,
            'label_mode': 'mayor_guidance',
            'trained_at': int(time.time() * 1000),
            'feature_names': list(X.columns),
            'metrics': {
                'report': report,
                'confusion': cm
            }
        }
        
        # 모델 저장
        try:
            joblib.dump(pack, _model_path_for(interval))
        except Exception:
            joblib.dump(pack, ML_MODEL_PATH)
        
        return jsonify({
            'ok': True,
            'message': '촌장 지침 학습 모델 훈련 완료',
            'label_mode': 'mayor_guidance',
            'classes': {
                '-1': int((y==-1).sum()),  # SELL (ORANGE)
                '0': int((y==0).sum()),    # HOLD
                '1': int((y==1).sum())     # BUY (BLUE)
            },
            'report': report,
            'confusion': cm
        })
        
    except Exception as e:
        return jsonify({'ok': False, 'error': f'촌장 지침 학습 실패: {str(e)}'}), 500

@app.route('/api/village/ai-explanation/<trainer_name>')
def get_ai_trading_explanation(trainer_name):
    """AI 거래 판단 설명 조회 및 저장"""
    try:
        from utils.logger import get_logger
        from utils.responses import success_response, error_response
        from utils.exceptions import NotFoundError
        
        logger = get_logger(__name__)
        
        # 트레이너 창고 확인
        trainer_key = trainer_name.lower()
        if trainer_key not in TRAINER_WAREHOUSES:
            raise NotFoundError(f"Trainer '{trainer_name}' not found")
        
        warehouse = TRAINER_WAREHOUSES[trainer_key]
        
        # 현재 구역 정보 가져오기
        current_zone = bot_ctrl.get('nb_zone', 'ORANGE')
        last_signal = bot_ctrl.get('last_signal', 'HOLD')
        position = bot_ctrl.get('position', 'FLAT')
        
        # r값 계산 (실제 구현에서는 실제 r값을 가져와야 함)
        r_value = 0.5  # 기본값, 실제로는 계산된 값 사용
        
        # 포지션 상태 판단
        position_status = "HAS_POSITION" if position != "FLAT" else "NO_POSITION"
        
        # 현재 액션 판단
        current_action = last_signal if last_signal in ['BUY', 'SELL', 'HOLD'] else 'HOLD'
        
        # 신뢰도 계산 (예시)
        confidence = 60  # 실제로는 계산된 신뢰도 사용
        
        # AI 거래 설명 생성
        explanation = generate_ai_trading_explanation(
            trainer_name, 
            current_action, 
            current_zone, 
            r_value, 
            confidence, 
            position_status
        )
        
        # 분석 결과를 히스토리에 추가 (기존 분석 유지)
        if 'ai_analysis' not in warehouse:
            warehouse['ai_analysis'] = {
                "current": None,
                "history": [],
                "last_updated": None
            }
        
        ai_analysis = warehouse['ai_analysis']
        
        # 이전 분석 결과를 히스토리에 추가 (있는 경우)
        if ai_analysis['current'] is not None:
            # 중복 방지: 같은 타임스탬프가 아니면 히스토리에 추가
            prev_timestamp = ai_analysis['current'].get('timestamp')
            new_timestamp = explanation.get('timestamp')
            
            if prev_timestamp != new_timestamp:
                # 히스토리에 추가 (최대 50개 유지)
                ai_analysis['history'].append(ai_analysis['current'])
                if len(ai_analysis['history']) > 50:
                    ai_analysis['history'] = ai_analysis['history'][-50:]
        
        # 현재 분석 결과 업데이트
        ai_analysis['current'] = explanation
        ai_analysis['last_updated'] = datetime.now().isoformat()
        
        logger.info(f"AI analysis saved for {trainer_name}: {current_action} in {current_zone}")
        
        # 현재 분석 결과와 히스토리 모두 반환
        # 기존 API 호환성을 위해 'explanation' 필드도 포함
        return success_response({
            "explanation": explanation,  # 기존 호환성 유지
            "current": explanation,      # 현재 분석 결과
            "history": ai_analysis['history'],  # 분석 히스토리
            "history_count": len(ai_analysis['history']),
            "last_updated": ai_analysis['last_updated']
        })
        
    except NotFoundError as e:
        return error_response(str(e), status_code=404, error_code="TrainerNotFound")
    except Exception as e:
        logger.error(f"Error in get_ai_trading_explanation: {e}", exc_info=True)
        return error_response(f'AI 거래 설명 생성 실패: {str(e)}', status_code=500)

# 카드 시스템 API 엔드포인트들
@app.route('/api/village/card-system/status', methods=['GET'])
def api_village_card_system_status():
    """카드 시스템 전체 상태 API"""
    try:
        # 활성 카드 목록에 경과 시간 및 상태 머신 정보 추가
        active_cards_with_time = []
        state_counts = {
            CARD_STATE["NEW"]: 0,
            CARD_STATE["WATCH"]: 0,
            CARD_STATE["LONG"]: 0,
            CARD_STATE["SHORT"]: 0,
            CARD_STATE["EXITED"]: 0,
            CARD_STATE["REMOVED"]: 0
        }
        action_counts = {
            CARD_ACTION["BUY"]: 0,
            CARD_ACTION["SELL_SHORT"]: 0,
            CARD_ACTION["SELL_TO_CLOSE"]: 0,
            CARD_ACTION["BUY_TO_CLOSE"]: 0,
            CARD_ACTION["WAIT"]: 0,
            CARD_ACTION["REMOVE_CARD"]: 0
        }
        
        for card_id, card in CARD_SYSTEM["activeCards"].items():
            elapsed_seconds, elapsed_formatted = get_card_elapsed_time(card)
            card_state = card.get("state", CARD_STATE["NEW"])
            card_action = card.get("action", CARD_ACTION["WAIT"])
            
            state_counts[card_state] = state_counts.get(card_state, 0) + 1
            action_counts[card_action] = action_counts.get(card_action, 0) + 1
            
            card_info = {
                "cardId": card["cardId"],
                "memberName": card["memberName"],
                "timeframe": card["timeframe"],
                "state": card_state,
                "action": card_action,
                "score": card.get("score", 0),
                "elapsedSeconds": elapsed_seconds,
                "elapsedTime": elapsed_formatted,
                "createdAtFormatted": card.get("createdAtFormatted", datetime.fromtimestamp(card["createdAt"]).strftime('%Y-%m-%d %H:%M:%S'))
            }
            active_cards_with_time.append(card_info)
        
        status = {
            "totalCards": CARD_SYSTEM["totalCards"],
            "activeCards": len(CARD_SYSTEM["activeCards"]),
            "completedCards": len(CARD_SYSTEM["completedCards"]),
            "failedCards": len(CARD_SYSTEM["failedCards"]),
            "removedCards": len(CARD_SYSTEM.get("removedCards", {})),
            "cardCounter": CARD_SYSTEM["cardCounter"],
            "lastUpdate": CARD_SYSTEM["lastCardUpdate"],
            "activeCardsList": active_cards_with_time,
            "stateCounts": state_counts,
            "actionCounts": action_counts,
            "members": {}
        }
        
        # 각 주민의 카드 상태
        for member_name, member in VILLAGE_RESIDENTS.items():
            status["members"][member_name] = get_member_card_status(member_name)
        
        return jsonify(status)
        
    except Exception as e:
        print(f"Error in card system status API: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/village/card-system/member/<member_name>', methods=['GET'])
def api_village_card_system_member(member_name):
    """특정 주민의 카드 시스템 상태 API"""
    try:
        status = get_member_card_status(member_name)
        if not status:
            return jsonify({"error": "Member not found"}), 404
        
        return jsonify(status)
        
    except Exception as e:
        print(f"Error in member card system API: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/village/card-system/create', methods=['POST'])
def api_village_card_system_create():
    """새로운 카드 생성 API"""
    try:
        data = request.get_json()
        member_name = data.get("member_name")
        timeframe = data.get("timeframe")
        pattern_data = data.get("pattern_data", {})
        
        if not member_name or not timeframe:
            return jsonify({"error": "Missing required fields"}), 400
        
        # 주민이 해당 분봉을 담당하는지 확인
        member = VILLAGE_RESIDENTS.get(member_name.lower())
        if not member or timeframe not in member["assignedTimeframes"]:
            return jsonify({"error": "Member not assigned to this timeframe"}), 400
        
        # 카드 생성
        card_id = create_card(member_name, timeframe, pattern_data)
        
        return jsonify({
            "success": True,
            "card_id": card_id,
            "member_name": member_name,
            "timeframe": timeframe
        })
        
    except Exception as e:
        print(f"Error in create card API: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/village/card-system/analyze/<int:card_id>', methods=['POST'])
def api_village_card_system_analyze(card_id):
    """카드 분석 API"""
    try:
        data = request.get_json()
        member_name = data.get("member_name")
        
        if not member_name:
            return jsonify({"error": "Missing member_name"}), 400
        
        # 카드 분석
        strategy = analyze_card(card_id, member_name)
        if not strategy:
            return jsonify({"error": "Card analysis failed"}), 400
        
        return jsonify({
            "success": True,
            "card_id": card_id,
            "strategy": strategy
        })
        
    except Exception as e:
        print(f"Error in analyze card API: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/village/card-system/buy/<int:card_id>', methods=['POST'])
def api_village_card_system_buy(card_id):
    """카드 매수 실행 API"""
    try:
        data = request.get_json()
        buy_info = data.get("buy_info", {})
        
        if not buy_info:
            return jsonify({"error": "Missing buy_info"}), 400
        
        # 매수 실행
        success = execute_card_buy(card_id, buy_info)
        if not success:
            return jsonify({"error": "Buy execution failed"}), 400
        
        return jsonify({
            "success": True,
            "card_id": card_id,
            "status": "buy_completed"
        })
        
    except Exception as e:
        print(f"Error in buy card API: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/village/card-system/sell/<int:card_id>', methods=['POST'])
def api_village_card_system_sell(card_id):
    """카드 매도 실행 API"""
    try:
        data = request.get_json()
        sell_info = data.get("sell_info", {})
        
        if not sell_info:
            return jsonify({"error": "Missing sell_info"}), 400
        
        # 매도 실행
        success = execute_card_sell(card_id, sell_info)
        if not success:
            return jsonify({"error": "Sell execution failed"}), 400
        
        return jsonify({
            "success": True,
            "card_id": card_id,
            "status": "completed"
        })
        
    except Exception as e:
        print(f"Error in sell card API: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/village/card-system/cards', methods=['GET'])
def api_village_card_system_cards():
    """모든 활성 카드 목록 조회 (생성 시간 카운트 및 상태 머신 정보 포함)"""
    try:
        cards_list = []
        for card_id, card in CARD_SYSTEM["activeCards"].items():
            elapsed_seconds, elapsed_formatted = get_card_elapsed_time(card)
            card_data = {
                "cardId": card["cardId"],
                "memberName": card["memberName"],
                "timeframe": card["timeframe"],
                "state": card.get("state", CARD_STATE["NEW"]),
                "action": card.get("action", CARD_ACTION["WAIT"]),
                "createdAt": card["createdAt"],
                "createdAtFormatted": card.get("createdAtFormatted", datetime.fromtimestamp(card["createdAt"]).strftime('%Y-%m-%d %H:%M:%S')),
                "elapsedSeconds": elapsed_seconds,
                "elapsedTime": elapsed_formatted,
                "score": card.get("score", 0),
                "dataQuality": card.get("dataQuality", "DATA_OK"),
                "trend": card.get("trend", "TREND_NEUTRAL"),
                "momentum": card.get("momentum", "MOM_NEUTRAL"),
                "riskStatus": card.get("riskStatus", "RISK_OK"),
                "entryPrice": card.get("entryPrice"),
                "currentPrice": card.get("currentPrice"),
                "pnlPercent": card.get("pnlPercent", 0),
                "buyInfo": card.get("buyInfo"),
                "sellInfo": card.get("sellInfo"),
                "performance": card.get("performance"),
                "strategy": card.get("strategy")
            }
            cards_list.append(card_data)
        
        return jsonify({
            "success": True,
            "cards": cards_list,
            "count": len(cards_list)
        })
        
    except Exception as e:
        print(f"Error in cards list API: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/village/card-system/card/<int:card_id>', methods=['GET'])
def api_village_card_system_card(card_id):
    """특정 카드 상세 정보 조회 (생성 시간 카운트 및 상태 머신 정보 포함)"""
    try:
        if card_id not in CARD_SYSTEM["activeCards"]:
            return jsonify({"error": "Card not found"}), 404
        
        card = CARD_SYSTEM["activeCards"][card_id]
        elapsed_seconds, elapsed_formatted = get_card_elapsed_time(card)
        
        card_data = {
            "cardId": card["cardId"],
            "memberName": card["memberName"],
            "timeframe": card["timeframe"],
            "state": card.get("state", CARD_STATE["NEW"]),
            "action": card.get("action", CARD_ACTION["WAIT"]),
            "createdAt": card["createdAt"],
            "createdAtFormatted": card.get("createdAtFormatted", datetime.fromtimestamp(card["createdAt"]).strftime('%Y-%m-%d %H:%M:%S')),
            "elapsedSeconds": elapsed_seconds,
            "elapsedTime": elapsed_formatted,
            "score": card.get("score", 0),
            "dataQuality": card.get("dataQuality", "DATA_OK"),
            "dataQualityCount": card.get("dataQualityCount", 0),
            "trend": card.get("trend", "TREND_NEUTRAL"),
            "momentum": card.get("momentum", "MOM_NEUTRAL"),
            "structure": card.get("structure", "STRUCTURE_NONE"),
            "volumeConfirm": card.get("volumeConfirm", False),
            "riskStatus": card.get("riskStatus", "RISK_OK"),
            "stopLoss": card.get("stopLoss"),
            "takeProfit": card.get("takeProfit"),
            "entryPrice": card.get("entryPrice"),
            "currentPrice": card.get("currentPrice"),
            "pnl": card.get("pnl", 0),
            "pnlPercent": card.get("pnlPercent", 0),
            "buyInfo": card.get("buyInfo"),
            "sellInfo": card.get("sellInfo"),
            "performance": card.get("performance"),
            "strategy": card.get("strategy"),
            "patternData": card.get("patternData"),
            "stateHistory": card.get("stateHistory", []),
            "actionHistory": card.get("actionHistory", [])
        }
        
        return jsonify({
            "success": True,
            "card": card_data
        })
        
    except Exception as e:
        print(f"Error in card detail API: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/village/card-system/update-state/<int:card_id>', methods=['POST'])
def api_village_card_system_update_state(card_id):
    """카드 상태 머신 업데이트 API"""
    try:
        data = request.get_json() or {}
        market_data = data.get("marketData")
        
        if card_id not in CARD_SYSTEM["activeCards"]:
            return jsonify({"error": "Card not found"}), 404
        
        updated = update_card_state_machine(card_id, market_data)
        
        card = CARD_SYSTEM["activeCards"][card_id]
        
        return jsonify({
            "success": True,
            "updated": updated,
            "cardId": card_id,
            "state": card.get("state"),
            "action": card.get("action")
        })
        
    except Exception as e:
        print(f"Error in update card state API: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/village/card-system/update-all-states', methods=['POST'])
def api_village_card_system_update_all_states():
    """모든 활성 카드의 상태 머신 업데이트 API"""
    try:
        data = request.get_json() or {}
        market_data_dict = data.get("marketDataDict", {})
        
        updated_count = update_all_cards_state_machine(market_data_dict)
        
        return jsonify({
            "success": True,
            "updatedCount": updated_count,
            "totalActiveCards": len(CARD_SYSTEM["activeCards"])
        })
        
    except Exception as e:
        print(f"Error in update all cards state API: {e}")
        return jsonify({"error": str(e)}), 500

state = {
    "price": 0.0,
    "signal": "HOLD",
    "ema_fast": 10,
    "ema_slow": 30,
    "market": "KRW-BTC",
    "candle": "minute10",
    "history": deque(maxlen=200),  # (ts, price)
}

# ML training state
ml_state = {
    'train_count': 0,
}

# Grouped NB observations (time-bucketed)
GROUP_BUCKET_SEC = int(os.getenv('NB_GROUP_BUCKET_SEC', '60'))  # group by 1m default
GROUP_MIN_SIZE = int(os.getenv('NB_GROUP_MIN_SIZE', '25'))
_nb_groups: dict[int, list] = {}
_npc_hashes: set[str] = set()

# Zone reputation learned from narratives/policy (-1 .. +1)
_zone_reputation: dict[str, dict] = {
    'ORANGE': {'score': 0.0, 'updated_ms': None, 'notes': []},
    'BLUE':   {'score': 0.0, 'updated_ms': None, 'notes': []},
}

# Information trust configuration
_trust_config: dict = {
    'ml_trust': 50.0,  # ML Model trust level (0-100)
    'nb_trust': 50.0,  # N/B Guild trust level (0-100)
    'last_updated': None
}

# Trainer storage warehouses (각 트레이너별 저장 창고)
_trainer_storage: dict[str, dict] = {
    'Scout': {
        'coins': 0.0,  # 보유 코인 수량
        'entry_price': 0.0,  # 매수 가격
        'last_update': None,  # 마지막 업데이트 시간
        'total_profit': 0.0,  # 총 수익
        'ticks': 0,  # 거래 틱 카운터
        'trades': []  # 거래 기록
    },
    'Guardian': {
        'coins': 0.0,
        'entry_price': 0.0,
        'last_update': None,
        'total_profit': 0.0,
        'ticks': 0,
        'trades': []
    },
    'Analyst': {
        'coins': 0.0,
        'entry_price': 0.0,
        'last_update': None,
        'total_profit': 0.0,
        'ticks': 0,
        'trades': []
    },
    'Elder': {
        'coins': 0.0,
        'entry_price': 0.0,
        'last_update': None,
        'total_profit': 0.0,
        'ticks': 0,
        'trades': []
    }
}

def _narrative_store_path() -> str:
    try:
        base_dir = os.path.dirname(__file__)
        data_dir = os.path.join(base_dir, 'data')
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, 'narratives.jsonl')
    except Exception:
        return 'narratives.jsonl'

def _trainer_storage_path() -> str:
    """트레이너 저장 창고 데이터 파일 경로"""
    try:
        base_dir = os.path.dirname(__file__)
        data_dir = os.path.join(base_dir, 'data')
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, 'trainer_storage.json')
    except Exception:
        return 'trainer_storage.json'

def _trust_config_path() -> str:
    """신뢰도 설정 파일 경로"""
    try:
        base_dir = os.path.dirname(__file__)
        data_dir = os.path.join(base_dir, 'data')
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, 'trust_config.json')
    except Exception:
        return 'trust_config.json'

def _load_trainer_storage() -> dict:
    """트레이너 저장 창고 데이터 로드"""
    try:
        path = _trainer_storage_path()
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # 기존 데이터와 새 구조 병합
                for trainer in ['Scout', 'Guardian', 'Analyst', 'Elder']:
                    if trainer not in data:
                        data[trainer] = {
                            'coins': 0.0,
                            'entry_price': 0.0,
                            'last_update': None,
                            'total_profit': 0.0,
                            'ticks': 0,
                            'trades': []
                        }
                    # 기존 데이터에 틱 카운터가 없으면 추가
                    if 'ticks' not in data[trainer]:
                        data[trainer]['ticks'] = 0
                return data
    except Exception:
        pass
    return _trainer_storage.copy()

def _save_trainer_storage():
    """트레이너 저장 창고 데이터 저장"""
    try:
        path = _trainer_storage_path()
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(_trainer_storage, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

def _load_trust_config() -> dict:
    """신뢰도 설정 로드"""
    try:
        with open(_trust_config_path(), 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'ml_trust': 50.0, 'nb_trust': 50.0, 'last_updated': None}

def _save_trust_config():
    """신뢰도 설정 저장"""
    try:
        _trust_config['last_updated'] = int(time.time() * 1000)
        with open(_trust_config_path(), 'w', encoding='utf-8') as f:
            json.dump(_trust_config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving trust config: {e}")

def _update_trainer_storage(trainer: str, action: str, price: float, size: float, profit: float = 0.0):
    """트레이너 저장 창고 업데이트"""
    try:
        if trainer not in _trainer_storage:
            return
        
        storage = _trainer_storage[trainer]
        now = int(time.time() * 1000)
        
        # 틱 카운터 초기화 (없으면)
        if 'ticks' not in storage:
            storage['ticks'] = 0
        
        if action.upper() == 'BUY':
            # 매수: 코인 추가
            storage['coins'] += size
            storage['entry_price'] = price
            storage['last_update'] = now
            storage['ticks'] += 1  # 거래 시 틱 증가
            storage['trades'].append({
                'ts': now,
                'action': 'BUY',
                'price': price,
                'size': size,
                'profit': 0.0
            })
            
        elif action.upper() == 'SELL':
            # 매도: 코인 차감 및 수익 계산
            if storage['coins'] >= size:
                storage['coins'] -= size
                if storage['entry_price'] > 0:
                    profit = (price - storage['entry_price']) * size
                    storage['total_profit'] += profit
                
                storage['last_update'] = now
                storage['ticks'] += 1  # 거래 시 틱 증가
                storage['trades'].append({
                    'ts': now,
                    'action': 'SELL',
                    'price': price,
                    'size': size,
                    'profit': profit
                })
                
                # 모든 코인을 매도한 경우 entry_price 초기화
                if storage['coins'] <= 0:
                    storage['entry_price'] = 0.0
        
        # 거래 기록은 최근 100개만 유지
        if len(storage['trades']) > 100:
            storage['trades'] = storage['trades'][-100:]
            
        _save_trainer_storage()
        
    except Exception:
        pass

def _update_zone_reputation(zone: str, delta: float, note: str | None = None) -> dict:
    try:
        z = str(zone or '').upper()
        if z not in _zone_reputation:
            _zone_reputation[z] = {'score': 0.0, 'updated_ms': None, 'notes': []}
        row = _zone_reputation[z]
        row['score'] = float(max(-1.0, min(1.0, float(row.get('score', 0.0)) + float(delta))))
        row['updated_ms'] = int(time.time()*1000)
        if note:
            notes = row.get('notes') or []
            notes.append(str(note))
            # cap notes list
            if len(notes) > 20:
                notes = notes[-20:]
            row['notes'] = notes
        return row
    except Exception:
        return {'score': 0.0}

def _bucket_ts(ts_ms: int | None = None, bucket_sec: int | None = None) -> int:
    try:
        b = int(bucket_sec or GROUP_BUCKET_SEC)
        t = int((ts_ms or int(time.time()*1000)) / 1000)
        return (t // b) * b
    except Exception:
        return int(time.time())

def _record_group_observation(interval: str, window: int, r_val: float,
                              pct_blue: float, pct_orange: float, ts_ms: int | None = None):
    try:
        bt = _bucket_ts(ts_ms, GROUP_BUCKET_SEC)
        row = {
            'ts': int(ts_ms or int(time.time()*1000)),
            'bucket': int(bt),
            'interval': str(interval),
            'window': int(window),
            'r': float(r_val),
            'pct_blue': float(pct_blue),
            'pct_orange': float(pct_orange),
        }
        _nb_groups.setdefault(bt, []).append(row)
        # trim old buckets to keep memory bounded
        if len(_nb_groups) > 1000:
            for k in sorted(list(_nb_groups.keys()))[:-900]:
                _nb_groups.pop(k, None)
    except Exception:
        pass

# In-memory order log for UI markers
orders = deque(maxlen=500)  # each item: {ts, side, price, size, paper, market}

# Simple cache for buy/sell card loads to avoid disk scans on every request
ORDER_CARDS_CACHE = {}

def _save_order_card(order, order_type='BUY'):
    """
    매수/매도 완료 카드를 data/buy_cards 또는 data/sell_cards 폴더에 자동 저장
    """
    try:
        base_dir = os.path.join('data', 'buy_cards' if order_type == 'BUY' else 'sell_cards')
        os.makedirs(base_dir, exist_ok=True)
        
        # 파일명: buy_cards_2026-01-08T02-49-45-351Z.json 형식
        now = datetime.utcnow()
        filename = f"{order_type.lower()}_cards_{now.strftime('%Y-%m-%dT%H-%M-%S')}-{now.microsecond // 1000:03d}Z.json"
        filepath = os.path.join(base_dir, filename)
        
        # 카드 데이터 저장 (배열 형식으로)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump([order], f, ensure_ascii=False, indent=2)
        
        logger.info(f"✅ {order_type} 카드 저장 완료: {filepath}")
        # Invalidate cache for this order type so subsequent reads reload
        try:
            ORDER_CARDS_CACHE.pop(order_type, None)
        except Exception:
            pass
        return filepath
    except Exception as e:
        logger.error(f"⚠️ {order_type} 카드 저장 실패: {e}")
        return None

def _load_order_cards(order_type='BUY'):
    """
    data/buy_cards 또는 data/sell_cards 폴더에서 모든 카드 로드
    각 카드에 대해 NBverse max 폴더에서 card_rating 데이터 추가
    """
    try:
        base_dir = os.path.join('data', 'buy_cards' if order_type == 'BUY' else 'sell_cards')
        os.makedirs(base_dir, exist_ok=True)

        dir_mtime = os.path.getmtime(base_dir)
        cached = ORDER_CARDS_CACHE.get(order_type)
        if cached and cached.get('mtime') == dir_mtime:
            return cached.get('cards', [])

        cards = []
        if os.path.exists(base_dir):
            for filename in sorted(os.listdir(base_dir), reverse=True):  # 최신순
                if filename.endswith('.json'):
                    filepath = os.path.join(base_dir, filename)
                    try:
                        with open(filepath, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            if isinstance(data, list):
                                for card_item in data:
                                    # NBverse max 폴더에서 card_rating 추가
                                    if isinstance(card_item, dict):
                                        _enrich_card_with_nbverse(card_item)
                                cards.extend(data)
                            else:
                                if isinstance(data, dict):
                                    _enrich_card_with_nbverse(data)
                                cards.append(data)
                    except Exception as e:
                        logger.warning(f"카드 파일 로드 실패 {filepath}: {e}")

        ORDER_CARDS_CACHE[order_type] = {'mtime': dir_mtime, 'cards': cards}
        return cards
    except Exception as e:
        logger.error(f"⚠️ {order_type} 카드 로드 실패: {e}")
        return []


def _enrich_card_with_nbverse(card: dict):
    """
    카드에 NBverse max 폴더의 card_rating 정보 추가
    """
    try:
        if not isinstance(card, dict):
            return
        
        # 이미 card_rating이 있으면 skip
        if 'card_rating' in card and card['card_rating']:
            return
        
        # nb_price 우선, 없으면 nb_price_max 사용
        nb_price = card.get('nb_price') or card.get('nbPrice') or card.get('nb_price_max') or card.get('nbPriceMax')
        if not nb_price:
            return
        
        try:
            nb_price_float = float(nb_price)
            
            # NBverse 경로 생성 로직 (server.py의 create_nb_path와 동일)
            # 예: 49.99999734193095 -> 49/9/9/9/9/9/7/3/4/1/9/3/0/9/5
            nb_str = str(nb_price_float)
            if '.' in nb_str:
                int_part, dec_part = nb_str.split('.', 1)
            else:
                int_part, dec_part = nb_str, ''
            
            # 음수 부호 제거
            int_part = int_part.replace('-', '')
            dec_part = dec_part.replace('-', '')
            
            # 경로 생성: 정수부 + 소수점 각 자리
            path_parts = [int_part] + list(dec_part)
            nb_path = os.path.join(*path_parts)
            
            nbverse_path = os.path.join('data', 'nbverse', 'max', nb_path, 'this_pocket_card.json')
            
            if os.path.exists(nbverse_path):
                with open(nbverse_path, 'r', encoding='utf-8') as f:
                    nbverse_data = json.load(f)
                    if isinstance(nbverse_data, dict):
                        if 'card_rating' in nbverse_data:
                            card['card_rating'] = nbverse_data['card_rating']
                        if 'ml_trust' in nbverse_data and isinstance(nbverse_data['ml_trust'], dict):
                            card['mlGrade'] = nbverse_data['ml_trust'].get('grade', '-')
                            card['mlEnhancement'] = nbverse_data['ml_trust'].get('enhancement', '0')
                        # nb_zone 정보도 추가
                        if 'nb_zone' in nbverse_data:
                            if not card.get('nb_zone'):
                                zone_data = nbverse_data['nb_zone']
                                if isinstance(zone_data, dict):
                                    card['nb_zone'] = zone_data.get('zone', 'NONE')
                                elif isinstance(zone_data, str):
                                    card['nb_zone'] = zone_data
            else:
                logger.debug(f"NBverse 파일 없음: {nbverse_path}")
        except Exception as e:
            logger.warning(f"NBverse 데이터 로드 실패 (nb_price={nb_price}): {e}")
    except Exception as e:
        logger.error(f"카드 enrichment 실패: {e}")


# ===== 카드 등급 ML 보조 함수 =====
def _load_nbverse_snapshot(path_str: str) -> dict:
    try:
        if not path_str:
            return {}
        base_dir = os.path.join(os.path.dirname(__file__), 'data', 'nbverse')
        candidate = path_str
        if not os.path.isabs(candidate):
            candidate = os.path.join(base_dir, candidate)
        if not os.path.exists(candidate):
            return {}
        with open(candidate, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _extract_profit_rate(card: dict) -> tuple[bool, float]:
    """Return (ok, profit_rate_float). profit_rate expected as fraction (-1..1)."""
    if not isinstance(card, dict):
        return False, 0.0
    keys = ['profit_rate', 'pnl_rate', 'pnlRate', 'rate', 'pnl_pct', 'pnl_percent']
    for k in keys:
        if k in card:
            try:
                pr = float(card[k])
                if abs(pr) > 5:  # likely percent
                    pr = pr / 100.0
                return True, pr
            except Exception:
                continue
    # derive from pnl and notional if present
    try:
        pnl = float(card.get('pnl'))
        notional = float(card.get('price', 0) * card.get('size', 0))
        if notional != 0:
            return True, pnl / notional
    except Exception:
        pass
    return False, 0.0


def _collect_ml_training_samples() -> list[dict]:
    """
    Generate training samples from historical BUY→SELL cycles in trainer_storage.
    Each training sample includes:
      - card: BUY card data reconstructed from trainer_storage BUY trades
      - profit_rate: profit percentage from matching SELL trade
    """
    samples: list[dict] = []
    
    # Load trainer_storage for complete BUY→SELL cycles
    try:
        with open('data/trainer_storage.json', 'r', encoding='utf-8') as f:
            trainer_data = json.load(f)
        logger.info(f"[_collect_ml_training_samples] Loaded trainer_storage with {len(trainer_data)} trainers")
    except Exception as e:
        logger.error(f"[_collect_ml_training_samples] Failed to load trainer_storage: {e}")
        return samples
    
    if not isinstance(trainer_data, dict):
        return samples
    
    # Extract BUY→SELL pairs from each trainer's trade history
    for trainer_name, trainer_info in trainer_data.items():
        if not isinstance(trainer_info, dict):
            continue
        
        trades_list = trainer_info.get('trades', [])
        if not isinstance(trades_list, list):
            continue
        
        # Build BUY trades index
        buy_trades = {}  # ts -> buy_trade
        sell_trades = {}  # ts -> sell_trade
        
        for trade in trades_list:
            if not isinstance(trade, dict):
                continue
            
            trade_match = trade.get('trade_match', {})
            if not isinstance(trade_match, dict):
                continue
            
            action = trade_match.get('system_action')
            
            if action == 'BUY':
                buy_trades[int(trade.get('ts', 0))] = {
                    'ts': int(trade.get('ts', 0)),
                    'price': float(trade_match.get('upbit_price', 0)),
                    'size': float(trade_match.get('upbit_size', 0)),
                    'trade_match': trade_match
                }
            elif action == 'SELL':
                sell_trades[int(trade.get('ts', 0))] = {
                    'ts': int(trade.get('ts', 0)),
                    'price': float(trade_match.get('upbit_price', 0)),
                    'size': float(trade_match.get('upbit_size', 0)),
                    'profit_percent': float(trade_match.get('profit_percent', 0)),
                    'trade_match': trade_match
                }
        
        # Match BUY with subsequent SELL (same size)
        for buy_ts, buy_trade in buy_trades.items():
            # Find the next SELL trade with matching size
            matching_sell = None
            
            for sell_ts in sorted(sell_trades.keys()):
                if sell_ts <= buy_ts:
                    continue
                
                sell_trade = sell_trades[sell_ts]
                
                # Check size match (allow 1% deviation)
                if abs(sell_trade['size'] - buy_trade['size']) > buy_trade['size'] * 0.01:
                    continue
                
                matching_sell = sell_trade
                break
            
            if matching_sell is None:
                continue
            
            # Build card payload
            # Since we don't have the original insight with zone_flag from trainer_storage,
            # we'll try to find it from buy_cards or estimate from price level
            card_payload = {
                'nb': {
                    'price': {'max': 50.0, 'min': 0.0},
                    'volume': {'max': 50.0, 'min': 0.0},
                    'turnover': {'max': 50.0, 'min': 0.0}
                },
                'current_price': buy_trade['price'],
                'interval': '1m',  # default interval
                'insight': {
                    'zone_flag': 0  # will be estimated if possible
                }
            }
            
            # Extract profit_rate
            profit_percent = matching_sell.get('profit_percent', 0.0)
            profit_rate = profit_percent / 100.0 if abs(profit_percent) > 1 else profit_percent
            
            # Add sample
            samples.append({
                'card': card_payload,
                'profit_rate': profit_rate
            })
    
    logger.info(f"[_collect_ml_training_samples] Collected {len(samples)} training samples")
    return samples


def _collect_nbverse_training_samples() -> list[dict]:
    """
    nbverse 스냅샷들에서 온라인 학습 데이터 수집
    현재 생산 중인 카드들의 N/B 데이터 + 계산된 강화도로 학습
    """
    samples = []
    nbverse_dir = Path('data/nbverse')
    
    if not nbverse_dir.exists():
        logger.warning("[_collect_nbverse_training_samples] nbverse 디렉토리 없음")
        return samples
    
    # nbverse의 모든 this_pocket_card.json 수집
    snapshot_files = list(nbverse_dir.rglob('this_pocket_card.json'))
    logger.info(f"[_collect_nbverse_training_samples] Found {len(snapshot_files)} nbverse snapshots")
    
    for snapshot_file in snapshot_files:
        try:
            with open(snapshot_file, 'r', encoding='utf-8') as f:
                snapshot = json.load(f)
            
            # 필요한 정보 추출
            card_rating = snapshot.get('card_rating', {})
            nb_data = snapshot.get('nb', {})
            insight = snapshot.get('insight', {})
            current_price = snapshot.get('current_price', 0)
            interval = snapshot.get('interval', 'minute30')
            
            # 유효성 검사
            if not card_rating or not nb_data:
                continue
            
            enhancement = float(card_rating.get('enhancement', 50))
            zone_flag = float(insight.get('zone_flag', 0))
            
            # enhancement를 profit_rate로 변환 (1-99 → -1~1)
            # 50 = 0%, 99 = +0.98, 1 = -0.98
            profit_rate = (enhancement - 50) / 50.0
            
            # 학습 샘플 구성
            card_payload = {
                'nb': nb_data,
                'current_price': current_price,
                'interval': interval,
                'insight': {
                    'zone_flag': zone_flag
                }
            }
            
            samples.append({
                'card': card_payload,
                'profit_rate': profit_rate
            })
        
        except Exception as e:
            logger.debug(f"[_collect_nbverse_training_samples] 스냅샷 로드 실패 {snapshot_file}: {e}")
            continue
    
    logger.info(f"[_collect_nbverse_training_samples] Collected {len(samples)} training samples from nbverse")
    return samples


def _merge_training_samples() -> list[dict]:
    """
    모든 훈련 데이터 통합
    - nbverse 스냅샷 (현재 생산 카드)
    - trainer_storage (거래 기록)
    """
    samples = []
    
    # 1. nbverse 스냅샷 (온라인 학습 데이터)
    nbverse_samples = _collect_nbverse_training_samples()
    samples.extend(nbverse_samples)
    
    # 2. trainer_storage (거래 기록)
    trader_samples = _collect_ml_training_samples()
    samples.extend(trader_samples)
    
    logger.info(f"[_merge_training_samples] Total samples: {len(samples)} (nbverse: {len(nbverse_samples)}, trader: {len(trader_samples)})")
    return samples

# ML signal log (in-memory; optionally persisted)
signals = []  # each: {id, ts, zone, extreme, price, pct_major, slope_bp, horizon, pred_nb, interval, market, score0, realized_score}

# N/B COIN tracking per candle bucket
_nb_coin_store: dict[str, dict] = {}
_nb_coin_counter: dict[str, int] = {}          # per-interval coin count (card-level)
_nb_open_entry: dict[str, float] = {}           # per-interval open entry price for BUY→SELL cycle
_nb_rest_until: dict[str, int] = {}             # per-interval rest window end bucket (exclusive)
_village_energy: dict[str, dict] = {}           # per-interval energy state: { E: float(0..100), last_ms: int, idle_bars: int }

# Village Council (trainer consensus) state
_council_state: dict = {
    'ts': None,
    'intervals': {},   # iv -> { chosen, intent, feasible, zone, slope_bp }
    'consensus': {'intent': 'HOLD', 'votes': {}},
}
_council_thread: threading.Thread | None = None
_council_running: bool = False

def _energy_state(iv: str) -> dict:
    try:
        iv = str(iv)
        st = _village_energy.get(iv)
        if not st:
            st = { 'E': 50.0, 'last_ms': int(time.time()*1000), 'idle_bars': 0 }
            _village_energy[iv] = st
        return st
    except Exception:
        return { 'E': 50.0, 'last_ms': int(time.time()*1000), 'idle_bars': 0 }

def _energy_tick(iv: str) -> float:
    try:
        st = _energy_state(iv)
        now = int(time.time()*1000)
        dt_sec = max(0.0, (now - int(st.get('last_ms') or now)) / 1000.0)
        decay = float(os.getenv('ENERGY_DECAY_PER_SEC', '0.001'))
        st['E'] = float(max(0.0, min(99999.0, float(st.get('E', 50.0)) - decay * dt_sec)))
        st['last_ms'] = now
        return float(st['E'])
    except Exception:
        return 0.0

def _energy_adjust(iv: str, delta: float, reason: str | None = None) -> float:
    try:
        st = _energy_state(iv)
        _energy_tick(iv)
        st['E'] = float(max(0.0, min(99999.0, float(st.get('E', 50.0)) + float(delta))))
        if reason:
            st['last_reason'] = str(reason)
        return float(st['E'])
    except Exception:
        return 0.0

@app.route('/api/village/state')
def api_village_state():
    try:
        iv = request.args.get('interval') if request.args else None
        if not iv:
            iv = state.get('candle') or load_config().candle
        # tick and read
        E = _energy_tick(str(iv))
        st = _energy_state(str(iv))
        last_reason = st.get('last_reason')
        # attach learned zone reputation snapshot
        rep = {
            'BLUE': dict(_zone_reputation.get('BLUE', {})),
            'ORANGE': dict(_zone_reputation.get('ORANGE', {})),
        }
        # compose minimal treasury snapshot via existing summary
        try:
            total_owned = int(sum(int(v) for v in _nb_coin_counter.values()))
        except Exception:
            total_owned = 0
        # KRW/price/ buyable from summary helper (reuse logic inline)
        price_per_coin = int(getattr(_resolve_config(), 'order_krw', 5100))
        krw = 0.0
        try:
            cfg = _resolve_config()
            if (not cfg.paper) and cfg.access_key and cfg.secret_key:
                upbit = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
                if upbit:
                    krw = float(upbit.get_balance('KRW') or 0.0)
        except Exception:
            krw = 0.0
        buyable = int(krw // max(1, price_per_coin))
        return jsonify({ 'ok': True, 'interval': str(iv), 'energy': E, 'last_reason': last_reason, 'reputation': rep, 'treasury': { 'krw': krw, 'coins': total_owned, 'price_per_coin': price_per_coin, 'buyable': buyable } })
    except Exception as e:
        return jsonify({ 'ok': False, 'error': str(e) }), 500

@app.route('/api/village/energy/fill', methods=['POST'])
def api_village_energy_fill():
    try:
        iv = request.args.get('interval') if request.args else None
        if not iv:
            iv = state.get('candle') or load_config().candle
        
        # Fill energy to 99999
        current_energy = _energy_tick(str(iv))
        energy_needed = 99999.0 - current_energy
        new_energy = _energy_adjust(str(iv), energy_needed, 'manual_fill')
        
        print(f"✅ Village energy filled: {current_energy:.1f}% → {new_energy:.1f}% (interval: {iv})")
        return jsonify({ 'ok': True, 'interval': str(iv), 'previous_energy': current_energy, 'new_energy': new_energy })
    except Exception as e:
        print(f"❌ Error filling village energy: {e}")
        return jsonify({ 'ok': False, 'error': str(e) }), 500

def _interval_to_sec(iv: str) -> int:
    try:
        s = str(iv or 'minute1')
        if s.startswith('minute'):
            return int(s.replace('minute','')) * 60
        if s == 'day':
            return 86400
        if s == 'week':
            return 7*86400
        if s == 'month':
            return 30*86400
    except Exception:
        pass
    return 60

def _bucket_ts_interval(ts_ms: int | None, iv: str) -> int:
    try:
        sec = _interval_to_sec(iv)
        t = int((ts_ms or int(time.time()*1000)) / 1000)
        return (t // sec) * sec
    except Exception:
        return int(time.time())

def _coin_key(interval: str, market: str, bucket_sec: int) -> str:
    return f"{market}|{interval}|{bucket_sec}"

def _coin_store_path() -> str:
    try:
        base_dir = os.path.dirname(__file__)
        data_dir = os.path.join(base_dir, 'data')
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, 'nb_coins_store.json')
    except Exception:
        return 'nb_coins_store.json'

def _npc_store_path() -> str:
    try:
        base_dir = os.path.dirname(__file__)
        data_dir = os.path.join(base_dir, 'data')
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, 'npc_messages.jsonl')
    except Exception:
        return 'npc_messages.jsonl'

def _load_npc_hashes() -> int:
    try:
        path = _npc_store_path()
        if not os.path.exists(path):
            return 0
        cnt = 0
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    h = str(obj.get('hash') or _hash_text(str(obj.get('text') or '')))
                    if h not in _npc_hashes:
                        _npc_hashes.add(h)
                        cnt += 1
                except Exception:
                    continue
        return cnt
    except Exception:
        return 0

def _save_nb_coins() -> bool:
    try:
        path = _coin_store_path()
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(_nb_coin_store, f, ensure_ascii=False)
        return True
    except Exception:
        return False

def _load_nb_coins() -> int:
    try:
        path = _coin_store_path()
        if not os.path.exists(path):
            return 0
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, dict):
            _nb_coin_store.clear()
            _nb_coin_store.update(data)
            return len(_nb_coin_store)
        return 0
    except Exception:
        return 0

def _hash_text(s: str) -> str:
    try:
        return hashlib.sha1(s.encode('utf-8')).hexdigest()
    except Exception:
        return str(uuid.uuid4())

def _npc_add(msg: dict) -> bool:
    try:
        text = str(msg.get('text') or '')
        h = _hash_text(text)
        if h in _npc_hashes:
            return False
        _npc_hashes.add(h)
        msg['id'] = str(uuid.uuid4())
        msg['hash'] = h
        path = _npc_store_path()
        with open(path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(msg, ensure_ascii=False) + '\n')
        return True
    except Exception:
        return False

def _ensure_nb_coin(interval: str, market: str, bucket_sec: int) -> dict:
    key = _coin_key(interval, market, bucket_sec)
    if key not in _nb_coin_store:
        _nb_coin_store[key] = {
            'bucket': int(bucket_sec),
            'interval': str(interval),
            'market': str(market),
            'side': 'NONE',  # NONE | BUY | SELL
            'orders': [],
            'ts': int(time.time()*1000),
            'reasons': [],            # list of strings describing why no trade yet
            'checked_ts': None,       # last time we evaluated trade conditions
            'blocks': {},             # aggregated counters per reason
            'coin_count': int(_nb_coin_counter.get(str(interval), 0)),
            'rest_until': int(_nb_rest_until.get(str(interval), 0)),
        }
        # trim to last ~2000 coins
        if len(_nb_coin_store) > 2500:
            for k in sorted(_nb_coin_store.keys())[:-2000]:
                try:
                    del _nb_coin_store[k]
                except Exception:
                    pass
        try:
            _save_nb_coins()
        except Exception:
            pass
    return _nb_coin_store[key]

def _mark_nb_coin(interval: str, market: str, side: str, ts_ms: int | None = None, order_obj: dict | None = None):
    try:
        b = _bucket_ts_interval(ts_ms or int(time.time()*1000), interval)
        coin = _ensure_nb_coin(interval, market, b)
        # Once any order happens in the bucket, mark the side (prefer SELL over BUY if multiple; or latest wins)
        coin['side'] = str(side).upper()
        
        # Store position size for BUY orders
        if str(side).upper() == 'BUY' and order_obj:
            try:
                size = float(order_obj.get('size') or 0.0)
                if size > 0:
                    coin['position_size'] = size
                    coin['entry_price'] = float(order_obj.get('price') or 0.0)
            except Exception:
                pass
        
        if order_obj:
            try:
                coin['orders'].append({
                    'ts': int(order_obj.get('ts') or int(time.time()*1000)),
                    'side': str(order_obj.get('side') or side).upper(),
                    'price': float(order_obj.get('price') or 0.0),
                    'size': float(order_obj.get('size') or 0.0),
                    'paper': bool(order_obj.get('paper')),
                })
            except Exception:
                pass
    except Exception:
        pass
    try:
        _save_nb_coins()
    except Exception:
        pass

def _apply_coin_accounting(interval: str, price: float, side: str):
    try:
        iv = str(interval)
        if side.upper() == 'BUY' and (price or 0) > 0:
            if iv not in _nb_open_entry:
                _nb_open_entry[iv] = float(price)
                # On BUY success, save 1 coin (최대 1개로 제한)
                prev = int(_nb_coin_counter.get(iv, 0))
                if prev < 1:  # 1개 미만일 때만 증가
                    _nb_coin_counter[iv] = prev + 1
                # If this is the first coin (0 -> 1), schedule rest window
                try:
                    if prev <= 0 and (_nb_coin_counter.get(iv, 0) or 0) >= 1:
                        rest_on = (os.getenv('REST_AFTER_FIRST_COIN', 'true').lower() == 'true')
                        rest_bars = int(os.getenv('REST_BARS', '3'))
                        if rest_on and rest_bars > 0:
                            b = _bucket_ts_interval(int(time.time()*1000), iv)
                            _nb_rest_until[iv] = int(b + rest_bars)
                except Exception:
                    pass
        elif side.upper() == 'SELL' and (price or 0) > 0:
            if iv in _nb_open_entry:
                entry = float(_nb_open_entry.get(iv) or 0.0)
                profit = (float(price) - entry) > 0
                if profit:
                    # profit: add one more coin
                    _nb_coin_counter[iv] = int(_nb_coin_counter.get(iv, 0)) + 1
                    try:
                        _energy_adjust(iv, +1.5, 'sell_profit')
                    except Exception:
                        pass
                else:
                    # loss: remove coin(s); stronger penalty if Elder guidance was violated
                    # Elder guidance: BUY only in BLUE, SELL only in ORANGE
                    try:
                        z = str((_nb_coin_store.get(_coin_key(iv, load_config().market, _bucket_ts_interval(int(time.time()*1000), iv)) ) or {}).get('zone') or '').upper()
                    except Exception:
                        z = ''
                    violated = False
                    try:
                        # If last known zone is BLUE and we SOLD, or ORANGE and we BOUGHT (opposite of guidance)
                        violated = (z == 'BLUE' and True)  # SELL in BLUE is violation; if z unknown keep False
                    except Exception:
                        violated = False
                    penalty = int(os.getenv('ELDER_VIOLATION_PENALTY', '2'))
                    if violated:
                        _nb_coin_counter[iv] = int(_nb_coin_counter.get(iv, 0)) - max(1, penalty)
                        try:
                            _energy_adjust(iv, -2.0, 'sell_loss_violation')
                        except Exception:
                            pass
                    else:
                        _nb_coin_counter[iv] = int(_nb_coin_counter.get(iv, 0)) - 1
                        try:
                            _energy_adjust(iv, -1.0, 'sell_loss')
                        except Exception:
                            pass
                # close the open cycle
                _nb_open_entry.pop(iv, None)
        # reflect latest coin_count into current bucket coin if exists
        try:
            b = _bucket_ts_interval(int(time.time()*1000), iv)
            key = _coin_key(iv, load_config().market, b)
            if key in _nb_coin_store:
                _nb_coin_store[key]['coin_count'] = int(_nb_coin_counter.get(iv, 0))
        except Exception:
            pass
    except Exception:
        pass


def _score_strategies(interval: str) -> dict:
    """Return simple heuristic scores for four strategies and a suggested action.
    Heads: trend, meanrev, breakout, pullback
    """
    try:
        iv = str(interval)
        cfg = _resolve_config()
        df = get_candles(cfg.market, iv, count=max(200, cfg.ema_slow+50))
        window = int(load_nb_params().get('window', 50))
        ins = _make_insight(df, window, cfg.ema_fast, cfg.ema_slow, iv, None) or {}
        zone = str(ins.get('zone') or '').upper()
        rv = float(ins.get('r', 0.5) or 0.5)
        try:
            HIGH = float(os.getenv('NB_HIGH', '0.55')); LOW = float(os.getenv('NB_LOW', '0.45'))
        except Exception:
            HIGH,LOW = 0.55,0.45
        rng = max(1e-9, HIGH-LOW)
        # slope approx
        slope_bp = 0.0
        try:
            n_tail = max(20, min(120, window))
            closes = df['close'].astype(float).tail(n_tail)
            if len(closes) >= 5:
                import numpy as _np
                y = _np.log(closes.replace(0, _np.nan)).bfill().ffill().values
                x = _np.arange(len(y), dtype=float)
                b1 = _np.polyfit(x, y, 1)[0]
                slope_bp = float(b1*10000.0)
        except Exception:
            slope_bp = 0.0
        # features for heads
        trend_align = (zone=='BLUE' and slope_bp>0) or (zone=='ORANGE' and slope_bp<0)
        near_extreme = (zone=='BLUE' and (rv-LOW) <= (0.15*rng)) or (zone=='ORANGE' and (HIGH-rv) <= (0.15*rng))
        try:
            hi = float(df['high'].rolling(window).max().iloc[-1]); lo = float(df['low'].rolling(window).min().iloc[-1]); c = float(df['close'].iloc[-1])
        except Exception:
            hi=lo=c=0.0
        breakout_up = c >= (hi*0.999)
        breakout_dn = c <= (lo*1.001)
        eg = float(ins.get('extreme_gap', 0.0) or 0.0); age = int(ins.get('zone_extreme_age', 0) or 0)
        try:
            pb_r = float(os.getenv('PULLBACK_R', '0.02'))
            pb_bars = int(os.getenv('PULLBACK_BARS', '2'))
        except Exception:
            pb_r, pb_bars = 0.02, 2
        pull_ok = (eg >= pb_r) and (age >= pb_bars)
        # scores (0..1)
        s_trend = 1.0 if trend_align else 0.2
        s_mean = 1.0 if ((zone=='BLUE' and slope_bp<0 and near_extreme) or (zone=='ORANGE' and slope_bp>0 and near_extreme)) else 0.2
        s_break = 1.0 if (breakout_up or breakout_dn) else 0.2
        s_pull = 1.0 if pull_ok else 0.2
        # Reputation-aware adjustment: penalize actions that conflict with learned zone reputation
        rep_orange = float((_zone_reputation.get('ORANGE') or {}).get('score') or 0.0)
        rep_blue = float((_zone_reputation.get('BLUE') or {}).get('score') or 0.0)
        rep_penalty = 0.15
        if zone == 'ORANGE' and rep_orange < 0:
            s_trend *= (1.0 + rep_orange * rep_penalty)
            s_mean  *= (1.0 + rep_orange * rep_penalty)
            s_pull  *= (1.0 + rep_orange * rep_penalty)
        if zone == 'BLUE' and rep_blue < 0:
            s_trend *= (1.0 + rep_blue * rep_penalty)
            s_mean  *= (1.0 + rep_blue * rep_penalty)
            s_pull  *= (1.0 + rep_blue * rep_penalty)
        head_scores = {'trend': s_trend, 'meanrev': s_mean, 'breakout': s_break, 'pullback': s_pull}
        # choose best (favor recent realized pnl via simple tie-break)
        chosen = max(head_scores.items(), key=lambda x: (x[1], 0))[0]
        # intent
        intent = 'HOLD'
        if chosen=='trend':
            intent = 'BUY' if zone=='BLUE' and slope_bp>0 else ('SELL' if zone=='ORANGE' and slope_bp<0 else 'HOLD')
        elif chosen=='meanrev':
            intent = 'BUY' if zone=='BLUE' and slope_bp<0 and near_extreme else ('SELL' if zone=='ORANGE' and slope_bp>0 and near_extreme else 'HOLD')
        elif chosen=='breakout':
            intent = 'BUY' if breakout_up else ('SELL' if breakout_dn else 'HOLD')
        elif chosen=='pullback':
            intent = 'BUY' if zone=='BLUE' and pull_ok else ('SELL' if zone=='ORANGE' and pull_ok else 'HOLD')
        # feasibility
        coin = int(_nb_coin_counter.get(iv, 0))
        price_per_coin = int(getattr(cfg, 'order_krw', 5100))
        avail_krw = 0.0
        try:
            upbit = None
            if (not cfg.paper) and cfg.access_key and cfg.secret_key:
                upbit = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
            if upbit:
                avail_krw = float(upbit.get_balance('KRW') or 0.0)
        except Exception:
            avail_krw = 0.0
        buyable = int(avail_krw // max(1, price_per_coin))
        feasible = {'can_buy': buyable>0, 'can_sell': coin>0}
        return {
            'ok': True,
            'interval': iv,
            'insight': ins,
            'slope_bp': slope_bp,
            'head_scores': head_scores,
            'chosen': chosen,
            'intent': intent,
            'feasible': feasible,
            'coin_count': coin,
            'buyable_by_krw': buyable,
            'reputation': {
                'BLUE': float(rep_blue),
                'ORANGE': float(rep_orange),
            },
        }
    except Exception as e:
        return {'ok': False, 'error': str(e)}


@app.route('/api/trainer/suggest')
def api_trainer_suggest():
    try:
        iv = request.args.get('interval') if request.args else None
        if not iv:
            iv = state.get('candle') or load_config().candle
        res = _score_strategies(str(iv))
        # update council view for this interval
        try:
            if res.get('ok'):
                _council_state['ts'] = int(time.time()*1000)
                ivs = _council_state.setdefault('intervals', {})
                ivs[str(iv)] = {
                    'chosen': res.get('chosen'),
                    'intent': res.get('intent'),
                    'feasible': res.get('feasible'),
                    'zone': (res.get('insight') or {}).get('zone'),
                    'slope_bp': res.get('slope_bp'),
                }
                # derive a simple consensus by majority of intents among feasible ones
                votes = {}
                for _, row in ivs.items():
                    intent = str(row.get('intent') or 'HOLD').upper()
                    feas = row.get('feasible') or {}
                    if intent == 'BUY' and not feas.get('can_buy'): intent = 'HOLD'
                    if intent == 'SELL' and not feas.get('can_sell'): intent = 'HOLD'
                    votes[intent] = votes.get(intent, 0) + 1
                if votes:
                    intent_cons = max(votes.items(), key=lambda x: x[1])[0]
                    _council_state['consensus'] = { 'intent': intent_cons, 'votes': votes }
        except Exception:
            pass
        return jsonify(res), (200 if res.get('ok') else 500)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/narrative/add', methods=['POST'])
def api_narrative_add():
    try:
        payload = request.get_json(force=True) if request.is_json else request.form.to_dict()
        text = str(payload.get('text') or '')
        zone = str(payload.get('zone') or '').upper()
        # simple sentiment mapping: if explicit negative, penalize; else small nudge
        negative = bool(payload.get('negative') or ('negative' in text.lower()) or ('risk' in text.lower()) or ('lock' in text.lower()))
        delta = float(payload.get('delta') or (-0.3 if negative else 0.1))
        row = _update_zone_reputation(zone, delta, note=(payload.get('title') or text[:120]))
        # persist narrative
        obj = {
            'id': str(uuid.uuid4()),
            'ts': int(time.time()*1000),
            'zone': zone,
            'text': text,
            'delta': delta,
            'rep_after': float(row.get('score', 0.0)),
        }
        try:
            with open(_narrative_store_path(), 'a', encoding='utf-8') as f:
                f.write(json.dumps(obj, ensure_ascii=False) + '\n')
        except Exception:
            pass
        # broadcast a brief NPC line
        _npc_add({'text': f"Narrative updated: {zone} reputation {row.get('score',0.0):.2f}.", 'ts': obj['ts']})
        return jsonify({'ok': True, 'reputation': _zone_reputation, 'saved': obj})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/council/state')
def api_council_state():
    try:
        return jsonify({ 'ok': True, 'state': _council_state })
    except Exception as e:
        return jsonify({ 'ok': False, 'error': str(e) }), 500

def _mark_nb_coin_block(interval: str, market: str, reasons: list[str] | None = None, ts_ms: int | None = None, meta: dict | None = None):
    try:
        b = _bucket_ts_interval(ts_ms or int(time.time()*1000), interval)
        coin = _ensure_nb_coin(interval, market, b)
        # Rest-after-first-coin gate annotation
        try:
            iv = str(interval)
            rest_until = int(_nb_rest_until.get(iv) or 0)
            if rest_until and b < rest_until:
                if reasons is None:
                    reasons = []
                if 'rest:scheduled' not in reasons:
                    reasons = list(reasons) + ['rest:scheduled']
        except Exception:
            pass
        coin['checked_ts'] = int(time.time()*1000)
        # Do not override side if already traded; still record reasons for diagnostics
        rs = reasons or []
        if rs:
            # append unique recent reasons (cap 20)
            for r in rs:
                try:
                    r = str(r)
                except Exception:
                    continue
                coin['reasons'].append(r)
                if isinstance(coin.get('blocks'), dict):
                    coin['blocks'][r] = int(coin['blocks'].get(r, 0)) + 1
            if len(coin['reasons']) > 20:
                coin['reasons'] = coin['reasons'][-20:]
        if meta and isinstance(meta, dict):
            # store a tiny snapshot
            coin['meta'] = {k: meta[k] for k in list(meta.keys())[:12]}
    except Exception:
        pass
    try:
        _save_nb_coins()
    except Exception:
        pass

def _record_nb_attempt(interval: str, market: str, side: str, ok: bool, error: str | None = None, ts_ms: int | None = None, meta: dict | None = None):
    try:
        b = _bucket_ts_interval(ts_ms or int(time.time()*1000), interval)
        coin = _ensure_nb_coin(interval, market, b)
        arr = coin.setdefault('attempts', [])
        item = {
            'ts': int(time.time()*1000),
            'side': str(side).upper(),
            'ok': bool(ok),
            'error': (str(error) if error else None),
        }
        if isinstance(meta, dict):
            item['meta'] = {k: meta[k] for k in list(meta.keys())[:12]}
        arr.append(item)
        # aggregate blocks
        key = (f"attempt_ok_{str(side).upper()}" if ok else f"error:{str(error)}:{str(side).upper()}")
        coin.setdefault('blocks', {})
        coin['blocks'][key] = int(coin['blocks'].get(key, 0)) + 1
        if not ok and error:
            coin.setdefault('reasons', [])
            coin['reasons'].append(f"error:{str(error)}:{str(side).upper()}")
            if len(coin['reasons']) > 20:
                coin['reasons'] = coin['reasons'][-20:]
    except Exception:
        pass
    try:
        _save_nb_coins()
    except Exception:
        pass

def _prefill_nb_coins(interval: str, market: str, how_many: int = 50) -> None:
    try:
        now_ms = int(time.time()*1000)
        now_b = _bucket_ts_interval(now_ms, interval)
        sec = _interval_to_sec(interval)
        for i in range(max(1, how_many)):
            b = now_b - i*sec
            _ensure_nb_coin(str(interval), str(market), int(b))
    except Exception:
        pass

# Auto-Buy configuration (simple in-memory store)
AUTO_BUY_CONFIG = {
    'enabled': False,
    'market': 'KRW-BTC',
    'interval': 'minute10',
    'amount_krw': 5000,
    'last_check': None,
    'last_buy': None
}

# Bot controller moved to bot_state.py

# ---------------- NB auto-tune persistence ----------------
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
PARAMS_PATH = os.path.join(DATA_DIR, 'nb_params.json')

def _ensure_data_dir():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
    except Exception:
        pass

def load_nb_params():
    try:
        _ensure_data_dir()
        if os.path.exists(PARAMS_PATH):
            with open(PARAMS_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return { 'buy': 0.70, 'sell': 0.30, 'window': 50, 'updated_at': None }

def save_nb_params(params: dict):
    try:
        _ensure_data_dir()
        params = dict(params)
        params['updated_at'] = int(time.time()*1000)
        with open(PARAMS_PATH, 'w', encoding='utf-8') as f:
            json.dump(params, f, ensure_ascii=False)
        return True
    except Exception:
        return False

# ---------------- ML training/prediction (development) ----------------
MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
ML_MODEL_PATH = os.path.join(MODELS_DIR, 'nb_ml.pkl')

def _model_path_for(interval: str) -> str:
    try:
        safe = str(interval or 'minute10').replace('/', '_')
    except Exception:
        safe = 'minute10'
    return os.path.join(MODELS_DIR, f'nb_ml_{safe}.pkl')

def _ensure_models_dir():
    try:
        os.makedirs(MODELS_DIR, exist_ok=True)
    except Exception:
        pass

def _build_features(df: pd.DataFrame, window: int, ema_fast: int = 10, ema_slow: int = 30, horizon: int = 5) -> pd.DataFrame:
    """최적화된 특성 계산 - 벡터화 연산 최대화"""
    out = pd.DataFrame(index=df.index)
    
    # 1. 데이터 타입 최적화 - 숫자 변환 최소화
    close = pd.to_numeric(df['close'], errors='coerce').values
    high = pd.to_numeric(df['high'], errors='coerce').values
    low = pd.to_numeric(df['low'], errors='coerce').values
    
    # NaN 제거 (한 번만)
    valid_mask = ~(np.isnan(close) | np.isnan(high) | np.isnan(low))
    close = np.where(valid_mask, close, np.nan)
    high = np.where(valid_mask, high, np.nan)
    low = np.where(valid_mask, low, np.nan)
    
    out['close'] = close
    out['high'] = high
    out['low'] = low
    
    # 2. NB r 계산
    r = _compute_r_from_ohlcv(df, window)
    out['r'] = r
    
    # 3. 벡터화된 w 계산 (rolling 최적화)
    high_max = pd.Series(high).rolling(window, min_periods=1).max().values
    low_min = pd.Series(low).rolling(window, min_periods=1).min().values
    hl_avg = (high + low) / 2
    hl_avg = np.where(hl_avg != 0, hl_avg, np.nan)
    out['w'] = (high_max - low_min) / hl_avg
    
    # 4. EMA 계산 (한 번의 ewm으로 통합)
    close_series = pd.Series(close)
    out['ema_f'] = close_series.ewm(span=ema_fast, adjust=False).mean().values
    out['ema_s'] = close_series.ewm(span=ema_slow, adjust=False).mean().values
    out['ema_diff'] = out['ema_f'] - out['ema_s']
    
    # 5. r 부드럽게 처리 (벡터화)
    r_series = pd.Series(r)
    out['r_ema3'] = r_series.ewm(span=3, adjust=False).mean().values
    out['r_ema5'] = r_series.ewm(span=5, adjust=False).mean().values
    out['dr'] = r_series.diff().values
    
    # 6. 수익률 계산 (벡터화)
    out['ret1'] = pd.Series(close).pct_change(1).values
    out['ret3'] = pd.Series(close).pct_change(3).values
    out['ret5'] = pd.Series(close).pct_change(5).values
    
    # 7. Zone 계산 (벡터화 버전)
    try:
        HIGH = float(os.getenv('NB_HIGH', '0.55'))
        LOW = float(os.getenv('NB_LOW', '0.45'))
    except Exception:
        HIGH, LOW = 0.55, 0.45
    
    rng = max(1e-9, HIGH - LOW)
    r_vals = r.fillna(0.5).values
    
    # 벡터화된 zone 계산
    zone_flag = np.where(r_vals >= 0.5, -1, 1).astype(float)  # -1=ORANGE, +1=BLUE
    dist_high = np.maximum(0, r_vals - HIGH)
    dist_low = np.maximum(0, LOW - r_vals)
    zone_conf = np.where(r_vals >= 0.5, dist_high / rng, dist_low / rng)
    zone_conf = np.clip(zone_conf, 0, 1)
    
    out['zone_flag'] = zone_flag
    out['dist_high'] = dist_high
    out['dist_low'] = dist_low
    out['zone_conf'] = zone_conf
    
    # 8. 복잡한 zone extrema 계산 (필요시만 수행)
    out['zone_min_r'] = 0.0
    out['zone_max_r'] = 1.0
    out['zone_extreme_r'] = r_vals
    out['zone_extreme_age'] = np.arange(len(r_vals), dtype=float)
    
    # 9. Forward return for labeling (필수) - 마지막 horizon개 행은 NaN이 될 수 있음
    close_series = pd.Series(close)
    fwd_close = close_series.shift(-horizon)
    # NaN이 아닌 값만 계산
    fwd_return = np.where(
        (close > 0) & (~fwd_close.isna().values),
        (fwd_close.values - close) / close,
        np.nan
    )
    out['fwd'] = fwd_return
    
    return out


def _train_ml(X: pd.DataFrame, y: np.ndarray):
    # Try scikit-learn; fall back to logistic regression if needed
    try:
        from sklearn.ensemble import GradientBoostingClassifier
        from sklearn.model_selection import TimeSeriesSplit
        from sklearn.utils.class_weight import compute_class_weight
        cls = GradientBoostingClassifier(random_state=42)
        # simple fit; for dev we skip CV heavy compute
        cls.fit(X, y)
        return cls
    except Exception as e:
        raise RuntimeError("scikit-learn is required. Please run: pip install scikit-learn. Cause: %s" % e)

def _load_ml(interval: str | None = None):
    _ensure_models_dir()
    try:
        path = _model_path_for(interval or state.get('candle') or load_config().candle)
    except Exception:
        path = ML_MODEL_PATH
    if os.path.exists(path):
        return joblib.load(path)
    # Backward compatibility fallback
    if os.path.exists(ML_MODEL_PATH):
        return joblib.load(ML_MODEL_PATH)
    return None

def _make_insight(df: pd.DataFrame, window: int, ema_fast: int, ema_slow: int, interval: str, pack: dict | None = None) -> dict:
    try:
        feat = _build_features(df, window, ema_fast, ema_slow, 5).dropna().copy()
        if feat.empty:
            return {}
        last = feat.iloc[-1]
        zone_flag = int(round(float(last.get('zone_flag', 0))))
        zone = 'BLUE' if zone_flag == 1 else ('ORANGE' if zone_flag == -1 else 'UNKNOWN')
        try:
            HIGH = float(os.getenv('NB_HIGH', '0.55'))
            LOW = float(os.getenv('NB_LOW', '0.45'))
        except Exception:
            HIGH, LOW = 0.55, 0.45
        rng = max(1e-9, HIGH - LOW)
        rv = float(last.get('r', 0.5))
        p_blue_raw = max(0.0, min(1.0, (HIGH - rv) / rng))
        p_orange_raw = max(0.0, min(1.0, (rv - LOW) / rng))
        s0 = p_blue_raw + p_orange_raw
        if s0 > 0:
            p_blue_raw, p_orange_raw = p_blue_raw/s0, p_orange_raw/s0
        # Trend weighting
        try:
            trend_k = int(os.getenv('NB_TREND_K', '30'))
            trend_alpha = float(os.getenv('NB_TREND_ALPHA', '0.5'))
        except Exception:
            trend_k, trend_alpha = 30, 0.5
        p_blue, p_orange = p_blue_raw, p_orange_raw
        try:
            r_series = _compute_r_from_ohlcv(df, window).astype(float)
            if len(r_series) >= trend_k*2:
                tail_now = r_series.iloc[-trend_k:]
                tail_prev = r_series.iloc[-trend_k*2:-trend_k]
                zmax_now, zmax_prev = float(tail_now.max()), float(tail_prev.max())
                zmin_now, zmin_prev = float(tail_now.min()), float(tail_prev.min())
                trend_orange = max(0.0, (zmax_prev - zmax_now) / rng)
                trend_blue = max(0.0, (zmin_now - zmin_prev) / rng)
                p_orange = max(0.0, min(1.0, p_orange_raw * (1.0 - trend_alpha * trend_orange)))
                p_blue = max(0.0, min(1.0, p_blue_raw * (1.0 - trend_alpha * trend_blue)))
                s = p_blue + p_orange
                if s > 0:
                    p_blue, p_orange = p_blue/s, p_orange/s
        except Exception:
            pass
        ins = {
            'r': rv,
            'zone_flag': zone_flag,
            'zone': zone,
            'zone_conf': float(last.get('zone_conf', 0.0)),
            'dist_high': float(last.get('dist_high', 0.0)),
            'dist_low': float(last.get('dist_low', 0.0)),
            'extreme_gap': float(last.get('extreme_gap', 0.0)),
            'zone_min_r': float(last.get('zone_min_r', rv)),
            'zone_max_r': float(last.get('zone_max_r', rv)),
            'zone_extreme_r': float(last.get('zone_extreme_r', rv)),
            'zone_extreme_age': int(last.get('zone_extreme_age', 0)),
            'zone_min_price': float(last.get('zone_min_price', last.get('close', 0.0))),
            'zone_max_price': float(last.get('zone_max_price', last.get('close', 0.0))),
            'zone_extreme_price': float(last.get('zone_extreme_price', last.get('close', 0.0))),
            'w': float(last.get('w', 0.0)),
            'ema_diff': float(last.get('ema_diff', 0.0)),
            'pct_blue_raw': float(p_blue_raw*100.0),
            'pct_orange_raw': float(p_orange_raw*100.0),
            'pct_blue': float(p_blue*100.0),
            'pct_orange': float(p_orange*100.0),
        }
        # record observation bucket for grouping
        try:
            _record_group_observation(interval, window, rv, ins['pct_blue'], ins['pct_orange'], int(time.time()*1000))
        except Exception:
            pass
        return ins
    except Exception:
        return {}

def _simulate_pnl_from_preds(prices: pd.Series, preds: np.ndarray, fee_bps: float = 10.0) -> dict:
    pos = 0
    entry = 0.0
    pnl = 0.0
    wins = 0
    trades = 0
    for p, y in zip(prices.astype(float).values, preds.tolist()):
        if pos == 0 and y > 0:
            pos = 1
            entry = float(p)
            trades += 1
        elif pos == 1 and y < 0:
            ret = float(p) - entry
            ret -= abs(entry) * (fee_bps / 10000.0)
            ret -= abs(p) * (fee_bps / 10000.0)
            pnl += ret
            if ret > 0:
                wins += 1
            pos = 0
            entry = 0.0
    if pos == 1:
        p = float(prices.iloc[-1])
        ret = p - entry
        ret -= abs(entry) * (fee_bps / 10000.0)
        ret -= abs(p) * (fee_bps / 10000.0)
        pnl += ret
        if ret > 0:
            wins += 1
        pos = 0
    win_rate = (wins / trades * 100.0) if trades else 0.0
    return { 'pnl': float(pnl), 'trades': int(trades), 'wins': int(wins), 'win_rate': float(win_rate) }

@app.route('/api/ml/train', methods=['GET','POST'])
def api_ml_train():
    """ML 모델 학습"""
    try:
        try:
            if request.method == 'POST':
                payload = request.get_json(force=True) if request.is_json else (request.form.to_dict() if request.form else {})
            else:
                payload = request.args.to_dict()
        except Exception:
            payload = {}
        window = int(payload.get('window', load_nb_params().get('window', 50)))
        ema_fast = int(payload.get('ema_fast', 10))
        ema_slow = int(payload.get('ema_slow', 30))
        horizon = int(payload.get('horizon', 5))
        tau = float(payload.get('tau', 0.002))  # 0.2%
        count = int(payload.get('count', 1800))
        interval = payload.get('interval') or load_config().candle
        # Default label mode can be overridden via env NB_LABEL_MODE_DEFAULT
        try:
            _lm_def = os.getenv('NB_LABEL_MODE_DEFAULT', 'zone')
        except Exception:
            _lm_def = 'zone'
        label_mode = str(payload.get('label_mode', _lm_def))  # 'zone' | 'nb_zone' | 'fwd_return' | 'nb_extreme' | 'nb_best_trade'
        # Optional: extreme-based labels tuning
        try:
            pullback_pct = float(payload.get('pullback_pct', os.getenv('NB_PULLBACK_PCT', '40')))
        except Exception:
            pullback_pct = 40.0
        try:
            confirm_bars = int(payload.get('confirm_bars', os.getenv('NB_CONFIRM_BARS', '2')))
        except Exception:
            confirm_bars = 2

        cfg = load_config()
        df = get_candles(cfg.market, interval, count=count)
        # Prefill NB COINs for the training interval so UI has coins during random learning
        try:
            _prefill_nb_coins(str(interval), str(cfg.market), how_many=min(200, max(60, count)))
        except Exception:
            pass
        feat = _build_features(df, window, ema_fast, ema_slow, horizon).dropna().copy()
        # label: depends on label_mode
        if label_mode == 'fwd_return':
            fwd = feat['fwd']
            y = np.where(fwd >= tau, 1, np.where(fwd <= -tau, -1, 0))
        elif label_mode in ('zone','zone_flag'):
            # Learn zone as target: BLUE(+1), ORANGE(-1) using hysteresis to reduce churn
            r = _compute_r_from_ohlcv(df, window)
            HIGH = float(os.getenv('NB_HIGH', '0.55'))
            LOW = float(os.getenv('NB_LOW', '0.45'))
            labels = np.zeros(len(df), dtype=int)
            zone = None
            r_vals = r.values.tolist()
            for i in range(len(df)):
                rv = r_vals[i] if i < len(r_vals) else 0.5
                if zone not in ('BLUE','ORANGE'):
                    zone = 'ORANGE' if rv >= 0.5 else 'BLUE'
                # hysteresis updates
                if zone == 'BLUE' and rv >= HIGH:
                    zone = 'ORANGE'
                elif zone == 'ORANGE' and rv <= LOW:
                    zone = 'BLUE'
                labels[i] = (1 if zone=='BLUE' else -1)
            idx_map = { ts: i for i, ts in enumerate(df.index) }
            y = np.array([ labels[idx_map.get(ts, 0)] for ts in feat.index ], dtype=int)
            # Safety: ensure no zeros remain in zone targets
            if np.any(y == 0):
                try:
                    rv_feat = feat['r'].astype(float).values
                    y = np.where(y == 0, np.where(rv_feat >= 0.5, -1, 1), y)
                except Exception:
                    y = np.where(y == 0, 1, y)
        elif label_mode == 'mayor_guidance':
            # 촌장 지침 학습: Zone-Side Only (BUY@BLUE / SELL@ORANGE)
            r = _compute_r_from_ohlcv(df, window)
            HIGH = float(os.getenv('NB_HIGH', '0.55'))
            LOW = float(os.getenv('NB_LOW', '0.45'))
            labels = np.zeros(len(df), dtype=int)
            zone = None
            r_vals = r.values.tolist()
            
            # 촌장 지침 기반 라벨링
            for i in range(len(df)):
                rv = r_vals[i] if i < len(r_vals) else 0.5
                if zone not in ('BLUE','ORANGE'):
                    zone = 'ORANGE' if rv >= 0.5 else 'BLUE'
                # hysteresis updates
                if zone == 'BLUE' and rv >= HIGH:
                    zone = 'ORANGE'
                elif zone == 'ORANGE' and rv <= LOW:
                    zone = 'BLUE'
                
                # 촌장 지침에 따른 라벨링:
                # BLUE 구역: BUY(+1)만 허용, SELL(-1) 금지
                # ORANGE 구역: SELL(-1)만 허용, BUY(+1) 금지
                if zone == 'BLUE':
                    labels[i] = 1  # BUY만 허용
                elif zone == 'ORANGE':
                    labels[i] = -1  # SELL만 허용
                else:
                    labels[i] = 0  # HOLD
            
            idx_map = { ts: i for i, ts in enumerate(df.index) }
            y = np.array([ labels[idx_map.get(ts, 0)] for ts in feat.index ], dtype=int)
        elif label_mode == 'nb_extreme':
            # Learn BLUE/ORANGE extremes with pullback confirmation; one BUY then one SELL
            r = _compute_r_from_ohlcv(df, window)
            HIGH = float(os.getenv('NB_HIGH', '0.55'))
            LOW = float(os.getenv('NB_LOW', '0.45'))
            RANGE = max(1e-9, HIGH - LOW)
            pull_r = RANGE * (max(0.0, min(100.0, float(pullback_pct))) / 100.0)
            labels = np.zeros(len(df), dtype=int)
            zone = None
            zone_extreme = None
            prev_r = None
            confirm_up = 0
            confirm_dn = 0
            position = 'FLAT'
            r_vals = r.values.tolist()
            for i in range(len(df)):
                rv = r_vals[i] if i < len(r_vals) else 0.5
                # init zone
                if zone not in ('BLUE','ORANGE'):
                    zone = 'ORANGE' if rv >= 0.5 else 'BLUE'
                    zone_extreme = rv
                    confirm_up = 0; confirm_dn = 0
                # zone transitions reset extremes
                if zone == 'BLUE' and rv >= HIGH:
                    zone = 'ORANGE'
                    zone_extreme = rv
                    confirm_up = 0; confirm_dn = 0
                elif zone == 'ORANGE' and rv <= LOW:
                    zone = 'BLUE'
                    zone_extreme = rv
                    confirm_up = 0; confirm_dn = 0
                # track extremes
                if zone == 'BLUE':
                    zone_extreme = min(zone_extreme, rv) if zone_extreme is not None else rv
                else:
                    zone_extreme = max(zone_extreme, rv) if zone_extreme is not None else rv
                # confirmations
                if prev_r is not None:
                    if rv > prev_r: confirm_up += 1
                    else: confirm_up = 0
                    if rv < prev_r: confirm_dn += 1
                    else: confirm_dn = 0
                prev_r = rv
                # decisions
                if position == 'FLAT' and zone == 'BLUE':
                    if (rv - zone_extreme) >= pull_r and confirm_up >= int(confirm_bars):
                        labels[i] = 1
                        position = 'LONG'
                        confirm_up = 0; confirm_dn = 0
                elif position == 'LONG' and zone == 'ORANGE':
                    if (zone_extreme - rv) >= pull_r and confirm_dn >= int(confirm_bars):
                        labels[i] = -1
                        position = 'FLAT'
                        confirm_up = 0; confirm_dn = 0
            # align labels to feature index
            idx_map = { ts: i for i, ts in enumerate(df.index) }
            y = np.array([ labels[idx_map.get(ts, 0)] for ts in feat.index ], dtype=int)
        elif label_mode == 'nb_best_trade':
            # Build NB zone transitions, form BUY/SELL pairs, pick the single best PnL pair
            r = _compute_r_from_ohlcv(df, window)
            HIGH = float(os.getenv('NB_HIGH', '0.55'))
            LOW = float(os.getenv('NB_LOW', '0.45'))
            zone = None
            signals = []  # (idx, side)
            r_vals = r.values.tolist()
            for i in range(len(df)):
                rv = r_vals[i] if i < len(r_vals) else 0.5
                if zone not in ('BLUE','ORANGE'):
                    zone = 'ORANGE' if rv >= 0.5 else 'BLUE'
                if zone == 'BLUE' and rv >= HIGH:
                    zone = 'ORANGE'
                    signals.append((i, -1))  # SELL
                elif zone == 'ORANGE' and rv <= LOW:
                    zone = 'BLUE'
                    signals.append((i, 1))   # BUY
            # normalize to alternating BUY/SELL starting with BUY
            norm = []
            last = None
            for i, s in signals:
                if s == last:
                    continue
                norm.append((i, s))
                last = s
            while norm and norm[0][1] != 1:
                norm.pop(0)
            # pair and score
            prices = df['close'].astype(float).values.tolist()
            best = None
            for k in range(0, len(norm)-1, 2):
                bi, bs = norm[k]
                if k+1 >= len(norm):
                    break
                si, ss = norm[k+1]
                if bs != 1 or ss != -1:
                    continue
                if si <= bi or bi < 0 or si >= len(prices):
                    continue
                ret = float(prices[si]) - float(prices[bi])
                # approx fees: 0.1% in/out
                fee_bps = 10.0
                ret -= float(prices[bi]) * (fee_bps/10000.0)
                ret -= float(prices[si]) * (fee_bps/10000.0)
                if (best is None) or (ret > best['pnl']):
                    best = { 'buy_idx': bi, 'sell_idx': si, 'pnl': ret }
            labels = np.zeros(len(df), dtype=int)
            if best is not None:
                labels[best['buy_idx']] = 1
                labels[best['sell_idx']] = -1
            # align labels to feature index
            idx_map = { ts: i for i, ts in enumerate(df.index) }
            y = np.array([ labels[idx_map.get(ts, 0)] for ts in feat.index ], dtype=int)
        else:
            # NB zone transition labels consistent with live trading loop
            r = _compute_r_from_ohlcv(df, window)
            HIGH = float(os.getenv('NB_HIGH', '0.55'))
            LOW = float(os.getenv('NB_LOW', '0.45'))
            labels = np.zeros(len(df), dtype=int)
            zone = None
            r_vals = r.values.tolist()
            for i in range(len(df)):
                rv = r_vals[i] if i < len(r_vals) else 0.5
                if zone not in ('BLUE', 'ORANGE'):
                    zone = 'ORANGE' if rv >= 0.5 else 'BLUE'
                sig = 0
                if zone == 'BLUE' and rv >= HIGH:
                    zone = 'ORANGE'
                    sig = -1  # SELL
                elif zone == 'ORANGE' and rv <= LOW:
                    zone = 'BLUE'
                    sig = 1   # BUY
                labels[i] = sig
            # align labels to feature frame
            idx_map = { ts: i for i, ts in enumerate(df.index) }
            y = np.array([ labels[idx_map.get(ts, 0)] for ts in feat.index ], dtype=int)
        base_cols = ['r','w','ema_f','ema_s','ema_diff','r_ema3','r_ema5','dr','ret1','ret3','ret5']
        ext_cols = ['zone_flag','dist_high','dist_low','extreme_gap','zone_conf','zone_min_r','zone_max_r','zone_extreme_r','zone_extreme_age','zmin_slope','zmax_slope','zone_len','zmin_vs_prev','zmax_vs_prev']
        # 가격 정보 feature 추가 (정규화된 가격)
        price_cols = []
        if 'close' in feat.columns:
            # 정규화된 가격 (최근 window 기간 내 최소/최대값 기준)
            close_vals = feat['close'].astype(float)
            price_min = close_vals.rolling(window).min()
            price_max = close_vals.rolling(window).max()
            price_range = (price_max - price_min).replace(0, np.nan)
            feat['price_norm'] = ((close_vals - price_min) / price_range).fillna(0.5)  # 0~1 범위로 정규화
            price_cols.append('price_norm')
        if 'high' in feat.columns and 'low' in feat.columns:
            # 고가/저가 정규화
            high_vals = feat['high'].astype(float)
            low_vals = feat['low'].astype(float)
            high_min = high_vals.rolling(window).min()
            high_max = high_vals.rolling(window).max()
            low_min = low_vals.rolling(window).min()
            low_max = low_vals.rolling(window).max()
            high_range = (high_max - high_min).replace(0, np.nan)
            low_range = (low_max - low_min).replace(0, np.nan)
            feat['high_norm'] = ((high_vals - high_min) / high_range).fillna(0.5)
            feat['low_norm'] = ((low_vals - low_min) / low_range).fillna(0.5)
            price_cols.extend(['high_norm', 'low_norm'])
        use_cols = base_cols + [c for c in ext_cols if c in feat.columns] + [c for c in price_cols if c in feat.columns]
        X = feat[use_cols]
        # Sample weights: class-balance + zone-time/extreme-aware weighting
        total_n = len(X)
        c_neg = int((y==-1).sum()); c_zero = int((y==0).sum()); c_pos = int((y==1).sum())
        w_neg = float(total_n) / max(1, 3*c_neg)
        w_zero = float(total_n) / max(1, 3*c_zero) if c_zero>0 else float(total_n)
        w_pos = float(total_n) / max(1, 3*c_pos)
        w = np.where(y==-1, w_neg, np.where(y==0, w_zero, w_pos)).astype(float)
        # Context multiplier:
        # - SELL(-1): emphasize when zones are far apart (long zone_len) and ORANGE max exceeds previous (zmax_vs_prev > 0)
        # - BUY(+1): emphasize when zones are close (short zone_len) and BLUE min exceeds previous (zmin_vs_prev > 0)
        try:
            zone_len = feat['zone_len'].reindex(X.index) if hasattr(X, 'index') else feat['zone_len']
            zmin_vs_prev = feat['zmin_vs_prev'].reindex(X.index) if hasattr(X, 'index') else feat['zmin_vs_prev']
            zmax_vs_prev = feat['zmax_vs_prev'].reindex(X.index) if hasattr(X, 'index') else feat['zmax_vs_prev']
            # normalize zone_len by window
            zl = np.clip((zone_len.astype(float).values / max(1, window)), 0.0, 1.0)
            zp = feat['zone_pos'].reindex(X.index).astype(float).values if 'zone_pos' in feat.columns else np.zeros_like(zl)
            zvp_min = np.clip(np.maximum(0.0, zmin_vs_prev.astype(float).values), 0.0, 1.0)
            zvp_max = np.clip(np.maximum(0.0, zmax_vs_prev.astype(float).values), 0.0, 1.0)
            try:
                alpha_buy = float(os.getenv('TW_ALPHA_BUY', '0.5'))
            except Exception:
                alpha_buy = 0.5
            try:
                alpha_sell = float(os.getenv('TW_ALPHA_SELL', '0.5'))
            except Exception:
                alpha_sell = 0.5
            ctx = np.ones_like(w, dtype=float)
            # SELL: farther zones (zl high) + positioned to the right (zp high) + stronger ORANGE max (zvp_max high)
            ctx = np.where(y==-1, ctx * (1.0 + alpha_sell * (zvp_max * zl * (0.5 + 0.5*zp))), ctx)
            # BUY: closer zones (zl low) + positioned to the left (zp low) + stronger BLUE min (zvp_min high)
            ctx = np.where(y== 1, ctx * (1.0 + alpha_buy  * (zvp_min * (1.0 - zl) * (1.0 - 0.5*zp))), ctx)
            w = w * ctx
        except Exception:
            pass

        # Hyperparameter search with time-series CV (weighted)
        from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
        from sklearn.model_selection import TimeSeriesSplit
        from sklearn.metrics import accuracy_score, f1_score, classification_report, confusion_matrix
        Xv = X.values
        tscv = TimeSeriesSplit(n_splits=3)
        grid = [
            {'n_estimators': 100, 'learning_rate': 0.05, 'max_depth': 2},
            {'n_estimators': 200, 'learning_rate': 0.05, 'max_depth': 2},
            {'n_estimators': 150, 'learning_rate': 0.10, 'max_depth': 3},
        ]
        best_params = None
        best_score = -1e9
        best_pnl = -1e18
        # prices aligned to feature index
        prices = feat['close'].loc[X.index] if hasattr(X, 'index') else feat['close']
        for params in grid:
            accs=[]; f1s=[]; cms=None; pnl_sum=0.0
            for tr_idx, va_idx in tscv.split(Xv):
                cls = GradientBoostingClassifier(random_state=42, **params)
                cls.fit(Xv[tr_idx], y[tr_idx], sample_weight=w[tr_idx])
                yp = cls.predict(Xv[va_idx])
                accs.append(accuracy_score(y[va_idx], yp))
                f1s.append(f1_score(y[va_idx], yp, average='macro', zero_division=0))
                cm = confusion_matrix(y[va_idx], yp, labels=[-1,0,1])
                cms = (cm if cms is None else (cms + cm))
                # pnl on validation slice
                try:
                    prices_va = prices.iloc[va_idx]
                    st = _simulate_pnl_from_preds(prices_va, yp)
                    pnl_sum += st['pnl']
                except Exception:
                    pass
            avg_f1 = float(np.mean(f1s)) if f1s else 0.0
            score = avg_f1
            if (score > best_score + 1e-9) or (abs(score - best_score) <= 1e-9 and pnl_sum > best_pnl):
                best_score = score
                best_params = params
                best_pnl = pnl_sum
        # Fit best model on all data with weights
        base = GradientBoostingClassifier(random_state=42, **(best_params or {}))
        base.fit(Xv, y, sample_weight=w)
        _ensure_models_dir()
        # compute reports
        yhat_in = base.predict(Xv)
        report_in = classification_report(y, yhat_in, output_dict=True, zero_division=0)
        cm_in = confusion_matrix(y, yhat_in, labels=[-1,0,1]).tolist()
        # summarize CV again for metrics payload
        metrics = {
            'in_sample': { 'report': report_in, 'confusion': cm_in },
            'cv': { 'f1_macro': float(best_score), 'pnl_sum': float(best_pnl) },
            'params': best_params,
        }
        # persist the exact feature order used for training
        try:
            feature_names = list(X.columns)
        except Exception:
            feature_names = use_cols
        pack = { 'model': base, 'window': window, 'ema_fast': ema_fast, 'ema_slow': ema_slow, 'horizon': horizon, 'tau': tau, 'interval': interval, 'metrics': metrics, 'trained_at': int(time.time()*1000), 'feature_names': feature_names, 'label_mode': label_mode }
        
        # Optional slope regressor: predict steepness over horizon (per-bar pct return)
        try:
            closes = feat['close'].astype(float).reindex(X.index)
            fwd_close = closes.shift(-horizon)
            slope_y = ((fwd_close - closes) / (closes.replace(0, np.nan) * max(1, horizon))).fillna(0.0).values
            reg = GradientBoostingRegressor(random_state=42, n_estimators=200, learning_rate=0.05, max_depth=2)
            reg.fit(X.values, slope_y)
            pack['slope_model'] = reg
        except Exception:
            pass
        # save model per-interval
        try:
            joblib.dump(pack, _model_path_for(interval))
        except Exception:
            joblib.dump(pack, ML_MODEL_PATH)
        ml_state['train_count'] = int(ml_state.get('train_count', 0)) + 1
        classes = { '-1': int((y==-1).sum()), '0': int((y==0).sum()), '1': int((y==1).sum()) }
        return jsonify({'ok': True, 'classes': classes, 'report': report_in, 'cv': metrics['cv'], 'params': best_params, 'train_count': ml_state['train_count']})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

ML_PREDICT_CACHE_TTL = 60
_ml_predict_cache = {}

def _ml_predict_core(cur_interval: str):
    """Return (payload, status_code) for ML prediction (cachable)."""
    try:
        pack = _load_ml(cur_interval)
        if not pack:
            # Graceful fallback: return lightweight insight so UI narrative can render
            cfg = load_config()
            try:
                window = int(load_nb_params().get('window', 50))
            except Exception:
                window = 50
            try:
                df = get_candles(cfg.market, cur_interval, count=max(400, window*3))
            except Exception as candle_err:
                logger.error(f"Failed to fetch candles in ml/predict: {candle_err}")
                df = pd.DataFrame()
            try:
                HIGH = float(os.getenv('NB_HIGH', '0.55'))
                LOW = float(os.getenv('NB_LOW', '0.45'))
            except Exception:
                HIGH, LOW = 0.55, 0.45
            rng = max(1e-9, HIGH - LOW)
            rv = 0.5
            p_blue = 0.5
            p_orange = 0.5
            try:
                if len(df) > 0:
                    r_series = _compute_r_from_ohlcv(df, window)
                    if isinstance(r_series, pd.Series) and len(r_series) > 0:
                        rv = float(r_series.iloc[-1])
                    else:
                        rv = 0.5
                    p_blue = max(0.0, min(1.0, (HIGH - rv) / rng))
                    p_orange = max(0.0, min(1.0, (rv - LOW) / rng))
                    s = p_blue + p_orange
                    if s > 0:
                        p_blue, p_orange = p_blue/s, p_orange/s
            except Exception as e:
                logger.warning(f"Fallback r calculation failed: {e}")
                rv = 0.5
                p_blue = 0.5
                p_orange = 0.5
            zone = 'ORANGE' if rv >= 0.5 else 'BLUE'
            ins = {
                'r': rv,
                'zone_flag': (-1 if zone=='ORANGE' else 1),
                'zone': zone,
                'zone_conf': float(max(0.0, (rv-LOW)/rng) if zone=='ORANGE' else max(0.0, (HIGH-rv)/rng)),
                'dist_high': float(max(0.0, rv - HIGH)),
                'dist_low': float(max(0.0, LOW - rv)),
                'extreme_gap': 0.0,
                'w': 0.0,
                'ema_diff': 0.0,
                'pct_blue': float(p_blue*100.0),
                'pct_orange': float(p_orange*100.0),
            }
            try:
                _record_group_observation(cur_interval, window, rv, ins['pct_blue'], ins['pct_orange'], int(time.time()*1000))
            except Exception:
                pass
            label_mode = 'zone'
            action = ('BLUE' if zone=='BLUE' else 'ORANGE')
            return {
                'ok': True,
                'action': action,
                'pred': 0,
                'probs': [],
                'train_count': int(ml_state.get('train_count', 0)),
                'insight': ins,
                'zone_actions': {'sell_in_orange': False, 'buy_in_blue': False},
                'label_mode': label_mode,
                'steep': None,
                'pred_nb': None,
                'horizon': 5,
                'interval': cur_interval,
            }, 200
        model = pack['model']
        window = int(pack.get('window', 50))
        ema_fast = int(pack.get('ema_fast', 10))
        ema_slow = int(pack.get('ema_slow', 30))
        horizon = int(pack.get('horizon', 5))
        cfg = load_config()
        df = get_candles(cfg.market, cur_interval, count=max(400, window*3))
        
        # 최적화: dropna() 대신 필요한 행만 사용
        try:
            feat = _build_features(df, window, ema_fast, ema_slow, horizon)
            feat = feat.iloc[window:]  # 초기 NaN 행 제거
        except Exception:
            feat = pd.DataFrame()
        
        base_cols = ['r','w','ema_f','ema_s','ema_diff','r_ema3','r_ema5','dr','ret1','ret3','ret5']
        ext_cols = ['zone_flag','dist_high','dist_low','zone_conf','zone_min_r','zone_max_r','zone_extreme_r','zone_extreme_age']
        trained_cols = list(pack.get('feature_names') or [])
        
        if not trained_cols:
            cand = base_cols + [c for c in ext_cols if c in feat.columns]
            try:
                need = int(getattr(model, 'n_features_in_', len(cand)))
            except Exception:
                need = len(cand)
            trained_cols = cand[:need]
        
        # 최적화: 필요한 열만 선택
        available_cols = [c for c in trained_cols if c in feat.columns]
        missing_cols = [c for c in trained_cols if c not in feat.columns]
        
        if missing_cols:
            logger.warning(f"Missing features for prediction: {missing_cols}, using available: {available_cols}")
        
        if not available_cols:
            raise ValueError(f"No valid features available. Trained: {trained_cols}, Available: {list(feat.columns)}")
        
        X = feat[available_cols]
        
        # NaN 체크 및 제거
        if X.isna().any().any():
            logger.warning(f"NaN detected in features, filling with median")
            X = X.fillna(X.median())
        
        # 빠른 데이터 검증
        if X.empty or len(X) == 0:
            raise ValueError(f"Feature matrix X is empty: {len(X)} rows, columns: {list(X.columns)}")
        
        # 최적화: 마지막 행만 예측 (최신 데이터) - 2D 보장 및 안전화
        try:
            # 안전한 numpy 변환
            if isinstance(X, pd.DataFrame):
                X_values = X.values
            else:
                X_values = np.asarray(X)
            
            if X_values.size == 0 or len(X_values) == 0:
                raise ValueError("X_values array is empty")
            
            # 2D 보장 (마지막 행만)
            if X_values.ndim == 1:
                X_last = X_values.reshape(1, -1)
            else:
                X_last = X_values[-1:, :]
            
            # predict_proba 수행
            if hasattr(model, 'predict_proba'):
                proba_result = model.predict_proba(X_last)
                if isinstance(proba_result, np.ndarray) and proba_result.size > 0:
                    probs = proba_result[0].tolist() if proba_result.ndim > 1 else proba_result.tolist()
                elif isinstance(proba_result, (list, tuple)) and len(proba_result) > 0:
                    probs = list(proba_result[0]) if hasattr(proba_result[0], '__iter__') else [float(proba_result[0])]
                else:
                    probs = []
            else:
                probs = []
        except Exception as e:
            logger.warning(f"predict_proba failed: {e}, X shape: {X.shape if hasattr(X, 'shape') else 'unknown'}")
            probs = []
        
        try:
            # 안전한 numpy 변환
            if isinstance(X, pd.DataFrame):
                X_values = X.values  # DataFrame.values 사용
            else:
                X_values = np.asarray(X)
            
            # 빈 배열 검증
            if X_values.size == 0 or len(X_values) == 0:
                raise ValueError("X_values array is empty for predict")
            
            # NaN 검증
            if np.isnan(X_values).any():
                logger.warning(f"NaN detected in X_values, shape={X_values.shape}")
                # NaN을 중앙값으로 대체
                col_medians = np.nanmedian(X_values, axis=0)
                inds = np.where(np.isnan(X_values))
                X_values[inds] = np.take(col_medians, inds[1])
            
            # 2D 배열로 변환 (마지막 행만)
            if X_values.ndim == 1:
                X_last = X_values.reshape(1, -1)
            else:
                X_last = X_values[-1:, :]  # 마지막 행 (2D 유지)
            
            # 예측 수행
            pred_result = model.predict(X_last)
            
            # 안전한 결과 추출
            if isinstance(pred_result, (list, tuple)) and len(pred_result) > 0:
                pred = int(pred_result[0])
            elif isinstance(pred_result, np.ndarray):
                if pred_result.size > 0:
                    pred = int(pred_result.flat[0])  # flat 사용으로 안전하게 추출
                else:
                    pred = 0
            elif hasattr(pred_result, 'item'):
                pred = int(pred_result.item())
            else:
                pred = int(pred_result)
        except Exception as e:
            logger.error(f"ML predict error (fallback mode): {e}")
            logger.error(f"X shape: {X.shape if hasattr(X, 'shape') else 'unknown'}, X_values shape: {X_values.shape if 'X_values' in locals() else 'unknown'}")
            import traceback
            logger.debug(traceback.format_exc())
            pred = 0
        
        slope_hat = None
        try:
            reg = pack.get('slope_model')
            if reg is not None:
                # 안전한 numpy 변환
                if isinstance(X, pd.DataFrame):
                    X_values = X.values
                else:
                    X_values = np.asarray(X)
                
                if X_values.ndim == 1:
                    X_last = X_values.reshape(1, -1)
                else:
                    X_last = X_values[-1:, :]
                
                slope_pred = reg.predict(X_last)
                
                # 안전하게 값 추출
                if isinstance(slope_pred, np.ndarray) and slope_pred.size > 0:
                    slope_hat = float(slope_pred.flat[0])
                elif hasattr(slope_pred, '__len__') and len(slope_pred) > 0:
                    slope_hat = float(slope_pred[0])
                else:
                    slope_hat = float(slope_pred)
        except Exception as e:
            logger.debug(f"Slope prediction failed: {e}")
            slope_hat = None
        if slope_hat is None:
            try:
                n_tail = max(20, min(120, window))
                closes_tail = df['close'].astype(float).tail(n_tail)
                if len(closes_tail) >= 5:
                    import numpy as _np
                    y = _np.log(closes_tail.replace(0, _np.nan)).bfill().ffill().values
                    x = _np.arange(len(y), dtype=float)
                    b1 = _np.polyfit(x, y, 1)[0]
                    slope_hat = float(b1)
            except Exception:
                slope_hat = None
        predicted_price = None
        # 현재가 안전 접근
        try:
            current_price = float(df['close'].iloc[-1]) if len(df) > 0 else None
        except Exception:
            current_price = None
        if current_price and slope_hat is not None:
            try:
                predicted_price = float(current_price * np.exp(slope_hat * horizon))
            except Exception:
                predicted_price = None
        predicted_time = None
        predicted_timestamp = None
        try:
            from datetime import datetime, timedelta
            interval_sec = _interval_to_sec(cur_interval)
            current_time = datetime.now()
            future_seconds = interval_sec * horizon
            predicted_time_obj = current_time + timedelta(seconds=future_seconds)
            predicted_time = predicted_time_obj.strftime('%Y-%m-%d %H:%M:%S')
            predicted_timestamp = int(predicted_time_obj.timestamp())
        except Exception:
            predicted_time = None
            predicted_timestamp = None
        ins = {}
        try:
            last = feat.iloc[-1]
            zone_flag = int(round(float(last.get('zone_flag', 0))))
            zone = 'BLUE' if zone_flag == 1 else ('ORANGE' if zone_flag == -1 else 'UNKNOWN')
            try:
                HIGH = float(os.getenv('NB_HIGH', '0.55'))
                LOW = float(os.getenv('NB_LOW', '0.45'))
            except Exception:
                HIGH, LOW = 0.55, 0.45
            rng = max(1e-9, HIGH - LOW)
            rv = float(last.get('r', 0.5))
            p_blue_raw = max(0.0, min(1.0, (HIGH - rv) / rng))
            p_orange_raw = max(0.0, min(1.0, (rv - LOW) / rng))
            s0 = p_blue_raw + p_orange_raw
            if s0 > 0:
                p_blue_raw, p_orange_raw = p_blue_raw/s0, p_orange_raw/s0
            try:
                trend_k = int(os.getenv('NB_TREND_K', '30'))
                trend_alpha = float(os.getenv('NB_TREND_ALPHA', '0.5'))
            except Exception:
                trend_k, trend_alpha = 30, 0.5
            try:
                r_series = _compute_r_from_ohlcv(df, window).astype(float)
                if len(r_series) >= trend_k*2:
                    tail_now = r_series.iloc[-trend_k:]
                    tail_prev = r_series.iloc[-trend_k*2:-trend_k]
                    zmax_now, zmax_prev = float(tail_now.max()), float(tail_prev.max())
                    zmin_now, zmin_prev = float(tail_now.min()), float(tail_prev.min())
                    trend_orange = max(0.0, (zmax_prev - zmax_now) / rng)
                    trend_blue = max(0.0, (zmin_now - zmin_prev) / rng)
                    p_orange = max(0.0, min(1.0, p_orange_raw * (1.0 - trend_alpha * trend_orange)))
                    p_blue = max(0.0, min(1.0, p_blue_raw * (1.0 - trend_alpha * trend_blue)))
                    s = p_blue + p_orange
                    if s <= 1e-9:
                        p_blue, p_orange = p_blue_raw, p_orange_raw
                        s = p_blue + p_orange
                    if s > 0:
                        p_blue, p_orange = p_blue/s, p_orange/s
                else:
                    p_blue, p_orange = p_blue_raw, p_orange_raw
            except Exception:
                p_blue, p_orange = p_blue_raw, p_orange_raw
            ins = {
                'r': rv,
                'zone_flag': zone_flag,
                'zone': zone,
                'zone_conf': float(last.get('zone_conf', 0.0)),
                'dist_high': float(last.get('dist_high', 0.0)),
                'dist_low': float(last.get('dist_low', 0.0)),
                'extreme_gap': float(last.get('extreme_gap', 0.0)),
                'zone_min_r': float(last.get('zone_min_r', rv)),
                'zone_max_r': float(last.get('zone_max_r', rv)),
                'zone_extreme_r': float(last.get('zone_extreme_r', rv)),
                'zone_extreme_age': int(last.get('zone_extreme_age', 0)),
                'zone_min_price': float(last.get('zone_min_price', last.get('close', 0.0))),
                'zone_max_price': float(last.get('zone_max_price', last.get('close', 0.0))),
                'zone_extreme_price': float(last.get('zone_extreme_price', last.get('close', 0.0))),
                'blue_min_last': float(last.get('blue_min_last', rv)),
                'orange_max_last': float(last.get('orange_max_last', rv)),
                'blue_min_cur': float(last.get('blue_min_cur', rv)),
                'orange_max_cur': float(last.get('orange_max_cur', rv)),
                'w': float(last.get('w', 0.0)),
                'ema_diff': float(last.get('ema_diff', 0.0)),
                'pct_blue_raw': float(p_blue_raw*100.0),
                'pct_orange_raw': float(p_orange_raw*100.0),
                'pct_blue': float(p_blue*100.0),
                'pct_orange': float(p_orange*100.0),
            }
            try:
                _record_group_observation(cur_interval, window, rv, ins['pct_blue'], ins['pct_orange'], int(time.time()*1000))
            except Exception:
                pass
        except Exception:
            ins = {}
        if not ins:
            try:
                HIGH = float(os.getenv('NB_HIGH', '0.55'))
                LOW = float(os.getenv('NB_LOW', '0.45'))
            except Exception:
                HIGH, LOW = 0.55, 0.45
        
            rng = max(1e-9, HIGH - LOW)
            r_series = _compute_r_from_ohlcv(df, window)
            rv = float(r_series.iloc[-1]) if len(r_series) else 0.5
            p_blue = max(0.0, min(1.0, (HIGH - rv) / rng))
            p_orange = max(0.0, min(1.0, (rv - LOW) / rng))
            s = p_blue + p_orange
            if s > 0:
                p_blue, p_orange = p_blue/s, p_orange/s
            zone = 'ORANGE' if rv >= 0.5 else 'BLUE'
            ins = {
                'r': rv,
                'zone_flag': (-1 if zone=='ORANGE' else 1),
                'zone': zone,
                'zone_conf': float(max(0.0, (rv-LOW)/rng) if zone=='ORANGE' else max(0.0, (HIGH-rv)/rng)),
                'dist_high': float(max(0.0, rv - HIGH)),
                'dist_low': float(max(0.0, LOW - rv)),
                'extreme_gap': 0.0,
                'w': float(((df['high'].rolling(window).max() - df['low'].rolling(window).min()) / ((df['high'] + df['low'])/2).replace(0, np.nan)).iloc[-1]) if len(df) else 0.0,
                'ema_diff': float((df['close'].ewm(span=ema_fast, adjust=False).mean().iloc[-1] - df['close'].ewm(span=ema_slow, adjust=False).mean().iloc[-1])) if len(df) else 0.0,
                'pct_blue': float(p_blue*100.0),
                'pct_orange': float(p_orange*100.0),
            }
            try:
                _record_group_observation(cur_interval, window, rv, ins['pct_blue'], ins['pct_orange'], int(time.time()*1000))
            except Exception:
                pass
        label_mode = str(pack.get('label_mode') or 'zone')
        action = 'HOLD'
        if label_mode in ('zone','zone_flag'):
            action = ('BLUE' if pred>0 else 'ORANGE')
        elif label_mode == 'mayor_guidance':
            if pred > 0:
                action = 'BUY'
            elif pred < 0:
                action = 'SELL'
            else:
                action = 'HOLD'
        elif pred > 0:
            action = 'BUY'
        elif pred < 0:
            action = 'SELL'
        try:
            z_now = str(ins.get('zone') or '').upper()
        except Exception:
            z_now = 'UNKNOWN'
        zone_actions = {
            'sell_in_orange': bool(z_now == 'ORANGE' and pred < 0),
            'buy_in_blue': bool(z_now == 'BLUE' and pred > 0),
        }
        try:
            steep = None
            if slope_hat is not None:
                if str(ins.get('zone') or '').upper() == 'BLUE':
                    steep = {'blue_up_slope': slope_hat, 'orange_down_slope': None}
                elif str(ins.get('zone') or '').upper() == 'ORANGE':
                    steep = {'blue_up_slope': None, 'orange_down_slope': slope_hat}
            pred_nb = None
            try:
                HIGH = float(os.getenv('NB_HIGH', '0.55'))
                LOW = float(os.getenv('NB_LOW', '0.45'))
                rv = float(ins.get('r', 0.5))
                z = str(ins.get('zone') or '').upper()
                def sec_from_iv(iv:str)->int:
                    if iv.startswith('minute'):
                        m=int(iv.replace('minute','') or '1'); return m*60
                    if iv=='day': return 86400
                    return 60
                bar_sec = sec_from_iv(cur_interval)
                k_env = float(os.getenv('NB_R_STEP_K','0.2'))
                min_step = float(os.getenv('NB_R_STEP_MIN','0.003'))
                r_step = max(min_step, min(0.2, abs(float(slope_hat or 0.0)) * k_env)) if slope_hat is not None else 0.0
                try:
                    idx_last = df.index[-1] if len(df) else None
                    if hasattr(idx_last, 'timestamp'):
                        last_ts_ms = int(idx_last.timestamp()*1000)
                    else:
                        last_ts_ms = int(time.time()*1000)
                except Exception:
                    last_ts_ms = int(time.time()*1000)
                if z=='BLUE':
                    dist = max(0.0, HIGH - rv)
                    if (slope_hat or 0.0) > 0 and r_step>0:
                        bars = int(math.ceil(dist / r_step))
                        if bars>0 and bars <= max(1, horizon*2):
                            pred_nb = {'side':'SELL','bars':bars,'ts': last_ts_ms + bars*bar_sec*1000}
                elif z=='ORANGE':
                    dist = max(0.0, rv - LOW)
                    if (slope_hat or 0.0) < 0 and r_step>0:
                        bars = int(math.ceil(dist / r_step))
                        if bars>0 and bars <= max(1, horizon*2):
                            pred_nb = {'side':'BUY','bars':bars,'ts': last_ts_ms + bars*bar_sec*1000}
            except Exception:
                pred_nb = None
            try:
                pct_major = max(float(ins.get('pct_blue') or ins.get('pct_blue_raw') or 0.0), float(ins.get('pct_orange') or ins.get('pct_orange_raw') or 0.0))
            except Exception:
                pct_major = 0.0
            score0 = float(max(0.0, min(1.0, pct_major/100.0)))
            return {
                'ok': True,
                'action': action,
                'pred': pred,
                'probs': probs,
                'train_count': ml_state.get('train_count', 0),
                'insight': ins,
                'zone_actions': zone_actions,
                'label_mode': label_mode,
                'steep': steep,
                'pred_nb': pred_nb,
                'horizon': horizon,
                'interval': cur_interval,
                'score0': score0,
                'predicted_price': predicted_price,
                'current_price': current_price,
                'predicted_time': predicted_time,
                'predicted_timestamp': predicted_timestamp
            }, 200
        except Exception:
            return {
                'ok': True,
                'action': action,
                'pred': pred,
                'probs': probs,
                'train_count': ml_state.get('train_count', 0),
                'insight': ins,
                'zone_actions': zone_actions,
                'label_mode': label_mode,
                'pred_nb': None,
                'horizon': horizon,
                'interval': cur_interval,
                'score0': 0.0,
                'predicted_price': predicted_price,
                'current_price': current_price,
                'predicted_time': predicted_time,
                'predicted_timestamp': predicted_timestamp
            }, 200
    except Exception as e:
        try:
            logger.error(f"ML predict error (fallback mode): {e}")
            cur_interval = state.get('candle') or load_config().candle
            cfg = load_config()
            window = int(load_nb_params().get('window', 50))
            df = get_candles(cfg.market, cur_interval, count=max(200, window*2))
            try:
                HIGH = float(os.getenv('NB_HIGH', '0.55'))
                LOW = float(os.getenv('NB_LOW', '0.45'))
            except Exception:
                HIGH, LOW = 0.55, 0.45
            rng = max(1e-9, HIGH - LOW)
            try:
                r_series = _compute_r_from_ohlcv(df, window)
                if r_series is None or len(r_series) == 0:
                    rv = 0.5
                else:
                    rv = float(r_series.iloc[-1]) if len(r_series) > 0 else 0.5
            except Exception as e2:
                logger.warning(f"_compute_r_from_ohlcv failed in fallback: {e2}")
                rv = 0.5
                rv = 0.5
            p_blue = max(0.0, min(1.0, (HIGH - rv) / rng))
            p_orange = max(0.0, min(1.0, (rv - LOW) / rng))
            s = p_blue + p_orange
            if s > 0:
                p_blue, p_orange = p_blue/s, p_orange/s
            zone = 'ORANGE' if rv >= 0.5 else 'BLUE'
            ins = {'r': rv, 'zone_flag': (-1 if zone=='ORANGE' else 1), 'zone': zone, 'pct_blue': float(p_blue*100.0), 'pct_orange': float(p_orange*100.0)}
            return {
                'ok': True,
                'action': zone,
                'pred': 0,
                'probs': [],
                'train_count': int(ml_state.get('train_count', 0)),
                'insight': ins,
                'zone_actions': {'sell_in_orange': False, 'buy_in_blue': False},
                'label_mode': 'zone',
                'steep': None,
                'pred_nb': None,
                'horizon': 5,
                'interval': cur_interval,
                'score0': float(max(p_blue, p_orange))
            }, 200
        except Exception as e2:
            return {'ok': False, 'error': f'predict_fallback_failed: {e2}'}, 500

# ===== 카드 등급 ML 엔드포인트 =====
@app.route('/api/ml/rating/info', methods=['GET'])
def api_ml_rating_info():
    try:
        ml = get_rating_ml()
        return jsonify(ml.info())
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/ml/rating/train', methods=['POST'])
def api_ml_rating_train():
    try:
        payload = request.get_json(force=True) if request.is_json else {}
    except Exception:
        payload = {}
    try:
        training_data = payload.get('training_data') if isinstance(payload, dict) else None
        if not training_data:
            training_data = _collect_ml_training_samples()
        ml = get_rating_ml()
        result = ml.train(training_data)
        # Always return 200 to avoid frontend error floods; include ok flag in body
        status = 200
        return jsonify(result), status
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/ml/rating/predict', methods=['POST'])
def api_ml_rating_predict():
    try:
        if not request.is_json:
            return jsonify({'ok': False, 'error': 'JSON required'}), 400
        payload = request.get_json(force=True)
        card = payload.get('card') if isinstance(payload, dict) else None
        if not card:
            return jsonify({'ok': False, 'error': 'card is required'}), 400
        ml = get_rating_ml()
        result = ml.predict(card)
        return jsonify(result)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/ml/rating/auto-train', methods=['POST'])
def api_ml_rating_auto_train():
    """
    자동 온라인 학습 엔드포인트
    1. nbverse에서 가장 최근 카드를 찾아 가격 비교로 실제 수익률 계산
    2. 이전 카드를 trainer_storage에 추가 (훈련 데이터)
    3. 5개 이상 축적되면 전체 재훈련
    4. 현재 카드 AI 예측 반환
    """
    try:
        if not request.is_json:
            return jsonify({'ok': False, 'error': 'JSON required'}), 400
        
        payload = request.get_json(force=True)
        card = payload.get('card')
        current_price = payload.get('current_price')
        interval = payload.get('interval')
        
        if not card or current_price is None:
            return jsonify({'ok': False, 'error': 'card and current_price required'}), 400
        
        result = {'ok': True}
        ml = get_rating_ml()
        
        try:
            current_price = float(current_price)
        except (ValueError, TypeError):
            current_price = None
        
        # Step 1: nbverse에서 가장 최근 저장된 카드 찾기
        prev_card = None
        prev_price = None
        actual_profit_rate = None
        
        if interval:
            try:
                nbverse_base = os.path.join(model_dir, '..', 'data', 'nbverse')
                
                latest_card = None
                latest_mtime = 0
                
                for type_dir in ['max', 'min']:
                    type_path = os.path.join(nbverse_base, type_dir)
                    if os.path.isdir(type_path):
                        for root, dirs, files in os.walk(type_path):
                            for f in files:
                                if f == 'this_pocket_card.json':
                                    fpath = os.path.join(root, f)
                                    try:
                                        mtime = os.path.getmtime(fpath)
                                        if mtime > latest_mtime:
                                            with open(fpath, 'r', encoding='utf-8') as jf:
                                                card_data = json.load(jf)
                                                latest_mtime = mtime
                                                latest_card = card_data
                                    except:
                                        pass
                
                if latest_card:
                    prev_card = latest_card.get('card')
                    prev_price = latest_card.get('current_price')
                    
            except Exception as e:
                logger.debug(f"[auto-train] Failed to load prev card: {e}")
        
        # Step 2: 이전 카드가 있으면 수익률 계산 및 trainer_storage에 저장
        if prev_card and prev_price is not None and current_price is not None:
            try:
                prev_p = float(prev_price)
                if prev_p > 0:
                    actual_profit_rate = (current_price - prev_p) / prev_p
                    
                    # 노이즈 제거
                    if abs(actual_profit_rate) > 0.5:
                        actual_profit_rate = 0.5 if actual_profit_rate > 0 else -0.5
                    
                    # trainer_storage에 이전 카드 추가
                    try:
                        trainer_data = load_trainer_storage()
                        if not isinstance(trainer_data, list):
                            trainer_data = []
                        
                        training_sample = {
                            'card': prev_card,
                            'profit_rate': float(actual_profit_rate),
                            'timestamp': datetime.now().isoformat()
                        }
                        trainer_data.append(training_sample)
                        save_trainer_storage(trainer_data)
                        
                        result['prev_card_added'] = True
                        result['actual_profit_rate'] = float(actual_profit_rate)
                        logger.debug(f"[auto-train] Prev card added to trainer_storage: profit_rate={actual_profit_rate:.4f}")
                    except Exception as e:
                        logger.debug(f"[auto-train] Failed to save to trainer_storage: {e}")
                    
            except Exception as e:
                logger.debug(f"[auto-train] Failed to calculate profit_rate: {e}")
        
        # Step 3: 5개 이상 샘플 축적되면 전체 재훈련
        try:
            trainer_data = load_trainer_storage()
            if isinstance(trainer_data, list) and len(trainer_data) >= 5:
                # nbverse도 포함
                all_samples = _merge_training_samples()
                if len(all_samples) >= 5:
                    train_result = ml.train(all_samples)
                    if train_result.get('ok'):
                        result['full_retrain'] = {
                            'train_count': train_result.get('train_count'),
                            'mae': float(train_result.get('mae', 0))
                        }
                        logger.info(f"[auto-train] Full retrain: {train_result.get('train_count')} samples, MAE={train_result.get('mae'):.2f}")
        except Exception as e:
            logger.debug(f"[auto-train] Retrain check failed: {e}")
        
        # Step 4: 현재 카드로 AI 예측
        try:
            ai_prediction = ml.predict(card)
            if ai_prediction.get('ok'):
                result['current_prediction'] = {
                    'enhancement': ai_prediction.get('enhancement'),
                    'grade': ai_prediction.get('grade'),
                    'method': ai_prediction.get('method')
                }
        except Exception as e:
            logger.debug(f"[auto-train] Predict failed: {e}")
        
        return jsonify(result)
    
    except Exception as e:
        logger.error(f"[api_ml_rating_auto_train] Error: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/ml/predict', methods=['GET'])
def api_ml_predict():
    """ML 모델 예측 API - 캐시(10초) 적용"""
    try:
        try:
            req_iv = request.args.get('interval') if request.args else None
        except Exception as arg_err:
            logger.warning(f"Failed to get interval argument: {arg_err}")
            req_iv = None
        cur_interval = str(req_iv or (state.get('candle') or load_config().candle))
        now = time.time()
        entry = _ml_predict_cache.get(cur_interval)
        if entry and (now - entry['ts'] < ML_PREDICT_CACHE_TTL):
            return jsonify(entry['payload']), entry['status']
        logger.info(f"API /api/ml/predict called with interval: {cur_interval}")
        payload, status = _ml_predict_core(cur_interval)
        # 410 같은 상태는 UI를 깨지 않도록 200으로 내림
        if status == 410:
            payload = {'ok': False, 'error': 'ml predict unavailable (soft fallback)', 'interval': cur_interval}
            status = 200
        if status < 500:
            _ml_predict_cache[cur_interval] = {'ts': now, 'payload': payload, 'status': status}
        return jsonify(payload), status
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/ml/metrics', methods=['GET'])
def api_ml_metrics():
    try:
        try:
            req_iv = request.args.get('interval') if request.args else None
        except Exception:
            req_iv = None
        cur_interval = str(req_iv or (state.get('candle') or load_config().candle))
        pack = _load_ml(cur_interval)
        if not pack:
            # Return default metrics instead of error for untrained intervals
            default_metrics = {
                'in_sample': {
                    'report': {
                        'macro avg': {'precision': 0.0, 'recall': 0.0, 'f1-score': 0.0},
                        'weighted avg': {'precision': 0.0, 'recall': 0.0, 'f1-score': 0.0}
                    },
                    'confusion': [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
                },
                'cv': {'f1_macro': 0.0, 'pnl_sum': 0.0},
                'params': None
            }
            return jsonify({
                'ok': True, 
                'interval': cur_interval, 
                'metrics': default_metrics, 
                'params': None, 
                'trained_at': None, 
                'train_count': 0,
                'note': 'model_not_trained_using_defaults'
            })
        metrics = pack.get('metrics', {}) or {}
        # If metrics missing (old model), recompute lightweight metrics on recent data
        if not metrics or not metrics.get('in_sample'):
            try:
                model = pack['model']
                window = int(pack.get('window', 50))
                ema_fast = int(pack.get('ema_fast', 10))
                ema_slow = int(pack.get('ema_slow', 30))
                horizon = int(pack.get('horizon', 5))
                cfg = load_config()
                df = get_candles(cfg.market, cur_interval, count=max(800, window*3))
                feat = _build_features(df, window, ema_fast, ema_slow, horizon).dropna().copy()
                X = feat[['r','w','ema_f','ema_s','ema_diff','r_ema3','r_ema5','dr','ret1','ret3','ret5']]
                # default NB zone labels for comparison
                r = _compute_r_from_ohlcv(df, window)
                HIGH = float(os.getenv('NB_HIGH', '0.55'))
                LOW = float(os.getenv('NB_LOW', '0.45'))
                labels = np.zeros(len(df), dtype=int)
                zone = None
                r_vals = r.values.tolist()
                for i in range(len(df)):
                    rv = r_vals[i] if i < len(r_vals) else 0.5
                    if zone not in ('BLUE','ORANGE'):
                        zone = 'ORANGE' if rv >= 0.5 else 'BLUE'
                    sig = 0
                    if zone == 'BLUE' and rv >= HIGH:
                        zone = 'ORANGE'; sig = -1
                    elif zone == 'ORANGE' and rv <= LOW:
                        zone = 'BLUE'; sig = 1
                    labels[i] = sig
                idx_map = { ts: i for i, ts in enumerate(df.index) }
                y = np.array([ labels[idx_map.get(ts, 0)] for ts in feat.index ], dtype=int)
                from sklearn.metrics import classification_report, confusion_matrix, f1_score
                from sklearn.model_selection import TimeSeriesSplit
                yhat = model.predict(X.values)
                rep = classification_report(y, yhat, output_dict=True, zero_division=0)
                cm = confusion_matrix(y, yhat, labels=[-1,0,1]).tolist()
                # quick CV
                tscv = TimeSeriesSplit(n_splits=3)
                f1s=[]; pnl_sum=0.0
                for tr_idx, va_idx in tscv.split(X.values):
                    yp = model.predict(X.values[va_idx])
                    f1s.append(f1_score(y[va_idx], yp, average='macro', zero_division=0))
                    try:
                        prices_va = feat['close'].iloc[va_idx]
                        st = _simulate_pnl_from_preds(prices_va, yp)
                        pnl_sum += st['pnl']
                    except Exception:
                        pass
                metrics = {
                    'in_sample': { 'report': rep, 'confusion': cm },
                    'cv': { 'f1_macro': float(np.mean(f1s)) if f1s else 0.0, 'pnl_sum': float(pnl_sum) },
                    'params': None,
                }
                # persist back for faster future reads
                try:
                    pack['metrics'] = metrics
                    joblib.dump(pack, _model_path_for(cur_interval))
                except Exception:
                    pass
            except Exception:
                metrics = {}
        return jsonify({'ok': True, 'interval': pack.get('interval', cur_interval), 'metrics': metrics, 'params': metrics.get('params'), 'trained_at': pack.get('trained_at'), 'train_count': ml_state.get('train_count', 0)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# ===== Auto-Buy (placeholder, in-memory only) =====
# Auto-Buy routes are defined in trade_routes.py


def updater():
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


def _resolve_config():
    base = load_config()
    ov = bot_ctrl['cfg_override']
    # merge overrides if present (기본값을 실제 거래로 설정)
    base.paper = base.paper if ov['paper'] is None else bool(ov['paper'])
    # 기본값을 실제 거래로 강제 설정
    if ov['paper'] is None:
        base.paper = False
    base.order_krw = base.order_krw if ov['order_krw'] is None else int(ov['order_krw'])
    # attach pnl_ratio dynamically to base for Trader
    try:
        base.pnl_ratio = float(ov['pnl_ratio']) if ov['pnl_ratio'] is not None else float(getattr(base, 'pnl_ratio', 0.0))
    except Exception:
        base.pnl_ratio = float(getattr(base, 'pnl_ratio', 0.0))
    # Attach new ratios for profit/loss mapping
    try:
        base.pnl_profit_ratio = float(ov['pnl_profit_ratio']) if ov['pnl_profit_ratio'] is not None else float(getattr(base, 'pnl_profit_ratio', 0.0))
    except Exception:
        base.pnl_profit_ratio = float(getattr(base, 'pnl_profit_ratio', 0.0))
    try:
        base.pnl_loss_ratio = float(ov['pnl_loss_ratio']) if ov['pnl_loss_ratio'] is not None else float(getattr(base, 'pnl_loss_ratio', 0.0))
    except Exception:
        base.pnl_loss_ratio = float(getattr(base, 'pnl_loss_ratio', 0.0))
    base.ema_fast = base.ema_fast if ov['ema_fast'] is None else int(ov['ema_fast'])
    base.ema_slow = base.ema_slow if ov['ema_slow'] is None else int(ov['ema_slow'])
    base.candle = base.candle if ov['candle'] is None else str(ov['candle'])
    base.market = base.market if ov['market'] is None else str(ov['market'])
    base.interval_sec = base.interval_sec if ov['interval_sec'] is None else int(ov['interval_sec'])
    # keys (if provided via API)
    base.access_key = base.access_key if ov['access_key'] is None else str(ov['access_key'])
    base.secret_key = base.secret_key if ov['secret_key'] is None else str(ov['secret_key'])
    # Feature flag: ML-only autotrade (ignore zone-side/order checks except min notional)
    try:
        base.ml_only = bool(ov.get('ml_only'))
    except Exception:
        base.ml_only = False
    try:
        base.ml_seg_only = bool(ov.get('ml_seg_only'))
    except Exception:
        base.ml_seg_only = False
    return base

def _get_runtime_keys():
    """Return a tuple of (std_ak, std_sk, open_ak, open_sk) from overrides/env."""
    ov = bot_ctrl['cfg_override']
    std_ak = (ov.get('access_key') if isinstance(ov, dict) else None) or os.getenv('UPBIT_ACCESS_KEY')
    std_sk = (ov.get('secret_key') if isinstance(ov, dict) else None) or os.getenv('UPBIT_SECRET_KEY')
    open_ak = (ov.get('open_api_access_key') if isinstance(ov, dict) else None) or os.getenv('UPBIT_OPEN_API_ACCESS_KEY')
    open_sk = (ov.get('open_api_secret_key') if isinstance(ov, dict) else None) or os.getenv('UPBIT_OPEN_API_SECRET_KEY')
    return std_ak, std_sk, open_ak, open_sk

def _mask_key(v: str | None) -> str:
    if not v:
        return ''
    try:
        s = str(v)
        if len(s) <= 8:
            return s[:2] + ('*' * max(0, len(s) - 4)) + s[-2:]
        return s[:4] + ('*' * (len(s) - 8)) + s[-4:]
    except Exception:
        return '<?>'

def log_env_keys():
    std_ak, std_sk, open_ak, open_sk = _get_runtime_keys()
    print(f"[ENV] UPBIT_ACCESS_KEY={_mask_key(std_ak)} UPBIT_SECRET_KEY={_mask_key(std_sk)}")
    print(f"[ENV] UPBIT_OPEN_API_ACCESS_KEY={_mask_key(open_ak)} UPBIT_OPEN_API_SECRET_KEY={_mask_key(open_sk)}")

def _reload_env_vars() -> bool:
    try:
        # project root
        load_dotenv()
        load_dotenv("env.local", override=False)
        # bot dir (this file)
        base_dir = os.path.dirname(__file__)
        load_dotenv(os.path.join(base_dir, ".env"), override=True)
        load_dotenv(os.path.join(base_dir, "env.local"), override=True)
        return True
    except Exception:
        return False


def trade_loop():
    try:
        cfg = _resolve_config()
        upbit = None
        if not cfg.paper and cfg.access_key and cfg.secret_key:
            upbit = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
        trader = Trader(
            upbit,
            TradeConfig(
                market=cfg.market,
                order_krw=cfg.order_krw,
                paper=cfg.paper,
                pnl_ratio=float(getattr(cfg, 'pnl_ratio', 0.0)),
                pnl_profit_ratio=float(getattr(cfg, 'pnl_profit_ratio', 0.0)),
                pnl_loss_ratio=float(getattr(cfg, 'pnl_loss_ratio', 0.0)),
            )
        )
        last_signal = 'HOLD'
        # ML model cache for confirmation
        ml_pack = None
        ml_interval = None
        last_order_ts = 0
        # Prevent multiple orders within the same candle/bar
        last_order_bar_ts = 0
        
        # ===== 8BIT 마을 시스템 통합 =====
        # 촌장의 신뢰도 기반 지침 생성
        mayor_guidance = mayor_trust_guidance()
        print(f"🏛️ 촌장 지침: {mayor_guidance['guidance']['official_strategy']}")
        
        # 자동 촌장 지침 학습 체크 및 실행
        auto_mayor_guidance_learning()
        
        # 마을 주민들의 비트카 에너지 주입
        for trainer_name in VILLAGE_RESIDENTS.keys():
            energy_amount = BITCAR_ENERGY_SYSTEM[trainer_name]["energy"]
            result = inject_village_energy_to_bitcar(trainer_name, energy_amount)
            print(f"🚗 {trainer_name} 비트카: {result}")
        
        print("🍊 ORANGE 구역으로 출발합니다!")
        # ===== 마을 시스템 통합 완료 =====
        
        while bot_ctrl['running']:
            try:
                cfg = _resolve_config()
                # Use NB wave zone transitions: one SELL when entering ORANGE, one BUY when entering BLUE
                df = get_candles(cfg.market, cfg.candle, count=max(120, cfg.ema_slow + 5))
                price = float(df['close'].iloc[-1])
                # Compute r in [0,1]
                try:
                    ui_win = bot_ctrl['cfg_override'].get('nb_window')
                    window = int(ui_win) if ui_win is not None else int(load_nb_params().get('window', 50))
                except Exception:
                    window = 50
                r = _compute_r_from_ohlcv(df, window)
                r_last = float(r.iloc[-1]) if len(r) else 0.5
                # Update bot_ctrl with current r_value
                bot_ctrl['r_value'] = r_last
                
                # Current bar timestamp (ms) to dedupe orders per bar
                try:
                    bar_ts = int(df.index[-1].timestamp() * 1000)
                except Exception:
                    bar_ts = int(time.time() * 1000)
                HIGH = float(os.getenv('NB_HIGH', '0.60'))
                LOW = float(os.getenv('NB_LOW', '0.40'))
                if bot_ctrl.get('nb_zone') not in ('BLUE','ORANGE'):
                    bot_ctrl['nb_zone'] = 'ORANGE' if r_last >= 0.5 else 'BLUE'
                
                # Update ml_zone to match nb_zone for now (can be enhanced later)
                bot_ctrl['ml_zone'] = bot_ctrl['nb_zone']
                sig = 'HOLD'
                if bot_ctrl['nb_zone'] == 'BLUE' and r_last >= HIGH:
                    bot_ctrl['nb_zone'] = 'ORANGE'
                    sig = 'SELL'
                elif bot_ctrl['nb_zone'] == 'ORANGE' and r_last <= LOW:
                    bot_ctrl['nb_zone'] = 'BLUE'
                    sig = 'BUY'
                state['signal'] = sig if sig != 'HOLD' else state.get('signal', 'HOLD')
                state['price'] = price
                if sig in ('BUY','SELL') and sig != last_signal:
                    # One-order-per-bar: skip if we already ordered on this bar
                    if last_order_bar_ts and bar_ts == last_order_bar_ts:
                        # already ordered this bar; record reason and skip
                        try:
                            _mark_nb_coin_block(str(cfg.candle), str(cfg.market), ["blocked:already_ordered_this_bar"], int(time.time()*1000), { 'price': price })
                        except Exception:
                            pass
                        last_signal = sig
                        bot_ctrl['last_signal'] = sig
                        time.sleep(max(1, _resolve_config().interval_sec))
                        continue
                    # cooldown between orders (to avoid near-simultaneous flips)
                    try:
                        min_gap = int(bot_ctrl['cfg_override'].get('min_order_gap_sec') or os.getenv('MIN_ORDER_GAP_SEC', '10'))
                    except Exception:
                        min_gap = 10
                    now_ms = int(time.time()*1000)
                    if last_order_ts and (now_ms - last_order_ts) < max(0,min_gap)*1000:
                        try:
                            _mark_nb_coin_block(str(cfg.candle), str(cfg.market), [f"blocked:cooldown({min_gap}s)"], now_ms, { 'price': price })
                        except Exception:
                            pass
                        try:
                            _energy_tick(str(cfg.candle))
                        except Exception:
                            pass
                        last_signal = sig
                        bot_ctrl['last_signal'] = sig
                        time.sleep(max(1, _resolve_config().interval_sec))
                        continue
                    # Enforce single BUY→SELL cycle using position lock
                    try:
                        pos = str(bot_ctrl.get('position') or 'FLAT').upper()
                    except Exception:
                        pos = 'FLAT'
                    # Disallow consecutive BUYs; require SELL to flatten first
                    if sig == 'BUY' and pos == 'LONG':
                        try:
                            _mark_nb_coin_block(str(cfg.candle), str(cfg.market), ["blocked:already_long"], int(time.time()*1000), { 'price': price })
                        except Exception:
                            pass
                        try:
                            _energy_adjust(str(cfg.candle), -0.5, 'already_long')
                        except Exception:
                            pass
                        last_signal = sig
                        bot_ctrl['last_signal'] = sig
                        time.sleep(max(1, _resolve_config().interval_sec))
                        continue
                    # Disallow SELL when already flat (no prior BUY)
                    if sig == 'SELL' and pos != 'LONG':
                        try:
                            _mark_nb_coin_block(str(cfg.candle), str(cfg.market), ["blocked:not_long"], int(time.time()*1000), { 'price': price })
                        except Exception:
                            pass
                        try:
                            _energy_adjust(str(cfg.candle), -0.5, 'not_long')
                        except Exception:
                            pass
                        last_signal = sig
                        bot_ctrl['last_signal'] = sig
                        time.sleep(max(1, _resolve_config().interval_sec))
                        continue
                    # Optional: require ML confirmation
                    try:
                        require_ml = bool(bot_ctrl['cfg_override'].get('require_ml')) if bot_ctrl['cfg_override'].get('require_ml') is not None else (os.getenv('REQUIRE_ML_CONFIRM', 'false').lower()=='true')
                    except Exception:
                        require_ml = False
                    # Rest-after-first-coin: if within rest window, skip placing orders
                    try:
                        iv_rest = str(cfg.candle)
                        bnow = _bucket_ts_interval(int(time.time()*1000), iv_rest)
                        ru = int(_nb_rest_until.get(iv_rest) or 0)
                        if ru and bnow < ru:
                            _mark_nb_coin_block(iv_rest, str(cfg.market), ["rest:scheduled"], int(time.time()*1000), { 'price': price })
                            last_signal = sig
                            bot_ctrl['last_signal'] = sig
                            time.sleep(max(1, _resolve_config().interval_sec))
                            continue
                    except Exception:
                        pass
                    # Optional: require 100% zone probability
                    try:
                        zone100_only = bool(bot_ctrl['cfg_override'].get('zone100_only')) if bot_ctrl['cfg_override'].get('zone100_only') is not None else (os.getenv('ZONE100_ONLY', 'false').lower()=='true')
                    except Exception:
                        zone100_only = False
                    # If nb_force is true, skip optional gates and place order (respect cooldown/position lock)
                    try:
                        nb_force = bool(bot_ctrl['cfg_override'].get('nb_force')) if bot_ctrl['cfg_override'].get('nb_force') is not None else (os.getenv('NB_FORCE','false').lower()=='true')
                    except Exception:
                        nb_force = False

                    # Energy-aware gating (E low → enforce stronger guards; very low → pause)
                    try:
                        E = float(_energy_tick(str(cfg.candle)))
                        e_block = float(os.getenv('ENERGY_BLOCK_TH', '5'))
                        e_pull = float(os.getenv('ENERGY_ENFORCE_PULLBACK_TH', '30'))
                        e_zone = float(os.getenv('ENERGY_ENFORCE_ZONE100_TH', '30'))
                        if E <= e_block:
                            try:
                                _mark_nb_coin_block(str(cfg.candle), str(cfg.market), [f"blocked:energy_low({E:.1f})"], int(time.time()*1000), { 'price': price })
                            except Exception:
                                pass
                            last_signal = sig
                            bot_ctrl['last_signal'] = sig
                            time.sleep(max(1, _resolve_config().interval_sec))
                            continue
                        # below thresholds → tighten gates
                        energy_enforce_pullback = (E < e_pull)
                        energy_enforce_zone100 = (E < e_zone)
                    except Exception:
                        energy_enforce_pullback = False
                        energy_enforce_zone100 = False

                    if not nb_force and require_ml:
                        try:
                            if ml_interval != cfg.candle or ml_pack is None:
                                ml_pack = _load_ml(cfg.candle)
                                ml_interval = cfg.candle
                            if ml_pack is not None:
                                model = ml_pack['model']
                                window = int(ml_pack.get('window', 50))
                                ema_fast = int(ml_pack.get('ema_fast', 10))
                                ema_slow = int(ml_pack.get('ema_slow', 30))
                                feat = _build_features(df, window, ema_fast, ema_slow, 5).dropna().copy()
                                # Respect trained feature order if available
                                trained_cols = list(ml_pack.get('feature_names') or [])
                                if not trained_cols:
                                    base_cols = ['r','w','ema_f','ema_s','ema_diff','r_ema3','r_ema5','dr','ret1','ret3','ret5']
                                    cols_ext = ['zone_flag','dist_high','dist_low','extreme_gap','zone_conf','zone_min_r','zone_max_r','zone_extreme_r','zone_extreme_age']
                                    cand = base_cols + [c for c in cols_ext if c in feat.columns]
                                    try:
                                        need = int(getattr(model, 'n_features_in_', len(cand)))
                                    except Exception:
                                        need = len(cand)
                                    trained_cols = cand[:need]
                                Xv = feat[[c for c in trained_cols if c in feat.columns]].values
                                ml_pred = int(model.predict(Xv)[-1]) if len(Xv) else 0
                                # Auto-sync server candle to ML model interval if they diverge
                                try:
                                    ml_used_interval = str(ml_pack.get('interval') or cfg.candle)
                                except Exception:
                                    ml_used_interval = cfg.candle
                                if ml_used_interval and ml_used_interval != cfg.candle:
                                    bot_ctrl['cfg_override']['candle'] = ml_used_interval
                                    state['candle'] = ml_used_interval
                                    # Skip this tick to reload with new interval
                                    try:
                                        _mark_nb_coin_block(str(cfg.candle), str(cfg.market), [f"blocked:ml_interval_switch->{ml_used_interval}"])
                                    except Exception:
                                        pass
                                    last_signal = sig
                                    bot_ctrl['last_signal'] = sig
                                    time.sleep(max(1, _resolve_config().interval_sec))
                                    continue
                                # Pullback from extreme enforcement (may be forced by low energy)
                                allow_by_pullback = True
                                try:
                                    need_pullback = bool(bot_ctrl['cfg_override'].get('require_pullback') or os.getenv('REQUIRE_PULLBACK', 'false').lower()=='true')
                                except Exception:
                                    need_pullback = False
                                # Energy may force pullback requirement
                                if energy_enforce_pullback:
                                    need_pullback = True
                                try:
                                    pullback_r = float(bot_ctrl['cfg_override'].get('pullback_r') or os.getenv('PULLBACK_R', '0.02'))
                                except Exception:
                                    pullback_r = 0.02
                                try:
                                    pullback_bars = int(bot_ctrl['cfg_override'].get('pullback_bars') or os.getenv('PULLBACK_BARS', '2'))
                                except Exception:
                                    pullback_bars = 2
                                if need_pullback:
                                    try:
                                        snap_pb = snap if 'snap' in locals() and isinstance(snap, dict) else _make_insight(df, window, cfg.ema_fast, cfg.ema_slow, cfg.candle, ml_pack)
                                        eg = float(snap_pb.get('extreme_gap', 0.0) or 0.0)
                                        age = int(snap_pb.get('zone_extreme_age', 0) or 0)
                                        allow_by_pullback = (eg >= pullback_r) and (age >= pullback_bars)
                                    except Exception:
                                        allow_by_pullback = False
                                # Zone 100% enforcement using latest insight snapshot
                                allow_by_zone100 = True
                                if zone100_only or energy_enforce_zone100:
                                    try:
                                        snap = _make_insight(df, window, cfg.ema_fast, cfg.ema_slow, cfg.candle, ml_pack)
                                        pb = float(snap.get('pct_blue', 0.0) or 0.0)
                                        po = float(snap.get('pct_orange', 0.0) or 0.0)
                                        allow_by_zone100 = (pb >= 99.95 or po >= 99.95)
                                    except Exception:
                                        allow_by_zone100 = False
                                # Multi-timeframe group consensus
                                allow_by_group = True
                                try:
                                    need_group = bool(bot_ctrl['cfg_override'].get('require_group') or os.getenv('REQUIRE_GROUP', 'false').lower()=='true')
                                except Exception:
                                    need_group = False
                                if need_group:
                                    try:
                                        intervals = bot_ctrl['cfg_override'].get('group_intervals') or ['minute1','minute3','minute5']
                                        buy_th = float(bot_ctrl['cfg_override'].get('group_buy_th') or os.getenv('GROUP_BUY_TH','70'))
                                        sell_th = float(bot_ctrl['cfg_override'].get('group_sell_th') or os.getenv('GROUP_SELL_TH','70'))
                                        blue_sum=0.0; orange_sum=0.0; cnt=0
                                        for iv in intervals:
                                            dfx = get_candles(cfg.market, iv, count=max(120, window*2))
                                            rvx = float(_compute_r_from_ohlcv(dfx, window).iloc[-1]) if len(dfx) else 0.5
                                            HIGH = float(os.getenv('NB_HIGH', '0.55')); LOW = float(os.getenv('NB_LOW', '0.45'))
                                            rng = max(1e-9, HIGH-LOW)
                                            pbx = max(0.0, min(1.0, (HIGH - rvx)/rng))
                                            pox = max(0.0, min(1.0, (rvx - LOW)/rng))
                                            s0 = pbx+pox
                                            if s0>0: pbx,pox=pbx/s0,pox/s0
                                            blue_sum += pbx; orange_sum += pox; cnt += 1
                                        pb = (blue_sum/cnt*100.0) if cnt else 0.0
                                        po = (orange_sum/cnt*100.0) if cnt else 0.0
                                        if sig=='BUY': allow_by_group = (pb >= buy_th)
                                        elif sig=='SELL': allow_by_group = (po >= sell_th)
                                    except Exception:
                                        allow_by_group = False
                                cfg_now = _resolve_config()
                                if getattr(cfg_now, 'ml_only', False):
                                    # ML-only: only require ML direction to match NB signal
                                    if (ml_pred == 0) or (ml_pred == 1 and sig != 'BUY') or (ml_pred == -1 and sig != 'SELL'):
                                        try:
                                            _mark_nb_coin_block(str(cfg.candle), str(cfg.market), [f"blocked:ml_dir_mismatch pred={ml_pred} sig={sig}"])
                                        except Exception:
                                            pass
                                        try:
                                            _energy_adjust(str(cfg.candle), -0.5, 'ml_dir_mismatch')
                                        except Exception:
                                            pass
                                        last_signal = sig
                                        bot_ctrl['last_signal'] = sig
                                        time.sleep(max(1, _resolve_config().interval_sec))
                                        continue
                                else:
                                    if (ml_pred == 0) or (ml_pred == 1 and sig != 'BUY') or (ml_pred == -1 and sig != 'SELL') or (not allow_by_pullback) or (not allow_by_zone100) or (not allow_by_group):
                                        try:
                                            rs = []
                                            if ml_pred == 0: rs.append('blocked:ml_hold')
                                            if (ml_pred == 1 and sig != 'BUY') or (ml_pred == -1 and sig != 'SELL'):
                                                rs.append('blocked:ml_dir_mismatch')
                                            if not allow_by_pullback: rs.append('blocked:pullback')
                                            if not allow_by_zone100: rs.append('blocked:zone100')
                                            if not allow_by_group: rs.append('blocked:group')
                                            _mark_nb_coin_block(str(cfg.candle), str(cfg.market), rs)
                                        except Exception:
                                            pass
                                        try:
                                            _energy_adjust(str(cfg.candle), -0.5, 'blocked')
                                        except Exception:
                                            pass
                                        last_signal = sig
                                        bot_ctrl['last_signal'] = sig
                                        time.sleep(max(1, _resolve_config().interval_sec))
                                        continue
                        except Exception:
                            pass
                    # Enforce: only BUY in BLUE zone, only SELL in ORANGE zone (toggle-able)
                    try:
                        need_enforce = bool(bot_ctrl['cfg_override'].get('enforce_zone_side')) if bot_ctrl['cfg_override'].get('enforce_zone_side') is not None else (os.getenv('ENFORCE_ZONE_SIDE','false').lower()=='true')
                    except Exception:
                        need_enforce = False
                    if need_enforce:
                        try:
                            snap_guard = _make_insight(df, window, cfg.ema_fast, cfg.ema_slow, cfg.candle, ml_pack)
                            z_now = str(snap_guard.get('zone') or ('ORANGE' if r_last >= 0.5 else 'BLUE')).upper()
                            if (sig == 'BUY' and z_now != 'BLUE') or (sig == 'SELL' and z_now != 'ORANGE'):
                                try:
                                    _mark_nb_coin_block(str(cfg.candle), str(cfg.market), [f"blocked:enforce_zone_side zone={z_now} sig={sig}"])
                                except Exception:
                                    pass
                                try:
                                    _energy_adjust(str(cfg.candle), -0.5, 'enforce_zone_side')
                                except Exception:
                                    pass
                                last_signal = sig
                                bot_ctrl['last_signal'] = sig
                                time.sleep(max(1, _resolve_config().interval_sec))
                                continue
                        except Exception:
                            pass
                    # Finance-aware gating by residents (live only)
                    try:
                        if not cfg.paper:
                            res = _score_strategies(str(cfg.candle))
                            feas = res.get('feasible') if isinstance(res, dict) else None
                            if sig == 'BUY' and (not feas or not feas.get('can_buy')):
                                _mark_nb_coin_block(str(cfg.candle), str(cfg.market), ["blocked:finance:no_buyable"], int(time.time()*1000), { 'price': price })
                                last_signal = sig
                                bot_ctrl['last_signal'] = sig
                                time.sleep(max(1, _resolve_config().interval_sec))
                                continue
                            if sig == 'SELL' and (not feas or not feas.get('can_sell')):
                                _mark_nb_coin_block(str(cfg.candle), str(cfg.market), ["blocked:finance:no_inventory"], int(time.time()*1000), { 'price': price })
                                last_signal = sig
                                bot_ctrl['last_signal'] = sig
                                time.sleep(max(1, _resolve_config().interval_sec))
                                continue
                    except Exception:
                        pass
                    # Update trader's dynamic pnl_ratio before each order
                    try:
                        trader.cfg.pnl_ratio = float(getattr(cfg, 'pnl_ratio', 0.0))
                    except Exception:
                        trader.cfg.pnl_ratio = 0.0
                    o = None
                    try:
                        o = trader.place(sig, price)
                    except Exception:
                        o = None
                    # snapshot current insight at order time
                    try:
                        snap_insight = _make_insight(df, window, cfg.ema_fast, cfg.ema_slow, cfg.candle, ml_pack)
                    except Exception:
                        snap_insight = {}
                    # If live mode and order was not placed (e.g., min notional, no balance), skip logging
                    if (not cfg.paper) and (not isinstance(o, dict)):
                        try:
                            _mark_nb_coin_block(str(cfg.candle), str(cfg.market), ["blocked:live_min_notional_or_balance"])
                        except Exception:
                            pass
                        try:
                            _energy_adjust(str(cfg.candle), -1.0, 'live_fail')
                        except Exception:
                            pass
                        last_signal = sig
                        bot_ctrl['last_signal'] = sig
                        time.sleep(max(1, _resolve_config().interval_sec))
                        continue
                    order = {
                        'ts': int(time.time()*1000),
                        'side': sig,
                        'price': price,
                        'size': (o.get('size') if isinstance(o, dict) else None) or 0,
                        'paper': cfg.paper or bool((isinstance(o, dict) and o.get('paper'))),
                        'market': cfg.market,
                        'interval': str(cfg.candle),
                        'live_ok': bool(o.get('live_ok')) if isinstance(o, dict) else False,
                        'nb_signal': sig,
                        'nb_window': int(window),
                        'nb_r': float(r_last),
                        'insight': snap_insight,
                    }
                    orders.append(order)
                    try:
                        _mark_nb_coin(str(cfg.candle), str(cfg.market), sig, order.get('ts'), order)
                    except Exception:
                        pass
                    
                    # ===== 8BIT 마을 시스템 거래 기록 =====
                    # 각 트레이너의 창고에 거래 기록 저장
                    for trainer_name in VILLAGE_RESIDENTS.keys():
                        try:
                            # 신뢰도 계산
                            personal_confidence = VILLAGE_RESIDENTS[trainer_name].get('skillLevel', 1.0) * 100
                            weighted_confidence = calculate_weighted_confidence(
                                personal_confidence, 
                                MAYOR_TRUST_SYSTEM["ML_Model_Trust"], 
                                MAYOR_TRUST_SYSTEM["NB_Guild_Trust"]
                            )
                            
                            # 거래 데이터 준비
                            trade_data = {
                                'timestamp': datetime.now().isoformat(),
                                'action': sig,
                                'price': price,
                                'quantity': order.get('size', 0),
                                'pnl': 0,  # 나중에 계산
                                'strategy': VILLAGE_RESIDENTS[trainer_name].get('strategy', 'unknown'),
                                'zone': bot_ctrl.get('nb_zone', 'unknown'),
                                'confidence': weighted_confidence,
                                'is_real': not cfg.paper,
                                'market_condition': 'ORANGE' if bot_ctrl.get('nb_zone') == 'ORANGE' else 'BLUE',
                                'timing': 'immediate',
                                'lesson_learned': '거래 실행됨'
                            }
                            
                            # 창고에 거래 기록 저장
                            real_time_trade_recording(trainer_name, trade_data)
                            
                            # ===== 거래 일지 추가 =====
                            # 촌장 지침 기반 일지 생성
                            mayor_entry = create_mayor_guidance_entry(
                                trainer_name, 
                                bot_ctrl.get('nb_zone', 'unknown'), 
                                sig, 
                                f"{trainer_name}의 {sig} 거래 실행"
                            )
                            
                            # ML 모델 판단 기반 일지 생성
                            ml_entry = create_ml_decision_entry(
                                trainer_name,
                                bot_ctrl.get('nb_zone', 'unknown'),
                                sig,
                                MAYOR_TRUST_SYSTEM["ML_Model_Trust"],
                                personal_confidence
                            )
                            
                            # 일지에 추가
                            add_trade_journal_entry(trainer_name, mayor_entry)
                            add_trade_journal_entry(trainer_name, ml_entry)
                            
                            print(f"📦 {trainer_name} 창고에 거래 기록 저장: {sig} @ {price}")
                            print(f"📝 {trainer_name} 거래 일지 업데이트: {mayor_entry['mayor_guidance']}")
                            
                        except Exception as e:
                            print(f"❌ {trainer_name} 거래 기록 저장 실패: {e}")
                    # ===== 마을 시스템 거래 기록 완료 =====
                    last_order_ts = int(order['ts'])
                    last_order_bar_ts = int(bar_ts)
                    bot_ctrl['last_order'] = order
                    # Update position lock
                    try:
                        if sig == 'BUY':
                            bot_ctrl['position'] = 'LONG'
                        elif sig == 'SELL':
                            bot_ctrl['position'] = 'FLAT'
                    except Exception:
                        pass
                    # Energy reward/penalty on order outcome will be applied when accounting updates coin_count
                # No state change (HOLD) or after handling
                last_signal = sig
                bot_ctrl['last_signal'] = sig
            except Exception:
                pass
            time.sleep(max(1, _resolve_config().interval_sec))
    finally:
        bot_ctrl['running'] = False


@app.route('/api/stream')
def api_stream():
    def gen():
        last_ts = None
        last_order_ts = None
        while True:
            try:
                ts = state["history"][-1][0] if state["history"] else None
                if ts and ts != last_ts:
                    last_ts = ts
                    payload = {
                        "ts": ts,
                        "price": state.get("price", 0),
                        "signal": state.get("signal", "HOLD"),
                        "market": state.get("market"),
                        "candle": state.get("candle"),
                        "ema_fast": state.get("ema_fast"),
                        "ema_slow": state.get("ema_slow"),
                    }
                    # Include latest order only when there's a new one
                    if orders:
                        o = orders[-1]
                        if last_order_ts != o.get("ts"):
                            payload["order"] = o
                            last_order_ts = o.get("ts")
                    yield f"data: {json.dumps(payload)}\n\n"
                time.sleep(0.5)
            except GeneratorExit:
                break
            except Exception:
                time.sleep(0.5)
                continue
    headers = {
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    }
    return Response(gen(), mimetype='text/event-stream', headers=headers)


@app.route("/api/state")
def api_state():
    return jsonify({
        "price": state["price"],
        "signal": state["signal"],
        "ema_fast": state["ema_fast"],
        "ema_slow": state["ema_slow"],
        "market": state["market"],
        "candle": state["candle"],
        "history": list(state["history"]),
    })


@app.route('/api/ohlcv')
def api_ohlcv():
    try:
        cfg = load_config()
        count = int((request.args.get('count') or 300))
        interval = request.args.get('interval') or cfg.candle
        
        # Try to get candles with better error handling
        try:
            df = get_candles(cfg.market, interval, count=count)
        except Exception as candle_err:
            logger.error(f"Failed to fetch candles: {candle_err}")
            # Return empty data instead of 500 error
            return jsonify({
                'market': state.get('market', cfg.market),
                'candle': state.get('candle', interval),
                'data': [],
                'error': f'Failed to fetch data: {str(candle_err)}'
            })
        
        out = []
        for idx, row in df.iterrows():
            out.append({
                'time': int(idx.timestamp()*1000),
                'open': float(row['open']),
                'high': float(row['high']),
                'low': float(row['low']),
                'close': float(row['close']),
                'volume': float(row['volume']) if 'volume' in row else 0.0,
            })
        return jsonify({'market': state.get('market'), 'candle': state.get('candle'), 'data': out})
    except Exception as e:
        logger.error(f"Error in api_ohlcv: {e}", exc_info=True)
        return jsonify({'error': str(e), 'data': []}), 500


@app.route('/api/orders', methods=['GET'])
def api_orders():
    """Return recent orders for plotting markers on the chart."""
    try:
        return jsonify({'ok': True, 'market': state.get('market'), 'data': list(orders)})
    except Exception as e:
        return jsonify({'error': str(e), 'data': []}), 500

@app.route('/api/cards/buy', methods=['GET'])
def api_cards_buy():
    """
    data/buy_cards 폴더의 모든 매수 카드 반환
    """
    try:
        cards = _load_order_cards('BUY')
        return jsonify({'ok': True, 'cards': cards, 'count': len(cards)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/cards/sell', methods=['GET'])
def api_cards_sell():
    """
    data/sell_cards 폴더의 모든 매도 카드 반환
    """
    try:
        cards = _load_order_cards('SELL')
        return jsonify({'ok': True, 'cards': cards, 'count': len(cards)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/cards/chart', methods=['GET'])
def api_cards_chart():
    """
    Return simple price/volume arrays for a given market/interval around a timestamp.
    - Params: market (default: cfg.market), interval (e.g., minute10), ts (ms), count (default 120)
    - Uses pyupbit.get_ohlcv with 'to' to approximate the candle range up to the timestamp
    """
    try:
        cfg = load_config()
        try:
            window = int(load_nb_params().get('window', 50))
        except Exception:
            window = 50
        market = request.args.get('market', cfg.market)
        interval = request.args.get('interval', cfg.candle)
        ts_str = request.args.get('ts')
        count = int(request.args.get('count', '120'))

        if not ts_str:
            # Fallback: return recent chart
            df = get_candles(market, interval, count=count)
        else:
            try:
                ts = int(ts_str)
            except Exception:
                return jsonify({'ok': False, 'error': 'invalid ts'}), 400
            # Build 'to' string for pyupbit (YYYY-MM-DD HH:MM:SS)
            dt = datetime.fromtimestamp(ts / 1000.0)
            to_str = dt.strftime('%Y-%m-%d %H:%M:%S')
            # pyupbit doesn't expose 'to' via helper, use direct call if available
            try:
                # Some environments might not have direct 'to'; fallback to recent if fails
                df = pyupbit.get_ohlcv(market, interval=interval, count=count, to=to_str)
                if df is None or len(df) == 0:
                    df = get_candles(market, interval, count=count)
            except Exception:
                df = get_candles(market, interval, count=count)

        if df is None or len(df) == 0:
            return jsonify({'ok': False, 'error': 'no data'}), 500

        # Extract closes and volumes
        try:
            closes = [float(x) for x in df['close'].tolist()]
        except Exception:
            closes = []
        try:
            volumes = [float(x) for x in df['volume'].tolist()]
        except Exception:
            volumes = []

        # Compute NB stats on this window
        try:
            stats = _compute_nb_stats(df, window)
        except Exception:
            stats = {'price': {'values': [], 'max': None, 'min': None}, 'volume': {'values': [], 'max': None, 'min': None}, 'turnover': {'values': [], 'max': None, 'min': None}}

        # Get current price now (for PnL)
        try:
            now_df = get_candles(market, interval, count=1)
            current_now = float(now_df['close'].astype(float).iloc[-1]) if now_df is not None and len(now_df) else None
        except Exception:
            try:
                current_now = float(pyupbit.get_current_price(market))
            except Exception:
                current_now = None

        return jsonify({'ok': True, 'interval': interval, 'window': window, 'price': closes, 'volume': volumes, 'nb': stats, 'current_price_now': current_now, 'count': len(closes)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# Assets summary endpoint
@app.route('/api/assets', methods=['GET'])
def api_assets_summary():
    """
    Return asset summary including:
    - available KRW (exchange if keys configured)
    - BTC amount and its KRW value
    - total asset KRW (available KRW + BTC value)
    Fallback to local buy/sell card aggregation when exchange keys not present.
    """
    try:
        cfg = load_config()
        market = getattr(cfg, 'market', 'KRW-BTC')
        use_exchange = (not getattr(cfg, 'paper', True)) and bool(getattr(cfg, 'access_key', None)) and bool(getattr(cfg, 'secret_key', None))

        available_krw = 0.0
        btc_amount = 0.0
        last_price = 0.0
        source = 'local'

        # Resolve last price
        try:
            last_price = float(pyupbit.get_current_price(market) or 0.0)
        except Exception:
            last_price = 0.0
        if last_price <= 0:
            try:
                df = get_candles(market, getattr(cfg, 'candle', 'minute10'), count=1)
                if df is not None and len(df) > 0:
                    last_price = float(df['close'].astype(float).iloc[-1])
            except Exception:
                last_price = 0.0

        if use_exchange:
            try:
                upbit = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
                available_krw = float(upbit.get_balance('KRW') or 0.0)
                btc_amount = float(upbit.get_balance(market) or 0.0)
                source = 'exchange'
            except Exception as e:
                logger.warning(f"Exchange balances failed, fallback to local: {e}")
                available_krw = 0.0
                btc_amount = 0.0
                source = 'local'

        if source == 'local':
            try:
                buy_cards = _load_order_cards('BUY')
            except Exception:
                buy_cards = []
            try:
                sell_cards = _load_order_cards('SELL')
            except Exception:
                sell_cards = []

            buy_total = sum(float(c.get('price', 0)) * float(c.get('size', 0)) for c in buy_cards)
            sell_total = sum(float(c.get('price', 0)) * float(c.get('size', 0)) for c in sell_cards)
            buy_size_total = sum(float(c.get('size', 0)) for c in buy_cards)
            sell_size_total = sum(float(c.get('size', 0)) for c in sell_cards)
            net_size = max(0.0, buy_size_total - sell_size_total)
            remaining_cost = max(0.0, buy_total - sell_total)
            btc_amount = net_size
            available_krw = remaining_cost

        btc_value_krw = (btc_amount * last_price) if last_price > 0 and btc_amount > 0 else 0.0
        total_krw = available_krw + btc_value_krw

        return jsonify({
            'ok': True,
            'source': source,
            'market': market,
            'availableKRW': available_krw,
            'btcAmount': btc_amount,
            'btcValueKRW': btc_value_krw,
            'totalKRW': total_krw,
            'lastPrice': last_price
        })
    except Exception as e:
        logger.error(f"/api/assets error: {e}", exc_info=True)
        return jsonify({'ok': False, 'error': str(e)}), 500

# ===== NBverse Card Helpers & API =====
def _nbverse_digits_path(value: float, decimal_places: int = 6) -> tuple[list[str], str]:
    """Build nested digit path segments and filename stem from a numeric value.
    Example: 0.597666 -> segments ['5','9','7','6','6','6'], stem '597666'
    Larger values are scaled to preserve significant digits up to decimal_places.
    """
    try:
        # Normalize to positive and extract digits
        v = abs(float(value))
        scaled = int(round(v * (10 ** decimal_places)))
        stem = f"{scaled}"
        # Ensure at least 6 digits for path sharding
        pad = max(0, 6 - len(stem))
        if pad > 0:
            stem = ("0" * pad) + stem
        segments = list(stem[:6])
        return segments, stem
    except Exception:
        return ["0","0","0","0","0","0"], "000000"


def _compute_nb_values(series: pd.Series, window: int) -> list[float]:
    """Compute NB values from a series using EMA-60 change over a rolling window.
    Returns the last window of NB values for MAX/MIN computation.
    """
    try:
        ema_60 = series.ewm(span=60, adjust=False).mean()
        nb_values: list[float] = []
        for i in range(len(series)):
            if i >= window - 1:
                window_ema = ema_60.iloc[i-window+1:i+1]
                changes = []
                for j in range(1, len(window_ema)):
                    prev_ema = float(window_ema.iloc[j-1])
                    curr_ema = float(window_ema.iloc[j])
                    if prev_ema != 0:
                        changes.append((curr_ema - prev_ema) / prev_ema)
                    else:
                        changes.append(0.0)
                nb_values.append(float(np.mean(changes) if changes else 0.0))
            else:
                nb_values.append(0.0)
        # Return last window slice (defensive)
        tail = nb_values[-window:] if window <= len(nb_values) else nb_values
        return tail
    except Exception:
        return []


def _compute_nb_stats(df: pd.DataFrame, window: int) -> dict:
    """Compute NB MAX/MIN for price(close), volume, and turnover(close*volume)."""
    rng_seed = 5.5 + (window % 95) * 0.5  # consistent with existing logic
    out = {}
    try:
        # Price-based
        price_series = df['close'].astype(float)
        price_nb = _compute_nb_values(price_series, window)
        out['price'] = {
            'values': price_nb,
            'max': float(BIT_MAX_NB(price_nb, rng_seed)) if price_nb else None,
            'min': float(BIT_MIN_NB(price_nb, rng_seed)) if price_nb else None,
        }
    except Exception:
        out['price'] = {'values': [], 'max': None, 'min': None}
    try:
        # Volume-based
        vol_series = df['volume'].astype(float) if 'volume' in df.columns else None
        if vol_series is not None:
            vol_nb = _compute_nb_values(vol_series, window)
            out['volume'] = {
                'values': vol_nb,
                'max': float(BIT_MAX_NB(vol_nb, rng_seed)) if vol_nb else None,
                'min': float(BIT_MIN_NB(vol_nb, rng_seed)) if vol_nb else None,
            }
        else:
            out['volume'] = {'values': [], 'max': None, 'min': None}
    except Exception:
        out['volume'] = {'values': [], 'max': None, 'min': None}
    try:
        # Turnover (price * volume)
        if 'volume' in df.columns:
            turnover_series = (df['close'].astype(float) * df['volume'].astype(float))
            turnover_nb = _compute_nb_values(turnover_series, window)
            out['turnover'] = {
                'values': turnover_nb,
                'max': float(BIT_MAX_NB(turnover_nb, rng_seed)) if turnover_nb else None,
                'min': float(BIT_MIN_NB(turnover_nb, rng_seed)) if turnover_nb else None,
            }
        else:
            out['turnover'] = {'values': [], 'max': None, 'min': None}
    except Exception:
        out['turnover'] = {'values': [], 'max': None, 'min': None}
    return out


def _save_nbverse_price(max_val: float, min_val: float, interval: str, current_price: float,
                        chart_data: list[dict], nb_values: list[float], decimal_places: int = 6) -> dict:
    """Save price-based NBverse records for MAX and MIN into data/nbverse.
    Creates sharded paths by leading digits and stores rich JSON with chart snapshot.
    Returns paths for max/min.
    """
    base_dir = os.path.join(os.path.dirname(__file__), 'data', 'nbverse')
    ts = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    meta = {'paths': {}}
    try:
        # MAX
        max_segs, max_stem = _nbverse_digits_path(max_val, decimal_places)
        max_dir = os.path.join(base_dir, 'max', *max_segs)
        os.makedirs(max_dir, exist_ok=True)
        max_path = os.path.join(max_dir, f"{max_stem}_{ts}.json")
        with open(max_path, 'w', encoding='utf-8') as f:
            json.dump({
                'nb': {
                    'category': 'price',
                    'max': float(max_val),
                    'min': float(min_val),
                    'values': list(map(float, nb_values or [])),
                },
                'interval': str(interval),
                'current_price': float(current_price),
                'chart_data': chart_data,
                'decimal_places': int(decimal_places),
                'calculated_at': datetime.now().isoformat(),
                'version': 'nbverse.card.v1'
            }, f, ensure_ascii=False, indent=2)
        meta['paths']['max'] = max_path
    except Exception as e:
        meta['paths']['max_error'] = str(e)
    try:
        # MIN
        min_segs, min_stem = _nbverse_digits_path(min_val, decimal_places)
        min_dir = os.path.join(base_dir, 'min', *min_segs)
        os.makedirs(min_dir, exist_ok=True)
        min_path = os.path.join(min_dir, f"{min_stem}_{ts}.json")
        with open(min_path, 'w', encoding='utf-8') as f:
            json.dump({
                'nb': {
                    'category': 'price',
                    'max': float(max_val),
                    'min': float(min_val),
                    'values': list(map(float, nb_values or [])),
                },
                'interval': str(interval),
                'current_price': float(current_price),
                'chart_data': chart_data,
                'decimal_places': int(decimal_places),
                'calculated_at': datetime.now().isoformat(),
                'version': 'nbverse.card.v1'
            }, f, ensure_ascii=False, indent=2)
        meta['paths']['min'] = min_path
    except Exception as e:
        meta['paths']['min_error'] = str(e)
    return meta


@app.route('/api/nbverse/card', methods=['GET'])
def api_nbverse_card():
    """Compute current NBverse card values and persist price-based MAX/MIN.
    Query: interval, count(optional), save(optional=true/false)
    """
    try:
        cfg = load_config()
        try:
            window = int(load_nb_params().get('window', 50))
        except Exception:
            window = 50
        interval = request.args.get('interval') or (state.get('candle') or cfg.candle)
        count = int(request.args.get('count') or max(400, window * 3))
        save_flag = str(request.args.get('save', 'false')).lower() in ('1','true','yes')
        df = get_candles(cfg.market, interval, count=count)
        # 빈 데이터 방어
        if df is None or len(df) == 0:
            return jsonify({'ok': True, 'interval': interval, 'window': window, 'market': cfg.market, 'current_price': None, 'chart': [], 'nb': {'price': {'values': [], 'max': None, 'min': None}, 'volume': {'values': [], 'max': None, 'min': None}, 'turnover': {'values': [], 'max': None, 'min': None}}})
        # Chart payload compatible with frontend
        chart = []
        try:
            for idx, row in df.iterrows():
                chart.append({
                    'time': int(idx.timestamp()*1000),
                    'open': float(row['open']),
                    'high': float(row['high']),
                    'low': float(row['low']),
                    'close': float(row['close']),
                    'volume': float(row['volume']) if 'volume' in row else 0.0,
                })
        except Exception:
            chart = []
        stats = _compute_nb_stats(df, window)
        current_price = float(df['close'].astype(float).iloc[-1]) if len(df) else None
        result = {
            'ok': True,
            'interval': interval,
            'window': window,
            'market': cfg.market,
            'current_price': current_price,
            'chart': chart,
            'nb': stats,
        }
        # Persist price-based NBverse (오류는 결과에 포함하고 계속 진행)
        # DISABLED: NBverse auto-save is now disabled
        # try:
        #     if save_flag and stats.get('price') and stats['price'].get('max') is not None and stats['price'].get('min') is not None:
        #         meta = _save_nbverse_price(stats['price']['max'], stats['price']['min'], interval, current_price, chart, stats['price']['values'])
        #         result['save'] = meta
        # except Exception as e:
        #     result['save_error'] = str(e)
        return jsonify(result)
    except Exception as e:
        # 200으로 응답해 프론트가 캐시/폴백을 쓰도록 유도
        return jsonify({'ok': False, 'error': str(e), 'interval': request.args.get('interval'), 'chart': [], 'nb': {}})


@app.route('/api/nbverse/zone', methods=['GET'])
def api_nbverse_zone():
    """Return current N/B zone status for the given interval.
    Query: interval (optional, defaults to config.candle)
    Response: {ok: bool, current_zone: 'BLUE'|'ORANGE'|'NONE', zone_count: int}
    """
    try:
        cfg = load_config()
        interval = request.args.get('interval') or (state.get('candle') or cfg.candle)
        count = int(request.args.get('count') or 300)
        try:
            window = int(load_nb_params().get('window', 50))
        except Exception:
            window = 50
        
        # Get thresholds
        try:
            HIGH = float(os.getenv('NB_HIGH', '0.55'))
            LOW = float(os.getenv('NB_LOW', '0.45'))
        except Exception:
            HIGH, LOW = 0.55, 0.45
        
        # Get candles and compute current r value
        df = get_candles(cfg.market, interval, count=count)
        if len(df) < window:
            return jsonify({
                'ok': True,
                'interval': interval,
                'current_zone': 'NONE',
                'zone_count': 0,
                'note': 'Insufficient data'
            })
        
        # Compute r_series
        r_series = _compute_r_from_ohlcv(df, window).astype(float)
        rv = float(r_series.iloc[-1]) if len(r_series) else 0.5
        
        # Determine current zone
        if rv >= HIGH:
            current_zone = 'ORANGE'
        elif rv <= LOW:
            current_zone = 'BLUE'
        else:
            current_zone = 'NONE'
        
        # Count consecutive zone occurrences from the end
        zone_count = 1
        for i in range(len(r_series) - 2, -1, -1):
            r_val = float(r_series.iloc[i])
            if current_zone == 'ORANGE' and r_val >= HIGH:
                zone_count += 1
            elif current_zone == 'BLUE' and r_val <= LOW:
                zone_count += 1
            elif current_zone == 'NONE':
                break
            else:
                break
        
        return jsonify({
            'ok': True,
            'interval': interval,
            'current_zone': current_zone,
            'zone_count': zone_count,
            'r': float(rv),
            'high': float(HIGH),
            'low': float(LOW)
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/nbverse/save', methods=['POST'])
def api_nbverse_save():
    """Save current card data to NBverse.
    Body: {interval, timestamp, current_price, current_volume, current_turnover, nb, chart, 
           card_rating, nb_zone, ml_trust, realized_pnl, nb_wave}
    Stores full chart (not just count) so UI can restore exactly.
    Saves to paths based on N/B max and min values.
    """
    try:
        if not request.is_json:
            return jsonify({'ok': False, 'error': 'JSON required'}), 400
        
        payload = request.get_json(force=True)
        interval = str(payload.get('interval', 'minute10'))
        timestamp = str(payload.get('timestamp', datetime.now().isoformat()))
        current_price = float(payload.get('current_price', 0))
        current_volume = float(payload.get('current_volume', 0))
        current_turnover = float(payload.get('current_turnover', 0))
        nb_data = payload.get('nb', {})
        chart_data = payload.get('chart', [])
        
        # Additional card info
        card_rating = payload.get('card_rating', {})  # {code, league, group, super, enhancement, color}
        nb_zone = payload.get('nb_zone', {})  # {zone, zone_flag, zone_conf, dist_high, dist_low, etc.}
        ml_trust = payload.get('ml_trust', {})  # {grade, enhancement, trust_score, etc.}
        realized_pnl = payload.get('realized_pnl', {})  # {avg, max}
        nb_wave = payload.get('nb_wave', {})  # {r, w, ema_diff, pct_blue, pct_orange, etc.}
        
        # Build insight object from nb_zone for ML training compatibility
        insight = {
            'zone': nb_zone.get('zone', ''),
            'zone_flag': nb_zone.get('zone_flag', 0),
            'zone_conf': nb_zone.get('zone_conf', 0.0),
            'dist_high': nb_zone.get('dist_high', 0.0),
            'dist_low': nb_zone.get('dist_low', 0.0),
            'r': nb_wave.get('r', 0.0),
            'w': nb_wave.get('w', 0.0),
            'ema_diff': nb_wave.get('ema_diff', 0.0),
            'pct_blue': nb_wave.get('pct_blue', 0.0),
            'pct_orange': nb_wave.get('pct_orange', 0.0)
        }
        
        # Save record (include full chart and all metadata)
        record = {
            'interval': interval,
            'timestamp': timestamp,
            'saved_at': datetime.now().isoformat(),
            'current_price': current_price,
            'current_volume': current_volume,
            'current_turnover': current_turnover,
            'nb': nb_data,
            'chart': chart_data,
            'chart_count': len(chart_data),
            'card_rating': card_rating,
            'nb_zone': nb_zone,
            'insight': insight,  # Add insight for ML training
            'ml_trust': ml_trust,
            'realized_pnl': realized_pnl,
            'nb_wave': nb_wave,
            'version': 'nbverse.save.v5'
        }
        
        # Helper function to create path from N/B value
        def create_nb_path(nb_value):
            """Convert N/B value to directory path structure.
            Example: 8.488212244897959 -> 8/4/8/8/2/1/2/2/4/4/8/9/7/9/5/9
            Example: 12.69311836734694 -> 12/6/9/3/1/1/8/3/6/7/3/4/6/9/4
            """
            nb_str = str(nb_value)
            
            # Split into integer and decimal parts
            if '.' in nb_str:
                int_part, dec_part = nb_str.split('.', 1)
            else:
                int_part, dec_part = nb_str, ''
            
            # Remove negative sign if present
            int_part = int_part.replace('-', '')
            dec_part = dec_part.replace('-', '')
            
            # Create path: integer part as-is, then each decimal digit separately
            path_parts = [int_part] + list(dec_part)
            return os.path.join(*path_parts)
        
        base_dir = os.path.join(os.path.dirname(__file__), 'data', 'nbverse')
        saved_paths = []
        
        # Extract N/B max and min values
        price_nb = nb_data.get('price', {})
        nb_max = price_nb.get('max')
        nb_min = price_nb.get('min')
        
        # Save to N/B max path
        if nb_max is not None:
            try:
                max_path_dir = os.path.join(base_dir, 'max', create_nb_path(nb_max))
                os.makedirs(max_path_dir, exist_ok=True)
                max_save_file = os.path.join(max_path_dir, 'this_pocket_card.json')
                
                with open(max_save_file, 'w', encoding='utf-8') as f:
                    json.dump(record, f, ensure_ascii=False, indent=2)
                
                saved_paths.append(max_save_file)
                logger.info(f'✅ NBverse 카드 저장 (MAX): {interval} at {max_save_file}')
            except Exception as e:
                logger.error(f'❌ NBverse MAX 경로 저장 실패: {str(e)}')
        
        # Save to N/B min path
        if nb_min is not None:
            try:
                min_path_dir = os.path.join(base_dir, 'min', create_nb_path(nb_min))
                os.makedirs(min_path_dir, exist_ok=True)
                min_save_file = os.path.join(min_path_dir, 'this_pocket_card.json')
                
                with open(min_save_file, 'w', encoding='utf-8') as f:
                    json.dump(record, f, ensure_ascii=False, indent=2)
                
                saved_paths.append(min_save_file)
                logger.info(f'✅ NBverse 카드 저장 (MIN): {interval} at {min_save_file}')
            except Exception as e:
                logger.error(f'❌ NBverse MIN 경로 저장 실패: {str(e)}')
        
        # Fallback: save with timestamp if no N/B values
        if not saved_paths:
            ts = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
            fallback_file = os.path.join(base_dir, f'card_{interval}_{ts}.json')
            os.makedirs(base_dir, exist_ok=True)
            
            with open(fallback_file, 'w', encoding='utf-8') as f:
                json.dump(record, f, ensure_ascii=False, indent=2)
            
            saved_paths.append(fallback_file)
            logger.info(f'✅ NBverse 카드 저장 (FALLBACK): {interval} at {fallback_file}')
        
        return jsonify({
            'ok': True,
            'saved': True,
            'paths': saved_paths,
            'count': len(saved_paths),
            'interval': interval,
            'timestamp': timestamp,
            'nb_max': nb_max,
            'nb_min': nb_min
        })
    except Exception as e:
        logger.error(f'❌ NBverse 저장 오류: {str(e)}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/nbverse/load', methods=['GET'])
def api_nbverse_load():
    """Load a saved NBverse snapshot and normalize for UI.
    Query: path (absolute or relative under data/nbverse)
    Response: {ok, interval, timestamp, price:[], volume:[], nb:{...}, chart_count}
    """
    try:
        raw_path = request.args.get('path')
        if not raw_path:
            return jsonify({'ok': False, 'error': 'path is required'}), 400

        base_dir = os.path.join(os.path.dirname(__file__), 'data', 'nbverse')
        os.makedirs(base_dir, exist_ok=True)

        # Resolve absolute path safely within base_dir
        candidate = raw_path
        if not os.path.isabs(candidate):
            candidate = os.path.join(base_dir, candidate)
        abs_path = os.path.abspath(candidate)
        base_abs = os.path.abspath(base_dir)
        # Prevent path traversal
        if os.path.commonpath([abs_path, base_abs]) != base_abs:
            return jsonify({'ok': False, 'error': 'invalid path'}), 400
        if not os.path.exists(abs_path):
            # Graceful fallback: return empty payload instead of 404 to avoid frontend spam
            return jsonify({
                'ok': False,
                'error': 'not found',
                'path': raw_path,
                'data': [],
                'price': [],
                'volume': [],
                'chart_count': 0
            })

        with open(abs_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        chart = data.get('chart') or []
        price_vals = []
        volume_vals = []
        for c in chart:
            try:
                # support various candle shapes
                close = c.get('close', c.get('c', c.get('price')))
                vol = c.get('volume', c.get('v', c.get('qty', 0)))
                price_vals.append(float(close) if close is not None else None)
                volume_vals.append(float(vol) if vol is not None else 0.0)
            except Exception:
                price_vals.append(None)
                volume_vals.append(0.0)

        resp = {
            'ok': True,
            'interval': data.get('interval'),
            'timestamp': data.get('timestamp'),
            'chart_count': len(chart),
            'price': price_vals,
            'volume': volume_vals,
            'nb': data.get('nb') or {}
        }
        return jsonify(resp)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/nbverse/load_by_nb', methods=['GET'])
def api_nbverse_load_by_nb():
    """Load a saved NBverse card by N/B value (max or min).
    Query: nb_value (e.g., 8.488212244897959 or 12.69311836734694), type (max or min, default: max)
    Response: {ok, interval, timestamp, price:[], volume:[], nb:{...}, chart_count, path}
    """
    try:
        nb_value = request.args.get('nb_value')
        nb_type = request.args.get('type', 'max')  # 'max' or 'min'
        
        if not nb_value:
            return jsonify({'ok': False, 'error': 'nb_value is required'}), 400
        
        if nb_type not in ['max', 'min']:
            return jsonify({'ok': False, 'error': 'type must be "max" or "min"'}), 400
        
        # Convert N/B value to path structure
        base_dir = os.path.join(os.path.dirname(__file__), 'data', 'nbverse')
        card_file = _find_nbverse_card_by_nb(base_dir, nb_value, nb_type, float(request.args.get('eps', 1e-9)))
        
        if card_file is None:
            return jsonify({
                'ok': False,
                'error': 'card not found',
                'nb_value': nb_value,
                'type': nb_type,
                'hint': 'Try with reduced decimals (e.g., 14.8352) or adjust eps'
            }), 404
        
        with open(card_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        price_vals, volume_vals = _extract_chart_data(data.get('chart') or [])
        
        resp = {
            'ok': True,
            'interval': data.get('interval'),
            'timestamp': data.get('timestamp'),
            'saved_at': data.get('saved_at'),
            'chart_count': len(data.get('chart') or []),
            'price': price_vals,
            'volume': volume_vals,
            'nb': data.get('nb') or {},
            'current_price': data.get('current_price'),
            'current_volume': data.get('current_volume'),
            'current_turnover': data.get('current_turnover'),
            'path': card_file,
            'nb_value': nb_value
        }
        logger.info(f'✅ NBverse 카드 로드 (N/B={nb_value}): {card_file}')
        return jsonify(resp)
    except Exception as e:
        logger.error(f'❌ NBverse 로드 오류 (N/B={request.args.get("nb_value")}): {str(e)}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/nbverse/search', methods=['GET'])
def api_nbverse_search():
    """Search NBverse cards with flexible criteria
    
    Query params:
    - type: 'max' or 'min' (default: both)
    - interval: 'minute1', 'minute3', etc. (filter by interval)
    - price_min: minimum nb.price.max or nb.price.min value
    - price_max: maximum nb.price.max or nb.price.min value
    - current_price_min: minimum current_price
    - current_price_max: maximum current_price
    - limit: max results (default: 100, max: 500)
    - offset: skip results (default: 0)
    - sort: 'timestamp' or 'price' or 'nb_price' (default: timestamp)
    - order: 'asc' or 'desc' (default: desc)
    """
    try:
        # Parse query params
        search_params = {
            'type': request.args.get('type'),
            'interval': request.args.get('interval'),
            'price_min': request.args.get('price_min', type=float),
            'price_max': request.args.get('price_max', type=float),
            'current_price_min': request.args.get('current_price_min', type=float),
            'current_price_max': request.args.get('current_price_max', type=float),
            'limit': min(int(request.args.get('limit', 100)), 500),
            'offset': int(request.args.get('offset', 0)),
            'sort': request.args.get('sort', 'timestamp'),
            'order': request.args.get('order', 'desc')
        }
        
        base_dir = os.path.join(os.path.dirname(__file__), 'data', 'nbverse')
        results, stats = _search_nbverse_cards(base_dir, search_params)
        
        # Apply pagination
        total = len(results)
        paginated = results[search_params['offset']:search_params['offset'] + search_params['limit']]
        
        logger.info(f'✅ NBverse 검색 완료: 스캔 {stats["scanned"]}개, 매칭 {total}개, 반환 {len(paginated)}개')
        return jsonify({
            "ok": True,
            "results": paginated,
            "total": total,
            "limit": search_params['limit'],
            "offset": search_params['offset'],
            "returned": len(paginated),
            "stats": stats
        })
    
    except Exception as e:
        logger.error(f'❌ NBverse 검색 오류: {str(e)}')
        return jsonify({
            "ok": False,
            "error": str(e)
        }), 500


@app.route('/api/nbverse/file', methods=['GET'])
def api_nbverse_file():
    """Load NBverse card file by relative path
    
    Query params:
    - path: relative path from nbverse root (e.g., 'max/0/4/9/8/.../this_pocket_card.json')
    """
    try:
        path = request.args.get('path')
        if not path:
            return jsonify({'ok': False, 'error': 'path parameter is required'}), 400
        
        base_dir = os.path.join(os.path.dirname(__file__), 'data', 'nbverse')
        
        # Validate and get absolute file path
        abs_file_path, error = _validate_nbverse_path(path, base_dir)
        if error:
            return jsonify({'ok': False, 'error': error}), 400 if 'Invalid' in error else 404
        
        # Load file data
        data = _load_nbverse_file(abs_file_path)
        
        logger.info(f'✅ NBverse 파일 로드: {path}')
        return jsonify({
            'ok': True,
            'path': path,
            'data': data
        })
    
    except json.JSONDecodeError as e:
        logger.error(f'❌ NBverse JSON 파싱 오류: {str(e)}')
        return jsonify({'ok': False, 'error': 'Invalid JSON format'}), 400
    except Exception as e:
        logger.error(f'❌ NBverse 파일 로드 오류: {str(e)}')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ===== NBverse Helper Functions =====

def _find_nbverse_card_by_nb(base_dir, nb_value, nb_type, eps=1e-9):
    """Find NBverse card file by N/B value with tolerance"""
    nb_str = str(nb_value)
    if '.' in nb_str:
        int_part, dec_part = nb_str.split('.', 1)
    else:
        int_part, dec_part = nb_str, ''

    int_part = int_part.replace('-', '')
    dec_part = dec_part.replace('-', '')

    path_parts = [int_part] + list(dec_part)
    nb_path = os.path.join(*path_parts) if path_parts else int_part

    card_file = os.path.join(base_dir, nb_type, nb_path, 'this_pocket_card.json')

    # Exact path attempt
    if os.path.exists(card_file):
        return card_file

    # Fallback: search with tolerance
    try:
        target_val = float(nb_value)
    except Exception:
        return None

    if math.isnan(target_val):
        return None

    # Search in narrower scope first
    prefix_parts = [int_part]
    if dec_part:
        prefix_parts += list(dec_part[:4])
    search_root = os.path.join(base_dir, nb_type, *prefix_parts)

    candidates = _find_card_candidates(search_root)
    
    # If no candidates, broaden search
    if not candidates:
        broader_root = os.path.join(base_dir, nb_type, int_part)
        candidates = _find_card_candidates(broader_root)

    # Find matching card within tolerance
    for fpath in candidates:
        try:
            with open(fpath, 'r', encoding='utf-8') as fp:
                j = json.load(fp)
            v = j.get('nb', {}).get('price', {}).get(nb_type)
            if v is not None and abs(float(v) - target_val) <= eps:
                return fpath
        except Exception:
            continue

    return None


def _find_card_candidates(search_root):
    """Find all this_pocket_card.json files under search_root"""
    candidates = []
    if os.path.isdir(search_root):
        for root, dirs, files in os.walk(search_root):
            if 'this_pocket_card.json' in files:
                candidates.append(os.path.join(root, 'this_pocket_card.json'))
    return candidates


def _extract_chart_data(chart):
    """Extract price and volume arrays from chart data"""
    price_vals = []
    volume_vals = []
    for c in chart:
        try:
            close = c.get('close', c.get('c', c.get('price')))
            vol = c.get('volume', c.get('v', c.get('qty', 0)))
            price_vals.append(float(close) if close is not None else None)
            volume_vals.append(float(vol) if vol is not None else 0.0)
        except Exception:
            price_vals.append(None)
            volume_vals.append(0.0)
    return price_vals, volume_vals


def _search_nbverse_cards(base_dir, params):
    """Search NBverse cards with filters and sorting"""
    # Determine types to search
    types_to_search = []
    if params['type'] == 'max':
        types_to_search = ['max']
    elif params['type'] == 'min':
        types_to_search = ['min']
    else:
        types_to_search = ['max', 'min']
    
    results = []
    stats = {
        'scanned': 0,
        'matched': 0,
        'filtered': 0,
        'by_type': {'max': 0, 'min': 0},
        'by_interval': {}
    }
    
    # Walk through NBverse directories
    for nb_type_dir in types_to_search:
        type_path = os.path.join(base_dir, nb_type_dir)
        if not os.path.exists(type_path):
            continue
        
        # Walk recursively through all subdirectories
        for root, dirs, files in os.walk(type_path):
            if 'this_pocket_card.json' not in files:
                continue
            
            stats['scanned'] += 1
            card_path = os.path.join(root, 'this_pocket_card.json')
            card_data = _load_and_filter_card(card_path, nb_type_dir, base_dir, params)
            
            if card_data:
                results.append(card_data)
                stats['matched'] += 1
                stats['by_type'][nb_type_dir] += 1
                
                # Count by interval
                interval = card_data.get('interval', 'unknown')
                stats['by_interval'][interval] = stats['by_interval'].get(interval, 0) + 1
            else:
                stats['filtered'] += 1
    
    # Sort results
    _sort_results(results, params['sort'], params['order'])
    
    return results, stats


def _load_and_filter_card(card_path, nb_type_dir, base_dir, params):
    """Load card and apply filters"""
    try:
        with open(card_path, 'r', encoding='utf-8') as f:
            card = json.load(f)
        
        # Extract path relative to nbverse base
        rel_path = os.path.relpath(card_path, base_dir).replace('\\', '/')
        
        # Apply interval filter
        if params['interval'] and card.get('interval') != params['interval']:
            return None
        
        # Get nb_price value
        nb_price = card.get('nb', {}).get('price', {})
        nb_price_val = nb_price.get(nb_type_dir)
        
        # Apply nb_price filters
        if params['price_min'] is not None and (nb_price_val is None or nb_price_val < params['price_min']):
            return None
        if params['price_max'] is not None and (nb_price_val is None or nb_price_val > params['price_max']):
            return None
        
        # Apply current_price filters
        current_price = card.get('current_price')
        if params['current_price_min'] is not None and (current_price is None or current_price < params['current_price_min']):
            return None
        if params['current_price_max'] is not None and (current_price is None or current_price > params['current_price_max']):
            return None
        
        # Build result
        return {
            "type": nb_type_dir,
            "path": rel_path,
            "interval": card.get('interval'),
            "timestamp": card.get('timestamp'),
            "saved_at": card.get('saved_at'),
            "current_price": current_price,
            "current_volume": card.get('current_volume'),
            "nb_price": nb_price_val,
            "nb_price_max": nb_price.get('max'),
            "nb_price_min": nb_price.get('min')
        }
    
    except Exception:
        return None


def _sort_results(results, sort_by, order):
    """Sort results in place"""
    reverse = (order == 'desc')
    
    if sort_by == 'timestamp':
        results.sort(key=lambda x: x.get('timestamp', ''), reverse=reverse)
    elif sort_by == 'price':
        results.sort(key=lambda x: x.get('current_price') or 0, reverse=reverse)
    elif sort_by == 'nb_price':
        results.sort(key=lambda x: x.get('nb_price') or 0, reverse=reverse)


def _validate_nbverse_path(path, base_dir):
    """Validate NBverse file path and return absolute path
    
    Returns:
        tuple: (abs_file_path, error_message)
        - If valid: (absolute_path, None)
        - If invalid: (None, error_message)
    """
    # Security: prevent path traversal attacks
    if '..' in path or path.startswith('/') or path.startswith('\\'):
        return None, 'Invalid path: Path traversal detected'
    
    # Normalize path separators
    normalized_path = path.replace('/', os.sep).replace('\\', os.sep)
    file_path = os.path.join(base_dir, normalized_path)
    
    # Get absolute paths for security check
    abs_file_path = os.path.abspath(file_path)
    abs_base_dir = os.path.abspath(base_dir)
    
    # Verify file is within nbverse directory
    if not abs_file_path.startswith(abs_base_dir):
        return None, 'Invalid path: Outside allowed directory'
    
    # Check file exists
    if not os.path.exists(abs_file_path):
        return None, 'File not found'
    
    # Check it's a file (not directory)
    if not os.path.isfile(abs_file_path):
        return None, 'Invalid path: Not a file'
    
    return abs_file_path, None


def _load_nbverse_file(file_path):
    """Load and parse NBverse JSON file
    
    Args:
        file_path: Absolute path to JSON file
        
    Returns:
        dict: Parsed JSON data
        
    Raises:
        json.JSONDecodeError: If file is not valid JSON
        IOError: If file cannot be read
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


@app.route('/api/order', methods=['POST'])
def api_order_create():
    """Accept order notifications from the trader (paper or live)."""
    try:
        if request.is_json:
            payload = request.get_json(force=True)
        else:
            payload = request.form.to_dict()
        # Normalize fields
        order = {
            'ts': int(payload.get('ts') or int(time.time() * 1000)),
            'side': str(payload.get('side', '')).upper(),
            'price': float(payload.get('price', 0) or 0),
            'size': float(payload.get('size', 0) or 0),
            'paper': bool(payload.get('paper', True) in (True, 'true', '1', 1, 'True')),
            'market': payload.get('market') or state.get('market'),
        }
        orders.append(order)
        try:
            _mark_nb_coin(str(state.get('candle') or load_config().candle), str(order.get('market') or state.get('market') or load_config().market), str(order.get('side') or 'NONE'), int(order.get('ts') or int(time.time()*1000)), order)
        except Exception:
            pass
        return jsonify({'ok': True, 'order': order})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400


@app.route('/api/orders/clear', methods=['POST'])
def api_orders_clear():
    """Clear in-memory order log and return ok."""
    try:
        orders.clear()
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/signal/log', methods=['POST'])
def api_signal_log():
    """Append an ML signal marker for later scoring/training.
    Body: { ts, zone, extreme, price, pct_major, slope_bp, horizon, pred_nb, interval }
    """
    try:
        payload = request.get_json(force=True)
        s = {
            'id': int(time.time()*1000),
            'ts': int(payload.get('ts')),
            'zone': str(payload.get('zone','')).upper(),
            'extreme': str(payload.get('extreme','')).upper(),
            'price': float(payload.get('price') or 0.0),
            'pct_major': float(payload.get('pct_major') or 0.0),
            'slope_bp': float(payload.get('slope_bp') or 0.0),
            'horizon': int(payload.get('horizon') or 0),
            'pred_nb': payload.get('pred_nb'),
            'interval': str(payload.get('interval') or (state.get('candle') or 'minute5')),
            'market': str(state.get('market') or load_config().market),
            'score0': max(0.0, min(1.0, float(payload.get('score0') or 0.0))),
            'realized_score': None,
        }
        signals.append(s)
        try:
            _mark_nb_coin(str(s.get('interval') or (state.get('candle') or 'minute5')),
                          str(s.get('market') or (state.get('market') or load_config().market)),
                          'BUY' if str(s.get('zone')).upper()=='BLUE' else ('SELL' if str(s.get('zone')).upper()=='ORANGE' else 'NONE'),
                          int(s.get('ts') or int(time.time()*1000)), None)
        except Exception:
            pass
        # optional: append to disk
        try:
            base_dir = os.path.dirname(__file__)
            path = os.path.join(base_dir, 'data', 'signals.jsonl')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'a', encoding='utf-8') as f:
                f.write(json.dumps(s, ensure_ascii=False) + '\n')
        except Exception:
            pass
        return jsonify({'ok': True, 'signal': s})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400


def initialize_arrays(count):
    """25개의 배열을 초기화하는 함수"""
    arrays = ['BIT_START_A50', 'BIT_START_A100', 'BIT_START_B50', 'BIT_START_B100', 'BIT_START_NBA100']
    initialized_arrays = {}
    for array in arrays:
        initialized_arrays[array] = [0] * count
    return initialized_arrays

def calculate_bit(nb_values, bit=5.5, reverse=False):
    """정식 N/B Wave BIT 계산 함수 (25개 배열 사용)"""
    if len(nb_values) < 2:
        return bit / 100
    
    BIT_NB = bit
    max_val = max(nb_values)
    min_val = min(nb_values)
    COUNT = 25  # 25개 배열 사용
    CONT = 20
    range_val = max_val - min_val
    
    # 음수와 양수 범위를 구분하여 증분 계산
    negative_range = abs(min_val) if min_val < 0 else 0
    positive_range = max_val if max_val > 0 else 0
    negative_increment = negative_range / (COUNT * len(nb_values) - 1) if negative_range > 0 else 0
    positive_increment = positive_range / (COUNT * len(nb_values) - 1) if positive_range > 0 else 0
    
    arrays = initialize_arrays(COUNT * len(nb_values))
    count = 0
    total_sum = 0
    
    for value in nb_values:
        for i in range(COUNT):
            BIT_END = 1
            
            # 부호에 따른 A50, B50 계산
            if value < 0:
                A50 = min_val + negative_increment * (count + 1)
            else:
                A50 = min_val + positive_increment * (count + 1)
            
            A100 = (count + 1) * BIT_NB / (COUNT * len(nb_values))
            
            if value < 0:
                B50 = A50 - negative_increment * 2
                B100 = A50 + negative_increment
            else:
                B50 = A50 - positive_increment * 2
                B100 = A50 + positive_increment
            
            NBA100 = A100 / (len(nb_values) - BIT_END)
            
            arrays['BIT_START_A50'][count] = A50
            arrays['BIT_START_A100'][count] = A100
            arrays['BIT_START_B50'][count] = B50
            arrays['BIT_START_B100'][count] = B100
            arrays['BIT_START_NBA100'][count] = NBA100
            count += 1
        total_sum += value
    
    # Reverse 옵션 처리 (시간 역방향 흐름 분석)
    if reverse:
        arrays['BIT_START_NBA100'].reverse()
    
    # NB50 계산 (시간 흐름 기반 가중치 분석)
    NB50 = 0
    for value in nb_values:
        for a in range(len(arrays['BIT_START_NBA100'])):
            if (arrays['BIT_START_B50'][a] <= value and 
                arrays['BIT_START_B100'][a] >= value):
                NB50 += arrays['BIT_START_NBA100'][min(a, len(arrays['BIT_START_NBA100']) - 1)]
                break
    
    # 시간 흐름의 상한치(MAX)와 하한치(MIN) 보정
    if len(nb_values) == 2:
        return bit - NB50  # NB 분석 점수가 작을수록 시간 흐름 안정성이 높음
    
    return NB50

def _compute_r_from_ohlcv(df: pd.DataFrame, window: int) -> pd.Series:
    """최적화된 N/B Wave 계산 - 벡터화 연산"""
    if df is None or len(df) == 0:
        return pd.Series(dtype=float)
    
    window = int(window)
    
    # 1. EMA 60 한 번만 계산
    close_values = pd.to_numeric(df['close'], errors='coerce')
    if close_values.isna().all():
        return pd.Series(0.5, index=df.index)
    
    ema_60 = close_values.ewm(span=60, adjust=False).mean()
    
    # 2. 벡터화된 변화율 계산
    ema_changes = ema_60.pct_change().fillna(0).values
    
    # 3. Rolling mean으로 최적화 (반복문 대신 Pandas 사용)
    nb_values = pd.Series(ema_changes).rolling(window=window, min_periods=1).mean().values
    
    # 4. 간단한 R값 계산 (최적화된 버전)
    r_values = 0.5 + np.clip(nb_values * 10, -0.5, 0.5)  # 0~1 범위로 정규화
    
    result = pd.Series(r_values, index=df.index)
    return result


def _simulate_pnl_from_r(prices: pd.Series, r: pd.Series, buy_th: float, sell_th: float,
                         debounce: int = 0, fee_bps: float = 0.0) -> dict:
    pos = 0
    entry = 0.0
    pnl = 0.0
    wins = 0
    trades = 0
    peak = 0.0
    maxdd = 0.0
    last_sig_idx = -10**9
    for i, (p, rv) in enumerate(zip(prices.values, r.values)):
        if pos == 0 and rv >= buy_th and (i - last_sig_idx) >= debounce:
            pos = 1
            entry = float(p)
            trades += 1
            last_sig_idx = i
        elif pos == 1 and rv <= sell_th and (i - last_sig_idx) >= debounce:
            ret = float(p) - entry
            # apply fee (approx market in/out)
            ret -= abs(entry) * (fee_bps / 10000.0)
            ret -= abs(p) * (fee_bps / 10000.0)
            pnl += ret
            if ret > 0:
                wins += 1
            pos = 0
            entry = 0.0
            last_sig_idx = i
        peak = max(peak, pnl)
        maxdd = max(maxdd, peak - pnl)
    # close at last
    if pos == 1:
        p = float(prices.iloc[-1])
        ret = p - entry
        ret -= abs(entry) * (fee_bps / 10000.0)
        ret -= abs(p) * (fee_bps / 10000.0)
        pnl += ret
        if ret > 0:
            wins += 1
        pos = 0
    win_rate = (wins / trades * 100.0) if trades else 0.0
    return {
        'pnl': float(pnl),
        'trades': trades,
        'wins': wins,
        'win_rate': win_rate,
        'max_dd': float(maxdd),
    }


@app.route('/api/nb/optimize', methods=['POST'])
def api_nb_optimize():
    """Grid-search NB thresholds to maximize PnL on recent OHLCV.
    Body JSON: { window: int, buy: [start, stop, step], sell: [start, stop, step], debounce: int, fee_bps: float, count: int, interval: str }
    """
    try:
        payload = request.get_json(force=True) if request.is_json else {}
        window = int(payload.get('window', 50))
        buy_grid = payload.get('buy', [0.6, 0.85, 0.02])
        sell_grid = payload.get('sell', [0.15, 0.45, 0.02])
        debounce = int(payload.get('debounce', 6))
        fee_bps = float(payload.get('fee_bps', 10.0))  # 0.1%
        count = int(payload.get('count', 600))
        interval = payload.get('interval') or load_config().candle

        cfg = load_config()
        df = get_candles(cfg.market, interval, count=count)
        if not {'open','high','low','close'}.issubset(df.columns):
            return jsonify({'ok': False, 'error': 'OHLCV missing', 'data': {}}), 400
        r = _compute_r_from_ohlcv(df, window)
        prices = df['close']

        b_start, b_stop, b_step = buy_grid
        s_start, s_stop, s_step = sell_grid
        best = None
        best_stats = None
        b = b_start
        while b <= b_stop + 1e-9:
            s = s_start
            while s <= s_stop + 1e-9:
                stats = _simulate_pnl_from_r(prices, r, b, s, debounce=debounce, fee_bps=fee_bps)
                if best is None or stats['pnl'] > best_stats['pnl']:
                    best = {'buy': round(b, 3), 'sell': round(s, 3)}
                    best_stats = stats
                s += s_step
            b += b_step

        # persist best and respond
        if best:
            save_nb_params({ 'buy': best['buy'], 'sell': best['sell'], 'window': window })
        return jsonify({'ok': True, 'best': best, 'stats': best_stats, 'saved': bool(best)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/nb/zone')
def api_nb_zone():
    """Return current NB r and zone. Optional query params:
    - r: float (if provided, use this r directly)
    - interval: str (default: config.candle)
    - count: int (default: 300)
    - window: int (default: saved nb_params.window)
    """
    try:
        # thresholds: prefer env, else defaults
        try:
            HIGH = float(os.getenv('NB_HIGH', '0.55'))
            LOW = float(os.getenv('NB_LOW', '0.45'))
        except Exception:
            HIGH, LOW = 0.55, 0.45
        rng = max(1e-9, HIGH - LOW)

        q = request.args
        r_q = q.get('r')
        if r_q is not None:
            rv = float(r_q)
            interval = q.get('interval') or state.get('candle') or load_config().candle
            window = int(q.get('window') or load_nb_params().get('window', 50))
        else:
            cfg = load_config()
            interval = q.get('interval') or state.get('candle') or cfg.candle
            count = int(q.get('count') or 300)
            window = int(q.get('window') or load_nb_params().get('window', 50))
            df = get_candles(cfg.market, interval, count=count)
            r_series = _compute_r_from_ohlcv(df, window)
            rv = float(r_series.iloc[-1]) if len(r_series) else 0.5
        p_blue_raw = max(0.0, min(1.0, (HIGH - rv) / rng))
        p_orange_raw = max(0.0, min(1.0, (rv - LOW) / rng))
        s0 = p_blue_raw + p_orange_raw
        if s0 > 0:
            p_blue_raw, p_orange_raw = p_blue_raw/s0, p_orange_raw/s0
        # Optional trend weighting when data available
        p_blue, p_orange = p_blue_raw, p_orange_raw
        try:
            trend_k = int(os.getenv('NB_TREND_K', '30'))
            trend_alpha = float(os.getenv('NB_TREND_ALPHA', '0.5'))
        except Exception:
            trend_k, trend_alpha = 30, 0.5
        if r_q is None:
            try:
                r_series = _compute_r_from_ohlcv(df, window).astype(float)
                if len(r_series) >= trend_k*2:
                    tail_now = r_series.iloc[-trend_k:]
                    tail_prev = r_series.iloc[-trend_k*2:-trend_k]
                    zmax_now, zmax_prev = float(tail_now.max()), float(tail_prev.max())
                    zmin_now, zmin_prev = float(tail_now.min()), float(tail_prev.min())
                    trend_orange = max(0.0, (zmax_prev - zmax_now) / rng)
                    trend_blue = max(0.0, (zmin_now - zmin_prev) / rng)
                    p_orange = max(0.0, min(1.0, p_orange_raw * (1.0 - trend_alpha * trend_orange)))
                    p_blue = max(0.0, min(1.0, p_blue_raw * (1.0 - trend_alpha * trend_blue)))
                    s = p_blue + p_orange
                    if s > 0:
                        p_blue, p_orange = p_blue/s, p_orange/s
            except Exception:
                pass
        zone = 'ORANGE' if rv >= 0.5 else 'BLUE'
        return jsonify({
            'ok': True,
            'interval': interval,
            'window': window,
            'r': float(rv),
            'zone': zone,
            'pct_blue_raw': float(p_blue_raw*100.0),
            'pct_orange_raw': float(p_orange_raw*100.0),
            'pct_blue': float(p_blue*100.0),
            'pct_orange': float(p_orange*100.0),
            'high': float(HIGH),
            'low': float(LOW),
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/nb-wave-ohlcv')
def api_nb_wave_ohlcv():
    """Return NB wave data computed from OHLCV data using modular calculation.
    This is the refactored version that uses helpers.nb_wave module.
    Query params:
    - timeframe: str (default: config.candle)
    - count: int (default: 300)
    - window: int (default: 50)
    """
    try:
        from helpers.nb_wave import compute_nb_wave_from_ohlcv
        
        cfg = load_config()
        timeframe = request.args.get('timeframe') or cfg.candle
        count = int(request.args.get('count', 300))
        window = int(request.args.get('window', 50))
        
        # Get OHLCV data
        df = get_candles(cfg.market, timeframe, count=count)
        if df.empty or not {'open','high','low','close','volume'}.issubset(df.columns):
            return jsonify({'ok': False, 'error': 'OHLCV data missing'}), 400
        
        # Convert DataFrame to list of dicts for the module
        ohlcv_rows = []
        for idx, row in df.iterrows():
            timestamp_ms = int(idx.timestamp() * 1000)  # Convert to milliseconds
            ohlcv_rows.append({
                'time': timestamp_ms,
                'open': float(row['open']),
                'high': float(row['high']),
                'low': float(row['low']),
                'close': float(row['close']),
                'volume': float(row.get('volume', 0))
            })
        
        # Compute wave using the module
        result = compute_nb_wave_from_ohlcv(ohlcv_rows, window)
        
        if not result['ok']:
            return jsonify(result), 400
        
        return jsonify({
            'ok': True,
            'wave_data': result['wave_data'],
            'base': result['base'],
            'summary': result['summary'],
            'timeframe': timeframe,
            'window': result['window'],
            'calculation_method': 'modular_nb_wave'
        })
        
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/nb-wave')
def api_nb_wave():
    """Return NB wave data for charting using official BIT calculation. Query params:
    - timeframe: str (default: config.candle)
    - bars: int (default: 120)
    - window: int (default: saved nb_params.window)
    """
    try:
        cfg = load_config()
        timeframe = request.args.get('timeframe') or cfg.candle
        bars = int(request.args.get('bars') or 120)
        window = int(request.args.get('window') or load_nb_params().get('window', 50))
        
        # Get OHLCV data
        df = get_candles(cfg.market, timeframe, count=bars)
        if not {'open','high','low','close'}.issubset(df.columns):
            return jsonify({'ok': False, 'error': 'OHLCV missing'}), 400
        
        # Compute r values using official BIT calculation
        r_series = _compute_r_from_ohlcv(df, window)
        
        # Get thresholds
        try:
            HIGH = float(os.getenv('NB_HIGH', '0.55'))
            LOW = float(os.getenv('NB_LOW', '0.45'))
        except Exception:
            HIGH, LOW = 0.55, 0.45
        
        # Create zones data with enhanced BIT information
        zones = []
        labels = []
        
        for i, (timestamp, r_val) in enumerate(zip(df.index, r_series)):
            r_val = float(r_val)
            
            # Determine zone using official BIT calculation
            # NB-MAX 값이 NB-MIN 값보다 크면 BLUE, 반대면 ORANGE
            if i >= window - 1:
                # Get window data for BIT calculation
                window_data = df.iloc[i-window+1:i+1]
                price_changes = []
                
                for j in range(1, len(window_data)):
                    prev_close = window_data.iloc[j-1]['close']
                    curr_close = window_data.iloc[j]['close']
                    change = (curr_close - prev_close) / prev_close
                    price_changes.append(change)
                
                if price_changes:
                    nb_values = price_changes
                    max_bit = BIT_MAX_NB(nb_values)
                    min_bit = BIT_MIN_NB(nb_values)
                    
                    # NB-MAX 값이 NB-MIN 값보다 크면 BLUE, 반대면 ORANGE
                    if max_bit > min_bit:
                        zone = 'BLUE'
                    else:
                        zone = 'ORANGE'
                else:
                    zone = 'BLUE'  # 기본값
            else:
                zone = 'BLUE'  # 기본값
            
            # Calculate strength (distance from neutral)
            strength = abs(r_val - 0.5) * 2  # 0 to 1
            
            # Calculate volume (use close price as proxy)
            volume = float(df['close'].iloc[i]) if i < len(df) else 0
            
            # Use the BIT values already calculated for zone determination
            if i >= window - 1:
                # Get window data for BIT calculation
                window_data = df.iloc[i-window+1:i+1]
                price_changes = []
                
                for j in range(1, len(window_data)):
                    prev_close = window_data.iloc[j-1]['close']
                    curr_close = window_data.iloc[j]['close']
                    change = (curr_close - prev_close) / prev_close
                    price_changes.append(change)
                
                if price_changes:
                    nb_values = price_changes
                    max_bit = BIT_MAX_NB(nb_values)
                    min_bit = BIT_MIN_NB(nb_values)
                else:
                    max_bit = 5.5
                    min_bit = 5.5
            else:
                max_bit = 5.5
                min_bit = 5.5
            
            zones.append({
                'zone': zone,
                'strength': strength,
                'volume': volume,
                'r_value': r_val,
                'max_bit': max_bit,
                'min_bit': min_bit,
                'bit_diff': max_bit - min_bit
            })
            
            # Create time labels
            if i % 20 == 0 or i == len(df) - 1:  # Show every 20th label
                labels.append(timestamp.strftime('%H:%M'))
            else:
                labels.append('')
        
        # Calculate summary with BIT statistics
        orange_count = sum(1 for z in zones if z['zone'] == 'ORANGE')
        blue_count = sum(1 for z in zones if z['zone'] == 'BLUE')
        current_price = float(df['close'].iloc[-1]) if len(df) > 0 else 0
        
        # Calculate average BIT values
        avg_max_bit = np.mean([z['max_bit'] for z in zones if z['max_bit'] != 5.5])
        avg_min_bit = np.mean([z['min_bit'] for z in zones if z['min_bit'] != 5.5])
        avg_bit_diff = np.mean([z['bit_diff'] for z in zones if z['bit_diff'] != 0])
        
        summary = {
            'orange': orange_count,
            'blue': blue_count,
            'current_price': current_price,
            'total_bars': len(zones),
            'avg_max_bit': float(avg_max_bit) if not np.isnan(avg_max_bit) else 5.5,
            'avg_min_bit': float(avg_min_bit) if not np.isnan(avg_min_bit) else 5.5,
            'avg_bit_diff': float(avg_bit_diff) if not np.isnan(avg_bit_diff) else 0.0
        }
        
        return jsonify({
            'ok': True,
            'zones': zones,
            'labels': labels,
            'summary': summary,
            'timeframe': timeframe,
            'window': window,  # 실제 사용된 window 값
            'high_threshold': HIGH,
            'low_threshold': LOW,
            'calculation_method': 'official_bit_25_arrays',
            'random_bit_used': 5.5 + (window % 95) * 0.5  # 실제 사용된 랜덤 BIT 값
        })
        
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/nb/group', methods=['POST'])
def api_nb_group():
    """Group multiple intervals at the current time and return per-interval NB stats and a consensus.
    Body JSON (all optional):
      - intervals: ["minute1","minute3","minute5","minute10"]
      - window: int (default saved nb_params.window)
      - weights: { interval: number }
      - tolerance_sec: number (default: interval length in sec)
    """
    try:
        payload = request.get_json(force=True) if request.is_json else {}
        try:
            HIGH = float(os.getenv('NB_HIGH', '0.55'))
            LOW = float(os.getenv('NB_LOW', '0.45'))
        except Exception:
            HIGH, LOW = 0.55, 0.45
        rng = max(1e-9, HIGH - LOW)
        def interval_seconds(iv: str) -> int:
            if iv.startswith('minute'):
                try:
                    m = int(iv.replace('minute',''))
                except Exception:
                    m = 1
                return max(60, m*60)
            if iv == 'day':
                return 24*60*60
            if iv == 'minute60':
                return 60*60
            return 600
        cfg = load_config()
        intervals = payload.get('intervals') or ['minute1','minute3','minute5','minute10']
        base_window = int(payload.get('window', load_nb_params().get('window', 50)))
        weights = payload.get('weights') or { iv: max(1, interval_seconds(iv)//60) for iv in intervals }
        tol_sec = int(payload.get('tolerance_sec', 0))  # per-interval fallback below
        now = int(time.time())
        rows = []
        w_sum = 0.0
        blue_sum = 0.0
        orange_sum = 0.0
        for iv in intervals:
            try:
                sec = interval_seconds(iv)
                tol = tol_sec if tol_sec>0 else sec
                df = get_candles(cfg.market, iv, count=max(200, base_window*3))
                if df is None or df.empty:
                    continue
                ts_ms = int(df.index[-1].timestamp()*1000)
                ts_s = ts_ms//1000
                if abs(now - ts_s) > tol:
                    # skip very stale bars
                    continue
                r_series = _compute_r_from_ohlcv(df, base_window)
                rv = float(r_series.iloc[-1]) if len(r_series) else 0.5
                p_blue_raw = max(0.0, min(1.0, (HIGH - rv) / rng))
                p_orange_raw = max(0.0, min(1.0, (rv - LOW) / rng))
                s0 = p_blue_raw + p_orange_raw
                if s0>0:
                    p_blue_raw, p_orange_raw = p_blue_raw/s0, p_orange_raw/s0
                z = 'ORANGE' if rv >= 0.5 else 'BLUE'
                w = float(weights.get(iv, 1.0))
                w_sum += w
                blue_sum += w * p_blue_raw
                orange_sum += w * p_orange_raw
                rows.append({
                    'interval': iv,
                    'time_ms': ts_ms,
                    'r': rv,
                    'zone': z,
                    'pct_blue_raw': float(p_blue_raw*100.0),
                    'pct_orange_raw': float(p_orange_raw*100.0),
                    'weight': w,
                })
            except Exception:
                continue
        consensus = {
            'pct_blue': float(blue_sum/w_sum*100.0) if w_sum>0 else 0.0,
            'pct_orange': float(orange_sum/w_sum*100.0) if w_sum>0 else 0.0,
            'count': len(rows),
        }
        return jsonify({ 'ok': True, 'intervals': intervals, 'window': base_window, 'items': rows, 'consensus': consensus })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/nb/train', methods=['POST'])
def api_nb_train():
    """Auto period split training (grid search per segment) and persist best.
    Body JSON: { count: int(1800), segments: int(3), window: int, debounce: int, fee_bps: float, interval: str }
    """
    try:
        payload = request.get_json(force=True) if request.is_json else {}
        count = int(payload.get('count', 1800))
        segments = max(1, int(payload.get('segments', 3)))
        window = int(payload.get('window', load_nb_params().get('window', 50)))
        debounce = int(payload.get('debounce', 6))
        fee_bps = float(payload.get('fee_bps', 10.0))
        interval = payload.get('interval') or load_config().candle

        cfg = load_config()
        df = get_candles(cfg.market, interval, count=count)
        if len(df) < max(window*2, segments*50):
            return jsonify({'ok': False, 'error': 'Not enough data'}), 400
        r_all = _compute_r_from_ohlcv(df, window)
        prices_all = df['close']

        seg_len = len(df) // segments
        results = []
        def search_best(prices: pd.Series, r: pd.Series):
            best=None; best_stats=None
            b=0.6
            while b<=0.85+1e-9:
                s=0.15
                while s<=0.45+1e-9:
                    st = _simulate_pnl_from_r(prices, r, b, s, debounce=debounce, fee_bps=fee_bps)
                    if best is None or st['pnl']>best_stats['pnl']:
                        best={'buy':round(b,3),'sell':round(s,3)}; best_stats=st
                    s+=0.02
                b+=0.02
            return best, best_stats

        for i in range(segments):
            start = i*seg_len
            end = (i+1)*seg_len if i<segments-1 else len(df)
            r_seg = r_all.iloc[start:end]
            p_seg = prices_all.iloc[start:end]
            best, stats = search_best(p_seg, r_seg)
            results.append({'segment': i+1, 'start': int(df.index[start].timestamp()*1000), 'end': int(df.index[end-1].timestamp()*1000), 'best': best, 'stats': stats})

        # choose best by highest pnl; fallback to last segment if tie
        results_sorted = sorted(results, key=lambda x: x['stats']['pnl'], reverse=True)
        chosen = results_sorted[0]
        save_nb_params({ 'buy': chosen['best']['buy'], 'sell': chosen['best']['sell'], 'window': window })
        return jsonify({'ok': True, 'chosen': chosen, 'results': results, 'saved': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/nb/params', methods=['GET', 'POST'])
def api_nb_params():
    try:
        if request.method == 'GET':
            return jsonify({ 'ok': True, 'params': load_nb_params() })
        # POST to manually set/override
        payload = request.get_json(force=True)
        p = load_nb_params()
        for k in ('buy','sell','window'):
            if k in payload:
                p[k] = payload[k]
        ok = save_nb_params(p)
        return jsonify({ 'ok': ok, 'params': p })
    except Exception as e:
        return jsonify({ 'ok': False, 'error': str(e)}), 500


def nb_auto_opt_loop():
    """Background auto-optimizer: periodically updates NB parameters."""
    while True:
        try:
            cfg = load_config()
            # quick grid for development
            payload = {
                'window': load_nb_params().get('window', 50),
                'buy': [0.6, 0.85, 0.025],
                'sell': [0.15, 0.45, 0.025],
                'debounce': 6,
                'fee_bps': 10.0,
                'count': 800,
                'interval': state.get('candle') or cfg.candle,
            }
            # run optimize inline
            try:
                # reuse internal helpers
                df = get_candles(cfg.market, payload['interval'], count=payload['count'])
                r = _compute_r_from_ohlcv(df, payload['window'])
                prices = df['close']
                best=None; best_stats=None
                b=payload['buy'][0]
                while b <= payload['buy'][1] + 1e-9:
                    s=payload['sell'][0]
                    while s <= payload['sell'][1] + 1e-9:
                        stats = _simulate_pnl_from_r(prices, r, b, s, debounce=payload['debounce'], fee_bps=payload['fee_bps'])
                        if best is None or stats['pnl'] > best_stats['pnl']:
                            best={'buy': round(b,3), 'sell': round(s,3)}; best_stats=stats
                        s += payload['sell'][2]
                    b += payload['buy'][2]
                if best:
                    save_nb_params({ 'buy': best['buy'], 'sell': best['sell'], 'window': payload['window'] })
            except Exception:
                pass
        finally:
            # sleep (dev: 10 minutes; configurable via NB_OPT_MIN env)
            mins = int(os.getenv('NB_OPT_MIN', '10'))
            time.sleep(max(60, mins*60))

def auto_scheduler_loop():
    """완전 자동화 스케줄러: 모든 기능을 자동으로 실행"""
    import time
    from datetime import datetime
    
    # 자동화 설정
    AUTO_ML_TRAIN_INTERVAL = int(os.getenv('AUTO_ML_TRAIN_INTERVAL', '3600'))  # 1시간
    AUTO_OPTIMIZE_INTERVAL = int(os.getenv('AUTO_OPTIMIZE_INTERVAL', '1800'))  # 30분
    AUTO_BACKTEST_INTERVAL = int(os.getenv('AUTO_BACKTEST_INTERVAL', '7200'))  # 2시간
    
    last_ml_train = 0
    last_optimize = 0
    last_backtest = 0
    
    print("[AUTO] 자동화 스케줄러 시작됨")
    print(f"[AUTO] ML 학습 간격: {AUTO_ML_TRAIN_INTERVAL}초")
    print(f"[AUTO] 최적화 간격: {AUTO_OPTIMIZE_INTERVAL}초")
    print(f"[AUTO] 백테스트 간격: {AUTO_BACKTEST_INTERVAL}초")
    
    while True:
        try:
            now = time.time()
            cfg = load_config()
            
            # 1. ML 자동 학습
            if now - last_ml_train >= AUTO_ML_TRAIN_INTERVAL:
                try:
                    print(f"[AUTO] ML 자동 학습 시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
                    intervals = ['minute1', 'minute3', 'minute5', 'minute10', 'minute15', 'minute30', 'minute60']
                    for interval in intervals:
                        try:
                            # ML 학습 실행
                            payload = {
                                'window': load_nb_params().get('window', 50),
                                'ema_fast': 10,
                                'ema_slow': 30,
                                'horizon': 5,
                                'tau': 0.002,
                                'count': 1800,
                                'interval': interval,
                                'label_mode': 'zone'
                            }
                            # 내부 함수 직접 호출
                            df = get_candles(cfg.market, interval, count=payload['count'])
                            if df is None or len(df) < 100:
                                print(f"[AUTO] {interval}: 데이터 부족 (필요: 100+, 현재: {len(df) if df is not None else 0})")
                                continue
                            
                            window = payload['window']
                            ema_fast = payload['ema_fast']
                            ema_slow = payload['ema_slow']
                            horizon = payload['horizon']
                            feat = _build_features(df, window, ema_fast, ema_slow, horizon)
                            
                            # NaN 제거 (fwd 컬럼 기준)
                            if 'fwd' not in feat.columns:
                                print(f"[AUTO] {interval}: fwd 컬럼 없음 (컬럼: {list(feat.columns)})")
                                continue
                            
                            feat = feat.dropna(subset=['fwd']).copy()
                            if len(feat) < 100:
                                print(f"[AUTO] {interval}: 유효 데이터 부족 (필요: 100+, 현재: {len(feat)})")
                                continue
                            
                            # Zone 레이블 생성 (다양한 임계값 사용으로 클래스 다양성 확보)
                            r = _compute_r_from_ohlcv(df, window)
                            HIGH = float(os.getenv('NB_HIGH', '0.55'))
                            LOW = float(os.getenv('NB_LOW', '0.45'))
                            
                            # feat 인덱스와 일치하는 r만 사용
                            if len(r) != len(df):
                                print(f"[AUTO] {interval}: r 길이 불일치 (r: {len(r)}, df: {len(df)})")
                                continue
                            
                            # r과 feat의 인덱스를 맞춰서 추출
                            r_aligned = r.loc[feat.index]
                            
                            # r 값 분포 확인 (디버깅)
                            r_min, r_max, r_mean = float(r_aligned.min()), float(r_aligned.max()), float(r_aligned.mean())
                            print(f"[AUTO] {interval}: r 분포 - min={r_min:.4f}, max={r_max:.4f}, mean={r_mean:.4f}")
                            
                            # 더 넓은 범위로 zone 분류 (클래스 다양성 확보)
                            # BLUE(1): r < 0.48, HOLD(0): 0.48 <= r < 0.52, ORANGE(-1): r >= 0.52
                            HIGH_WIDE = 0.52
                            LOW_WIDE = 0.48
                            
                            zone = np.where(
                                r_aligned >= HIGH_WIDE, -1,  # ORANGE
                                np.where(r_aligned <= LOW_WIDE, 1, 0)  # BLUE or HOLD
                            )
                            
                            # 특성 준비 - close, high, low 제외 및 fwd 제거
                            feature_cols = [c for c in feat.columns if c not in ['close', 'high', 'low', 'fwd']]
                            if len(feature_cols) == 0:
                                print(f"[AUTO] {interval}: 사용 가능한 특성 없음")
                                continue
                            
                            X_raw = feat[feature_cols].values
                            y_raw = zone  # zone은 이미 numpy array
                            
                            # ⚠️ NaN 처리 - 매우 중요!
                            # NaN이 포함된 행 제거
                            valid_mask = ~np.isnan(X_raw).any(axis=1)
                            X = X_raw[valid_mask]
                            y = y_raw[valid_mask]
                            
                            print(f"[AUTO] {interval}: NaN 제거 전 X.shape={X_raw.shape} → 제거 후 X.shape={X.shape}")
                            
                            if X.shape[0] < 50:
                                print(f"[AUTO] {interval}: NaN 제거 후 데이터 부족 (필요: 50+, 현재: {X.shape[0]})")
                                continue
                            
                            print(f"[AUTO] {interval}: X.shape={X.shape}, y.shape={y.shape}, classes={np.unique(y)}")
                            
                            # 클래스 검증 및 데이터 증강
                            unique_classes = np.unique(y)
                            if len(unique_classes) < 2:
                                print(f"[AUTO] {interval}: 클래스 부족 (필요: 2+, 현재: {len(unique_classes)}, 값: {unique_classes})")
                                # 클래스 불균형 해결 시도: 백분위수 기반 동적 임계값
                                try:
                                    # r 값의 33%ile과 67%ile를 임계값으로 사용
                                    low_percentile = np.percentile(r_aligned, 33)
                                    high_percentile = np.percentile(r_aligned, 67)
                                    
                                    print(f"[AUTO] {interval}: 동적 임계값 - low={low_percentile:.4f}, high={high_percentile:.4f}")
                                    
                                    zone_dynamic = np.where(
                                        r_aligned >= high_percentile, -1,
                                        np.where(r_aligned <= low_percentile, 1, 0)
                                    )
                                    unique_dynamic = np.unique(zone_dynamic)
                                    if len(unique_dynamic) >= 2:
                                        print(f"[AUTO] {interval}: 동적 임계값 적용 성공 (classes: {unique_dynamic}))")
                                        y = zone_dynamic
                                        unique_classes = unique_dynamic
                                    else:
                                        print(f"[AUTO] {interval}: 데이터 증강 실패 - 학습 스킵")
                                        continue
                                except Exception as aug_err:
                                    print(f"[AUTO] {interval}: 데이터 증강 오류: {aug_err}")
                                    continue
                            
                            if len(X) > 100 and X.shape[1] > 0 and len(unique_classes) > 1:
                                from sklearn.ensemble import GradientBoostingClassifier
                                from sklearn.model_selection import TimeSeriesSplit
                                clf = GradientBoostingClassifier(n_estimators=100, max_depth=5, random_state=42)
                                tscv = TimeSeriesSplit(n_splits=3)
                                scores = []
                                for train_idx, test_idx in tscv.split(X):
                                    X_train, X_test = X[train_idx], X[test_idx]
                                    y_train, y_test = y[train_idx], y[test_idx]
                                    clf.fit(X_train, y_train)
                                    scores.append(clf.score(X_test, y_test))
                                if np.mean(scores) > 0.5:
                                    model_path = f"models/nb_ml_{interval}.pkl"
                                    os.makedirs('models', exist_ok=True)
                                    joblib.dump(clf, model_path)
                                    print(f"[AUTO] ML 모델 저장됨: {model_path} (정확도: {np.mean(scores):.3f})")
                        except Exception as e:
                            print(f"[AUTO] ML 학습 오류 ({interval}): {e}")
                    last_ml_train = now
                    print(f"[AUTO] ML 자동 학습 완료")
                except Exception as e:
                    print(f"[AUTO] ML 자동 학습 오류: {e}")
            
            # 2. 최적화 자동 실행
            if now - last_optimize >= AUTO_OPTIMIZE_INTERVAL:
                try:
                    print(f"[AUTO] 최적화 자동 실행 시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
                    payload = {
                        'window': load_nb_params().get('window', 50),
                        'buy': [0.6, 0.85, 0.025],
                        'sell': [0.15, 0.45, 0.025],
                        'debounce': 6,
                        'fee_bps': 10.0,
                        'count': 800,
                        'interval': cfg.candle,
                    }
                    df = get_candles(cfg.market, payload['interval'], count=payload['count'])
                    r = _compute_r_from_ohlcv(df, payload['window'])
                    prices = df['close']
                    best = None
                    best_stats = None
                    b = payload['buy'][0]
                    while b <= payload['buy'][1] + 1e-9:
                        s = payload['sell'][0]
                        while s <= payload['sell'][1] + 1e-9:
                            stats = _simulate_pnl_from_r(prices, r, b, s, debounce=payload['debounce'], fee_bps=payload['fee_bps'])
                            if best is None or stats['pnl'] > best_stats['pnl']:
                                best = {'buy': round(b, 3), 'sell': round(s, 3)}
                                best_stats = stats
                            s += payload['sell'][2]
                        b += payload['buy'][2]
                    if best:
                        save_nb_params({'buy': best['buy'], 'sell': best['sell'], 'window': payload['window']})
                        print(f"[AUTO] 최적화 완료: buy={best['buy']}, sell={best['sell']}, PnL={best_stats['pnl']:.0f}")
                    last_optimize = now
                except Exception as e:
                    print(f"[AUTO] 최적화 오류: {e}")
            
            # 3. 백테스트 자동 실행 (간격이 더 김)
            if now - last_backtest >= AUTO_BACKTEST_INTERVAL:
                try:
                    print(f"[AUTO] 백테스트 자동 실행 시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
                    # 백테스트는 내부적으로 실행되므로 여기서는 로그만 남김
                    # 실제 백테스트는 trade_loop에서 자동으로 실행됨
                    last_backtest = now
                    print(f"[AUTO] 백테스트 완료")
                except Exception as e:
                    print(f"[AUTO] 백테스트 오류: {e}")
            
            # 1분마다 체크
            time.sleep(60)
            
        except Exception as e:
            print(f"[AUTO] 스케줄러 오류: {e}")
            time.sleep(60)

@app.route('/api/balance')
def api_balance():
    """Return Upbit balances (requires API keys and PAPER=false).
    Uses runtime-resolved config so UI Paper toggle takes effect.
    개선된 버전: 표준 응답 형식 및 에러 처리 사용
    """
    try:
        cfg = _resolve_config()
        if cfg.paper:
            return success_response({
                'paper': True,
                'balances': []
            })
        
        # Prefer standard keys from config; otherwise support UPBIT_OPEN_API_* env style (JWT direct call)
        bals = None
        std_ak, std_sk, open_ak, open_sk = _get_runtime_keys()
        
        if std_ak and std_sk:
            try:
                up = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
                bals = up.get_balances()
            except Exception as e:
                logger.error(f"Error getting balances via standard API: {e}", exc_info=True)
                raise ExternalApiError(f"Failed to fetch balances: {str(e)}")
        else:
            # Try JWT-based private API using env: UPBIT_OPEN_API_ACCESS_KEY, UPBIT_OPEN_API_SECRET_KEY
            ak = open_ak or std_ak
            sk = open_sk or std_sk
            server_url = config.upbit.open_api_server_url
            
            if not ak or not sk:
                raise ValidationError("Missing API keys", details={'has_std_keys': bool(std_ak and std_sk), 'has_open_keys': bool(open_ak and open_sk)})
            
            try:
                import jwt as pyjwt  # type: ignore
            except ImportError:
                raise InternalServerError("PyJWT not installed. Install with: pip install PyJWT")
            
            try:
                payload = {
                    'access_key': ak,
                    'nonce': str(uuid.uuid4()),
                }
                token = pyjwt.encode(payload, sk, algorithm='HS256')
                headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/json'}
                resp = requests.get(server_url.rstrip('/') + '/v1/accounts', headers=headers, timeout=10)
                
                if resp.status_code >= 400:
                    raise ExternalApiError(
                        f"Upbit API error: HTTP {resp.status_code}",
                        status_code=503,
                        details={'upbit_status': resp.status_code, 'body': resp.text[:200]}
                    )
                
                bals = resp.json()
            except requests.RequestException as e:
                logger.error(f"Error connecting to Upbit API: {e}", exc_info=True)
                raise ExternalApiError(f"Failed to connect to Upbit API: {str(e)}")
            except Exception as e:
                logger.error(f"Error parsing Upbit API response: {e}", exc_info=True)
                raise ExternalApiError(f"Invalid response from Upbit API: {str(e)}")
        
        # 데이터 정리 및 보강
        cleaned = []
        for b in (bals or []):
            try:
                cleaned.append({
                    'currency': b.get('currency'),
                    'balance': float(b.get('balance', 0) or 0),
                    'locked': float(b.get('locked', 0) or 0),
                    'avg_buy_price': float(b.get('avg_buy_price', 0) or 0),
                    'unit_currency': b.get('unit_currency', 'KRW'),
                })
            except Exception as e:
                logger.warning(f"Error processing balance entry: {e}")
                continue
        
        # 현재 가격으로 자산 가치 계산
        out = []
        for row in cleaned:
            try:
                cur = (row.get('currency') or '').upper()
                bal = float(row.get('balance') or 0)
                
                if cur == 'KRW':
                    price = 1.0
                    asset_value = bal
                else:
                    try:
                        price = float(pyupbit.get_current_price(f"KRW-{cur}") or 0.0)
                    except Exception as e:
                        logger.warning(f"Error getting price for {cur}: {e}")
                        price = 0.0
                    asset_value = float(bal * price)
                
                row['price'] = price
                row['asset_value'] = asset_value
                out.append(row)
            except Exception as e:
                logger.warning(f"Error enriching balance row: {e}")
                out.append(row)
        
        logger.info(f"Balance fetched successfully: {len(out)} currencies")
        return success_response({
            'paper': False,
            'balances': out
        })
        
    except (ValidationError, ExternalApiError, InternalServerError) as e:
        return handle_exception(e)
    except Exception as e:
        logger.error(f"Unexpected error in api_balance: {e}", exc_info=True)
        return handle_exception(e)


@app.route('/api/bot/config', methods=['POST'])
def api_bot_config():
    try:
        data = request.get_json(force=True)
        # Optional: reload env vars on demand
        if data.get('reload_env'):
            _reload_env_vars()
        ov = bot_ctrl['cfg_override']
        for k in ('paper','order_krw','pnl_ratio','pnl_profit_ratio','pnl_loss_ratio','ema_fast','ema_slow','candle','market','interval_sec','require_ml','enforce_zone_side','nb_force','nb_window','ml_only','ml_seg_only',
                  'access_key','secret_key','open_api_access_key','open_api_secret_key'):
            if k in data:
                ov[k] = data[k]
        # reflect into global state for UI
        cfg = _resolve_config()
        state['ema_fast'] = cfg.ema_fast
        state['ema_slow'] = cfg.ema_slow
        state['market'] = cfg.market
        state['candle'] = cfg.candle
        return jsonify({'ok': True, 'config': {
            'paper': cfg.paper,
            'order_krw': cfg.order_krw,
            'pnl_ratio': float(getattr(cfg, 'pnl_ratio', 0.0)),
            'ema_fast': cfg.ema_fast,
            'ema_slow': cfg.ema_slow,
            'candle': cfg.candle,
            'market': cfg.market,
            'interval_sec': cfg.interval_sec,
            'pnl_profit_ratio': float(getattr(cfg, 'pnl_profit_ratio', 0.0)),
            'pnl_loss_ratio': float(getattr(cfg, 'pnl_loss_ratio', 0.0)),
            'has_keys': bool((_get_runtime_keys()[0] and _get_runtime_keys()[1]) or (_get_runtime_keys()[2] and _get_runtime_keys()[3]))
        }})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400


@app.route('/api/bot/start', methods=['POST'])
def api_bot_start():
    if bot_ctrl['running']:
        return jsonify({'ok': True, 'running': True})
    bot_ctrl['running'] = True
    t = threading.Thread(target=trade_loop, daemon=True)
    bot_ctrl['thread'] = t
    t.start()
    return jsonify({'ok': True, 'running': True})


@app.route('/api/bot/stop', methods=['POST'])
def api_bot_stop():
    bot_ctrl['running'] = False
    return jsonify({'ok': True, 'running': False})


@app.route('/api/trainer/storage', methods=['GET'])
def api_trainer_storage():
    """트레이너별 저장 창고 정보 조회"""
    try:
        trainer = request.args.get('trainer')
        if trainer and trainer in _trainer_storage:
            return jsonify({'ok': True, 'storage': _trainer_storage[trainer]})
        else:
            return jsonify({'ok': True, 'storage': _trainer_storage})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/trainer/storage/modify', methods=['POST'])
def api_trainer_storage_modify():
    """트레이너별 저장 창고 수정 (N/B 길드 NPC 제어)"""
    try:
        data = request.get_json(force=True)
        trainer = data.get('trainer')
        amount = float(data.get('amount', 0.0))
        
        if not trainer or trainer not in ['Scout', 'Guardian', 'Analyst', 'Elder']:
            return jsonify({'ok': False, 'error': 'Invalid trainer name'}), 400
        
        # Get current price for entry price calculation
        current_price = 0.0
        try:
            # Try to get current price from preflight API
            cfg = _resolve_config()
            if cfg.access_key and cfg.secret_key:
                upbit = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
                ticker = upbit.get_ticker(cfg.market)
                if ticker and 'trade_price' in ticker:
                    current_price = float(ticker['trade_price'])
            else:
                # Fallback: try to get from market data
                market_data = _get_market_data()
                if market_data and 'price' in market_data:
                    current_price = float(market_data['price'])
        except Exception as e:
            print(f"Warning: Could not get current price: {e}")
            # Use a fallback price if available
            current_price = 161000000  # fallback price
        
        # Update trainer storage
        if trainer in _trainer_storage:
            current_coins = _trainer_storage[trainer]['coins']
            new_coins = max(0.0, current_coins + amount)  # Prevent negative coins
            
            # Update coins
            _trainer_storage[trainer]['coins'] = new_coins
            
            # Update entry price if adding coins
            if amount > 0 and current_price > 0:
                if current_coins > 0:
                    # Weighted average of existing and new coins
                    total_value = (current_coins * _trainer_storage[trainer]['entry_price']) + (amount * current_price)
                    _trainer_storage[trainer]['entry_price'] = total_value / new_coins
                else:
                    # First time adding coins
                    _trainer_storage[trainer]['entry_price'] = current_price
            
            # Update last update time
            _trainer_storage[trainer]['last_update'] = int(time.time())
            
            # Only save to trade history if it's a real trade (not manual modification)
            if data.get('trade_match') and data.get('trade_match').get('upbit_trade_id'):
                # This is a real trade from Upbit
                trade_record = {
                    'ts': int(time.time() * 1000),  # milliseconds timestamp
                    'action': 'REAL_TRADE',
                    'price': current_price,
                    'size': abs(amount),  # Use 'size' instead of 'amount'
                    'profit': 0.0,
                    'new_balance': new_coins,  # Add new balance for reference
                    'trade_match': data.get('trade_match')
                }
                _trainer_storage[trainer]['trades'].append(trade_record)
                print(f"✅ Real trade saved: {trainer} {abs(amount):.8f} BTC")
            else:
                # This is a manual modification (temporary, not saved to history)
                print(f"⚠️ Manual modification (not saved to history): {trainer} {abs(amount):.8f} BTC")
            
            # Save to file
            _save_trainer_storage()
            
            print(f"✅ Trainer storage modified: {trainer} {amount:+.8f} BTC (new balance: {new_coins:.8f} BTC)")
            
            return jsonify({
                'ok': True, 
                'trainer': trainer,
                'amount': amount,
                'new_balance': new_coins,
                'entry_price': _trainer_storage[trainer]['entry_price']
            })
        else:
            return jsonify({'ok': False, 'error': 'Trainer not found in storage'}), 404
            
    except Exception as e:
        print(f"❌ Error modifying trainer storage: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/trainer/storage/reset', methods=['POST'])
def api_trainer_storage_reset():
    """트레이너별 저장 창고 평균가 초기화"""
    try:
        data = request.get_json(force=True)
        trainer = data.get('trainer')
        
        if not trainer or trainer not in ['Scout', 'Guardian', 'Analyst', 'Elder']:
            return jsonify({'ok': False, 'error': 'Invalid trainer name'}), 400
        
        if trainer in _trainer_storage:
            # 평균가 초기화
            _trainer_storage[trainer]['entry_price'] = 0.0
            _trainer_storage[trainer]['last_update'] = int(time.time())
            
            # Manual price reset is not saved to trade history (temporary only)
            print(f"⚠️ Manual price reset (not saved to history): {trainer}")
            
            # Save to file
            _save_trainer_storage()
            
            print(f"✅ Trainer storage average price reset: {trainer}")
            
            return jsonify({
                'ok': True, 
                'trainer': trainer,
                'entry_price': 0.0
            })
        else:
            return jsonify({'ok': False, 'error': 'Trainer not found in storage'}), 404
            
    except Exception as e:
        print(f"❌ Error resetting trainer storage average price: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/trainer/storage/tick', methods=['POST'])
def api_trainer_storage_tick():
    """트레이너별 저장 창고 틱 조작"""
    try:
        data = request.get_json(force=True)
        trainer = data.get('trainer')
        delta = int(data.get('delta', 0))  # +1 or -1
        
        if not trainer or trainer not in ['Scout', 'Guardian', 'Analyst', 'Elder']:
            return jsonify({'ok': False, 'error': 'Invalid trainer name'}), 400
        
        if trainer in _trainer_storage:
            # 틱 카운터 조작
            current_ticks = _trainer_storage[trainer].get('ticks', 0)
            new_ticks = max(0, current_ticks + delta)  # Prevent negative ticks
            _trainer_storage[trainer]['ticks'] = new_ticks
            _trainer_storage[trainer]['last_update'] = int(time.time())
            
            # Manual tick modifications are not saved to trade history (temporary only)
            print(f"⚠️ Manual tick modification (not saved to history): {trainer} {delta:+d} ticks")
            
            # Save to file
            _save_trainer_storage()
            
            print(f"✅ Trainer storage tick modified: {trainer} {delta:+d} (new ticks: {new_ticks})")
            
            return jsonify({
                'ok': True, 
                'trainer': trainer,
                'delta': delta,
                'new_ticks': new_ticks
            })
        else:
            return jsonify({'ok': False, 'error': 'Trainer not found in storage'}), 404
            
    except Exception as e:
        print(f"❌ Error modifying trainer storage ticks: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/trust/config', methods=['GET', 'POST'])
def api_trust_config():
    """신뢰도 설정 조회 및 수정 + ML/N/B 통합 모델 응답"""
    try:
        if request.method == 'POST':
            data = request.get_json()
            ml_trust = float(data.get('ml_trust', 50.0))
            nb_trust = float(data.get('nb_trust', 50.0))
            
            # 값 범위 제한 (0-100)
            ml_trust = max(0.0, min(100.0, ml_trust))
            nb_trust = max(0.0, min(100.0, nb_trust))
            
            _trust_config['ml_trust'] = ml_trust
            _trust_config['nb_trust'] = nb_trust
            _trust_config['last_updated'] = int(time.time() * 1000)
            
            _save_trust_config()
            
            return jsonify({
                'ok': True,
                'ml_trust': ml_trust,
                'nb_trust': nb_trust,
                'last_updated': _trust_config['last_updated']
            })
        else:
            # GET: 현재 설정 + ML/N/B 현재 모델 결과 통합 반환
            cfg = load_config()
            interval = request.args.get('interval') or (state.get('candle') or cfg.candle)
            
            response = {
                'ok': True,
                'ml_trust': _trust_config['ml_trust'],
                'nb_trust': _trust_config['nb_trust'],
                'last_updated': _trust_config['last_updated']
            }
            
            # ML 모델 예측 추가
            try:
                ml_payload, ml_status = _ml_predict_core(interval)
                if ml_status == 200 or ml_status == 410:
                    response['ml_prediction'] = ml_payload
                else:
                    response['ml_prediction_error'] = f'ML predict status {ml_status}'
            except Exception as ml_err:
                response['ml_prediction_error'] = str(ml_err)
            
            # N/B 모델 결과 추가
            try:
                window = int(load_nb_params().get('window', 50))
                # 5의 배수로 최소 데이터만 사용 (캔들 조회 최적화)
                nb_count = max(50, (window * 2 // 5) * 5)
                df = get_candles(cfg.market, interval, count=nb_count)
                HIGH = float(os.getenv('NB_HIGH', '0.55'))
                LOW = float(os.getenv('NB_LOW', '0.45'))
                
                if len(df) >= window:
                    r_series = _compute_r_from_ohlcv(df, window).astype(float)
                    rv = float(r_series.iloc[-1]) if len(r_series) else 0.5
                    
                    if rv >= HIGH:
                        current_zone = 'ORANGE'
                    elif rv <= LOW:
                        current_zone = 'BLUE'
                    else:
                        current_zone = 'NONE'
                    
                    zone_count = 1
                    for i in range(len(r_series) - 2, -1, -1):
                        r_val = float(r_series.iloc[i])
                        if current_zone == 'ORANGE' and r_val >= HIGH:
                            zone_count += 1
                        elif current_zone == 'BLUE' and r_val <= LOW:
                            zone_count += 1
                        else:
                            break
                    
                    response['nb_result'] = {
                        'ok': True,
                        'current_zone': current_zone,
                        'zone_count': zone_count,
                        'r': float(rv),
                        'high': float(HIGH),
                        'low': float(LOW),
                        'interval': interval
                    }
                else:
                    response['nb_result'] = {'ok': False, 'current_zone': 'NONE', 'zone_count': 0, 'note': 'Insufficient data'}
            except Exception as nb_err:
                response['nb_result_error'] = str(nb_err)
            
            # 최종 가중치 기반 zone 결정 + Information Trust Level 계산
            try:
                ml_zone = response.get('ml_prediction', {}).get('insight', {}).get('zone', 'BLUE')
                nb_zone = response.get('nb_result', {}).get('current_zone', 'BLUE')
                
                # ML 신뢰도 계산: pct_orange와 pct_blue 중 최댓값 사용 (0-100 범위 그대로)
                ml_pred = response.get('ml_prediction', {}).get('insight', {})
                pct_orange = float(ml_pred.get('pct_orange', 0.0)) / 100.0
                pct_blue = float(ml_pred.get('pct_blue', 0.0)) / 100.0
                ml_confidence = max(pct_blue, pct_orange)  # 0-1 범위
                
                # N/B 신뢰도 계산 (zone_count 정규화: 0-250 → 0-1, 250 이상은 1.0)
                nb_zone_count = response.get('nb_result', {}).get('zone_count', 0)
                nb_confidence = min(1.0, float(nb_zone_count) / 250.0) if nb_zone_count else 0.1
                
                # Information Trust Level (두 모델 평균 신뢰도, 0-100%)
                info_trust_level = round((ml_confidence + nb_confidence) / 2.0 * 100)
                
                # 일치도 (같은 zone일 때 신뢰도 상향)
                zone_agreement = 'YES' if ml_zone == nb_zone else 'NO'
                
                # 최종 zone 결정 (일치하면 해당 zone, 불일치하면 신뢰도 높은 쪽)
                if ml_zone == nb_zone:
                    final_zone = ml_zone
                elif ml_confidence > nb_confidence:
                    final_zone = ml_zone
                else:
                    final_zone = nb_zone
                
                response['information_trust_level'] = info_trust_level  # 0-100%
                response['ml_confidence'] = round(ml_confidence * 100)  # ML 신뢰도 (%)
                response['nb_confidence'] = round(nb_confidence * 100)  # N/B 신뢰도 (%)
                response['zone_agreement'] = zone_agreement
                response['final_zone'] = final_zone
                
                logger.info(f"Trust calculation: ML={response['ml_confidence']}%, N/B={response['nb_confidence']}%, Info={info_trust_level}%")
            except Exception as final_err:
                logger.error(f"Trust calculation error: {final_err}")
                response['final_zone_error'] = str(final_err)
                response['information_trust_level'] = 50
                response['ml_confidence'] = 50
                response['nb_confidence'] = 50
            
            return jsonify(response)
            
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/upbit/connection')
def api_upbit_connection():
    """Check Upbit API connection status and return connection info."""
    try:
        cfg = _resolve_config()
        std_ak, std_sk, open_ak, open_sk = _get_runtime_keys()
        
        connection_status = {
            'connected': False,
            'paper_mode': cfg.paper,
            'has_keys': bool((std_ak and std_sk) or (open_ak and open_sk)),
            'key_type': None,
            'error': None,
            'test_time': None
        }
        
        if cfg.paper:
            connection_status['connected'] = True
            connection_status['key_type'] = 'paper'
            connection_status['test_time'] = datetime.now().isoformat()
            return jsonify({'ok': True, 'connection': connection_status})
        
        # Test connection with actual API call
        upbit = None
        if std_ak and std_sk:
            try:
                upbit = pyupbit.Upbit(std_ak, std_sk)
                # Test connection by getting account info
                accounts = upbit.get_balances()
                if accounts is not None:
                    connection_status['connected'] = True
                    connection_status['key_type'] = 'standard'
                    connection_status['test_time'] = datetime.now().isoformat()
            except Exception as e:
                connection_status['error'] = str(e)
        elif open_ak and open_sk:
            try:
                import jwt as pyjwt
                server_url = os.getenv('UPBIT_OPEN_API_SERVER_URL', 'https://api.upbit.com')
                payload = {
                    'access_key': open_ak,
                    'nonce': str(uuid.uuid4()),
                }
                token = pyjwt.encode(payload, open_sk, algorithm='HS256')
                headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/json'}
                resp = requests.get(server_url.rstrip('/') + '/v1/accounts', headers=headers, timeout=5)
                if resp.status_code == 200:
                    connection_status['connected'] = True
                    connection_status['key_type'] = 'open_api'
                    connection_status['test_time'] = datetime.now().isoformat()
                else:
                    connection_status['error'] = f'HTTP {resp.status_code}: {resp.text[:100]}'
            except Exception as e:
                connection_status['error'] = str(e)
        else:
            connection_status['error'] = 'No API keys configured'
        
        return jsonify({'ok': True, 'connection': connection_status})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/bot/status')
def api_bot_status():
    cfg = _resolve_config()
    # Log masked env keys on each status request for visibility
    try:
        log_env_keys()
    except Exception:
        pass
    # current N/B coin for this interval bucket
    try:
        b = _bucket_ts_interval(int(time.time()*1000), str(cfg.candle))
        coin = _nb_coin_store.get(_coin_key(str(cfg.candle), str(cfg.market), b))
    except Exception:
        coin = None
    return jsonify({
        'running': bot_ctrl['running'],
        'last_signal': bot_ctrl.get('last_signal', 'HOLD'),
        'last_order': bot_ctrl.get('last_order'),
        'coin': coin,
        'trainer_storage': _trainer_storage,  # 트레이너 저장 창고 정보 추가
        'config': {
            'paper': cfg.paper,
            'order_krw': cfg.order_krw,
            'pnl_ratio': float(getattr(cfg, 'pnl_ratio', 0.0)),
            'ema_fast': cfg.ema_fast,
            'ema_slow': cfg.ema_slow,
            'candle': cfg.candle,
            'market': cfg.market,
            'interval_sec': cfg.interval_sec,
            'has_keys': bool((_get_runtime_keys()[0] and _get_runtime_keys()[1]) or (_get_runtime_keys()[2] and _get_runtime_keys()[3]))
        }
    })


@app.route('/api/nb/coin', methods=['GET'])
def api_nb_coin():
    """Return current and recent N/B COINs (per-candle buckets)."""
    try:
        cfg = _resolve_config()
        iv = str(request.args.get('interval') or cfg.candle)
        market = str(request.args.get('market') or cfg.market)
        now_b = _bucket_ts_interval(int(time.time()*1000), iv)
        # collect recent N buckets
        try:
            n = int(request.args.get('n') or 50)
        except Exception:
            n = 50
        sec = _interval_to_sec(iv)
        buckets = [(now_b - i*sec) for i in range(max(1, n))]
        coins = []
        for b in buckets:
            c = _nb_coin_store.get(_coin_key(iv, market, b))
            if not c:
                c = _ensure_nb_coin(iv, market, int(b))
            coins.append(c)
        cur = _nb_coin_store.get(_coin_key(iv, market, now_b))
        return jsonify({'ok': True, 'current': cur, 'recent': coins})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/nb/coins/summary', methods=['GET'])
def api_nb_coins_summary():
    try:
        cfg = _resolve_config()
        # total owned coins = sum of per-interval counters
        try:
            total_owned = int(sum(int(v) for v in _nb_coin_counter.values()))
        except Exception:
            total_owned = 0
        # price per coin from setting (order_krw), default 5100
        try:
            price_per_coin = int(getattr(cfg, 'order_krw', 5100))
        except Exception:
            price_per_coin = 5100
        # available KRW
        avail_krw = 0.0
        try:
            upbit = None
            if (not cfg.paper) and cfg.access_key and cfg.secret_key:
                upbit = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
            if upbit:
                avail_krw = float(upbit.get_balance('KRW') or 0.0)
        except Exception:
            avail_krw = 0.0
        try:
            buyable = int(avail_krw // max(1, int(price_per_coin)))
        except Exception:
            buyable = 0
        return jsonify({'ok': True, 'total_owned': total_owned, 'price_per_coin': int(price_per_coin), 'krw': float(avail_krw), 'buyable_by_krw': int(buyable)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/leftpanel/log', methods=['POST'])
def api_leftpanel_log():
    try:
        payload = request.get_json(force=True) if request.is_json else request.form.to_dict()
    except Exception:
        payload = {}
    try:
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'bot.v.0.1', 'log'))
        os.makedirs(base_dir, exist_ok=True)
        log_path = os.path.join(base_dir, 'left_panel.log')
        rec = json.dumps({
            'tf': payload.get('tf'),
            'text': payload.get('text'),
            'ts': int(payload.get('ts') or 0),
            'mode': payload.get('mode'),
            'type': payload.get('type') or 'status'
        }, ensure_ascii=False)
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(rec + '\n')
        with open(log_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        if len(lines) > 100:
            with open(log_path, 'w', encoding='utf-8') as f:
                f.writelines(lines[-100:])
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/npc/generate', methods=['POST'])
def api_npc_generate():
    """Generate N random NPC dialogue messages based on current narrative/state.
    Body: { n?: int, interval?: string }
    Writes unique messages to data/npc_messages.jsonl and returns the new ones.
    """
    try:
        payload = request.get_json(force=True) if request.is_json else {}
        try:
            n = max(1, min(50, int(payload.get('n', 10))))
        except Exception:
            n = 10
        try:
            iv = str(payload.get('interval')) if payload.get('interval') else (state.get('candle') or load_config().candle)
        except Exception:
            iv = state.get('candle') or load_config().candle
        # lightweight insight snapshot (avoid calling Flask handlers directly)
        cfg = _resolve_config()
        try:
            df = get_candles(cfg.market, iv, count=max(120, cfg.ema_slow + 5))
        except Exception:
            df = pd.DataFrame()
        try:
            window = int(load_nb_params().get('window', 50))
        except Exception:
            window = 50
        try:
            ins = _make_insight(df, window, cfg.ema_fast, cfg.ema_slow, iv, None) or {}
        except Exception:
            ins = {}
        zone = str(ins.get('zone') or '').upper() if ins else None
        # approximate slope per bar (bp) if possible
        slope = None
        try:
            closes = df['close'].astype(float).tail(max(20, min(120, window)))
            if len(closes) >= 5:
                import numpy as _np
                y = _np.log(closes.replace(0, _np.nan)).bfill().ffill().values
                x = _np.arange(len(y), dtype=float)
                b1 = _np.polyfit(x, y, 1)[0]
                slope = float(b1)  # per-bar log slope (approx bp/bar after scale)
        except Exception:
            slope = None
        flip = None  # optional: can be added later
        # templates
        personas = ['Analyst','Scout','Guardian','Elder']
        frames = [
            "{p}({iv}): {zone} with slope {s} bp/bar. Flip ETA: {f} bars.",
            "{p}({iv}): I favor {act} while momentum holds. {guard}",
            "{p}({iv}): Feasibility → BUY={can_buy} SELL={can_sell}. coin={coin} buyable={buy}",
            "{p}({iv}): If conditions soften, I will stand down and wait for better alignment."
        ]
        # feasibility snapshot
        coin = int(_nb_coin_counter.get(iv, 0))
        # buyable via KRW balance and order_krw(coin price)
        try:
            price_per_coin = int(getattr(cfg, 'order_krw', 5100))
        except Exception:
            price_per_coin = 5100
        avail_krw = 0.0
        try:
            upbit = None
            if (not cfg.paper) and cfg.access_key and cfg.secret_key:
                upbit = pyupbit.Upbit(cfg.access_key, cfg.secret_key)
            if upbit:
                avail_krw = float(upbit.get_balance('KRW') or 0.0)
        except Exception:
            avail_krw = 0.0
        try:
            buy = int(avail_krw // max(1, price_per_coin))
        except Exception:
            buy = 0
        can_buy = (buy > 0); can_sell = (coin > 0)
        guard = "Zone-side & cooldown OK"  # placeholder; detailed guards available elsewhere
        # If OpenAI key present or provider specified, generate via GPT-4o-mini first
        provider = str(payload.get('provider') or '').lower()
        openai_key = os.getenv('OPENAI_API_KEY')
        out = []
        if openai_key and (provider == 'openai' or os.getenv('NPC_PROVIDER','').lower()=='openai'):
            try:
                url = 'https://api.openai.com/v1/chat/completions'
                headers = { 'Authorization': f'Bearer {openai_key}', 'Content-Type': 'application/json' }
                sys = "You are an NPC villager speaking concise, context-aware trading lines in English. Keep each line short (<= 140 chars), natural, and grounded in the given signals."
                context = f"interval={iv}, zone={zone}, slope={slope}, flip={flip}, coin_count={coin}, buyable={buy}, can_buy={can_buy}, can_sell={can_sell}"
                # we will request one-by-one to enforce de-duplication and keep responses crisp
                tries = 0
                while len(out) < n and tries < n*3:
                    tries += 1
                    persona = random.choice(personas)
                    usr = f"As {persona} at {iv}, say ONE short line about: {context}. Include a clear intent (BUY/SELL/HOLD) only if feasible."
                    body = {
                        'model': 'gpt-4o-mini',
                        'messages': [
                            { 'role': 'system', 'content': sys },
                            { 'role': 'user', 'content': usr }
                        ],
                        'temperature': 0.7,
                        'max_tokens': 60
                    }
                    resp = requests.post(url, headers=headers, json=body, timeout=20)
                    if resp.status_code >= 400:
                        break
                    data = resp.json()
                    txt = (data.get('choices') or [{}])[0].get('message', {}).get('content') or ''
                    text = f"{persona}({iv}): {txt.strip()}"
                    msg = { 'ts': int(time.time()*1000), 'interval': iv, 'persona': persona, 'text': text }
                    if _npc_add(msg):
                        out.append(msg)
            except Exception:
                out = []
        # fallback: template generator
        out = []
        tries = 0
        while len(out) < n and tries < n*5:
            tries += 1
            p = random.choice(personas)
            act = 'BUY' if (zone=='BLUE') else ('SELL' if zone=='ORANGE' else 'HOLD')
            s = None if slope is None else (round(float(slope)*10000, 2))
            f = (flip if isinstance(flip, int) else '-')
            text = random.choice(frames).format(p=p, iv=iv, zone=(zone or '-'), s=(s if s is not None else '-'), f=f, act=act, guard=guard, can_buy=can_buy, can_sell=can_sell, coin=coin, buy=buy)
            msg = { 'ts': int(time.time()*1000), 'interval': iv, 'persona': p, 'text': text }
            if _npc_add(msg):
                out.append(msg)
        return jsonify({'ok': True, 'count': len(out), 'items': out})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/village/nb-guild-status', methods=['GET'])
def api_village_nb_guild_status():
    """N/B 길드 상태 정보 반환"""
    try:
        # N/B 길드 상태 정보 구성 (기본값)
        nb_guild_status = {
            'profit': '0.0%',
            'loss': '100.0%',
            'autoTrade': '100%',
            'trustLevel': 'N/B Favored',
            'mlTrust': '40%',
            'nbGuildTrust': '82%',
            'trustBalance': 'ML: 40% | N/B: 82%',
            'zoneStatus': '5m ORANGE',
            'timestamp': datetime.now().isoformat()
        }
        
        return jsonify(nb_guild_status)
        
    except Exception as e:
        print(f"❌ N/B 길드 상태 API 오류: {e}")
        return jsonify({
            'error': str(e),
            'profit': '0.0%',
            'loss': '100.0%',
            'autoTrade': '100%',
            'trustLevel': 'N/B Favored',
            'mlTrust': '40%',
            'nbGuildTrust': '82%',
            'trustBalance': 'ML: 40% | N/B: 82%',
            'zoneStatus': '5m ORANGE',
        }), 500


# ===== 비트코인 아이템 시스템 =====

BITCOIN_ITEMS_FILE = os.path.join(os.path.dirname(__file__), 'data', 'bitcoin_items.json')

def _load_bitcoin_items():
    """비트코인 아이템 데이터 로드"""
    try:
        if os.path.exists(BITCOIN_ITEMS_FILE):
            with open(BITCOIN_ITEMS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"⚠️ Failed to load bitcoin items: {e}")
    return {"items": [], "last_updated": None}

def _save_bitcoin_items(data):
    """비트코인 아이템 데이터 저장"""
    try:
        os.makedirs(os.path.dirname(BITCOIN_ITEMS_FILE), exist_ok=True)
        with open(BITCOIN_ITEMS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"⚠️ Failed to save bitcoin items: {e}")
        return False

"""
BTC 가격 조회 관련 전역 캐시 및 레이트 리미트 설정
- UPBIT API 호출은 1분에 최대 10회로 제한
- 서버 내부에서는 캐시를 사용하여 1~3분마다만 실제 API 호출
"""
_BTC_PRICE_CACHE = 0.0
_BTC_PRICE_CACHE_TIME = 0.0
_BTC_PRICE_LOCK = threading.Lock()
_BTC_PRICE_CALL_TIMES = []  # 최근 Upbit 실제 호출 시각(초) 목록

# 캐시 유지 시간(초) – 90초로 설정 (1~3분 사이, 필요시 조정 가능)
BTC_PRICE_CACHE_TTL = 90
# Upbit API 실제 호출 레이트 리미트: 1분에 최대 10회
BTC_PRICE_RATE_LIMIT = 10
BTC_PRICE_RATE_WINDOW = 60  # 60초


def _get_current_btc_price():
    """현재 BTC 가격 조회 (KRW)
    
    - 먼저 서버 캐시를 확인
    - 캐시가 90초 이내이면 그대로 반환 (Upbit 호출 없음)
    - 캐시가 만료되었을 때만 Upbit API를 호출
    - Upbit 호출은 60초 동안 최대 10회로 제한
    """
    global _BTC_PRICE_CACHE, _BTC_PRICE_CACHE_TIME, _BTC_PRICE_CALL_TIMES
    
    now = time.time()
    
    with _BTC_PRICE_LOCK:
        # 1) 캐시가 아직 유효하면 바로 반환
        if _BTC_PRICE_CACHE_TIME > 0 and (now - _BTC_PRICE_CACHE_TIME) < BTC_PRICE_CACHE_TTL:
            return _BTC_PRICE_CACHE
        
        # 2) 레이트 리미트: 최근 60초 내 호출 횟수 계산
        _BTC_PRICE_CALL_TIMES = [t for t in _BTC_PRICE_CALL_TIMES if now - t < BTC_PRICE_RATE_WINDOW]
        if len(_BTC_PRICE_CALL_TIMES) >= BTC_PRICE_RATE_LIMIT:
            # 레이트 리미트 초과 시: 새로 호출하지 않고, 기존 캐시 반환
            if _BTC_PRICE_CACHE_TIME > 0:
                print("⚠️ BTC price rate limit reached, using cached value.")
                return _BTC_PRICE_CACHE
            # 캐시도 없으면 0 반환
            print("⚠️ BTC price rate limit reached and no cache available.")
            return 0
        
        # 3) 실제 Upbit API 호출
        try:
            ticker = pyupbit.get_ticker("KRW-BTC")
            if ticker:
                price = float(ticker.get('trade_price', 0))
            else:
                price = 0.0
        except Exception as e:
            print(f"⚠️ Failed to get BTC price: {e}")
            price = 0.0
        
        # 호출 시간 기록 (성공/실패와 무관)
        _BTC_PRICE_CALL_TIMES.append(now)
        
        # 4) 가격이 유효하면 캐시에 저장
        if price > 0:
            _BTC_PRICE_CACHE = price
            _BTC_PRICE_CACHE_TIME = now
        else:
            # 실패한 경우에도, 이전 캐시가 있으면 그 값을 유지
            if _BTC_PRICE_CACHE_TIME > 0:
                print("⚠️ Failed to get fresh BTC price, using cached value.")
                return _BTC_PRICE_CACHE
        
        return price

def _update_item_prices():
    """모든 아이템의 현재 가격 업데이트"""
    try:
        data = _load_bitcoin_items()
        current_price = _get_current_btc_price()
        
        if current_price == 0:
            return data
        
        for item in data.get('items', []):
            if item.get('status') == 'active':
                purchase_price = item.get('purchase_price', 0)
                purchase_amount = item.get('purchase_amount', 0)
                
                current_value = current_price * purchase_amount
                profit_loss = current_value - purchase_price
                profit_loss_percent = (profit_loss / purchase_price * 100) if purchase_price > 0 else 0
                
                item['current_price'] = current_price
                item['current_value'] = current_value
                item['profit_loss'] = profit_loss
                item['profit_loss_percent'] = round(profit_loss_percent, 2)
        
        data['last_updated'] = datetime.now().isoformat()
        _save_bitcoin_items(data)
        return data
    except Exception as e:
        print(f"⚠️ Failed to update item prices: {e}")
        return _load_bitcoin_items()


@app.route('/api/items/create', methods=['POST'])
def api_items_create():
    """비트코인 아이템 생성"""
    try:
        data = request.get_json()
        purchase_price = float(data.get('purchase_price', 0))
        purchase_amount = float(data.get('purchase_amount', 0))
        item_name = data.get('item_name', '비트코인')
        
        if purchase_price <= 0 or purchase_amount <= 0:
            return jsonify({'ok': False, 'error': 'Invalid purchase price or amount'}), 400
        
        # 현재 BTC 가격 조회
        current_price = _get_current_btc_price()
        if current_price == 0:
            return jsonify({'ok': False, 'error': 'Failed to get current BTC price'}), 500
        
        # 아이템 생성
        item_id = f"btc_item_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{random.randint(1000, 9999)}"
        current_value = current_price * purchase_amount
        profit_loss = current_value - purchase_price
        profit_loss_percent = (profit_loss / purchase_price * 100) if purchase_price > 0 else 0
        
        item = {
            'item_id': item_id,
            'item_name': item_name,
            'item_type': 'crypto',
            'purchase_price': purchase_price,
            'purchase_amount': purchase_amount,
            'purchase_time': datetime.now().isoformat(),
            'current_price': current_price,
            'current_value': current_value,
            'profit_loss': profit_loss,
            'profit_loss_percent': round(profit_loss_percent, 2),
            'status': 'active'
        }
        
        # 저장
        items_data = _load_bitcoin_items()
        items_data['items'].append(item)
        items_data['last_updated'] = datetime.now().isoformat()
        _save_bitcoin_items(items_data)
        
        return jsonify({'ok': True, 'item': item})
        
    except Exception as e:
        print(f"❌ 아이템 생성 오류: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/items/list', methods=['GET'])
def api_items_list():
    """비트코인 아이템 목록 조회"""
    try:
        status = request.args.get('status', 'active')
        
        # 가격 업데이트
        items_data = _update_item_prices()
        
        # 필터링
        items = [item for item in items_data.get('items', []) 
                if status == 'all' or item.get('status') == status]
        
        # 총계 계산
        total_amount = sum(item.get('purchase_amount', 0) for item in items if item.get('status') == 'active')
        total_value = sum(item.get('current_value', 0) for item in items if item.get('status') == 'active')
        total_purchase_price = sum(item.get('purchase_price', 0) for item in items if item.get('status') == 'active')
        total_profit_loss = total_value - total_purchase_price
        total_profit_loss_percent = (total_profit_loss / total_purchase_price * 100) if total_purchase_price > 0 else 0
        
        return jsonify({
            'ok': True,
            'items': items,
            'total': {
                'total_amount': round(total_amount, 8),
                'total_value': round(total_value, 2),
                'total_purchase_price': round(total_purchase_price, 2),
                'total_profit_loss': round(total_profit_loss, 2),
                'total_profit_loss_percent': round(total_profit_loss_percent, 2)
            },
            'current_btc_price': _get_current_btc_price(),
            'last_updated': items_data.get('last_updated')
        })
        
    except Exception as e:
        print(f"❌ 아이템 목록 조회 오류: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/items/update-prices', methods=['GET'])
def api_items_update_prices():
    """아이템 시세 업데이트"""
    try:
        items_data = _update_item_prices()
        active_count = len([item for item in items_data.get('items', []) if item.get('status') == 'active'])
        
        return jsonify({
            'ok': True,
            'updated_count': active_count,
            'current_btc_price': _get_current_btc_price(),
            'last_updated': items_data.get('last_updated')
        })
        
    except Exception as e:
        print(f"❌ 시세 업데이트 오류: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/items/sell', methods=['POST'])
def api_items_sell():
    """비트코인 아이템 판매"""
    try:
        data = request.get_json()
        item_id = data.get('item_id')
        
        if not item_id:
            return jsonify({'ok': False, 'error': 'Item ID required'}), 400
        
        items_data = _load_bitcoin_items()
        item = None
        item_index = None
        
        for i, it in enumerate(items_data.get('items', [])):
            if it.get('item_id') == item_id:
                item = it
                item_index = i
                break
        
        if not item:
            return jsonify({'ok': False, 'error': 'Item not found'}), 404
        
        if item.get('status') != 'active':
            return jsonify({'ok': False, 'error': 'Item is not active'}), 400
        
        # 현재 가격으로 판매
        current_price = _get_current_btc_price()
        if current_price == 0:
            return jsonify({'ok': False, 'error': 'Failed to get current BTC price'}), 500
        
        sell_value = current_price * item.get('purchase_amount', 0)
        final_profit_loss = sell_value - item.get('purchase_price', 0)
        final_profit_loss_percent = (final_profit_loss / item.get('purchase_price', 0) * 100) if item.get('purchase_price', 0) > 0 else 0
        
        # 아이템 상태 업데이트
        item['status'] = 'sold'
        item['sell_price'] = current_price
        item['sell_value'] = sell_value
        item['sell_time'] = datetime.now().isoformat()
        item['final_profit_loss'] = final_profit_loss
        item['final_profit_loss_percent'] = round(final_profit_loss_percent, 2)
        
        items_data['items'][item_index] = item
        items_data['last_updated'] = datetime.now().isoformat()
        _save_bitcoin_items(items_data)
        
        return jsonify({
            'ok': True,
            'item': item
        })
        
    except Exception as e:
        print(f"❌ 아이템 판매 오류: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/container-state/save', methods=['POST'])
def api_container_state_save():
    """분봉마다 N/B Zone Status와 Win% 히스토리 저장 (최신 200개만 유지)"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'ok': False, 'error': 'No data provided'}), 400
        
        structured = data.get('structured', {})
        text = data.get('text', '')
        
        # ===== N/B Zone 추출 (우선순위: structured > 텍스트 파싱) =====
        nb_zone = None
        
        # 1순위: structured 데이터에서 추출
        if 'nbZone' in structured:
            nb_zone = str(structured['nbZone']).upper() if structured['nbZone'] else None
        elif 'nb_zone' in structured:
            nb_zone = str(structured['nb_zone']).upper() if structured['nb_zone'] else None
        
        # 2순위: 텍스트에서 "N/B: ORANGE/BLUE" 패턴 추출
        if not nb_zone and 'N/B:' in text:
            import re
            nb_match = re.search(r'N/B:\s*(ORANGE|BLUE)', text, re.IGNORECASE)
            if nb_match:
                nb_zone = nb_match.group(1).upper()
        
        # 3순위: 텍스트에서 단순 ORANGE/BLUE 확인 (주의: ORANGE가 우선)
        if not nb_zone:
            text_upper = text.upper()
            # ORANGE가 명시적으로 있고 BLUE가 없으면 ORANGE
            if 'ORANGE' in text_upper and 'BLUE' not in text_upper:
                nb_zone = 'ORANGE'
            # "N/B"와 함께 있는 BLUE만 인식
            elif re.search(r'N/B.*?BLUE|BLUE.*?N/B', text_upper):
                nb_zone = 'BLUE'
            # 마지막으로 단순 BLUE 확인
            elif 'BLUE' in text_upper:
                nb_zone = 'BLUE'
        
        if not nb_zone:
            nb_zone = 'BLUE'  # 기본값
        
        # ===== ML Zone 추출 (우선순위: structured > 텍스트 파싱) =====
        ml_zone = None
        
        # 1순위: structured 데이터에서 추출
        if 'mlZone' in structured:
            ml_zone = str(structured['mlZone']).upper() if structured['mlZone'] else None
        elif 'ml_zone' in structured:
            ml_zone = str(structured['ml_zone']).upper() if structured['ml_zone'] else None
        
        # 2순위: 텍스트에서 ML Zone 확인
        if not ml_zone:
            import re
            ml_match = re.search(r'ML.*?Zone[:\s]+(ORANGE|BLUE)', text, re.IGNORECASE)
            if ml_match:
                ml_zone = ml_match.group(1).upper()
        
        if not ml_zone:
            ml_zone = nb_zone  # ML Zone이 없으면 N/B Zone 사용
        
        # ===== Trust Level 추출 =====
        ml_trust = structured.get('mlTrust', 50.0)  # 기본값 50%
        nb_trust = structured.get('nbTrust', 70.0)  # 기본값 70%
        
        # 텍스트에서 Trust Level 추출 (백업)
        if 'ML Model Trust' in text:
            import re
            ml_trust_match = re.search(r'ML Model Trust[:\s]+([\d.]+)%', text, re.IGNORECASE)
            if ml_trust_match:
                ml_trust = float(ml_trust_match.group(1))
        
        if 'N/B Guild Trust' in text or 'N/B Trust' in text:
            import re
            nb_trust_match = re.search(r'N/B.*?Trust[:\s]+([\d.]+)%', text, re.IGNORECASE)
            if nb_trust_match:
                nb_trust = float(nb_trust_match.group(1))
        
        # Trust Level 정규화 (0-100 범위)
        ml_trust = max(0.0, min(100.0, float(ml_trust)))
        nb_trust = max(0.0, min(100.0, float(nb_trust)))
        
        # ===== 신뢰도 가중 합의 방식으로 최종 Zone 결정 =====
        def determine_final_zone(nb_z, ml_z, nb_t, ml_t):
            """
            신뢰도 가중 합의 방식으로 최종 Zone 결정
            - N/B와 ML이 같으면 → 그 Zone 사용 (강한 신호)
            - 다를 때:
              * N/B 신뢰도가 높으면 → N/B Zone 사용 (기본 우선순위)
              * ML 신뢰도가 70% 이상이고 N/B보다 높으면 → ML Zone 사용
              * 둘 다 낮으면 → N/B Zone 사용 (안정성)
            """
            # 둘 다 같은 Zone이면 그 Zone 사용
            if nb_z == ml_z:
                return nb_z, 'consensus'
            
            # 가중치 계산
            total_trust = nb_t + ml_t
            if total_trust == 0:
                return nb_z, 'default_nb'
            
            nb_weight = nb_t / total_trust
            ml_weight = ml_t / total_trust
            
            # ML 신뢰도가 70% 이상이고 N/B보다 높으면 ML Zone 사용
            if ml_t >= 70.0 and ml_weight > nb_weight:
                return ml_z, 'ml_high_confidence'
            
            # 기본적으로 N/B Zone 우선 (안정성)
            return nb_z, 'nb_priority'
        
        zone, decision_reason = determine_final_zone(nb_zone, ml_zone, nb_trust, ml_trust)
        
        # 분봉 정보 추출
        timeframe = structured.get('timeframeCycle', {}).get('current', '')
        if not timeframe:
            import re
            timeframe_match = re.search(r'(\d+m|\d+h|day)', text, re.IGNORECASE)
            if timeframe_match:
                timeframe = timeframe_match.group(1).lower()
        
        # 현재 시세 조회
        cfg = load_config()
        current_price = 0
        try:
            current_price = pyupbit.get_current_price(cfg.market)
            if not current_price:
                current_price = 0
        except:
            current_price = 0
        
        # 현재 시간
        now = datetime.now()
        timestamp = now.isoformat()
        time_str = now.strftime('%Y-%m-%d %H:%M:%S')
        
        # data 디렉토리에 저장
        data_dir = 'data'
        if not os.path.exists(data_dir):
            os.makedirs(data_dir)
        
        # 파일 경로 (분봉별로 파일명 생성)
        safe_timeframe = timeframe.replace('/', '_') if timeframe else 'unknown'
        zone_file_path = os.path.join(data_dir, f'zone_status_{safe_timeframe}.json')
        history_file_path = os.path.join(data_dir, f'win_history_{safe_timeframe}.json')
        
        # ===== Zone Status 파일 저장 =====
        zone_data = {'history': []}
        if os.path.exists(zone_file_path):
            try:
                with open(zone_file_path, 'r', encoding='utf-8') as f:
                    zone_data = json.load(f)
                    if 'history' not in zone_data:
                        zone_data['history'] = []
            except:
                zone_data = {'history': []}
        
        # Zone 엔트리 생성
        zone_entry = {
            'timestamp': timestamp,
            'time': time_str,
            'zone': zone,
            'timeframe': timeframe,
            'price': float(current_price),
            'price_formatted': f"{current_price:,.0f}" if current_price > 0 else "0",
            'nb_zone_status': zone
        }
        
        # Zone 히스토리에 추가
        zone_data['history'].append(zone_entry)
        
        # 분봉별로 저장 (개수 제한 없음, 분봉별로 별도 파일이므로)
        # 각 분봉 파일에는 해당 분봉의 모든 세그먼트(점) 데이터 저장
        
        zone_data['latest'] = zone_entry
        zone_data['last_updated'] = timestamp
        zone_data['total_items'] = len(zone_data['history'])
        zone_data['timeframe'] = timeframe
        
        # Zone 파일에 저장
        with open(zone_file_path, 'w', encoding='utf-8') as f:
            json.dump(zone_data, f, ensure_ascii=False, indent=2)
        
        # ===== Win History 파일 저장 =====
        # 분봉별로 최신 Zone 상태 1개만 저장 (Zone 변경 시마다 덮어쓰기)
        win_history_data = {}
        if os.path.exists(history_file_path):
            try:
                with open(history_file_path, 'r', encoding='utf-8') as f:
                    win_history_data = json.load(f)
            except:
                win_history_data = {}
        
        # Win% 히스토리 엔트리 생성 (Zone 정보 포함) - 분봉별로 1개만 저장
        win_entry = {
            'timestamp': timestamp,
            'time': time_str,
            'zone': zone,  # 최종 결정된 Zone (N/B + ML 합의)
            'nb_zone': nb_zone,  # N/B Zone
            'ml_zone': ml_zone,  # ML Zone
            'nb_trust': float(nb_trust),  # N/B 신뢰도
            'ml_trust': float(ml_trust),  # ML 신뢰도
            'decision_reason': decision_reason,  # 결정 이유
            'timeframe': timeframe,
            'price': float(current_price),
            'price_formatted': f"{current_price:,.0f}" if current_price > 0 else "0",
            'win_history_count': 25  # Win% 히스토리 개수
        }
        
        # 분봉별로 최신 상태 1개만 저장 (덮어쓰기)
        win_history_data['latest'] = win_entry
        win_history_data['last_updated'] = timestamp
        win_history_data['timeframe'] = timeframe
        
        # Win History 파일에 저장 (분봉별로 1개만)
        with open(history_file_path, 'w', encoding='utf-8') as f:
            json.dump(win_history_data, f, ensure_ascii=False, indent=2)
        
        safe_print(f"💾 Saved: Zone={zone} @ {timeframe} | Price: {current_price:,.0f}")
        safe_print(f"   N/B Zone: {nb_zone} (신뢰도: {nb_trust:.1f}%) | ML Zone: {ml_zone} (신뢰도: {ml_trust:.1f}%)")
        safe_print(f"   최종 결정: {zone} (이유: {decision_reason})")
        safe_print(f"   Zone file: {len(zone_data.get('segments', []))} segments (분봉별 세그먼트 저장)")
        safe_print(f"   History file: 1 item (분봉별 최신 Zone 상태 1개만 저장)")
        
        return jsonify({
            'ok': True,
            'saved': True,
            'zone_file': zone_file_path,
            'history_file': history_file_path,
            'zone': zone,  # 최종 결정된 Zone
            'nb_zone': nb_zone,
            'ml_zone': ml_zone,
            'nb_trust': nb_trust,
            'ml_trust': ml_trust,
            'decision_reason': decision_reason,
            'timeframe': timeframe,
            'price': current_price,
            'zone_segments': len(zone_data.get('segments', [])),
            'note': 'Zone: 분봉별 세그먼트 저장, History: 분봉별 최신 1개만 저장 (N/B+ML 합의 방식)'
        })
        
    except Exception as e:
        safe_print(f"❌ Container state save error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/container-state/save-zone-segments', methods=['POST'])
def api_container_state_save_zone_segments():
    """N/B Zone Strip의 각 세그먼트(점)를 시간별로 분봉별로 저장"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'ok': False, 'error': 'No data provided'}), 400
        
        segments = data.get('segments', [])
        timeframe = data.get('timeframe', 'minute10')
        timestamp = data.get('timestamp', datetime.now().isoformat())
        
        if not segments or len(segments) == 0:
            return jsonify({'ok': False, 'error': 'No segments data'}), 400
        
        # 현재 시세 조회
        cfg = load_config()
        current_price = 0
        try:
            current_price = pyupbit.get_current_price(cfg.market)
            if not current_price:
                current_price = 0
        except:
            current_price = 0
        
        # data 디렉토리에 저장
        data_dir = 'data'
        if not os.path.exists(data_dir):
            os.makedirs(data_dir)
        
        # 파일 경로 (분봉별로 파일명 생성)
        safe_timeframe = timeframe.replace('/', '_') if timeframe else 'unknown'
        zone_file_path = os.path.join(data_dir, f'zone_status_{safe_timeframe}.json')
        
        # 기존 데이터 로드
        zone_data = {'history': [], 'segments': []}
        if os.path.exists(zone_file_path):
            try:
                with open(zone_file_path, 'r', encoding='utf-8') as f:
                    zone_data = json.load(f)
                    if 'history' not in zone_data:
                        zone_data['history'] = []
                    if 'segments' not in zone_data:
                        zone_data['segments'] = []
            except:
                zone_data = {'history': [], 'segments': []}
        
        # 각 세그먼트를 시간별로 저장 (중복 체크)
        now = datetime.now()
        time_str = now.strftime('%Y-%m-%d %H:%M:%S')
        
        # 현재 신뢰도 값 가져오기 (세분화된 intensity 계산용)
        try:
            ml_trust = MAYOR_TRUST_SYSTEM.get("ML_Model_Trust", 50.0)
            nb_trust = MAYOR_TRUST_SYSTEM.get("NB_Guild_Trust", 50.0)
        except:
            ml_trust = 50.0
            nb_trust = 50.0
        
        for segment in segments:
            # segment에서 nb_trust, ml_trust 추출 (있으면 사용, 없으면 현재 값 사용)
            segment_nb_trust = segment.get('nb_trust', nb_trust)
            segment_ml_trust = segment.get('ml_trust', ml_trust)
            
            # 세분화된 intensity 계산 (소수점 10자리까지)
            nb_t = float(segment_nb_trust) / 100.0
            ml_t = float(segment_ml_trust) / 100.0
            intensity = round((nb_t * 0.7 + ml_t * 0.3), 10)  # N/B 70%, ML 30% 가중 평균
            
            # segment에서 가격 정보 추출 (있으면 사용, 없으면 현재 시세 사용)
            segment_price = segment.get('price', current_price)
            segment_high = segment.get('high', segment_price)
            segment_low = segment.get('low', segment_price)
            segment_open = segment.get('open', segment_price)
            segment_volume = segment.get('volume', 0)
            
            segment_entry = {
                'timestamp': segment.get('timestamp', datetime.fromtimestamp(segment.get('time', 0)).isoformat() if segment.get('time') else timestamp),
                'time': datetime.fromtimestamp(segment.get('time', 0)).strftime('%Y-%m-%d %H:%M:%S') if segment.get('time') else time_str,
                'time_unix': segment.get('time', 0),
                'zone': segment.get('zone', 'BLUE'),
                'timeframe': timeframe,
                'price': float(segment_price),  # 종가 (close)
                'price_formatted': f"{segment_price:,.0f}" if segment_price > 0 else "0",
                'open': float(segment_open),  # 시가
                'high': float(segment_high),  # 고가
                'low': float(segment_low),  # 저가
                'volume': float(segment_volume),  # 거래량
                'value': segment.get('value', 0),
                'index': segment.get('index', 0),
                'nb_trust': float(segment_nb_trust),  # N/B 신뢰도 저장
                'ml_trust': float(segment_ml_trust),  # ML 신뢰도 저장
                'intensity': intensity  # 세분화된 intensity 저장 (소수점 10자리)
            }
            
            # 중복 체크 (같은 time_unix가 있으면 업데이트, 없으면 추가)
            existing_index = None
            for i, existing in enumerate(zone_data['segments']):
                if existing.get('time_unix') == segment_entry['time_unix']:
                    existing_index = i
                    break
            
            if existing_index is not None:
                # 기존 항목 업데이트
                zone_data['segments'][existing_index] = segment_entry
            else:
                # 새 항목 추가
                zone_data['segments'].append(segment_entry)
        
        # 시간순 정렬
        zone_data['segments'].sort(key=lambda x: x.get('time_unix', 0))
        
        # 최신 상태 업데이트
        if zone_data['segments']:
            zone_data['latest'] = zone_data['segments'][-1]
        zone_data['last_updated'] = timestamp
        zone_data['total_segments'] = len(zone_data['segments'])
        zone_data['timeframe'] = timeframe
        
        # 파일에 저장 (덮어쓰기)
        with open(zone_file_path, 'w', encoding='utf-8') as f:
            json.dump(zone_data, f, ensure_ascii=False, indent=2)
        
        safe_print(f"💾 Zone segments saved: {len(segments)} points @ {timeframe} | Total: {len(zone_data['segments'])} segments")
        
        return jsonify({
            'ok': True,
            'saved': True,
            'file_path': zone_file_path,
            'timeframe': timeframe,
            'segments_saved': len(segments),
            'total_segments': len(zone_data['segments'])
        })
        
    except Exception as e:
        safe_print(f"❌ Zone segments save error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/container-state/get', methods=['GET'])
def api_container_state_get():
    """저장된 컨테이너 상태 조회"""
    try:
        file_path = os.path.join('data', 'container_state.json')
        
        if not os.path.exists(file_path):
            return jsonify({
                'ok': True,
                'exists': False,
                'data': None
            })
        
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        limit = request.args.get('limit', type=int)
        if limit and 'history' in data:
            data['history'] = data['history'][-limit:]
        
        return jsonify({
            'ok': True,
            'exists': True,
            'data': data
        })
        
    except Exception as e:
        safe_print(f"❌ Container state get error: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


def run():
    # Register extracted trade/auto-buy routes after all helpers are defined
    try:
        from trade_routes import register_trade_routes
        register_trade_routes(app, globals())
        logger.info("Trade routes registered from trade_routes.py")
    except Exception as e:
        logger.warning(f"Failed to register trade routes: {e}")

    # Load saved trainer storage data
    global _trainer_storage
    try:
        saved_data = _load_trainer_storage()
        if saved_data:
            _trainer_storage.update(saved_data)
            safe_print("[OK] Trainer storage data loaded successfully")
    except Exception as e:
        safe_print(f"[WARN] Failed to load trainer storage data: {e}")
    
    # Load trust configuration
    global _trust_config
    try:
        saved_trust = _load_trust_config()
        if saved_trust:
            _trust_config.update(saved_trust)
            safe_print(f"[OK] Trust config loaded: ML={_trust_config['ml_trust']}%, N/B={_trust_config['nb_trust']}%")
    except Exception as e:
        safe_print(f"[WARN] Failed to load trust config: {e}")
    
    # ===== 완전 자동화 시스템 =====
    # 모든 기능을 자동으로 실행하는 스케줄러
    AUTO_ENABLED = os.getenv("AUTO_ENABLED", "true").lower() == "true"
    
    if AUTO_ENABLED:
        print("[AUTO] 완전 자동화 시스템 활성화됨")
        # 자동 매매 루프 시작
        bot_ctrl['running'] = True  # 자동 매매 활성화
        threading.Thread(target=trade_loop, daemon=True).start()
        print("[AUTO] 자동 매매 루프 시작됨 (bot_ctrl['running'] = True)")
    
    threading.Thread(target=updater, daemon=True).start()
    threading.Thread(target=nb_auto_opt_loop, daemon=True).start()
    
    # 자동화 스케줄러 시작
    if AUTO_ENABLED:
        threading.Thread(target=auto_scheduler_loop, daemon=True).start()
        print("[AUTO] 자동화 스케줄러 시작됨")
    
    use_https = os.getenv("UI_HTTPS", "false").lower() == "true"
    ssl_ctx = 'adhoc' if use_https else None
    
    # 성능 최적화: werkzeug 디버거 비활성화, 멀티스레딩 활성화
    app.run(
        host="127.0.0.1", 
        port=int(os.getenv("UI_PORT", "5057")), 
        ssl_context=ssl_ctx, 
        threaded=True, 
        use_reloader=False,
        debug=False,
        processes=1
    )


if __name__ == "__main__":
    run()


