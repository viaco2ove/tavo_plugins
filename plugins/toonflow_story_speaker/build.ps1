# Build plugin .tpg package
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginDir = $scriptDir
$outputDir = Split-Path -Parent $scriptDir

$tmpZip = "$outputDir\toonflow_story_speaker.zip"
$outTpg = "$outputDir\toonflow_story_speaker.tpg"

Remove-Item -Path $tmpZip -ErrorAction SilentlyContinue
Remove-Item -Path $outTpg -ErrorAction SilentlyContinue

Compress-Archive -Path "$pluginDir\*" -DestinationPath $tmpZip -Force
Move-Item -Path $tmpZip -Destination $outTpg -Force

Write-Host "Built: toonflow_story_speaker.tpg"
Get-Item $outTpg | Select-Object Name, @{N='Size';E={'{0:N1} KB' -f ($_.Length/1KB)}}