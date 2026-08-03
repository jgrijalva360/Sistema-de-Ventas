' iniciar-oculto.vbs
' Inicia el servidor de inventario en segundo plano sin ventana visible.
' Para detenerlo: ejecuta "detener-servidor.bat"

Dim WshShell
Set WshShell = CreateObject("WScript.Shell")

' Guardar el PID en un archivo para poder detenerlo después
Dim sPath
sPath = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' Ejecutar node server.js sin ventana (0 = oculto)
WshShell.Run "cmd /c cd /d """ & sPath & """ && node server.js > server.log 2>&1", 0, False

Set WshShell = Nothing
