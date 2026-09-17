@echo off
rem ==========================================================================
rem  UniverseTI Assistencia - inicializador para Windows
rem  Dá duplo clique neste arquivo para subir o sistema e abrir o navegador.
rem ==========================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js nao encontrado.
  echo   Baixe a versao LTS em https://nodejs.org e instale antes de continuar.
  echo.
  pause
  exit /b 1
)

if not exist "data\tecnoflow.db" (
  echo.
  echo   Primeira execucao: criando banco de dados com dados de demonstracao...
  call node --no-warnings server\seed.js
)

echo.
echo   Iniciando o UniverseTI Assistencia... mantenha esta janela aberta.
echo   Para encerrar o sistema, feche a janela ou pressione Ctrl+C.
echo.

start "" http://localhost:3000
node --no-warnings server\index.js

pause
