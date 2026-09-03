Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class N4 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
$target=(Get-Process | Where-Object {$_.MainWindowTitle -eq 'DeepSeek Harness Desktop'} | Select-Object -First 1).MainWindowHandle
if(-not $target){Write-Output 'DSH_WINDOW_NOT_FOUND';exit 1}
[N4]::ShowWindow($target,9)|Out-Null
$fg=[N4]::GetForegroundWindow()
if($fg -ne $target){
  $fgPid=0
  $fgThread=[N4]::GetWindowThreadProcessId($fg,[ref]$fgPid)
  $myThread=[N4]::GetCurrentThreadId()
  [N4]::AttachThreadInput($fgThread,$myThread,$true)|Out-Null
  [N4]::SetForegroundWindow($target)|Out-Null
  [N4]::AttachThreadInput($fgThread,$myThread,$false)|Out-Null
}
Start-Sleep -Milliseconds 600
$fg2=[N4]::GetForegroundWindow()
$sb=New-Object System.Text.StringBuilder 256
[N4]::GetWindowText($fg2,$sb,256)|Out-Null
Write-Output ('FOREGROUND=' + $sb.ToString())
if($fg2 -eq $target){Write-Output 'DSH_FOREGROUND_OK'}else{Write-Output 'DSH_FOREGROUND_FAIL'}
