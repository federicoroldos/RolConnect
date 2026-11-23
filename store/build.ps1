# Builds the Edge Add-ons package: dist/Rold-<version>.zip
# Usage: powershell -ExecutionPolicy Bypass -File store\build.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$dist = Join-Path $root 'dist'
$zip = Join-Path $dist "Rold-$($manifest.version).zip"
New-Item -ItemType Directory -Force $dist | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }

# Only what the extension needs at runtime.
$items = @('manifest.json', 'background.js', 'newtab.html', 'sidepanel.html', 'routine.html', 'LICENSE', 'css', 'js', 'icons')
$files = foreach ($item in $items) {
  $p = Join-Path $root $item
  if (Test-Path $p -PathType Container) { Get-ChildItem $p -Recurse -File } else { Get-Item $p }
}

# Entry names use forward slashes, as the store requires.
$archive = [IO.Compression.ZipFile]::Open($zip, 'Create')
try {
  foreach ($f in $files) {
    $name = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f.FullName, $name, 'Optimal') | Out-Null
  }
} finally {
  $archive.Dispose()
}

$size = [math]::Round((Get-Item $zip).Length / 1KB)
Write-Host "Built $zip ($size KB, $($files.Count) files)"
