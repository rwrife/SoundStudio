$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path 'node_modules\electron')) {
        throw 'Dependencies are missing. Run npm install first.'
    }
    if (-not (Test-Path 'out\main\index.js')) {
        throw 'The application has not been built. Run npm run build first.'
    }
    npm start
    if ($LASTEXITCODE -ne 0) {
        throw "Sound Studio exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
