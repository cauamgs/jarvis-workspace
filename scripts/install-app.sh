#!/bin/zsh
# Empacota o Jarvis WorkSpace, assina (ad-hoc) e instala em /Applications.
# A assinatura é feita fora de ~/Documents: o iCloud recoloca atributos estendidos ali e quebra o codesign.
set -euo pipefail
cd "${0:A:h}/.."

unset ELECTRON_RUN_AS_NODE
npx electron-vite build
npx electron-builder --mac --arm64

STAGE="$(mktemp -d)"
ditto --noextattr --norsrc "dist/mac-arm64/Jarvis WorkSpace.app" "$STAGE/Jarvis WorkSpace.app"
codesign --force --deep -s - "$STAGE/Jarvis WorkSpace.app"
codesign --verify --deep "$STAGE/Jarvis WorkSpace.app"

osascript -e 'quit app "Jarvis WorkSpace"' 2>/dev/null || true
rm -rf "/Applications/Jarvis WorkSpace.app"
ditto "$STAGE/Jarvis WorkSpace.app" "/Applications/Jarvis WorkSpace.app"
rm -rf "$STAGE"
echo "✔ Instalado em /Applications/Jarvis WorkSpace.app"
