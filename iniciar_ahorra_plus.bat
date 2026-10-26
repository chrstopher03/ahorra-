@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Necesitas instalar Node.js 18 o superior para iniciar el servidor de Mimi AI.
  echo Puedes abrir index.html directamente, pero Mimi funcionara en modo local sin IA completa.
  pause
  exit /b 1
)
node server.js
pause
