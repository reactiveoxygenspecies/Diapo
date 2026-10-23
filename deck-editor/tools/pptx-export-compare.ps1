<#
Side by side, for each exported slide: Diapo's own render (diapo-NN.png, made by the
export test run) on the left, PowerPoint's (NN.png, from pptx-export-check.ps1) on the
right, into <Dir>/<name>/cmp-NN.png. Read those to judge the PowerPoint export.

    powershell -ExecutionPolicy Bypass -File tools/pptx-export-compare.ps1 -Names folio,welcome [-Dir tools/pptx-export]
#>
param(
    [string[]]$Names = @(),
    [string]$Dir = ""
)
$ErrorActionPreference = "Stop"
$Names = @($Names | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Dir) { $Dir = Join-Path $here "pptx-export" }
Add-Type -AssemblyName System.Drawing
foreach ($name in $Names) {
    $d = Join-Path $Dir $name
    Get-ChildItem $d -Filter "diapo-*.png" | ForEach-Object {
        $nn = $_.BaseName.Substring(6)
        $ppt = Join-Path $d "$nn.png"
        if (-not (Test-Path $ppt)) { return }
        $a = [System.Drawing.Image]::FromFile($_.FullName)
        $b = [System.Drawing.Image]::FromFile($ppt)
        $w = 960; $h = 540; $gap = 12
        $bmp = New-Object System.Drawing.Bitmap (2 * $w + $gap), ($h + 28)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.Clear([System.Drawing.Color]::FromArgb(255, 60, 60, 66))
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($a, 0, 28, $w, $h)
        $g.DrawImage($b, $w + $gap, 28, $w, $h)
        $font = New-Object System.Drawing.Font "Segoe UI", 11
        $g.DrawString("Diapo  $name $nn", $font, [System.Drawing.Brushes]::White, 6, 5)
        $g.DrawString("PowerPoint", $font, [System.Drawing.Brushes]::White, ($w + $gap + 6), 5)
        $bmp.Save((Join-Path $d "cmp-$nn.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose(); $a.Dispose(); $b.Dispose()
    }
    Write-Output "compared $name"
}
