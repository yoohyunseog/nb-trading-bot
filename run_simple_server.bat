@echo off
chcp 65001 >nul
cls

echo ========================================
echo 8BIT Bot Simple Server 실행
echo ========================================
echo.

REM 가상환경 활성화 (경로에 맞게 수정)
if exist E:\python_env\Scripts\activate.bat (
    echo [1/2] 가상환경 활성화: E:\python_env
    call E:\python_env\Scripts\activate.bat
) else (
    echo [!] 가상환경을 찾을 수 없습니다.
    echo [!] Python이 시스템에 설치되어 있어야 합니다.
)

echo [2/2] 작업 디렉토리로 이동 중...
cd /d "%~dp0"
echo 현재 디렉토리: %CD%
echo.

echo Python 버전 확인 중...
python --version
echo.

echo ========================================
echo Simple Server 실행 중...
echo ========================================
echo 접속 URL: http://localhost:5100/
echo ========================================
echo.

python server_simple.py

if errorlevel 1 (
    echo.
    echo [오류] Simple Server 실행 중 오류가 발생했습니다.
)

pause
