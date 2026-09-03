param([int]$X,[int]$Y,[switch]$NoRestoreFocus)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Native {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
}
'@
if(-not $NoRestoreFocus){
  $proc=Get-Process | Where-Object {$_.MainWindowTitle -ne '' -and $_.ProcessName -like '*DSH*'} | Select-Object -First 1
  if($proc -and $proc.MainWindowHandle -ne 0){[Native]::ShowWindow($proc.MainWindowHandle,9)|Out-Null;[Native]::SetForegroundWindow($proc.MainWindowHandle)|Out-Null;Start-Sleep -Milliseconds 400}
}
[Native]::SetCursorPos($X,$Y)|Out-Null
Start-Sleep -Milliseconds 120
[Native]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[Native]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
Write-Output ('CLICK ' + $X + ',' + $Y)
