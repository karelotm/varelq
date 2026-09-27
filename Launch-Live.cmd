@echo off
cd /d "%~dp0"
set PORT=8081
echo VARELQ live NVIDIA session
echo Enter your NVIDIA Build API key at the hidden prompt.
echo After startup, open http://127.0.0.1:8081/
echo Keep this window open while using the app.
python run.py
pause

