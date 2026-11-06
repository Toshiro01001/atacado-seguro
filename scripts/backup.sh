#!/bin/sh
# Exporta o banco remoto para backups/. Rode em uma máquina com o Wrangler autenticado
# e guarde o arquivo cifrado fora da Cloudflare.
set -eu
mkdir -p backups
ARQ="backups/atacado-$(date +%Y%m%d-%H%M).sql"
npx wrangler d1 export atacado-seguro --remote --output="$ARQ"
echo "$ARQ"
