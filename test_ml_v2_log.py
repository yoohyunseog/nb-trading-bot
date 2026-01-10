#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ML V2 로그 테스트
"""

print("=" * 60)
print("[TEST] rating_ml_v2 로그 테스트 시작")
print("=" * 60)

# rating_ml_v2 import 시 자동으로 로그 생성
from rating_ml_v2 import get_ml_system_v2

print("\n[TEST] rating_ml_v2 import 완료")

# 시스템 인스턴스 생성
system = get_ml_system_v2()

print("\n[TEST] 시스템 상태 확인...")
status = system.get_status()

print(f"\n[TEST] Zone Model Loaded: {status['zone_model']['loaded']}")
print(f"[TEST] Profit Model Loaded: {status['profit_model']['loaded']}")

print("\n" + "=" * 60)
print("[TEST] 테스트 완료 - logs/ml_v2.log 파일 확인하세요")
print("=" * 60)
