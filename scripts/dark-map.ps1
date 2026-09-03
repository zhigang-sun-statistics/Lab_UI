param([string]$PngPath)
Add-Type -AssemblyName System.Drawing
$bmp=[System.Drawing.Bitmap]::FromFile($PngPath)
$step=40
$cols=[math]::Floor($bmp.Width/$step)
$rows=[math]::Floor($bmp.Height/$step)
$grid=New-Object 'int[,]' $cols,$rows
for($i=0;$i -lt $cols;$i++){
  for($j=0;$j -lt $rows;$j++){
    $d=0
    for($x=$i*$step+10;$x -lt ($i+1)*$step-10;$x+=10){
      for($y=$j*$step+10;$y -lt ($j+1)*$step-10;$y+=10){
        $p=$bmp.GetPixel($x,$y)
        if((($p.R*0.3+$p.G*0.59+$p.B*0.11)) -lt 45){$d++}
      }
    }
    $grid[$i,$j]=$d
  }
}
$out=@()
for($j=0;$j -lt $rows;$j++){
  $line=''
  for($i=0;$i -lt $cols;$i++){
    $v=$grid[$i,$j]
    if($v -ge 6){$line+='#'}elseif($v -ge 2){$line+='+'}else{$line+='.'}
  }
  $out+=('y'+($j*$step)+' '+$line)
}
$bmp.Dispose()
$out
