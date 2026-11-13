# Local deploy script (run on dev machine):
#   pnpm deploy:vps
# Packs sources, uploads to the VPS, builds and starts compose.
# Secrets live only on the server (~/task-board/.env), never locally.
# Target/overrides: powershell -File scripts/deploy.ps1 -Target user@otherhost -Key path\to\key
param(
  [string]$Target,
  [string]$Key,
  [string]$RemoteDir = 'task-board'
)
# Значения по умолчанию можно переопределить параметрами или переменными окружения
if (-not $Target) { $Target = $env:TASKBOARD_DEPLOY_TARGET }
if (-not $Target) { $Target = 'bibza@45.81.255.219' }
if (-not $Key) { $Key = $env:TASKBOARD_DEPLOY_KEY }
if (-not $Key) { $Key = "$env:USERPROFILE\.ssh\ai_agent_key" }
$ErrorActionPreference = 'Stop'
$Tarball = Join-Path $env:TEMP 'task-board.tar.gz'

if (-not (Test-Path $Key)) { throw "SSH key not found: $Key" }

Write-Host '[1/4] Packing sources...'
tar --exclude=.git --exclude=.idea --exclude=node_modules --exclude=dist `
  --exclude=*.env --exclude=DEV_NOTES.md --exclude=specs `
  -czf $Tarball .

Write-Host '[2/4] Uploading to server...'
ssh -i $Key $Target "rm -rf ~/$RemoteDir && mkdir -p ~/$RemoteDir"
scp -i $Key $Tarball "${Target}:~/deploy.tar.gz"
ssh -i $Key $Target "tar -xzf ~/deploy.tar.gz -C ~/$RemoteDir && rm ~/deploy.tar.gz"

Write-Host '[3/4] Server secrets (persistent master copy outside deploy dir)...'
ssh -i $Key $Target ('cd ~/{0} && if [ ! -f ~/task-board.secrets.env ]; then printf ''POSTGRES_PASSWORD=%s\nJWT_SECRET=%s\n'' "$(openssl rand -hex 16)" "$(openssl rand -hex 32)" > ~/task-board.secrets.env; fi && cp ~/task-board.secrets.env .env && echo ''.env synced from master''' -f $RemoteDir)

Write-Host '[4/4] Build and run...'
ssh -i $Key $Target "cd ~/$RemoteDir && docker compose build app && docker compose up -d --remove-orphans && docker image prune -f && docker compose ps"

Remove-Item $Tarball -ErrorAction SilentlyContinue
Write-Host 'Deploy finished.'
