param([int]$X,[int]$Y,[int]$Delta)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class N2 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);
}
'@
[N2]::SetCursorPos($X,$Y)|Out-Null
Start-Sleep -Milliseconds 100
[N2]::mouse_event(0x0800,0,0,[uint32]$Delta,[UIntPtr]::Zero)
Write-Output ('SCROLL ' + $X + ',' + $Y + ' delta=' + $Delta)
