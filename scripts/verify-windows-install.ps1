$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Windows installer verification requires a GitHub-hosted Windows runner.'
}
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or $env:RUNNER_TEMP -match '\s') {
  throw 'RUNNER_TEMP must be an existing path without whitespace for the NSIS /D argument.'
}
if (-not (Test-Path -LiteralPath $env:RUNNER_TEMP -PathType Container)) {
  throw "Runner temporary directory is missing: $env:RUNNER_TEMP"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$installer = Join-Path $projectRoot "release/mapper-$($package.version)-win-x64.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
  throw "Windows installer is missing: $installer"
}

$installDirectory = Join-Path ([System.IO.Path]::GetFullPath($env:RUNNER_TEMP)) "mapper-install-$([guid]::NewGuid().ToString('N'))"
$application = Join-Path $installDirectory 'mapper.exe'
$uninstaller = Join-Path $installDirectory 'Uninstall mapper.exe'
$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$programs = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
if ([string]::IsNullOrWhiteSpace($desktop) -or [string]::IsNullOrWhiteSpace($programs)) {
  throw 'Cannot resolve the current user desktop and Start menu directories.'
}
$shortcutPaths = @(
  (Join-Path $desktop 'mapper.lnk')
  (Join-Path $programs 'mapper.lnk')
)
foreach ($path in $shortcutPaths) {
  if (Test-Path -LiteralPath $path) {
    throw "Refusing to overwrite an existing shortcut: $path"
  }
}

function Invoke-Installer {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string[]]$Arguments,
    [int]$TimeoutSeconds = 180
  )

  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru
  try {
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      $process.Kill($true)
      $null = $process.WaitForExit(10000)
      throw "Installer timed out after $TimeoutSeconds seconds: $FilePath"
    }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
      throw "Installer exited with code $($process.ExitCode): $FilePath"
    }
  } finally {
    $process.Dispose()
  }
}

function Assert-Shortcuts {
  param(
    [Parameter(Mandatory)][string[]]$Paths,
    [Parameter(Mandatory)][string]$ExpectedTarget,
    [Parameter(Mandatory)][object]$Shell
  )

  if (-not (Test-Path -LiteralPath $ExpectedTarget -PathType Leaf) -or (Get-Item -LiteralPath $ExpectedTarget).Length -eq 0) {
    throw "Installed application is missing or empty: $ExpectedTarget"
  }
  foreach ($path in $Paths) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Installer did not create the shortcut: $path"
    }
    $shortcut = $Shell.CreateShortcut($path)
    try {
      if ([string]::IsNullOrWhiteSpace($shortcut.TargetPath)) {
        throw "Shortcut has no application target: $path"
      }
      $actual = [System.IO.Path]::GetFullPath($shortcut.TargetPath)
      if (-not [string]::Equals($actual, $ExpectedTarget, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Shortcut target mismatch: $path -> $actual; expected $ExpectedTarget"
      }
    } finally {
      $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
    }
  }
}

$installationStarted = $false
$shell = $null
$failure = $null
$cleanupFailure = $null
try {
  # NSIS /D must be unquoted and the final argument; the generated directory has no spaces.
  $installationStarted = $true
  Invoke-Installer -FilePath $installer -Arguments @('/S', '/currentuser', "/D=$installDirectory")
  $shell = New-Object -ComObject WScript.Shell
  Assert-Shortcuts -Paths $shortcutPaths -ExpectedTarget $application -Shell $shell
  Write-Host "Verified mapper $($package.version) installation and desktop/Start menu shortcuts."

  foreach ($path in $shortcutPaths) {
    Remove-Item -LiteralPath $path -Force
  }
  Invoke-Installer -FilePath $installer -Arguments @('/S', '/currentuser', "/D=$installDirectory")
  Assert-Shortcuts -Paths $shortcutPaths -ExpectedTarget $application -Shell $shell
  Write-Host 'Verified reinstall restores both missing shortcuts.'
} catch {
  $failure = $_
} finally {
  if ($installationStarted) {
    try {
      if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        # _?= disables NSIS's detached temporary uninstaller so process exit means cleanup finished.
        Invoke-Installer -FilePath $uninstaller -Arguments @('/S', '/currentuser', "_?=$installDirectory")
        if (Test-Path -LiteralPath $application) {
          throw "Uninstall did not remove the installed application: $application"
        }
        foreach ($path in $shortcutPaths) {
          if (Test-Path -LiteralPath $path) {
            throw "Uninstall did not remove the shortcut: $path"
          }
        }
        # A directly executed uninstaller cannot delete itself. Remove only that file and an empty directory.
        if (Test-Path -LiteralPath $uninstaller) {
          Remove-Item -LiteralPath $uninstaller -Force
        }
        if (Test-Path -LiteralPath $installDirectory) {
          if (@(Get-ChildItem -LiteralPath $installDirectory -Force).Count -ne 0) {
            throw "Uninstall left files in the temporary installation directory: $installDirectory"
          }
          Remove-Item -LiteralPath $installDirectory -Force
        }
        Write-Host 'Verified uninstall removes the application and both shortcuts.'
      } elseif (Test-Path -LiteralPath $installDirectory) {
        throw "Partial installation has no uninstaller; temporary files remain in $installDirectory"
      }
    } catch {
      $cleanupFailure = $_
    }
  }
  if ($null -ne $shell) {
    $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
  }
}

if ($null -ne $failure) {
  if ($null -ne $cleanupFailure) {
    Write-Error -ErrorRecord $cleanupFailure -ErrorAction Continue
  }
  throw $failure
}
if ($null -ne $cleanupFailure) {
  throw $cleanupFailure
}
