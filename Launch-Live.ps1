$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:PORT = '8081'
Write-Host 'Enter the NVIDIA Build key at the hidden prompt. Keep this window open.'
python .\run.py
