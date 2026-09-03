param([int]$ClickX,[int]$ClickY,[string]$Text)
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class N5 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint t,ref GUIINFO g);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
  [StructLayout(LayoutKind.Sequential)]
  public struct GUIINFO { public int cbSize; public int flags; public IntPtr hwndActive; public IntPtr hwndFocus; public IntPtr hwndCapture; public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret; public RECT rcCaret; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
}
'@
Add-Type -AssemblyName System.Windows.Forms
$target=(Get-Process | Where-Object {$_.MainWindowTitle -eq 'DeepSeek Harness Desktop'} | Select-Object -First 1).MainWindowHandle
[N5]::ShowWindow($target,9)|Out-Null
[N5]::SetForegroundWindow($target)|Out-Null
Start-Sleep -Milliseconds 600
$gi=New-Object N5+GUIINFO
$gi.cbSize=[System.Runtime.InteropServices.Marshal]::SizeOf($gi)
[N5]::GetGUIThreadInfo(0,[ref]$gi)|Out-Null
$pre=new-object System.Text.StringBuilder 64
[N5]::GetClassName($gi.hwndFocus,$pre,64)|Out-Null
Write-Output ('FOCUS_BEFORE class=' + $pre.ToString() + ' handle=' + $gi.hwndFocus)
[N5]::SetCursorPos($ClickX,$ClickY)|Out-Null
Start-Sleep -Milliseconds 150
[N5]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[N5]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 500
$gi2=New-Object N5+GUIINFO
$gi2.cbSize=[System.Runtime.InteropServices.Marshal]::SizeOf($gi2)
[N5]::GetGUIThreadInfo(0,[ref]$gi2)|Out-Null
$post=new-object System.Text.StringBuilder 64
[N5]::GetClassName($gi2.hwndFocus,$post,64)|Out-Null
Write-Output ('FOCUS_AFTER  class=' + $post.ToString() + ' handle=' + $gi2.hwndFocus + ' caret=(' + $gi2.rcCaret.L + ',' + $gi2.rcCaret.T + ')')
Write-Output ('TYPING: ' + $Text)
[System.Windows.Forms.SendKeys]::SendWait($Text)
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 2500
