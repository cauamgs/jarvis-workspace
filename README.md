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
  Na conversa: cartões por ferramenta (diff de Edit, comando/saída de Bash, subagentes ao vivo),
  painel de plano (TaskCreate/TaskUpdate/TodoWrite), tarefas em segundo plano, formulário do
  AskUserQuestion, aprovação de plano (ExitPlanMode), imagens (colar/arrastar/anexar), comandos `/`
  com autocompletar, sugestão do próximo pedido, esforço, medidor de contexto, painel MCP, limites de
  uso, ramificar (`forkSession`), restaurar arquivos (`rewindFiles`, só ou com a conversa) e renomear.
- **Terminal** (`src/main/pty.ts`) roda `claude --resume <id>` (ou `--session-id` para sessões novas) num PTY.

- **Busca rápida** (`src/main/palette.ts`, `src/renderer/src/Palette.tsx`): atalho global **⇧⌘J**
  (⌥⇧⌘J na versão de desenvolvimento) abre um painel flutuante por cima de qualquer app — buscar e abrir
  sessões, ⌘↵ envia o texto digitado para a sessão, ou "Nova sessão em …" cria uma sessão já com o pedido.
- **Barra de menu** (`src/main/tray.ts`): sessões que precisam de você, em execução e recentes, workspaces,
  "Iniciar com o macOS". Fechar a janela só a esconde — chats e terminais continuam rodando.
- **Notificações**: pedido de permissão ou turno concluído com o Jarvis fora de foco geram notificação;
  permissões pendentes aparecem como contador na barra de menu e no Dock.

- **Painel do sistema** (`src/main/system.ts`): CPU, memória, disco, bateria, rede, portas (lsof),
  processos e containers Docker/OrbStack, com ações de encerrar/iniciar/parar/logs.
- **Central de projetos** (`src/main/projects.ts`): repositórios Git descobertos automaticamente, status,
  diffs, commits, branches, fetch/pull e atalhos para GitHub/GitLab, VS Code e sessões do Claude.
- **Comando por voz** (`native/speech.swift`, `src/main/voice.ts`): reconhecimento nativo do macOS em pt-BR.
  ⌥⌘J abre a busca ouvindo; comandos locais executam direto; respostas a pedidos por voz são faladas.
  Só funciona no app instalado (o macOS exige as permissões declaradas no Info.plist do app).
- **Automação do Mac** (`src/main/automation.ts`): abrir apps, Atalhos do macOS, volume, aparência, dormir a
  tela e rotinas com vários passos, disparadas pela busca, por voz ou pelo módulo Automação.

Os formatos do Claude são internos e podem mudar — o Jarvis nunca escreve neles.
