@echo off
setlocal enabledelayedexpansion

echo ╔════════════════════════════════════════╗
echo ║     DAD Audio Monitor Installer        ║
echo ╔════════════════════════════════════════╝
echo.
echo Installing DAD Audio Monitor...
set "targetDir=%APPDATA%\DAD-AudioMonitor"
mkdir "%targetDir%" 2>nul

echo Checking for available ports...

:: Create PowerShell script with dynamic port selection
(
echo Add-Type @'
echo using System; using System.Runtime.InteropServices; using System.Net; using System.Net.Sockets; using System.IO;
echo public class AudioCheck {
echo     [DllImport("winmm.dll")] public static extern int waveOutGetVolume(IntPtr h, out uint v);
echo     public static int GetVolume() { uint v; waveOutGetVolume(IntPtr.Zero, out v); return (int)((v ^& 0xFFFF) / 655.35); }
echo     public static bool IsMuted() { uint v; waveOutGetVolume(IntPtr.Zero, out v); return v == 0; }
echo     
echo     public static int FindFreePort(int startPort) {
echo         for (int port = startPort; port ^< startPort + 100; port++) {
echo             try {
echo                 TcpListener listener = new TcpListener(IPAddress.Loopback, port);
echo                 listener.Start();
echo                 listener.Stop();
echo                 return port;
echo             } catch { }
echo         }
echo         return -1;
echo     }
echo }
echo '@
echo.
echo # Try to find a free port starting from 15789
echo $startPort = 15789
echo $port = [AudioCheck]::FindFreePort($startPort^)
echo.
echo if ($port -eq -1) {
echo     Write-Host "ERROR: No free ports available in range $startPort-$($startPort+99)" -ForegroundColor Red
echo     Write-Host "Please close some applications and try again." -ForegroundColor Yellow
echo     Read-Host "Press Enter to exit"
echo     exit 1
echo }
echo.
echo # Save port info
echo $portInfo = @{
echo     port = $port
echo     startTime = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"^)
echo }
echo $portInfo ^| ConvertTo-Json ^| Set-Content "$env:APPDATA\DAD-AudioMonitor\config.json"
echo.
echo Write-Host "✓ Audio Monitor will use port: $port" -ForegroundColor Green
echo.
echo # Start HTTP server
echo $http = [System.Net.HttpListener]::new(^)
echo $http.Prefixes.Add("http://localhost:$port/"^)
echo.
echo # Also listen on the first 10 alternative ports for discovery
echo $altPorts = @(15789, 15790, 15791, 15792, 15793, 15794, 15795, 15796, 15797, 15798^)
echo foreach ($altPort in $altPorts) {
echo     if ($altPort -ne $port) {
echo         try {
echo             $http.Prefixes.Add("http://localhost:$altPort/"^)
echo         } catch { }
echo     }
echo }
echo.
echo $http.Start(^)
echo Write-Host "✓ Audio Monitor started successfully" -ForegroundColor Green
echo.
echo while ($true) {
echo     try {
echo         $context = $http.GetContext(^)
echo         $request = $context.Request
echo         
echo         # Handle different endpoints
echo         if ($request.Url.LocalPath -eq "/audio-status") {
echo             $volume = [AudioCheck]::GetVolume(^)
echo             $isMuted = [AudioCheck]::IsMuted(^)
echo             $response = @{
echo                 volume = $volume
echo                 isMuted = $isMuted
echo                 isLow = ($volume -lt 50 -or $isMuted^)
echo                 port = $port
echo                 version = "1.0"
echo             }
echo             $json = $response ^| ConvertTo-Json
echo             $buffer = [Text.Encoding]::UTF8.GetBytes($json^)
echo         }
echo         elseif ($request.Url.LocalPath -eq "/discover") {
echo             # Discovery endpoint - returns actual port
echo             $response = @{ actualPort = $port }
echo             $json = $response ^| ConvertTo-Json
echo             $buffer = [Text.Encoding]::UTF8.GetBytes($json^)
echo         }
echo         else {
echo             $buffer = [Text.Encoding]::UTF8.GetBytes("OK"^)
echo         }
echo         
echo         $context.Response.Headers.Add("Access-Control-Allow-Origin", "*"^)
echo         $context.Response.ContentType = "application/json"
echo         $context.Response.OutputStream.Write($buffer, 0, $buffer.Length^)
echo         $context.Response.Close(^)
echo     }
echo     catch {
echo         # Ignore errors and continue
echo     }
echo }
) > "%targetDir%\AudioMonitor.ps1"

