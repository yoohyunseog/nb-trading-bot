"""설정 관리 모듈"""
import os
from dataclasses import dataclass
from typing import Optional
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()


@dataclass
class VillageConfig:
    """마을 시스템 설정"""
    energy: int = 150
    max_energy: int = 100
    energy_accumulated: int = 150
    energy_decay_per_sec: float = 0.001
    rest_after_first_coin: bool = True
    rest_bars: int = 3


@dataclass
class MayorTrustConfig:
    """촌장 신뢰도 시스템 설정"""
    ml_model_trust: int = 40
    nb_guild_trust: int = 82
    auto_learning_enabled: bool = True
    learning_interval: int = 3600  # 초 단위


@dataclass
class TradingConfig:
    """거래 설정"""
    market: str = "KRW-BTC"
    candle: str = "minute10"
    order_krw: int = 5000
    paper: bool = True
    ema_fast: int = 10
    ema_slow: int = 30
    interval_sec: int = 30
    pnl_profit_ratio: float = 0.0
    pnl_loss_ratio: float = 0.0
    min_coin_reserve_krw: float = 5000.0


@dataclass
class NBWaveConfig:
    """N/B Wave 설정"""
    nb_high: float = 0.55
    nb_low: float = 0.45
    window: int = 100
    zone100_th: float = 80.0


@dataclass
class MLConfig:
    """ML 모델 설정"""
    require_ml_confirm: bool = False
    ml_seg_only: bool = False
    ml_only: bool = False


@dataclass
class ServerConfig:
    """서버 설정"""
    ui_port: int = 5057
    ui_https: bool = False
    debug: bool = False
    log_level: str = "INFO"
    skip_auth: bool = False
    api_secret_key: Optional[str] = None
    cors_origins: str = "*"


@dataclass
class UpbitConfig:
    """Upbit API 설정"""
    access_key: Optional[str] = None
    secret_key: Optional[str] = None
    open_api_access_key: Optional[str] = None
    open_api_secret_key: Optional[str] = None
    open_api_server_url: str = "https://api.upbit.com"


class Config:
    """전체 설정 클래스"""
    
    def __init__(self):
        # 서버 설정
        self.server = ServerConfig(
            ui_port=int(os.getenv('UI_PORT', '5057')),
            ui_https=os.getenv('UI_HTTPS', 'false').lower() == 'true',
            debug=os.getenv('FLASK_DEBUG', 'false').lower() == 'true',
            log_level=os.getenv('LOG_LEVEL', 'INFO'),
            skip_auth=os.getenv('SKIP_AUTH', 'false').lower() == 'true',
            api_secret_key=os.getenv('API_SECRET_KEY') or os.getenv('API_KEY'),
            cors_origins=os.getenv('CORS_ORIGINS', '*')
        )
        
        # Upbit 설정
        self.upbit = UpbitConfig(
            access_key=os.getenv('UPBIT_ACCESS_KEY'),
            secret_key=os.getenv('UPBIT_SECRET_KEY'),
            open_api_access_key=os.getenv('UPBIT_OPEN_API_ACCESS_KEY'),
            open_api_secret_key=os.getenv('UPBIT_OPEN_API_SECRET_KEY'),
            open_api_server_url=os.getenv('UPBIT_OPEN_API_SERVER_URL', 'https://api.upbit.com')
        )
        
        # 거래 설정
        self.trading = TradingConfig(
            market=os.getenv('MARKET', 'KRW-BTC'),
            candle=os.getenv('CANDLE', 'minute10'),
            order_krw=int(os.getenv('ORDER_KRW', '5000')),
            paper=os.getenv('PAPER', 'true').lower() == 'true',
            ema_fast=int(os.getenv('EMA_FAST', '10')),
            ema_slow=int(os.getenv('EMA_SLOW', '30')),
            interval_sec=int(os.getenv('INTERVAL_SEC', '30')),
            pnl_profit_ratio=float(os.getenv('PNL_PROFIT_RATIO', '0.0')),
            pnl_loss_ratio=float(os.getenv('PNL_LOSS_RATIO', '0.0')),
            min_coin_reserve_krw=float(os.getenv('MIN_COIN_RESERVE_KRW', '5000.0'))
        )
        
        # N/B Wave 설정
        self.nb_wave = NBWaveConfig(
            nb_high=float(os.getenv('NB_HIGH', '0.55')),
            nb_low=float(os.getenv('NB_LOW', '0.45')),
            window=int(os.getenv('NB_WINDOW', '100')),
            zone100_th=float(os.getenv('ZONE100_TH', '80.0'))
        )
        
        # ML 설정
        self.ml = MLConfig(
            require_ml_confirm=os.getenv('REQUIRE_ML_CONFIRM', 'false').lower() == 'true',
            ml_seg_only=os.getenv('ML_SEG_ONLY', 'false').lower() == 'true',
            ml_only=os.getenv('ML_ONLY', 'false').lower() == 'true'
        )
        
        # 마을 설정
        self.village = VillageConfig(
            energy=int(os.getenv('VILLAGE_ENERGY', '150')),
            max_energy=int(os.getenv('MAX_VILLAGE_ENERGY', '100')),
            energy_accumulated=int(os.getenv('ENERGY_ACCUMULATED', '150')),
            energy_decay_per_sec=float(os.getenv('ENERGY_DECAY_PER_SEC', '0.001')),
            rest_after_first_coin=os.getenv('REST_AFTER_FIRST_COIN', 'true').lower() == 'true',
            rest_bars=int(os.getenv('REST_BARS', '3'))
        )
        
        # 촌장 신뢰도 설정
        self.mayor_trust = MayorTrustConfig(
            ml_model_trust=int(os.getenv('ML_MODEL_TRUST', '40')),
            nb_guild_trust=int(os.getenv('NB_GUILD_TRUST', '82')),
            auto_learning_enabled=os.getenv('AUTO_LEARNING_ENABLED', 'true').lower() == 'true',
            learning_interval=int(os.getenv('LEARNING_INTERVAL', '3600'))
        )
    
    def to_dict(self) -> dict:
        """설정을 딕셔너리로 변환 (민감한 정보 제외)"""
        return {
            'server': {
                'ui_port': self.server.ui_port,
                'ui_https': self.server.ui_https,
                'debug': self.server.debug,
                'log_level': self.server.log_level,
            },
            'trading': {
                'market': self.trading.market,
                'candle': self.trading.candle,
                'order_krw': self.trading.order_krw,
                'paper': self.trading.paper,
            },
            'nb_wave': {
                'nb_high': self.nb_wave.nb_high,
                'nb_low': self.nb_wave.nb_low,
                'window': self.nb_wave.window,
            },
            'village': {
                'energy': self.village.energy,
                'max_energy': self.village.max_energy,
            },
        }


# 전역 설정 인스턴스
config = Config()

