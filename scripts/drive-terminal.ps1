param([int]$ClickX,[int]$ClickY,[string]$Commands)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class N3 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
}
'@
Add-Type -AssemblyName System.Windows.Forms
$proc=Get-Process | Where-Object {$_.MainWindowTitle -eq 'DeepSeek Harness Desktop'} | Select-Object -First 1
if($proc -and $proc.MainWindowHandle -ne 0){[N3]::ShowWindow($proc.MainWindowHandle,9)|Out-Null;[N3]::SetForegroundWindow($proc.MainWindowHandle)|Out-Null;Start-Sleep -Milliseconds 500}
[N3]::SetCursorPos($ClickX,$ClickY)|Out-Null
Start-Sleep -Milliseconds 150
[N3]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[N3]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
Write-Output ('CLICKED ' + $ClickX + ',' + $ClickY + ' (terminal focus)')
Start-Sleep -Milliseconds 500
foreach($cmd in ($Commands -split '~')){
  if($cmd.Trim().Length -eq 0){continue}
  Write-Output ('TYPE: ' + $cmd)
  [System.Windows.Forms.SendKeys]::SendWait($cmd)
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 2200
}
