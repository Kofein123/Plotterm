@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Открываю онлайн-версию Plotterm...
  echo Чтобы работать без интернета, установите Node.js: https://nodejs.org
  start "" "https://kofein123.github.io/Plotterm/"
  timeout /t 8 >nul
  exit /b
)
echo Запускаю Plotterm. Не закрывайте это окно, пока работаете с плоттером.
node scripts\serve.mjs 8080 --open
pause
