@echo off
chcp 65001 > nul
title Deteniendo servidor de inventario...

echo Buscando proceso del servidor (node.exe en puerto 3000)...

:: Buscar el PID que usa el puerto 3000 y terminarlo
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo Deteniendo proceso PID: %%a
    taskkill /PID %%a /F
    echo Servidor detenido correctamente.
    goto :fin
)

echo No se encontro ningun servidor corriendo en el puerto 3000.

:fin
timeout /t 2 > nul
