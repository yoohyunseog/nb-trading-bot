"""커스텀 예외 클래스"""
from typing import Optional, Dict, Any


class ApiException(Exception):
    """API 예외 기본 클래스"""
    
    def __init__(self, message: str, status_code: int = 500, details: Optional[Dict[str, Any]] = None):
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(self.message)


class ValidationError(ApiException):
    """입력 검증 오류"""
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, status_code=400, details=details)


class AuthenticationError(ApiException):
    """인증 오류"""
    
    def __init__(self, message: str = "Authentication required", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, status_code=401, details=details)


class AuthorizationError(ApiException):
    """권한 오류"""
    
    def __init__(self, message: str = "Insufficient permissions", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, status_code=403, details=details)


class NotFoundError(ApiException):
    """리소스를 찾을 수 없음"""
    
    def __init__(self, message: str = "Resource not found", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, status_code=404, details=details)


class InternalServerError(ApiException):
    """내부 서버 오류"""
    
    def __init__(self, message: str = "Internal server error", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, status_code=500, details=details)


class ExternalApiError(ApiException):
    """외부 API 오류"""
    
    def __init__(self, message: str, status_code: int = 503, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, status_code=status_code, details=details)

