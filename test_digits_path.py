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

# 테스트
test_cases = [
    13.556440816326532,  # MAX 예시
    17.590906122448978,  # MIN 예시
]

for val in test_cases:
    segs, stem = _nbverse_digits_path(val)
    path = '/'.join(segs)
    print(f"값: {val}")
    print(f"경로: data/nbverse/max/{path}/this_card.json")
    print(f"stem: {stem}")
    print()
