# checkpoint.ps1 — helper commit checkpoint Aether
# Pakai: .\tools\checkpoint.ps1 "pesan singkat aksi"
param([Parameter(Mandatory=$true)][string]$Msg)
Set-Location C:/Workspace/Aether
git add -A
git commit -m $Msg --author="Aether <aether@local>"
Write-Output "LAST: $(git rev-parse --short HEAD)"
