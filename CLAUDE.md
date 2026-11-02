# Jarvis WorkSpace

App macOS (Electron + React + TypeScript) que organiza as sessões do Claude Code e controla o Mac.

## Para configurar/instalar

Siga a seção **Instalação** do `README.md`, na ordem:

1. Confira cada requisito da tabela antes de instalar qualquer coisa. Se faltar algo, diga ao usuário
   o que vai instalar e por quê. `xcode-select --install` abre um diálogo que o próprio usuário precisa confirmar.
2. `npm install`, depois `npm run install:app`, depois abra o app.
3. Em caso de erro, consulte "Problemas comuns" no README antes de improvisar.

## Regras

- Nunca escreva nos arquivos internos do Claude (`~/.claude/projects`, `~/.claude/sessions`,
  `~/Library/Application Support/Claude`). O Jarvis só os lê.
- Não conceda permissões de privacidade do macOS (Microfone, Reconhecimento de Fala, Automação) pelo
  usuário: explique o que ele vai ver e deixe que ele aprove.
- Comandos: `npm run dev` (desenvolvimento), `npm run typecheck`, `npm run install:app` (empacota e instala).
