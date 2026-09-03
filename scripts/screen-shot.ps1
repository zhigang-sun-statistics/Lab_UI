param([string]$OutPath)
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)
$bmp.Save($OutPath,[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose();$bmp.Dispose()
Write-Output ('SHOT ' + $b.Width + 'x' + $b.Height)
