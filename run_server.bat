@echo off
echo ========================================
echo 8BIT Bot Server Start
echo ========================================
echo.

REM Activate virtual environment
echo [1/2] Activating virtual environment...
if exist "E:\python_env\Scripts\activate.bat" (
    call "E:\python_env\Scripts\activate.bat"
    echo Virtual environment activated: E:\python_env
) else if exist "..\python_env\Scripts\activate.bat" (
    call "..\python_env\Scripts\activate.bat"
    echo Virtual environment activated: ..\python_env
) else if exist "python_env\Scripts\activate.bat" (
    call "python_env\Scripts\activate.bat"
    echo Virtual environment activated: python_env
) else (
    echo [WARNING] Virtual environment not found. Using system Python.
)
echo.

REM Change to working directory
echo [2/2] Changing to working directory...
cd /d "%~dp0"
echo Current directory: %CD%
echo.

REM Check Python version
echo Checking Python version...
python --version
if errorlevel 1 (
    echo [ERROR] Python not found.
    pause
    exit /b 1
)
echo.

REM Run server
echo ========================================
echo Starting Server...
echo ========================================
echo.
python server.py

REM After program termination
if errorlevel 1 (
    echo.
    echo [ERROR] Server encountered an error.
    pause
    exit /b 1
)

echo.
echo Server stopped normally.
pause

