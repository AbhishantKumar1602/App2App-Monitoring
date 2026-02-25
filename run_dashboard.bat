@echo off
echo ==============================
echo Running App2App Data Script
echo ==============================

REM Go to project directory
cd /d "D:\OLM_project_de\App2App data Scraping"

REM Run Python script (generate JSON + Excel)
"C:\Program Files\Python312\python.exe" "D:\OLM_project_de\App2App Mine Dashboard\Date wise Data.py"

pause
