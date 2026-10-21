# Installs the Kyara Games updater for the extension folder this script belongs to (run it once per folder).
# Afterwards the "Mettre a jour" button of the popup replaces the extension's files by itself.
#   installer-mises-a-jour.bat             install or refresh
#   installer-mises-a-jour.bat -Uninstall  remove the updater
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'

$name = 'com.kyara_games.updater'
$ext = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
$home2 = Join-Path $env:LOCALAPPDATA 'KyaraGamesUpdater'
$chromeKeys = 'Google\Chrome', 'Chromium', 'BraveSoftware\Brave-Browser', 'Microsoft\Edge', 'Vivaldi', 'Opera Software'
$utf8 = New-Object Text.UTF8Encoding $false

function Remove-Keys {
  foreach ($k in $chromeKeys + 'Mozilla') {
    Remove-Item -Path "HKCU:\Software\$k\NativeMessagingHosts\$name" -Force -ErrorAction SilentlyContinue
  }
}

if ($Uninstall) {
  Remove-Keys
  Remove-Item -LiteralPath $home2 -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Assistant de mise a jour Kyara Games supprime.'
  return
}

# Id of an unpacked extension: SHA-256 of its folder path (UTF-16, drive letter in capitals), letters a-p.
function Get-PathId($path) {
  $path = $path.Substring(0, 1).ToUpper() + $path.Substring(1)
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::Unicode.GetBytes($path))
  return -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
}

function Get-Key($dict, $key) {
  if ($dict -is [Collections.IDictionary] -and $dict.ContainsKey($key)) { return $dict[$key] }
  return $null
}

# The ids the browsers gave to this folder, read from their profiles (Preferences may hold empty keys: no ConvertFrom-Json).
function Find-Ids {
  $ids = @{ (Get-PathId $ext) = $true }
  Add-Type -AssemblyName System.Web.Extensions
  $json = New-Object Web.Script.Serialization.JavaScriptSerializer
  $json.MaxJsonLength = [int]::MaxValue
  $roots = @(
    "$env:LOCALAPPDATA\Google\Chrome\User Data",
    "$env:LOCALAPPDATA\Chromium\User Data",
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data",
    "$env:LOCALAPPDATA\Microsoft\Edge\User Data",
    "$env:LOCALAPPDATA\Vivaldi\User Data",
    "$env:APPDATA\Opera Software\Opera Stable"
  ) | Where-Object { Test-Path -LiteralPath $_ }
  foreach ($root in $roots) {
    $dirs = @(Get-Item -LiteralPath $root) + @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)
    foreach ($d in $dirs) {
      foreach ($file in 'Preferences', 'Secure Preferences') {
        $f = Join-Path $d.FullName $file
        if (-not (Test-Path -LiteralPath $f)) { continue }
        try { $prefs = $json.DeserializeObject([IO.File]::ReadAllText($f)) } catch { continue }
        $settings = Get-Key (Get-Key $prefs 'extensions') 'settings'
        if (-not $settings) { continue }
        foreach ($id in $settings.Keys) {
          $p = [string](Get-Key $settings[$id] 'path')
          if ($p -and $p.TrimEnd('\') -ieq $ext) { $ids[$id] = $true }
        }
      }
    }
  }
  return $ids.Keys
}

New-Item -ItemType Directory -Path $home2 -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'host.ps1') -Destination $home2 -Force
[IO.File]::WriteAllText((Join-Path $home2 'host.cmd'), "@echo off`r`npowershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"%~dp0host.ps1`" %*`r`n", [Text.Encoding]::ASCII)

# id -> extension folder, kept from earlier installs of other folders.
$config = @{}
$configPath = Join-Path $home2 'config.json'
if (Test-Path -LiteralPath $configPath) {
  (Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $config[$_.Name] = $_.Value }
}
foreach ($id in Find-Ids) { $config[$id] = $ext }
$manifest = Get-Content -LiteralPath (Join-Path $ext 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$gecko = $manifest.browser_specific_settings.gecko.id
if ($gecko) { $config[$gecko] = $ext }
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), $utf8)

$hostCmd = Join-Path $home2 'host.cmd'
$chromeIds = @($config.Keys | Where-Object { $_ -match '^[a-p]{32}$' })
$chromeManifest = Join-Path $home2 "$name.json"
[IO.File]::WriteAllText($chromeManifest, ([ordered]@{
  name = $name
  description = 'Kyara Games : mise a jour de l''extension'
  path = $hostCmd
  type = 'stdio'
  allowed_origins = @($chromeIds | ForEach-Object { "chrome-extension://$_/" })
} | ConvertTo-Json), $utf8)
$firefoxManifest = Join-Path $home2 "$name.firefox.json"
[IO.File]::WriteAllText($firefoxManifest, ([ordered]@{
  name = $name
  description = 'Kyara Games : mise a jour de l''extension'
  path = $hostCmd
  type = 'stdio'
  allowed_extensions = @('kyara-games@extension')
} | ConvertTo-Json), $utf8)

Remove-Keys
foreach ($k in $chromeKeys) {
  $key = "HKCU:\Software\$k\NativeMessagingHosts\$name"
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $chromeManifest
}
$key = "HKCU:\Software\Mozilla\NativeMessagingHosts\$name"
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value $firefoxManifest

Write-Host ''
Write-Host "Assistant de mise a jour Kyara Games installe pour : $ext"
Write-Host ("Extension(s) reconnue(s) : " + (($config.GetEnumerator() | Where-Object { $_.Value -eq $ext } | ForEach-Object { $_.Key }) -join ', '))
Write-Host 'Le bouton "Mettre a jour" de la popup fonctionne maintenant. Si tu deplaces le dossier de l''extension, relance ce fichier.'
