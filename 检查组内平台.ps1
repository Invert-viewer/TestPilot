param([string]$Platform='http://127.0.0.1:8080')
$ErrorActionPreference='Stop'
Invoke-WebRequest "$Platform/" -UseBasicParsing -TimeoutSec 5 | Select-Object StatusCode
Invoke-RestMethod "$Platform/api/v1/workspace" -TimeoutSec 5 | Select-Object code,traceId
Invoke-RestMethod "$Platform/api/v1/tool-assets" -TimeoutSec 5 | Select-Object code,traceId
