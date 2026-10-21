# Kyara Games updater, started by the browser (native messaging) when the "Mettre a jour" button is clicked.
# Replaces the extension's files with the requested GitHub release, then answers so the extension can reload itself.
# A folder that is a git clone is updated with "git pull" instead.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$release = '^https://github\.com/A-Finch13/Kyara-Games-Extension/releases/download/'
$stdin = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()

function Read-Message {
  $head = New-Object byte[] 4
  if ($stdin.Read($head, 0, 4) -ne 4) { return $null }
  $size = [BitConverter]::ToInt32($head, 0)
  $buf = New-Object byte[] $size
  $read = 0
  while ($read -lt $size) {
    $n = $stdin.Read($buf, $read, $size - $read)
    if ($n -le 0) { break }
    $read += $n
  }
  return [Text.Encoding]::UTF8.GetString($buf, 0, $read) | ConvertFrom-Json
}

function Send-Message($reply) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($reply | ConvertTo-Json -Compress -Depth 4))
  $stdout.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

# Runs a program without letting it write to stdout, which belongs to the browser.
function Invoke-Quiet($file, $arguments) {
  $p = New-Object Diagnostics.Process
  $p.StartInfo.FileName = $file
  $p.StartInfo.Arguments = $arguments
  $p.StartInfo.UseShellExecute = $false
  $p.StartInfo.CreateNoWindow = $true
  $p.StartInfo.RedirectStandardOutput = $true
  $p.StartInfo.RedirectStandardError = $true
  [void]$p.Start()
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return @{ code = $p.ExitCode; text = ($out.Result + $err).Trim() }
}

function Get-Version($dir) {
  return [string]((Get-Content -LiteralPath (Join-Path $dir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version)
}

function Update-Extension($dir, $msg) {
  if (Test-Path -LiteralPath (Join-Path $dir '.git')) {
    $git = Invoke-Quiet 'git' "-C `"$dir`" pull --ff-only"
    if ($git.code -ne 0) { return @{ error = 'git_failed'; detail = $git.text } }
  } else {
    $url = [string]$msg.url
    if ($url -notmatch $release) { return @{ error = 'bad_url' } }
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("kyara-games-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
      $zip = Join-Path $tmp 'release.zip'
      Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
      $files = Join-Path $tmp 'files'
      Expand-Archive -LiteralPath $zip -DestinationPath $files
      if (-not (Test-Path -LiteralPath (Join-Path $files 'manifest.json'))) { return @{ error = 'bad_package' } }
      $copy = Invoke-Quiet 'robocopy' "`"$files`" `"$dir`" /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP"
      if ($copy.code -ge 8) { return @{ error = 'copy_failed'; detail = $copy.text } }
    } finally {
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  # The updater itself follows the extension.
  $fresh = Join-Path $dir 'updater\host.ps1'
  if (Test-Path -LiteralPath $fresh) { Copy-Item -LiteralPath $fresh -Destination (Join-Path $here 'host.ps1') -Force -ErrorAction SilentlyContinue }
  $now = Get-Version $dir
  if ($msg.version -and $now -ne [string]$msg.version) { return @{ error = 'version_mismatch'; detail = $now } }
  return @{ ok = $true; version = $now }
}

try {
  # Chrome passes "chrome-extension://<id>/", Firefox the manifest path then the add-on id.
  $caller = ($args | Where-Object { $_ -match '^chrome-extension://' } | Select-Object -First 1)
  $id = if ($caller) { ($caller -replace '^chrome-extension://', '').TrimEnd('/') } else { [string]$args[-1] }
  $config = Get-Content -LiteralPath (Join-Path $here 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $dir = $config.PSObject.Properties[$id].Value
  $msg = Read-Message
  if (-not $dir -or -not (Test-Path -LiteralPath (Join-Path $dir 'manifest.json'))) {
    Send-Message @{ error = 'unknown_extension' }
  } elseif ($msg.action -eq 'ping') {
    Send-Message @{ ok = $true; version = (Get-Version $dir) }
  } elseif ($msg.action -eq 'update') {
    Send-Message (Update-Extension $dir $msg)
  } else {
    Send-Message @{ error = 'unknown_action' }
  }
} catch {
  Send-Message @{ error = 'failed'; detail = $_.Exception.Message }
}
