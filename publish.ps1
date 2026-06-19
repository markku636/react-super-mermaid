<#
.SYNOPSIS
  Build 並發佈 react-super-mermaid 到 npm。

.DESCRIPTION
  在套件資料夾執行:檢查登入 → (可選)bump 版本 → npm publish。
  npm publish 會自動觸發 prepublishOnly(typecheck + tsup build),所以這裡不重複 build。

  認證(擇一,token 一律不寫進本檔):
    - 環境變數 NPM_TOKEN:有設就自動帶入(最推薦,不留痕跡)。
        單次:  $env:NPM_TOKEN = 'npm_xxx'; ./publish.ps1
        永久:  setx NPM_TOKEN "npm_xxx"   (重開終端機生效;存使用者環境,不進 repo)
    - 或事先 `npm login` / `npm config set //registry.npmjs.org/:_authToken=...`,本腳本會沿用。

  2FA 說明:
    - 用「Automation」classic token(繞過 2FA)→ 全自動跑完,不跳任何提示。
    - 用一般 / security key 2FA → npm 會開瀏覽器要你用 security key 驗證,
      請在「互動式」PowerShell 視窗執行(不要在背景跑),驗證完就會繼續。

.PARAMETER Bump
  發佈前要不要 bump 版本:none(預設)/ patch / minor / major。
  republish 同一版本會被 npm 拒絕,改版時用這個。

.PARAMETER DryRun
  只做 npm publish --dry-run,不真的上傳(會跑 build、列出 tarball 內容)。

.EXAMPLE
  ./publish.ps1                 # 發佈目前版本
  ./publish.ps1 -Bump patch     # 0.1.0 -> 0.1.1 後發佈
  ./publish.ps1 -DryRun         # 試跑,不上傳
#>
param(
  [ValidateSet('none', 'patch', 'minor', 'major')]
  [string]$Bump = 'none',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
# 不論從哪裡呼叫,都切到腳本所在(= 套件根)資料夾。
Set-Location -Path $PSScriptRoot

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

Write-Step 'react-super-mermaid 發佈流程'

# 認證:優先用環境變數 NPM_TOKEN(不寫進檔案);否則沿用既有 npm login / 設定。
$authArgs = @()
if (-not [string]::IsNullOrWhiteSpace($env:NPM_TOKEN)) {
  $authArgs = @("--//registry.npmjs.org/:_authToken=$($env:NPM_TOKEN)")
  Write-Host '認證來源: 環境變數 NPM_TOKEN'
}

# 1. 確認 npm 登入 / token 有效
$who = npm whoami @authArgs
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($who)) {
  Write-Host '未登入 npm。請設定環境變數 NPM_TOKEN,或先 `npm login`:' -ForegroundColor Red
  Write-Host '  $env:NPM_TOKEN = ''npm_xxx''   # 單次' -ForegroundColor Yellow
  Write-Host '  setx NPM_TOKEN "npm_xxx"       # 永久(重開終端機)' -ForegroundColor Yellow
  exit 1
}
Write-Host "登入身分: $who"

# 2. (可選)bump 版本
if ($Bump -ne 'none') {
  Write-Step "bump 版本 ($Bump)"
  npm version $Bump --no-git-tag-version
  if ($LASTEXITCODE -ne 0) { Write-Host 'npm version 失敗。' -ForegroundColor Red; exit 1 }
}

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
Write-Host "套件: $($pkg.name)@$($pkg.version)"

# 3. 發佈(prepublishOnly 會自動先 typecheck + build)
$publishArgs = @('publish', '--access', 'public') + $authArgs
if ($DryRun) { $publishArgs += '--dry-run' }

Write-Step "npm $($publishArgs -join ' ')"
npm @publishArgs
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '發佈失敗。' -ForegroundColor Red
  Write-Host '若錯誤是 EOTP / 需要 2FA:' -ForegroundColor Yellow
  Write-Host '  (a) 在互動式 PowerShell 直接跑這個腳本,npm 會開瀏覽器讓你用 security key 驗證;或' -ForegroundColor Yellow
  Write-Host '  (b) 改用「Automation」classic token(繞過 2FA),設定後即可全自動發佈:' -ForegroundColor Yellow
  Write-Host '      npm config set //registry.npmjs.org/:_authToken=<automation token>' -ForegroundColor Yellow
  exit 1
}

if ($DryRun) {
  Write-Host '✅ Dry-run 完成(未上傳)。' -ForegroundColor Green
}
else {
  Write-Host "✅ 發佈成功: $($pkg.name)@$($pkg.version)" -ForegroundColor Green
  Write-Step '線上版本確認'
  npm view $pkg.name version
}
