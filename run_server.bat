@echo off
chcp 65001 >nul
echo ========================================
echo 8BIT Bot Server 실행
echo ========================================
echo.

REM 가상환경 활성화
echo [1/2] 가상환경 활성화 중...
if exist "E:\python_env\Scripts\activate.bat" (
    call "E:\python_env\Scripts\activate.bat"
    echo 가상환경 활성화: E:\python_env
) else if exist "..\python_env\Scripts\activate.bat" (
    call "..\python_env\Scripts\activate.bat"
    echo 가상환경 활성화: ..\python_env
) else if exist "python_env\Scripts\activate.bat" (
    call "python_env\Scripts\activate.bat"
    echo 가상환경 활성화: python_env
) else (
    echo [경고] 가상환경을 찾을 수 없습니다. 시스템 Python을 사용합니다.
)
echo.

REM 작업 디렉토리로 이동
echo [2/2] 작업 디렉토리로 이동 중...
cd /d "%~dp0"
echo 현재 디렉토리: %CD%
echo.

REM Python 버전 확인
echo Python 버전 확인 중...
python --version
if errorlevel 1 (
    echo [오류] Python을 찾을 수 없습니다.
    pause
    exit /b 1
)
echo.

REM Server 실행
echo ========================================
echo Server 실행 중...
echo ========================================
echo.
python server.py

REM 프로그램 종료 후
if errorlevel 1 (
    echo.
    echo [오류] Server 실행 중 오류가 발생했습니다.
    pause
)

