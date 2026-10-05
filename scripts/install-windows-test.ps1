param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:RUNNER_TEMP 'bmux Windows test install'
$process = Start-Process -FilePath (Resolve-Path $Installer) -ArgumentList '/S', "/D=$directory" -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)" }
$executable = Join-Path $directory 'bmux.exe'
if (!(Test-Path $executable)) { throw 'Installer did not create bmux.exe' }
"BMUX_WINDOWS_APP=$executable" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
