# Jarvis WorkSpace

Central de comando nativa para macOS (Electron + React + TypeScript), inspirada no J.A.R.V.I.S.
Começa organizando as sessões do Claude Code (Desktop e terminal) em workspaces.

## Rodar

```bash
npm install
npm run dev
```

## Como funciona

- **Indexador** (`src/main/indexer.ts`) lê, somente leitura:
  - transcripts `~/.claude/projects/<projeto>/<sessionId>.jsonl` (CLI e Desktop gravam aqui);
  - metadados do Desktop em `~/Library/Application Support/Claude/claude-code-sessions/**/local_*.json`
    (título, arquivada, worktree — ligados pelo campo `cliSessionId`);
  - sessões vivas em `~/.claude/sessions/<pid>.json`.
  Cache incremental em `~/Library/Application Support/jarvis-workspace/session-index.json`.
- **Workspaces** (`src/main/store.ts`) ficam em `workspaces.json` no mesmo diretório e só referenciam IDs de sessão.
  Pastas vinculadas incluem automaticamente as sessões daquele projeto.
- **Terminal** (`src/main/pty.ts`) roda `claude --resume <id>` (ou `--session-id` para sessões novas) num PTY.

Os formatos do Claude são internos e podem mudar — o Jarvis nunca escreve neles.
