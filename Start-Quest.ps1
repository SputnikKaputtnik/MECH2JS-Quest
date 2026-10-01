$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$taskNode = if ($taskNodeCommand) { $taskNodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (!(Test-Path -LiteralPath $taskNode)) { throw 'Node.js fehlt.' }
$taskAdbCommand = Get-Command adb -ErrorAction SilentlyContinue
$taskAdb = if ($taskAdbCommand) { $taskAdbCommand.Source } else { 'C:\Android\Sdk\platform-tools\adb.exe' }
if (!(Test-Path -LiteralPath $taskAdb)) { throw 'ADB fehlt.' }
& $taskAdb reverse tcp:5173 tcp:5173
if ($LASTEXITCODE -ne 0) { throw 'Quest anschließen und USB-Debugging im Headset bestätigen.' }
if (!(Test-Path -LiteralPath 'dist/index.html')) { throw 'Produktionsbuild fehlt. Zuerst pnpm build ausführen.' }
Write-Host 'Quest Browser: http://localhost:5173/ – Entwicklungstest mit PC-Datenzugriff.'
& $taskNode node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173 --strictPort
