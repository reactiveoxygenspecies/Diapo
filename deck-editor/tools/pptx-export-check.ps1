<#
Opens exported .pptx files in PowerPoint itself (COM automation, no window) and
renders every slide to PNG: the check that a file Diapo writes opens without
PowerPoint offering to repair it, and the picture of how PowerPoint draws it.

    powershell -ExecutionPolicy Bypass -File tools/pptx-export-check.ps1 -Files a.pptx,b.pptx [-Out tools/pptx-export]

For each file: "OK <slides> <file>" and <Out>/<name>/NN.png, or "FAIL <file>: <error>".
Needs PowerPoint (Office 16).
#>
param(
    [string[]]$Files = @(),
    [string]$Out = ""
)
$ErrorActionPreference = "Stop"
$Files = @($Files | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Out) { $Out = Join-Path $here "pptx-export" }
$Out = [System.IO.Path]::GetFullPath($Out)
New-Item -ItemType Directory -Force $Out | Out-Null

$app = New-Object -ComObject PowerPoint.Application
$failed = 0
try {
    foreach ($f in $Files) {
        $full = [System.IO.Path]::GetFullPath($f)
        $name = [System.IO.Path]::GetFileNameWithoutExtension($full)
        try {
            # ReadOnly, Untitled = false, WithWindow = false. A file PowerPoint must repair throws here.
            $p = $app.Presentations.Open($full, -1, 0, 0)
            $dir = Join-Path $Out $name
            New-Item -ItemType Directory -Force $dir | Out-Null
            $n = $p.Slides.Count
            for ($i = 1; $i -le $n; $i++) {
                $p.Slides.Item($i).Export((Join-Path $dir ("{0:D2}.png" -f $i)), "PNG", 1600, 900)
            }
            $charts = 0
            foreach ($s in $p.Slides) { foreach ($sh in $s.Shapes) { if ($sh.HasChart -eq -1) { $charts++ } } }
            $p.Close()
            Write-Output ("OK {0} slides, {1} charts: {2}" -f $n, $charts, $full)
        } catch {
            $failed++
            Write-Output ("FAIL {0}: {1}" -f $full, $_.Exception.Message)
        }
    }
} finally {
    $app.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
exit $failed
