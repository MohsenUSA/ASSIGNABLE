@echo off
setlocal enabledelayedexpansion

:: Colors for messages (Windows 10+)
color 0F
cls

echo ==========================================
echo      DAD Audio Monitor Installer
echo ==========================================
echo.

:: Check if running as admin (optional but recommended)
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] Not running as administrator.
    echo [WARNING] Installation will continue but may have limited permissions.
    echo.
)

echo [1/7] Creating installation directory...
set "targetDir=%APPDATA%\DAD-AudioMonitor"
mkdir "%targetDir%" 2>nul
if exist "%targetDir%" (
    echo [OK] Directory created: %targetDir%
) else (
    echo [FAIL] Could not create directory: %targetDir%
    echo [FAIL] Installation cannot continue.
    pause
    exit /b 1
)

echo.
echo [2/7] Creating PowerShell monitoring script...

:: Create PowerShell script with dynamic port selection
(
echo Add-Type @'
echo using System;
echo using System.Runtime.InteropServices;
echo using System.Net;
echo using System.Net.Sockets;
echo using System.IO;
echo public class AudioCheck {
echo     [DllImport("winmm.dll"^)] public static extern int waveOutGetVolume(IntPtr h, out uint v^);
echo     public static int GetVolume(^) { 
echo         uint v; 
echo         waveOutGetVolume(IntPtr.Zero, out v^); 
echo         return (int^)((v ^& 0xFFFF^) / 655.35^); 
echo     }
echo     public static bool IsMuted(^) { 
echo         uint v; 
echo         waveOutGetVolume(IntPtr.Zero, out v^); 
echo         return v == 0; 
echo     }
echo     public static int FindFreePort(int startPort^) {
echo         for (int port = startPort; port ^< startPort + 100; port++^) {
echo             try {
echo                 TcpListener listener = new TcpListener(IPAddress.Loopback, port^);
echo                 listener.Start(^);
echo                 listener.Stop(^);
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
echo Write-Host "[INFO] Searching for available port..." -ForegroundColor Cyan
echo $port = [AudioCheck]::FindFreePort($startPort^)
echo.
echo if ($port -eq -1^) {
echo     Write-Host "[FAIL] No free ports available in range $startPort-$($startPort+99^)" -ForegroundColor Red
echo     Write-Host "[FAIL] Please close some applications and try again." -ForegroundColor Red
echo     Read-Host "Press Enter to exit"
echo     exit 1
echo }
echo.
echo Write-Host "[OK] Found available port: $port" -ForegroundColor Green
echo.
echo # Save port info
echo $portInfo = @{
echo     port = $port
echo     startTime = (Get-Date^).ToString("yyyy-MM-dd HH:mm:ss"^)
echo }
echo $portInfo ^| ConvertTo-Json ^| Set-Content "$env:APPDATA\DAD-AudioMonitor\config.json"
echo.
echo # Start HTTP server
echo try {
echo     $http = [System.Net.HttpListener]::new(^)
echo     $http.Prefixes.Add("http://localhost:$port/"^)
echo     
echo     # Also listen on the first 10 alternative ports for discovery
echo     $altPorts = @(15789, 15790, 15791, 15792, 15793, 15794, 15795, 15796, 15797, 15798^)
echo     foreach ($altPort in $altPorts^) {
echo         if ($altPort -ne $port^) {
echo             try {
echo                 $http.Prefixes.Add("http://localhost:$altPort/"^)
echo             } catch { }
echo         }
echo     }
echo     
echo     $http.Start(^)
echo     Write-Host "[OK] Audio Monitor started successfully on port $port" -ForegroundColor Green
echo     
echo     # Write success flag
echo     "SUCCESS" ^| Set-Content "$env:APPDATA\DAD-AudioMonitor\startup.flag"
echo }
echo catch {
echo     Write-Host "[FAIL] Failed to start Audio Monitor: $_" -ForegroundColor Red
echo     "FAILED" ^| Set-Content "$env:APPDATA\DAD-AudioMonitor\startup.flag"
echo     exit 1
echo }
echo.
echo while ($true^) {
echo     try {
echo         $context = $http.GetContext(^)
echo         $request = $context.Request
echo         
echo         # Handle different endpoints
echo         if ($request.Url.LocalPath -eq "/audio-status"^) {
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
echo         elseif ($request.Url.LocalPath -eq "/discover"^) {
echo             # Discovery endpoint - returns actual port
echo             $response = @{ actualPort = $port }
echo             $json = $response ^| ConvertTo-Json
echo             $buffer = [Text.Encoding]::UTF8.GetBytes($json^)
echo         }
echo         elseif ($request.Url.LocalPath -eq "/test"^) {
echo             # Test endpoint for installer
echo             $buffer = [Text.Encoding]::UTF8.GetBytes("OK"^)
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

if exist "%targetDir%\AudioMonitor.ps1" (
    echo [OK] PowerShell script created
) else (
    echo [FAIL] Could not create PowerShell script
    echo [FAIL] Installation failed.
    pause
    exit /b 1
)

echo.
echo [3/7] Creating launcher script...

:: Create launcher
echo @echo off > "%targetDir%\StartAudioMonitor.bat"
echo cd /d "%targetDir%" >> "%targetDir%\StartAudioMonitor.bat"
echo start /min powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%targetDir%\AudioMonitor.ps1" >> "%targetDir%\StartAudioMonitor.bat"

if exist "%targetDir%\StartAudioMonitor.bat" (
    echo [OK] Launcher script created
) else (
    echo [FAIL] Could not create launcher script
    pause
    exit /b 1
)

echo.
echo [4/7] Creating uninstaller...

:: Create uninstaller
(
echo @echo off
echo echo ==========================================
echo echo    DAD Audio Monitor Uninstaller
echo echo ==========================================
echo echo.
echo echo Uninstalling DAD Audio Monitor...
echo.
echo :: Kill any PowerShell processes running our script
echo set "found=0"
echo for /f "tokens=2" %%%%a in ('tasklist /fi "imagename eq powershell.exe" /v 2^>nul ^| findstr /i "AudioMonitor.ps1"'^) do (
echo     taskkill /PID %%%%a /F ^>nul 2^>^&1
echo     set "found=1"
echo ^)
echo if "!found!"=="1" (
echo     echo [OK] Stopped Audio Monitor process
echo ^) else (
echo     echo [INFO] Audio Monitor was not running
echo ^)
echo.
echo :: Remove startup shortcut
echo if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DAD-AudioMonitor.lnk" (
echo     del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DAD-AudioMonitor.lnk" 2^>nul
echo     echo [OK] Removed startup entry
echo ^) else (
echo     echo [INFO] No startup entry found
echo ^)
echo.
echo :: Remove the installation folder
echo timeout /t 2 /nobreak ^>nul
echo cd /d "%APPDATA%"
echo if exist "DAD-AudioMonitor" (
echo     rd /s /q "DAD-AudioMonitor" 2^>nul
echo     if not exist "DAD-AudioMonitor" (
echo         echo [OK] Removed program files
echo     ^) else (
echo         echo [FAIL] Could not remove all files. Please delete manually: %APPDATA%\DAD-AudioMonitor
echo     ^)
echo ^) else (
echo     echo [INFO] Program files already removed
echo ^)
echo.
echo echo ==========================================
echo if not exist "DAD-AudioMonitor" (
echo     echo [SUCCESS] DAD Audio Monitor has been uninstalled
echo ^) else (
echo     echo [PARTIAL] Uninstall completed with warnings
echo ^)
echo echo ==========================================
echo echo.
echo pause
) > "%targetDir%\UNINSTALL.bat"

if exist "%targetDir%\UNINSTALL.bat" (
    echo [OK] Uninstaller created
) else (
    echo [FAIL] Could not create uninstaller
)

echo.
echo [5/7] Creating startup shortcut...

:: Add to startup
powershell -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DAD-AudioMonitor.lnk');$s.TargetPath='%targetDir%\StartAudioMonitor.bat';$s.WorkingDirectory='%targetDir%';$s.WindowStyle=7;$s.Save()" >nul 2>&1

if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DAD-AudioMonitor.lnk" (
    echo [OK] Startup shortcut created
) else (
    echo [WARNING] Could not create startup shortcut
    echo [WARNING] You may need to start the monitor manually
)

echo.
echo [6/7] Starting Audio Monitor...

:: Clear any previous startup flag
if exist "%targetDir%\startup.flag" del "%targetDir%\startup.flag" >nul 2>&1

:: Start the monitor
start /min "%targetDir%\StartAudioMonitor.bat"

:: Wait for startup flag
echo Waiting for Audio Monitor to start...
set "attempts=0"
:waitloop
if !attempts! geq 10 goto timeout
timeout /t 1 /nobreak >nul
set /a attempts+=1
if exist "%targetDir%\startup.flag" (
    set /p status=<"%targetDir%\startup.flag"
    if "!status!"=="SUCCESS" goto started
    if "!status!"=="FAILED" goto startfailed
)
goto waitloop

:timeout
echo [WARNING] Startup verification timeout
echo [WARNING] Monitor may still be starting...
goto testconnection

:startfailed
echo [FAIL] Audio Monitor failed to start
echo [FAIL] Check PowerShell execution policy or antivirus settings
goto finalstatus

:started
echo [OK] Audio Monitor process started

:testconnection
echo.
echo [7/7] Testing connection...

:: Try to detect which port it's using
set "detectedPort="
set "testSuccess=0"

for /l %%p in (15789,1,15798) do (
    if "!testSuccess!"=="0" (
        powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%%p/test' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
        if !errorlevel! == 0 (
            set "detectedPort=%%p"
            set "testSuccess=1"
        )
    )
)

if "!testSuccess!"=="1" (
    echo [OK] Successfully connected to Audio Monitor on port !detectedPort!
    
    :: Test audio detection
    echo.
    echo Testing audio detection...
    powershell -Command "try { $r = Invoke-RestMethod -Uri 'http://localhost:!detectedPort!/audio-status' -TimeoutSec 2; Write-Host '[OK] Current volume:' $r.volume'%%' -ForegroundColor Green; Write-Host '[OK] Muted:' $r.isMuted -ForegroundColor Green; exit 0 } catch { Write-Host '[FAIL] Could not get audio status' -ForegroundColor Red; exit 1 }" 2>nul
) else (
    echo [FAIL] Could not connect to Audio Monitor
    echo [FAIL] The service may not have started correctly
)

:finalstatus
echo.
echo ==========================================
if "!testSuccess!"=="1" (
    echo [SUCCESS] Installation completed successfully!
    echo ==========================================
    echo.
    echo Audio Monitor is now running on port: !detectedPort!
    echo It will start automatically with Windows.
    echo.
    echo Installed to: %targetDir%
    echo To uninstall: Run %targetDir%\UNINSTALL.bat
    echo.
    echo IMPORTANT: Update your DAD Batch Notifier userscript
    echo           to version 6.4.2 or later for auto-discovery!
) else (
    echo [FAILED] Installation completed with errors
    echo ==========================================
    echo.
    echo The Audio Monitor may not be working correctly.
    echo Please check:
    echo   1. Windows Defender or antivirus settings
    echo   2. PowerShell execution policy
    echo   3. Firewall settings for localhost connections
    echo.
    echo You can try running the uninstaller and reinstalling.
    echo Uninstaller location: %targetDir%\UNINSTALL.bat
)
echo.
pause
