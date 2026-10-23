<#
Makes the PowerPoint import corpus with PowerPoint itself (COM automation):
one deck of 14 slides that uses most of what real decks use (layouts,
multi-level bullets, mixed runs, shapes, lines, groups, pictures, a table
with merged cells, charts, a picture background, autofit text, a hidden
slide, notes), saved once per built-in design theme, plus a PNG of every
slide as PowerPoint renders it: the reference the import is compared with
(tools/pptx-compare.js does the importing, screenshots and contact sheets).

    powershell -ExecutionPolicy Bypass -File tools/pptx-corpus.ps1 [-Themes Ion,Facet] [-Out tools/pptx-corpus]

Needs PowerPoint (Office 16). Output (ignored by git):
    <Out>/<theme>.pptx           the deck in that theme
    <Out>/ref/<theme>/NN.png     PowerPoint's own render of slide NN
#>
param(
    [string[]]$Themes = @("Office Theme", "Ion", "Facet", "Retrospect", "Integral", "Wisp", "Slice", "Gallery"),
    [string]$Out = ""
)
$ErrorActionPreference = "Stop"
$Themes = @($Themes | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })   # -File passes one string
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Out) { $Out = Join-Path $here "pptx-corpus" }
$Out = [System.IO.Path]::GetFullPath($Out)
New-Item -ItemType Directory -Force $Out | Out-Null
$themeDir = "C:\Program Files\Microsoft Office\root\Document Themes 16"

# --- two pictures: a "photo" (gradient with circles) and a logo with transparency ---
Add-Type -AssemblyName System.Drawing
$photo = Join-Path $Out "photo.jpg"; $logo = Join-Path $Out "logo.png"
if (-not (Test-Path $photo)) {
    $bmp = New-Object System.Drawing.Bitmap 1200, 800
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new(0,0)), ([System.Drawing.Point]::new(1200,800)), ([System.Drawing.Color]::FromArgb(255,30,80,140)), ([System.Drawing.Color]::FromArgb(255,240,150,60))
    $g.FillRectangle($br, 0, 0, 1200, 800)
    $g.FillEllipse([System.Drawing.Brushes]::White, 700, 120, 320, 320)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(160, 20, 20, 40))), 150, 350, 500, 380)
    $bmp.Save($photo, [System.Drawing.Imaging.ImageFormat]::Jpeg); $g.Dispose(); $bmp.Dispose()
    $bmp = New-Object System.Drawing.Bitmap 400, 400
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::Transparent)
    $g.FillEllipse([System.Drawing.Brushes]::Crimson, 20, 20, 360, 360)
    $g.FillRectangle([System.Drawing.Brushes]::White, 120, 180, 160, 40)
    $bmp.Save($logo, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}

