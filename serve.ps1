# Simple local static server for the app (no Python or Node.js needed).
# Run:  powershell -ExecutionPolicy Bypass -File serve.ps1   then open http://localhost:8000
# (ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.)
param([int]$Port = 8000)

$Root = (Resolve-Path $PSScriptRoot).Path
$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving on http://localhost:$Port/ (stop with Ctrl+C)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($path -eq '') { $path = 'index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $Root $path))
      if ($file.StartsWith($Root) -and (Test-Path $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $type = $types[[IO.Path]::GetExtension($file).ToLower()]
        $ctx.Response.ContentType = $(if ($type) { $type } else { 'application/octet-stream' })
        $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
        $ctx.Response.ContentLength64 = $bytes.Length
        # HEAD requests get headers only; writing a body would throw.
        if ($ctx.Request.HttpMethod -ne 'HEAD') {
          $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
      } else {
        $ctx.Response.StatusCode = 404
      }
    } catch {
      Write-Host "Request failed: $($_.Exception.Message)"
    } finally {
      try { $ctx.Response.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
