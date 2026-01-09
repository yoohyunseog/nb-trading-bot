"""NBverse 헬퍼 함수들"""
import os
import json
from datetime import datetime

def _nbverse_digits_path(value: float, decimal_places: int = 10) -> tuple[list[str], str]:
    """Build nested digit path segments from a numeric value (정수 + 소수 10자리).
    Example: 13.556440816326532 -> segments ['1','3','5','5','6','4','4','0','8','1','6','3'], stem '1355644081'
    정수 부분과 소수점 10자리를 각각 폴더로 생성.
    """
    try:
        v = float(value)
        # 정수 부분과 소수 부분 분리
        int_part = int(v)
        decimal_part = v - int_part
        
        # 정수 부분을 자릿수별로 분해
        int_str = str(abs(int_part))
        int_digits = list(int_str)
        
        # 소수 부분을 10자리까지 추출
        decimal_str = f"{abs(decimal_part):.10f}"[2:]  # "0." 제거하고 10자리 추출
        decimal_digits = list(decimal_str[:10])
        
        # 모든 자릿수 조합
        segments = int_digits + decimal_digits
        
        # stem: 정수 + 소수 10자리 조합
        stem = ''.join(int_digits) + ''.join(decimal_digits)
        
        return segments, stem
    except Exception:
        return ["0"], "0"


def _normalize_nbverse_path(path_str: str) -> str:
    """
    절대 경로를 상대 경로로 정규화
    예: E:\...\data\nbverse\... → data/nbverse/...
    """
    if not path_str:
        return ""
    try:
        # 경로를 정규화 (백슬래시를 슬래시로)
        normalized = path_str.replace('\\', '/')
        
        # 절대 경로인 경우 data/nbverse부터 추출
        if '/' in normalized:
            # data/nbverse 포함 부분부터 추출
            if 'data/nbverse' in normalized:
                idx = normalized.index('data/nbverse')
                return normalized[idx:]
        
        # 상대 경로면 그대로 반환
        return path_str
    except Exception:
        return path_str


def _load_nbverse_snapshot(path_str: str, base_dir: str) -> dict:
    """NBverse 스냅샷 로드"""
    try:
        if not path_str:
            return {}
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


def save_nbverse_card(max_val: float, min_val: float, interval: str, current_price: float,
                      chart_data: list, nb_values: list, base_dir: str, logger=None) -> dict:
    """MAX/MIN 값을 hierarchical path에 this_card.json으로 저장"""
    meta = {'paths': {}}
    
    # 현재 카드 데이터
    card_data = {
        'nb': {
            'category': 'price',
            'max': float(max_val),
            'min': float(min_val),
            'values': list(map(float, nb_values or [])),
        },
        'interval': str(interval),
        'current_price': float(current_price),
        'chart_data': chart_data,
        'decimal_places': 10,
        'calculated_at': datetime.now().isoformat(),
        'version': 'nbverse.card.v1'
    }
    
    try:
        # MAX: 경로에 this_card.json으로 저장
        max_segs, max_stem = _nbverse_digits_path(max_val, 10)
        max_dir = os.path.join(base_dir, 'max', *max_segs)
        os.makedirs(max_dir, exist_ok=True)
        max_card_path = os.path.join(max_dir, 'this_card.json')
        with open(max_card_path, 'w', encoding='utf-8') as f:
            json.dump(card_data, f, ensure_ascii=False, indent=2)
        max_path_relative = os.path.relpath(max_card_path, os.path.dirname(base_dir))
        max_path_relative = max_path_relative.replace('\\', '/')
        meta['paths']['max'] = max_path_relative
        if logger:
            logger.debug(f"✅ MAX 카드 저장: {max_path_relative}")
    except Exception as e:
        meta['paths']['max_error'] = str(e)
        if logger:
            logger.error(f"❌ MAX 카드 저장 실패: {e}")
    
    try:
        # MIN: 경로에 this_card.json으로 저장
        min_segs, min_stem = _nbverse_digits_path(min_val, 10)
        min_dir = os.path.join(base_dir, 'min', *min_segs)
        os.makedirs(min_dir, exist_ok=True)
        min_card_path = os.path.join(min_dir, 'this_card.json')
        with open(min_card_path, 'w', encoding='utf-8') as f:
            json.dump(card_data, f, ensure_ascii=False, indent=2)
        min_path_relative = os.path.relpath(min_card_path, os.path.dirname(base_dir))
        min_path_relative = min_path_relative.replace('\\', '/')
        meta['paths']['min'] = min_path_relative
        if logger:
            logger.debug(f"✅ MIN 카드 저장: {min_path_relative}")
    except Exception as e:
        meta['paths']['min_error'] = str(e)
        if logger:
            logger.error(f"❌ MIN 카드 저장 실패: {e}")
    
    return meta
