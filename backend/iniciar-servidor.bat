@echo off
chcp 65001 > nul
title Sistema de Inventario — Servidor de Red Local

echo.
echo  Iniciando servidor de red local...
echo  (Si es la primera vez, se instalarán las dependencias. Espera un momento.)
echo.

cd /d "%~dp0"

:: Instalar dependencias si no existen
if not exist "node_modules" (
    echo  Instalando dependencias de Node.js...
    npm install
    echo.
)

:: Iniciar servidor
node server.js

echo.
echo  El servidor se ha detenido.
pause
