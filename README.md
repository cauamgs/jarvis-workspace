# Jarvis WorkSpace

Central de comando nativa para macOS (Electron + React + TypeScript), inspirada no J.A.R.V.I.S.
Começa organizando as sessões do Claude Code (Desktop e terminal) em workspaces.

## Rodar

```bash
npm install
npm run dev
```

## Instalar como app

```bash
npm run install:app
```

Gera o `.app` (Apple Silicon), assina ad-hoc e instala em `/Applications/Jarvis WorkSpace.app`.

## Como funciona

- **Indexador** (`src/main/indexer.ts`) lê, somente leitura:
  - transcripts `~/.claude/projects/<projeto>/<sessionId>.jsonl` (CLI e Desktop gravam aqui);
  - metadados do Desktop em `~/Library/Application Support/Claude/claude-code-sessions/**/local_*.json`
    (título, arquivada, worktree — ligados pelo campo `cliSessionId`);
  - sessões vivas em `~/.claude/sessions/<pid>.json`.
  Cache incremental em `~/Library/Application Support/jarvis-workspace/session-index.json`.
- **Workspaces** (`src/main/store.ts`) ficam em `workspaces.json` no mesmo diretório e só referenciam IDs de sessão.
  Pastas vinculadas incluem automaticamente as sessões daquele projeto.
- **Chat** (`src/main/chat.ts`) usa o Claude Agent SDK apontando para o `claude` instalado do usuário
  (mesmo login, settings, CLAUDE.md e MCPs). Retoma sessões existentes (`resume`) ou cria novas com ID
  reservado (`sessionId`); pedidos de permissão viram cartões na interface. O processo fecha após 20 min ocioso.
- **Terminal** (`src/main/pty.ts`) roda `claude --resume <id>` (ou `--session-id` para sessões novas) num PTY.

Os formatos do Claude são internos e podem mudar — o Jarvis nunca escreve neles.
