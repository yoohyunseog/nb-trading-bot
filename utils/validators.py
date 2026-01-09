"""입력 검증 유틸리티"""
from typing import Any, Dict, Optional, List, Callable
from flask import request
from .exceptions import ValidationError
from .logger import get_logger

logger = get_logger(__name__)


def validate_request(
    required_fields: Optional[List[str]] = None,
    field_validators: Optional[Dict[str, Callable]] = None,
    allow_empty: bool = False
) -> Dict[str, Any]:
    """
    요청 데이터 검증
    
    Args:
        required_fields: 필수 필드 목록
        field_validators: 필드별 검증 함수 딕셔너리
        allow_empty: 빈 요청 허용 여부
    
    Returns:
        검증된 요청 데이터
    
    Raises:
        ValidationError: 검증 실패 시
    """
    # 요청 데이터 가져오기
    if request.is_json:
        data = request.get_json(force=True) or {}
    elif request.form:
        data = request.form.to_dict()
    else:
        data = {}
    
    if not data and not allow_empty:
        raise ValidationError("Request body is required")
    
    # 필수 필드 검증
    if required_fields:
        missing_fields = [field for field in required_fields if field not in data]
        if missing_fields:
            raise ValidationError(
                f"Missing required fields: {', '.join(missing_fields)}",
                details={'missing_fields': missing_fields}
            )
    
    # 필드별 검증
    if field_validators:
        errors = {}
        for field, validator in field_validators.items():
            if field in data:
                try:
                    data[field] = validator(data[field])
                except ValueError as e:
                    errors[field] = str(e)
                except Exception as e:
                    logger.error(f"Validation error for field {field}: {e}")
                    errors[field] = f"Invalid value for {field}"
        
        if errors:
            raise ValidationError(
                "Validation failed",
                details={'errors': errors}
            )
    
    return data


def validate_market(market: str) -> str:
    """마켓 이름 검증"""
    if not market or not isinstance(market, str):
        raise ValueError("Market must be a non-empty string")
    
    # 기본 형식 검증 (예: KRW-BTC)
    if '-' not in market:
        raise ValueError("Market must be in format 'BASE-QUOTE' (e.g., KRW-BTC)")
    
    parts = market.split('-')
    if len(parts) != 2:
        raise ValueError("Market must be in format 'BASE-QUOTE' (e.g., KRW-BTC)")
    
    return market.upper()


def validate_interval(interval: str) -> str:
    """시간 간격 검증"""
    valid_intervals = [
        'minute1', 'minute3', 'minute5', 'minute10',
        'minute15', 'minute30', 'minute60', 'hour1',
        'hour4', 'hour24', 'day', 'week', 'month'
    ]
    
    if not interval or interval not in valid_intervals:
        raise ValueError(
            f"Interval must be one of: {', '.join(valid_intervals)}"
        )
    
    return interval


def validate_positive_number(value: Any, field_name: str = "value") -> float:
    """양수 검증"""
    try:
        num = float(value)
    except (ValueError, TypeError):
        raise ValueError(f"{field_name} must be a number")
    
    if num <= 0:
        raise ValueError(f"{field_name} must be positive")
    
    return num


def validate_non_negative_number(value: Any, field_name: str = "value") -> float:
    """0 이상 숫자 검증"""
    try:
        num = float(value)
    except (ValueError, TypeError):
        raise ValueError(f"{field_name} must be a number")
    
    if num < 0:
        raise ValueError(f"{field_name} must be non-negative")
    
    return num


def validate_percentage(value: Any, field_name: str = "value") -> float:
    """퍼센트 값 검증 (0-100)"""
    try:
        num = float(value)
    except (ValueError, TypeError):
        raise ValueError(f"{field_name} must be a number")
    
    if num < 0 or num > 100:
        raise ValueError(f"{field_name} must be between 0 and 100")
    
    return num


def validate_boolean(value: Any, field_name: str = "value") -> bool:
    """불리언 값 검증"""
    if isinstance(value, bool):
        return value
    
    if isinstance(value, str):
        return value.lower() in ('true', '1', 'yes', 'on')
    
    if isinstance(value, (int, float)):
        return bool(value)
    
    raise ValueError(f"{field_name} must be a boolean")

