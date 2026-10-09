@echo off
rem Запуск движка распознавания на CTranslate2 (faster-whisper).
rem Слушает http://127.0.0.1:8085 и отвечает в формате, который ждёт приложение.
rem Чтобы приложение его использовало, укажи в %APPDATA%\open-whispr\config.json:
rem   "whisperServerUrl": "http://127.0.0.1:8085"
cd /d "%~dp0"
".venv\Scripts\python.exe" server.py --port 8085 --threads 8 --beam 5 %*
