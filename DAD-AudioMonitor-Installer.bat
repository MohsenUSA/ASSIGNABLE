@echo off
setlocal enabledelayedexpansion

echo Installing DAD Audio Monitor...
set "targetDir=%APPDATA%\DAD-AudioMonitor"
mkdir "%targetDir%" 2>nul

:: Create PowerShell script with mute detection
(
echo Add-Type @'
echo using System; using System.Runtime.InteropServices;
echo public class AudioCheck {
echo     [DllImport("winmm.dll")] public static extern int waveOutGetVolume(IntPtr h, out uint v);
echo     public static int GetVolume() { uint v; waveOutGetVolume(IntPtr.Zero, out v); return (int)((v ^& 0xFFFF) / 655.35); }
echo     public static bool IsMuted() { uint v; waveOutGetVolume(IntPtr.Zero, out v); return v == 0; }
echo }
echo '@
echo $http = [System.Net.HttpListener]::new()
echo $http.Prefixes.Add("http://localhost:15789/"^)
echo $http.Start()
echo while ($true) {
echo     $context = $http.GetContext()
echo     $volume = [AudioCheck]::GetVolume()
echo     $isMuted = [AudioCheck]::IsMuted()
echo     $response = "{`"volume`":$volume,`"isMuted`":$isMuted,`"isLow`":$(if($volume -lt 50 -or $isMuted){'true'}else{'false'})}"
echo     $buffer = [Text.Encoding]::UTF8.GetBytes($response^)
echo     $context.Response.Headers.Add("Access-Control-Allow-Origin", "*"^)
echo     $context.Response.ContentType = "application/json"
echo     $context.Response.OutputStream.Write($buffer, 0, $buffer.Length^)
echo     $context.Response.Close()
echo }
) > "%targetDir%\AudioMonitor.ps1"

:: Create launcher
echo @echo off > "%targetDir%\StartAudioMonitor.bat"
echo start /min powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%targetDir%\AudioMonitor.ps1" >> "%targetDir%\StartAudioMonitor.bat"

:: Create uninstaller
(
echo @echo off
echo echo Uninstalling DAD Audio Monitor...
echo :: Kill the PowerShell process running AudioMonitor
echo for /f "tokens=2" %%%%i in ('tasklist /v ^| findstr /i "AudioMonitor.ps1"') do taskkill /PID %%%%i /F 2^>nul
echo :: Remove startup shortcut
echo del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DAD-AudioMonitor.lnk" 2^>nul
echo :: Wait a moment
echo timeout /t 2 /nobreak ^>nul
echo :: Remove the folder (from parent directory to avoid self-deletion issues)
echo cd ..
echo rd /s /q "%targetDir%" 2^>nul
echo echo.
echo echo ✅ DAD Audio Monitor has been uninstalled successfully!
echo echo.
echo pause
) > "%targetDir%\UNINSTALL.bat"

:: Add to startup
powershell -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DAD-AudioMonitor.lnk');$s.TargetPath='%targetDir%\StartAudioMonitor.bat';$s.WindowStyle=7;$s.Save()"

:: Start now
start /min "%targetDir%\StartAudioMonitor.bat"

echo.
echo ✅ Installation complete!
echo 🔊 Audio Monitor is now running
echo 🚀 Will start automatically with Windows
echo.
echo 📁 Installed to: %targetDir%
echo 🗑️ To uninstall: Run %targetDir%\UNINSTALL.bat
echo.
pause