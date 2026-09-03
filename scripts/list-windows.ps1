Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L,T,Rt,B; }
}
'@
$out=@()
$cb={param($h,$l)
  if([W]::IsWindowVisible($h)){
    $len=[W]::GetWindowTextLength($h)
    if($len -gt 0){
      $sb=New-Object System.Text.StringBuilder($len+1)
      [W]::GetWindowText($h,$sb,$sb.Capacity)|Out-Null
      $r=New-Object W+R
      [W]::GetWindowRect($h,[ref]$r)|Out-Null
      $script:out += ('WIN`t' + $sb.ToString() + '`t' + $r.L + ',' + $r.T + ',' + $r.Rt + ',' + $r.B)
    }
  }
  $true
}
[W]::EnumWindows($cb,[IntPtr]::Zero)|Out-Null
$script:out | ForEach-Object { [IO.File]::AppendAllText('C:\sonicPlan\plugins\dsh-lab-controller\windows.txt',$_+[Environment]::NewLine,[Text.Encoding]::UTF8) }