:: Create launcher
echo @echo off > "%targetDir%\StartAudioMonitor.bat"
echo cd /d "%targetDir%" >> "%targetDir%\StartAudioMonitor.bat"
echo start /min powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%targetDir%\AudioMonitor.ps1" >> "%targetDir%\StartAudioMonitor.bat"

:: Create port info file for userscript
echo {"ports":[15789,15790,15791,15792,15793,15794,15795,15796,15797,15798]} > "%targetDir%\ports.json"

:: Create uninstaller
(
echo @echo off
echo echo ╔════════════════════════════════════════╗
echo echo ║   DAD Audio Monitor Uninstaller        ║
echo echo ╔════════════════════════════════════════╝
echo echo.
echo echo Uninstalling DAD Audio Monitor...
echo.
echo :: Kill any PowerShell processes running our script
echo for /f "tokens=2" %%%%i in ('wmic process where "name='powershell.exe' and commandline like '%%AudioMonitor.ps1%%'" get processid /value 2^>nul ^| find "="') do (
echo     set pid=%%%%i
echo )
echo if defined pid (
echo     taskkill /PID %%pid%% /F ^>nul 2^>^&1
echo     echo ✓ Stopped Audio Monitor process
echo ) else (
echo     echo ℹ Audio Monitor was not running
echo )
echo.
echo :: Remove startup shortcut
echo if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DAD-AudioMonitor.lnk" (
echo     del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DAD-AudioMonitor.lnk" 2^>nul
echo     echo ✓ Removed startup entry
echo )
echo.
echo :: Remove the installation folder
echo timeout /t 2 /nobreak ^>nul
echo cd /d "%APPDATA%"
echo if exist "DAD-AudioMonitor" (
echo     rd /s /q "DAD-AudioMonitor" 2^>nul
echo     echo ✓ Removed program files
echo )
echo.
echo echo ════════════════════════════════════════
echo echo ✅ DAD Audio Monitor has been uninstalled
echo echo ════════════════════════════════════════
echo echo.
echo pause
) > "%targetDir%\UNINSTALL.bat"

:: Create README
(
echo DAD Audio Monitor
echo ================
echo.
echo This program monitors your system audio levels and communicates
echo with the DAD Batch Notifier userscript to ensure you don't miss
echo important audio notifications.
echo.
echo Files:
echo - AudioMonitor.ps1: Main monitoring script
echo - StartAudioMonitor.bat: Launcher script
echo - config.json: Configuration including port number
echo - UNINSTALL.bat: Uninstaller
echo.
echo The monitor automatically finds an available port when starting.
echo Default port range: 15789-15888
echo.
echo To check if it's running, visit:
echo http://localhost:15789/audio-status
echo ^(or check config.json for the actual port if 15789 is not working^)
) > "%targetDir%\README.txt"

:: Add to startup
powershell -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DAD-AudioMonitor.lnk');$s.TargetPath='%targetDir%\StartAudioMonitor.bat';$s.WorkingDirectory='%targetDir%';$s.WindowStyle=7;$s.Save()"

:: Start now
echo.
echo Starting Audio Monitor...
start /min "%targetDir%\StartAudioMonitor.bat"

:: Wait a moment for it to start
timeout /t 3 /nobreak >nul

:: Try to detect which port it's using
set "detectedPort="
for /l %%p in (15789,1,15798) do (
    if not defined detectedPort (
        powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%%p/discover' -TimeoutSec 1 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
        if !errorlevel! == 0 set "detectedPort=%%p"
    )
)

echo.
echo ════════════════════════════════════════
echo ✅ Installation complete!
echo ════════════════════════════════════════
echo.
echo 🔊 Audio Monitor is now running
if defined detectedPort (
    echo 🌐 Running on port: %detectedPort%
) else (
    echo 🌐 Port will be auto-detected by userscript
)
echo 🚀 Will start automatically with Windows
echo.
echo 📁 Installed to: %targetDir%
echo 🗑️ To uninstall: Run %targetDir%\UNINSTALL.bat
echo.
echo ⚠️  Make sure the DAD Batch Notifier userscript is updated
echo    to version 6.4.2 or later for port auto-discovery!
echo.
pause