$app = New-Object -ComObject PowerPoint.Application
try {
    $pres = $app.Presentations.Add(0)          # msoFalse: no window
    # The default size of a new presentation: 16:9 at 13.333 x 7.5 in (960 x 540 pt), the modern one.
    $L = @{}; foreach ($cl in $pres.SlideMaster.CustomLayouts) { $L[$cl.Name] = $cl }
    function Add-Slide($name) { $script:pres.Slides.AddSlide($script:pres.Slides.Count + 1, $L[$name]) }
    $W = $pres.PageSetup.SlideWidth; $H = $pres.PageSetup.SlideHeight

    # 1 title
    $s = Add-Slide "Title Slide"
    $s.Shapes(1).TextFrame.TextRange.Text = "Quarterly Review"
    $s.Shapes(2).TextFrame.TextRange.Text = "Product, people and plans for Q4"
    $s.NotesPage.Shapes(2).TextFrame.TextRange.Text = "Welcome everyone. Two minutes on the agenda, then the numbers."

    # 2 bullets, three levels, mixed runs, a link
    $s = Add-Slide "Title and Content"
    $s.Shapes(1).TextFrame.TextRange.Text = "Agenda"
    $tr = $s.Shapes(2).TextFrame.TextRange
    $tr.Text = "Where we are`rRevenue and margin`rCustomer growth by segment`rEnterprise`rSelf-serve`rWhat is next`rThe roadmap at diapo.app"
    $tr.Paragraphs(2).IndentLevel = 2; $tr.Paragraphs(3).IndentLevel = 2
    $tr.Paragraphs(4).IndentLevel = 3; $tr.Paragraphs(5).IndentLevel = 3
    $tr.Paragraphs(1).Font.Bold = -1
    $tr.Paragraphs(2).Characters(1, 7).Font.Color.RGB = 0x2020D0     # BGR: a red word
    $tr.Paragraphs(2).Characters(1, 7).Font.Italic = -1
    $link = $tr.Paragraphs(7).Characters(16, 9); $link.ActionSettings(1).Hyperlink.Address = "https://diapo.app"
    $s.NotesPage.Shapes(2).TextFrame.TextRange.Text = "Keep this short."

    # 3 section header
    $s = Add-Slide "Section Header"
    $s.Shapes(1).TextFrame.TextRange.Text = "The numbers"
    $s.Shapes(2).TextFrame.TextRange.Text = "Revenue, margin, cash"

    # 4 two content: bullets and a picture
    $s = Add-Slide "Two Content"
    $s.Shapes(1).TextFrame.TextRange.Text = "Revenue"
    $s.Shapes(2).TextFrame.TextRange.Text = "Up 18% year on year`rMargin steady at 62%`rCash runway 26 months"
    $ph = $s.Shapes(3); $pl = $ph.Left; $pt = $ph.Top; $pw = $ph.Width; $ph.Delete()
    $pic = $s.Shapes.AddPicture($photo, 0, -1, $pl, $pt, $pw, ($pw * 2 / 3))

    # 5 comparison
    $s = Add-Slide "Comparison"
    $s.Shapes(1).TextFrame.TextRange.Text = "Enterprise vs self-serve"
    $s.Shapes(2).TextFrame.TextRange.Text = "Enterprise"
    $s.Shapes(3).TextFrame.TextRange.Text = "Long sales cycle`rHigh contract value`rDedicated support"
    $s.Shapes(4).TextFrame.TextRange.Text = "Self-serve"
    $s.Shapes(5).TextFrame.TextRange.Text = "Sign up in minutes`rCard on file`rCommunity support"

    # 6 shapes on a title-only slide
    $s = Add-Slide "Title Only"
    $s.Shapes(1).TextFrame.TextRange.Text = "Shapes"
    $y = 130
    $r = $s.Shapes.AddShape(1, 40, $y, 150, 90); $r.TextFrame.TextRange.Text = "Rectangle"                       # msoShapeRectangle
    $r = $s.Shapes.AddShape(5, 210, $y, 150, 90); $r.TextFrame.TextRange.Text = "Rounded"                        # roundRect
    $r = $s.Shapes.AddShape(9, 380, $y, 120, 120); $r.TextFrame.TextRange.Text = "Oval"                          # oval
    $r = $s.Shapes.AddShape(7, 520, $y, 120, 110); $r.TextFrame.TextRange.Text = "Tri"                           # isosceles triangle
    $r = $s.Shapes.AddShape(4, 660, $y, 120, 110); $r.TextFrame.TextRange.Text = "Diamond"                       # diamond
    $r = $s.Shapes.AddShape(33, 800, $y, 140, 80); $r.TextFrame.TextRange.Text = "Go"                            # right arrow
    $y = 290
    $r = $s.Shapes.AddShape(52, 40, $y, 140, 80); $r.TextFrame.TextRange.Text = "Step 1"                         # chevron
    $r = $s.Shapes.AddShape(52, 190, $y, 140, 80); $r.TextFrame.TextRange.Text = "Step 2"
    $r = $s.Shapes.AddShape(92, 360, $y, 110, 110)                                                                # 5-point star
    $r = $s.Shapes.AddShape(10, 490, $y, 120, 110); $r.TextFrame.TextRange.Text = "Hex"                          # hexagon
    $r = $s.Shapes.AddShape(1, 640, $y, 160, 90); $r.Fill.TwoColorGradient(1, 1); $r.Fill.ForeColor.RGB = 0xC08020; $r.Fill.BackColor.RGB = 0x20A0F0; $r.TextFrame.TextRange.Text = "Gradient"
    $r = $s.Shapes.AddShape(1, 820, $y, 120, 90); $r.Fill.Visible = 0; $r.Line.Weight = 4; $r.Line.DashStyle = 4; $r.TextFrame.TextRange.Text = "Outline"
    $ln = $s.Shapes.AddLine(40, 420, 400, 500); $ln.Line.Weight = 3
    $ln = $s.Shapes.AddLine(420, 500, 780, 420); $ln.Line.Weight = 3; $ln.Line.EndArrowheadStyle = 3; $ln.Line.ForeColor.RGB = 0x0000C0
    $ln = $s.Shapes.AddLine(40, 520, 940, 520); $ln.Line.Weight = 6
    $tb = $s.Shapes.AddTextbox(1, 640, 400, 300, 60); $tb.TextFrame.TextRange.Text = "Rotated text box"; $tb.Rotation = -12
    $r = $s.Shapes.AddShape(1, 820, 410, 60, 60); $r.Fill.ForeColor.RGB = 0x40A040; $r.Shadow.Visible = -1; $r.Name = "g1"
    $r = $s.Shapes.AddShape(9, 890, 410, 50, 50); $r.Fill.ForeColor.RGB = 0x4040F0; $r.Name = "g2"
    $s.Shapes.Range(@("g1", "g2")).Group() | Out-Null

    # 7 table with merged header, widths, a filled cell
    $s = Add-Slide "Title Only"
    $s.Shapes(1).TextFrame.TextRange.Text = "Results by region"
    $t = $s.Shapes.AddTable(5, 4, 60, 130, 840, 300); $tbl = $t.Table
    $tbl.Cell(1, 1).Shape.TextFrame.TextRange.Text = "Region"
    $tbl.Cell(1, 2).Shape.TextFrame.TextRange.Text = "H1 and H2"; $tbl.Cell(1, 2).Merge($tbl.Cell(1, 3))
    $tbl.Cell(1, 4).Shape.TextFrame.TextRange.Text = "Total"
    $rows = @(@("North", "120", "140", "260"), @("South", "90", "110", "200"), @("East", "60", "75", "135"), @("West", "150", "170", "320"))
    for ($i = 0; $i -lt 4; $i++) { for ($j = 0; $j -lt 4; $j++) { $tbl.Cell($i + 2, $j + 1).Shape.TextFrame.TextRange.Text = $rows[$i][$j] } }
    $tbl.Columns(1).Width = 300; $tbl.Columns(2).Width = 180; $tbl.Columns(3).Width = 180; $tbl.Columns(4).Width = 180
    $tbl.Cell(5, 4).Shape.Fill.ForeColor.RGB = 0x60D0F0
    $tbl.Cell(5, 4).Shape.TextFrame.TextRange.Font.Bold = -1
    for ($j = 2; $j -le 4; $j++) { for ($i = 2; $i -le 5; $i++) { $tbl.Cell($i, $j).Shape.TextFrame.TextRange.ParagraphFormat.Alignment = 3 } }

    # 8 charts: added by tools/pptx-corpus-charts.py (python-pptx) after the save below;
    # PowerPoint's AddChart2 needs a window and an Excel session, which this script avoids.
    $s = Add-Slide "Title Only"
    $s.Shapes(1).TextFrame.TextRange.Text = "Charts"

    # 9 picture with caption, picture cropped and rounded
    $s = Add-Slide "Picture with Caption"
    $s.Shapes(1).TextFrame.TextRange.Text = "The team"
    $ph = $null; foreach ($sh in $s.Shapes) { if ($sh.Type -eq 14 -and $sh.PlaceholderFormat.Type -eq 18) { $ph = $sh } }
    if ($ph) { $pl = $ph.Left; $pt = $ph.Top; $pw = $ph.Width; $phh = $ph.Height; $ph.Delete(); $pic = $s.Shapes.AddPicture($photo, 0, -1, $pl, $pt, $pw, $phh) }
    else { $pic = $s.Shapes.AddPicture($photo, 0, -1, 60, 120, 500, 330) }
    $pic.PictureFormat.CropLeft = 120; $pic.PictureFormat.CropTop = 40
    foreach ($sh in $s.Shapes) { if ($sh.HasTextFrame -and $sh.TextFrame.TextRange.Text -eq "" -and $sh.Type -eq 14) { $sh.TextFrame.TextRange.Text = "Forty people in six countries, most of them remote." } }
    $lg = $s.Shapes.AddPicture($logo, 0, -1, ($W - 140), 20, 100, 100)

    # 10 autofit: too much text in the body
    $s = Add-Slide "Title and Content"
    $s.Shapes(1).TextFrame.TextRange.Text = "Risks (a slide with too much text)"
    $lines = 1..14 | ForEach-Object { "Risk number $_ with a fairly long description that wraps onto a second line in most themes" }
    $s.Shapes(2).TextFrame.TextRange.Text = ($lines -join "`r")
    $s.Shapes(2).TextFrame2.AutoSize = 2       # msoAutoSizeTextToFitShape

    # 11 mixed formatting in a free text box
    $s = Add-Slide "Blank"
    $tb = $s.Shapes.AddTextbox(1, 60, 60, 840, 400); $tr = $tb.TextFrame.TextRange
    $tr.Text = "Big centred heading`rA justified paragraph of body text that goes on for long enough to wrap onto several lines so that the justification and the line spacing can be seen in the render.`rRight aligned, underlined and struck`rSuper and sub: x2 and H2O, in a monospace face"
    $tr.Paragraphs(1).Font.Size = 40; $tr.Paragraphs(1).ParagraphFormat.Alignment = 2; $tr.Paragraphs(1).Font.Color.RGB = 0x802020
    $tr.Paragraphs(2).ParagraphFormat.Alignment = 4; $tr.Paragraphs(2).ParagraphFormat.SpaceWithin = 1.5; $tr.Paragraphs(2).Font.Size = 18
    $tr.Paragraphs(3).ParagraphFormat.Alignment = 3; $tr.Paragraphs(3).Characters(16, 10).Font.Underline = -1; $tb.TextFrame2.TextRange.Paragraphs(3).Characters(31, 6).Font.Strikethrough = -1
    $tr.Paragraphs(4).Characters(17, 1).Font.Superscript = -1; $tr.Paragraphs(4).Characters(24, 1).Font.Subscript = -1
    $tr.Paragraphs(4).Characters(30, 22).Font.Name = "Consolas"
    $tb2 = $s.Shapes.AddTextbox(1, 60, 470, 840, 40); $tb2.TextFrame.TextRange.Text = "Small grey footer text"; $tb2.TextFrame.TextRange.Font.Size = 12; $tb2.TextFrame.TextRange.Font.Color.RGB = 0x808080

    # 12 picture background, white text over it
    $s = Add-Slide "Blank"
    $s.FollowMasterBackground = 0; $s.Background.Fill.UserPicture($photo)
    $tb = $s.Shapes.AddTextbox(1, 60, 200, 840, 120); $tb.TextFrame.TextRange.Text = "Over a picture"; $tb.TextFrame.TextRange.Font.Size = 54; $tb.TextFrame.TextRange.Font.Color.RGB = 0xFFFFFF; $tb.TextFrame.TextRange.Font.Bold = -1

    # 13 content with caption + a hidden slide after it
    $s = Add-Slide "Content with Caption"
    $s.Shapes(1).TextFrame.TextRange.Text = "Caption layout"
    $s.Shapes(2).TextFrame.TextRange.Text = "Main content: three points`rTwo`rThree"
    $s.Shapes(3).TextFrame.TextRange.Text = "The caption explains the content in a smaller face."
    $s = Add-Slide "Title and Content"
    $s.Shapes(1).TextFrame.TextRange.Text = "Hidden slide"
    $s.Shapes(2).TextFrame.TextRange.Text = "This slide is hidden in the show"
    $s.SlideShowTransition.Hidden = -1

    $base = Join-Path $Out "base.pptx"
    $pres.SaveAs($base)
    $pres.Close()
    "base: $base"
    & py -3 (Join-Path $here "pptx-corpus-charts.py") $base
    if ($LASTEXITCODE -ne 0) { throw "pptx-corpus-charts.py failed" }

    foreach ($theme in $Themes) {
        $thmx = Join-Path $themeDir ($theme + ".thmx")
        if (-not (Test-Path $thmx)) { Write-Warning "no theme $thmx"; continue }
        $p2 = $app.Presentations.Open($base, 0, 0, 0)
        $p2.ApplyTemplate($thmx)
        $slug = ($theme -replace '[^A-Za-z0-9]+', '-').ToLower()
        $file = Join-Path $Out "$slug.pptx"
        $p2.SaveAs($file)
        $ref = Join-Path $Out "ref\$slug"; New-Item -ItemType Directory -Force $ref | Out-Null
        $n = 0
        foreach ($sl in $p2.Slides) { $n++; $sl.Export((Join-Path $ref ("{0:D2}.png" -f $n)), "PNG", 1920, 1080) }
        $p2.Close()
        "$slug : $file, $n renders"
    }
} finally {
    $app.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
