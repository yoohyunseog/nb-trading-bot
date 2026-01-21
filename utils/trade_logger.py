"""
거래 로그 전용 모듈
매수/매도 및 자동 구매 이벤트를 파일에 기록
"""
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any


class TradeLogger:
    """거래 로그 관리 클래스"""
    
    def __init__(self, log_dir: str = 'logs'):
        """
        Args:
            log_dir: 로그 파일을 저장할 디렉토리
        """
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(exist_ok=True)
        
        self.trade_log_path = self.log_dir / 'trade.log'
        self.auto_buy_log_path = self.log_dir / 'auto_buy.log'
        
        # 로그 파일 초기화 (헤더가 없으면 추가)
        self._init_log_file(self.trade_log_path, '# 매수/매도 거래 로그\n# 형식: [타임스탬프] [액션] [마켓] [가격] [수량] [금액] [상태]\n')
        self._init_log_file(self.auto_buy_log_path, '# 자동 구매 로그\n# 형식: [타임스탬프] [액션] [리그] [등급] [가격대%] [금액] [상태] [사유]\n')
    
    def _init_log_file(self, path: Path, header: str):
        """로그 파일 초기화 (헤더 추가)"""
        if not path.exists():
            with open(path, 'w', encoding='utf-8') as f:
                f.write(header + '\n')
    
    def _write_log(self, path: Path, message: str):
        """로그 파일에 메시지 기록"""
        try:
            with open(path, 'a', encoding='utf-8') as f:
                f.write(message + '\n')
        except Exception as e:
            print(f"⚠️ 로그 기록 실패: {e}")
    
    def log_trade(self, 
                  action: str, 
                  market: str, 
                  price: float, 
                  size: float, 
                  amount: float, 
                  status: str = 'SUCCESS',
                  extra: Optional[Dict[str, Any]] = None):
        """
        매수/매도 거래 로그 기록
        
        Args:
            action: 'BUY' 또는 'SELL'
            market: 마켓 코드 (예: 'KRW-BTC')
            price: 체결 가격
            size: 거래 수량
            amount: 거래 금액 (KRW)
            status: 거래 상태 ('SUCCESS', 'FAILED', 'PENDING')
            extra: 추가 정보 (선택)
        """
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        extra_str = ''
        if extra:
            extra_str = ' | ' + ' | '.join(f'{k}={v}' for k, v in extra.items())
        
        log_message = f'[{timestamp}] {action:5s} {market:10s} {price:12.0f} {size:12.8f} {amount:10.0f} {status:7s}{extra_str}'
        
        self._write_log(self.trade_log_path, log_message)
        print(f'📝 Trade Log: {log_message}')
    
    def log_auto_buy(self,
                     league: str,
                     grade: str,
                     percent: str,
                     amount: float,
                     status: str = 'SUCCESS',
                     reason: str = '-'):
        """
        자동 구매 로그 기록
        
        Args:
            league: 리그 (예: 'Challenger', 'Gold')
            grade: 등급 (예: 'SSS+', 'SS')
            percent: 가격대 퍼센트 (예: '50', '51.5')
            amount: 구매 금액 (KRW)
            status: 상태 ('SUCCESS', 'BLOCKED', 'FAILED')
            reason: 사유 (차단/실패 시 이유)
        """
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        log_message = f'[{timestamp}] AUTO_BUY {league:12s} {grade:5s} {percent:6s} {amount:12.0f} {status:8s} {reason}'
        
        self._write_log(self.auto_buy_log_path, log_message)
        print(f'📝 AutoBuy Log: {log_message}')
    
    def log_auto_buy_check(self,
                          league: str,
                          grade: str,
                          percent: str,
                          allowed: bool,
                          reason: str):
        """
        자동 구매 중복 확인 로그 기록
        
        Args:
            league: 리그
            grade: 등급
            percent: 가격대 퍼센트
            allowed: 구매 허용 여부
            reason: 판단 사유
        """
        status = 'ALLOWED' if allowed else 'BLOCKED'
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        log_message = f'[{timestamp}] CHECK    {league:12s} {grade:5s} {percent:6s} {"":12s} {status:8s} {reason}'
        
        self._write_log(self.auto_buy_log_path, log_message)
        print(f'🔍 AutoBuy Check: {log_message}')
    
    def get_recent_trades(self, count: int = 50) -> list:
        """최근 거래 로그 조회"""
        try:
            with open(self.trade_log_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # 헤더와 빈 줄 제외
            log_lines = [line.strip() for line in lines if line.strip() and not line.startswith('#')]
            
            # 최근 N개 반환
            return log_lines[-count:]
        except Exception as e:
            print(f"⚠️ 거래 로그 조회 실패: {e}")
            return []
    
    def get_recent_auto_buys(self, count: int = 50) -> list:
        """최근 자동 구매 로그 조회"""
        try:
            with open(self.auto_buy_log_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # 헤더와 빈 줄 제외
            log_lines = [line.strip() for line in lines if line.strip() and not line.startswith('#')]
            
            # 최근 N개 반환
            return log_lines[-count:]
        except Exception as e:
            print(f"⚠️ 자동 구매 로그 조회 실패: {e}")
            return []


# 싱글톤 인스턴스
_trade_logger_instance = None


def get_trade_logger(log_dir: str = 'logs') -> TradeLogger:
    """TradeLogger 싱글톤 인스턴스 반환"""
    global _trade_logger_instance
    if _trade_logger_instance is None:
        _trade_logger_instance = TradeLogger(log_dir)
    return _trade_logger_instance
