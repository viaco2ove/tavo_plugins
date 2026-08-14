# Package the plugin as .tpg (zip format)
# Run from plugin directory: powershell -File build.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginDir = $scriptDir  # plugin directory itself
$outputDir = Split-Path -Parent $scriptDir  # parent of plugin dir

$tmpZip = "$outputDir\toonflow_story_memory_manager.zip"
$outTpg = "$outputDir\toonflow_story_memory_manager.tpg"

# Remove old package
Remove-Item -Path $tmpZip -ErrorAction SilentlyContinue
Remove-Item -Path $outTpg -ErrorAction SilentlyContinue

# Package (exclude README and build scripts)
Compress-Archive -Path `
    "$pluginDir\manifest.json", `
    "$pluginDir\entry.js", `
    "$pluginDir\locales", `
    "$pluginDir\ui", `
    "$pluginDir\cover.png" `
    -DestinationPath $tmpZip

# Rename .zip to .tpg (tavo uses .tpg extension)
Move-Item -Path $tmpZip -Destination $outTpg -Force

Write-Host "Packaged: toonflow_story_memory_manager.tpg"
Get-Item $outTpg | Select-Object Name, @{N='Size';E={'{0:N1} KB' -f ($_.Length/1KB)}}, LastWriteTime