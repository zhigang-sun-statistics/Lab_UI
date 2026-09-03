param([string]$Text)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($Text)
Write-Output ('TYPED ' + $Text)
