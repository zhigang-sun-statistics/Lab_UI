param([string]$PngPath,[string]$OutPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage,ContentType=WindowsRuntime]
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]
function Await($op,$t){$task=$asTask.MakeGenericMethod($t).Invoke($null,@($op));$task.Wait(-1)|Out-Null;$task.Result}
$file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($PngPath)) ([Windows.Storage.StorageFile])
$stream=Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bmp=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if($null -eq $engine){Write-Output 'OCR_ENGINE=NONE';exit 1}
Write-Output ('OCR_LANG=' + $engine.RecognizerLanguage.LanguageTag)
$result=Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
$lines=@()
foreach($line in $result.Lines){
  foreach($word in $line.Words){
    $r=$word.BoundingRect
    $lines += ('WORD`t' + $word.Text + '`t' + [math]::Round($r.X) + ',' + [math]::Round($r.Y) + ',' + [math]::Round($r.X+$r.Width) + ',' + [math]::Round($r.Y+$r.Height))
  }
}
if($OutPath){[IO.File]::WriteAllLines($OutPath,$lines,[Text.Encoding]::UTF8)}else{$lines|Write-Output}
