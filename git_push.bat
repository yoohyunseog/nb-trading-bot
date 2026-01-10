@echo off
chcp 65001 >nul
echo ========================================
echo Git Push Automation
echo ========================================
echo.

REM 현재 날짜와 시간 가져오기
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%a-%%b-%%c)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a:%%b)

REM 기본 커밋 메시지 설정
set DEFAULT_MESSAGE=Update %mydate% %mytime%

echo 현재 변경사항을 확인합니다...
git status
echo.

REM 커밋 메시지 입력받기
set /p COMMIT_MSG="커밋 메시지를 입력하세요 (엔터=기본: %DEFAULT_MESSAGE%): "

REM 입력이 없으면 기본 메시지 사용
if "%COMMIT_MSG%"=="" set COMMIT_MSG=%DEFAULT_MESSAGE%

echo.
echo ========================================
echo Step 1: git add .
echo ========================================
git add .

echo.
echo ========================================
echo Step 2: git commit
echo ========================================
git commit -m "%COMMIT_MSG%"

if errorlevel 1 (
    echo.
    echo ⚠️ 커밋할 변경사항이 없거나 오류가 발생했습니다.
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Step 3: git push
echo ========================================
git push

if errorlevel 1 (
    echo.
    echo ❌ Push 실패! 에러를 확인하세요.
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo ✅ Git Push 완료!
echo ========================================
echo 커밋 메시지: %COMMIT_MSG%
echo.
pause
