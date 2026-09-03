param([string]$OutPath)
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)
$inv=New-Object System.Drawing.Imaging.ColorMatrix
$inv.Matrix00=-1;$inv.Matrix11=-1;$inv.Matrix22=-1;$inv.Matrix33=1;$inv.Matrix40=1;$inv.Matrix41=1;$inv.Matrix42=1
$ia=New-Object System.Drawing.Imaging.ImageAttributes
$ia.SetColorMatrix($inv)
$out=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$og=[System.Drawing.Graphics]::FromImage($out)
$og.DrawImage($bmp,(New-Object System.Drawing.Rectangle(0,0,$b.Width,$b.Height)),0,0,$b.Width,$b.Height,[System.Drawing.GraphicsUnit]::Pixel,$ia)
$out.Save($OutPath,[System.Drawing.Imaging.ImageFormat]::Png)
$og.Dispose();$g.Dispose();$bmp.Dispose();$out.Dispose()
Write-Output ('INVERTED '+$b.Width+'x'+$b.Height)
