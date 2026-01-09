"""표준 API 응답 형식"""
from flask import jsonify
from typing import Optional, Dict, Any, Union
from .exceptions import ApiException


class ApiResponse:
    """표준 API 응답 클래스"""
    
    @staticmethod
    def success(data: Any = None, message: Optional[str] = None, status_code: int = 200) -> tuple:
        """
        성공 응답 생성
        
        Args:
            data: 응답 데이터
            message: 응답 메시지
            status_code: HTTP 상태 코드
        
        Returns:
            (JSON 응답, 상태 코드) 튜플
        """
        response = {
            'success': True,
            'ok': True,  # 기존 호환성 유지
        }
        
        if data is not None:
            response['data'] = data
        
        if message:
            response['message'] = message
        
        return jsonify(response), status_code
    
    @staticmethod
    def error(
        message: str,
        status_code: int = 400,
        details: Optional[Dict[str, Any]] = None,
        error_code: Optional[str] = None
    ) -> tuple:
        """
        오류 응답 생성
        
        Args:
            message: 오류 메시지
            status_code: HTTP 상태 코드
            details: 상세 정보
            error_code: 오류 코드
        
        Returns:
            (JSON 응답, 상태 코드) 튜플
        """
        response = {
            'success': False,
            'ok': False,  # 기존 호환성 유지
            'error': message,
        }
        
        if error_code:
            response['error_code'] = error_code
        
        if details:
            response['details'] = details
        
        return jsonify(response), status_code


# 편의 함수
def success_response(data: Any = None, message: Optional[str] = None, status_code: int = 200) -> tuple:
    """성공 응답 생성 (편의 함수)"""
    return ApiResponse.success(data, message, status_code)


def error_response(
    message: str,
    status_code: int = 400,
    details: Optional[Dict[str, Any]] = None,
    error_code: Optional[str] = None
) -> tuple:
    """오류 응답 생성 (편의 함수)"""
    return ApiResponse.error(message, status_code, details, error_code)


def handle_exception(e: Exception) -> tuple:
    """
    예외를 표준 응답 형식으로 변환
    
    Args:
        e: 예외 인스턴스
    
    Returns:
        (JSON 응답, 상태 코드) 튜플
    """
    if isinstance(e, ApiException):
        return ApiResponse.error(
            e.message,
            e.status_code,
            e.details,
            error_code=e.__class__.__name__
        )
    
    # 예상치 못한 예외
    from .logger import get_logger
    logger = get_logger()
    logger.error(f"Unexpected error: {e}", exc_info=True)
    
    # 프로덕션 환경에서는 상세 정보 숨김
    import os
    is_production = os.getenv('FLASK_ENV') == 'production'
    
    if is_production:
        return ApiResponse.error(
            "Internal server error",
            status_code=500,
            error_code="InternalServerError"
        )
    else:
        return ApiResponse.error(
            str(e),
            status_code=500,
            details={'type': type(e).__name__},
            error_code="InternalServerError"
        )

