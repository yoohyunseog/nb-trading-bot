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

# 테스트
test_path = "E:\\Gif\\www\\hankookin.center\\8BIT\\bot\\nb-bot-ai-v0.0.2\\data\\nbverse\\card_minute3_20260109_021719_781728.json"
result = _normalize_nbverse_path(test_path)
print(f"Input: {test_path}")
print(f"Output: {result}")
