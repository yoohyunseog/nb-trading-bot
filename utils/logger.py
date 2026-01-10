"""로깅 시스템 설정"""
import os
import sys
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Windows 콘솔 인코딩 문제 해결
if sys.platform == 'win32':
    import io
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass


def setup_logger(name: str = '8bit_bot', log_dir: str = 'logs', level: str = None):
    """
    로거 설정
    
    Args:
        name: 로거 이름
        log_dir: 로그 파일 저장 디렉토리
        level: 로그 레벨 (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    
    Returns:
        설정된 로거 인스턴스
    """
    # 로그 레벨 결정
    if level is None:
        level = os.getenv('LOG_LEVEL', 'INFO').upper()
    
    log_level = getattr(logging, level, logging.INFO)
    
    # 로거 생성
    logger = logging.getLogger(name)
    logger.setLevel(log_level)
    
    # 이미 핸들러가 있으면 중복 추가 방지
    if logger.handlers:
        return logger
    
    # 로그 디렉토리 생성
    log_path = Path(log_dir)
    log_path.mkdir(exist_ok=True)
    
    # 포맷터 설정
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # 로그 파일명 결정 (name에 따라 다른 파일)
    if name == 'ml_v2':
        log_filename = 'ml_v2.log'
    else:
        log_filename = 'bot.log'
    
    # 파일 핸들러 (회전 로그)
    file_handler = RotatingFileHandler(
        log_path / log_filename,
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5,
        encoding='utf-8'
    )
    file_handler.setLevel(log_level)
    file_handler.setFormatter(formatter)
    
    # 콘솔 핸들러
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    
    # 핸들러 추가
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    # 즉시 flush 설정
    logger.propagate = False
    
    return logger
    logger.addHandler(console_handler)
    
    return logger


def get_logger(name: str = None):
    """
    로거 인스턴스 가져오기
    
    Args:
        name: 로거 이름 (None이면 기본 로거)
    
    Returns:
        로거 인스턴스
    """
    if name:
        return logging.getLogger(name)
    return logging.getLogger('8bit_bot')


# 안전한 출력 함수 (기존 safe_print 호환성 유지)
def safe_print(*args, **kwargs):
    """안전한 출력 함수 - Windows 콘솔 인코딩 문제 방지"""
    logger = get_logger()
    try:
        message = ' '.join(str(arg) for arg in args)
        logger.info(message)
    except Exception:
        try:
            print(*args, **kwargs)
        except (UnicodeEncodeError, UnicodeError):
            safe_args = []
            for arg in args:
                if isinstance(arg, str):
                    safe_arg = arg.replace('✅', '[OK]').replace('⚠️', '[WARN]').replace('❌', '[ERROR]')
                    safe_arg = safe_arg.encode('ascii', 'ignore').decode('ascii')
                    safe_args.append(safe_arg)
                else:
                    safe_args.append(arg)
            print(*safe_args, **kwargs)

