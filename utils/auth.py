"""인증 및 권한 관리"""
import os
from typing import Optional
from functools import wraps
from flask import request
from .exceptions import AuthenticationError, AuthorizationError
from .logger import get_logger

logger = get_logger(__name__)


def get_api_key() -> Optional[str]:
    """환경 변수에서 API 키 가져오기"""
    return os.getenv('API_SECRET_KEY') or os.getenv('API_KEY')


def require_api_key(f):
    """
    API 키 인증 데코레이터
    
    사용법:
        @app.route('/api/endpoint')
        @require_api_key
        def endpoint():
            return success_response()
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 개발 환경에서는 인증 건너뛰기 옵션
        if os.getenv('SKIP_AUTH', 'false').lower() == 'true':
            return f(*args, **kwargs)
        
        api_key = request.headers.get('X-API-Key') or request.headers.get('Authorization')
        
        # Authorization 헤더에서 Bearer 토큰 추출
        if api_key and api_key.startswith('Bearer '):
            api_key = api_key[7:]
        
        expected_key = get_api_key()
        
        if not expected_key:
            logger.warning("API key not configured, allowing request")
            return f(*args, **kwargs)
        
        if not api_key or api_key != expected_key:
            logger.warning(f"Invalid API key attempt from {request.remote_addr}")
            raise AuthenticationError("Invalid or missing API key")
        
        return f(*args, **kwargs)
    
    return decorated_function


def require_auth(require_api_key: bool = True):
    """
    인증 요구 데코레이터 팩토리
    
    Args:
        require_api_key: API 키 인증 필요 여부
    
    사용법:
        @app.route('/api/endpoint')
        @require_auth(require_api_key=True)
        def endpoint():
            return success_response()
    """
    def decorator(f):
        if require_api_key:
            return require_api_key(f)
        return f
    return decorator


def mask_api_key(key: str) -> str:
    """
    API 키 마스킹 (로깅용)
    
    Args:
        key: API 키
    
    Returns:
        마스킹된 API 키 (예: "sk_live_****1234")
    """
    if not key or len(key) < 8:
        return "****"
    return f"{key[:4]}****{key[-4:]}"

