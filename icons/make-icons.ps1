# Generates extension icons: iOS-style gradient tile + white sigma + Markdown-style down arrow
Add-Type -AssemblyName System.Drawing
$dir = $PSScriptRoot

function New-RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

foreach ($size in 16, 32, 48, 128) {
  $scale = 4
  $big = $size * $scale
  $bmp = New-Object System.Drawing.Bitmap $big, $big
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'

  $pad = if ($size -le 16) { 0 } else { $big * 0.04 }
  $tile = New-RoundRect $pad $pad ($big - 2 * $pad) ($big - 2 * $pad) ($big * 0.225)
  $rect = New-Object System.Drawing.RectangleF 0, 0, $big, $big
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(94, 92, 230)), ([System.Drawing.Color]::FromArgb(10, 132, 255)), 45
  $g.FillPath($brush, $tile)

  # Sigma glyph, centered on its outline (shifted left to leave room for the arrow)
  $glyph = New-Object System.Drawing.Drawing2D.GraphicsPath
  $family = New-Object System.Drawing.FontFamily 'Segoe UI'
  $glyph.AddString([string][char]0x2211, $family, [int][System.Drawing.FontStyle]::Bold, [single]($big * 0.62), (New-Object System.Drawing.PointF 0, 0), [System.Drawing.StringFormat]::GenericTypographic)
  $b = $glyph.GetBounds()
  $targetH = $big * 0.50
  $k = $targetH / $b.Height
  $m = New-Object System.Drawing.Drawing2D.Matrix
  $cx = $big * 0.42; $cy = $big * 0.5
  $m.Translate($cx, $cy)
  $m.Scale($k, $k)
  $m.Translate(-($b.X + $b.Width / 2), -($b.Y + $b.Height / 2))
  $glyph.Transform($m)
  $g.FillPath([System.Drawing.Brushes]::White, $glyph)

  # Down arrow (as in the Markdown logo)
  $ax = $big * 0.76; $top = $big * 0.30; $bot = $big * 0.72
  $sw = $big * 0.075; $head = $big * 0.12
  $arrow = New-Object System.Drawing.Drawing2D.GraphicsPath
  $pts = @(
    (New-Object System.Drawing.PointF ($ax - $sw / 2), $top),
    (New-Object System.Drawing.PointF ($ax + $sw / 2), $top),
    (New-Object System.Drawing.PointF ($ax + $sw / 2), ($bot - $head)),
    (New-Object System.Drawing.PointF ($ax + $head), ($bot - $head)),
    (New-Object System.Drawing.PointF $ax, $bot),
    (New-Object System.Drawing.PointF ($ax - $head), ($bot - $head)),
    (New-Object System.Drawing.PointF ($ax - $sw / 2), ($bot - $head))
  )
  $arrow.AddPolygon([System.Drawing.PointF[]]$pts)
  $g.FillPath([System.Drawing.Brushes]::White, $arrow)

  $out = New-Object System.Drawing.Bitmap $size, $size
  $g2 = [System.Drawing.Graphics]::FromImage($out)
  $g2.InterpolationMode = 'HighQualityBicubic'
  $g2.SmoothingMode = 'AntiAlias'
  $g2.PixelOffsetMode = 'HighQuality'
  $g2.DrawImage($bmp, 0, 0, $size, $size)
  $out.Save((Join-Path $dir "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g2.Dispose(); $out.Dispose(); $g.Dispose(); $bmp.Dispose()
}
"done"

