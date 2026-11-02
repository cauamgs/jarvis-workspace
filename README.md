# Jarvis WorkSpace

Central de comando nativa para macOS (Electron + React + TypeScript), inspirada no J.A.R.V.I.S.
Começa organizando as sessões do Claude Code (Desktop e terminal) em workspaces.

## Instalação

> **Usando o Claude Code?** Abra o Claude na pasta do projeto e peça: *"configure e instale o Jarvis
> seguindo o README"*. As instruções abaixo são escritas para ele seguir passo a passo.

### Requisitos

| Requisito | Como verificar | Como instalar |
|---|---|---|
| macOS em **Apple Silicon** (M1 ou mais novo) | `uname -m` → `arm64` | — (o `.app` é gerado só para arm64; em Intel, apenas `npm run dev`) |
| **Xcode Command Line Tools** (compilador C++ para o `node-pty` e `swiftc` para o módulo de voz) | `xcode-select -p` e `swiftc --version` | `xcode-select --install` (abre um diálogo do macOS: o usuário precisa confirmar) |
| **Node.js 22** ou mais novo | `node -v` | `brew install node@22` ou [nvm](https://github.com/nvm-sh/nvm) |
| **Claude Code CLI** com login feito | `claude --version` | `npm install -g @anthropic-ai/claude-code` e depois `claude` uma vez para fazer login |

O chat do Jarvis usa o `claude` instalado do usuário (mesma conta, settings, CLAUDE.md e MCPs). Sem ele
o app abre e lista as sessões, mas não conversa.

### Passo a passo

```bash
npm install          # instala dependências e recompila o node-pty para o Electron (postinstall)
npm run typecheck    # opcional: confirma que o código compila
npm run install:app  # compila o módulo de voz, empacota, assina ad-hoc e instala em /Applications
open "/Applications/Jarvis WorkSpace.app"
```

`install:app` fecha uma instância aberta do Jarvis e substitui a versão em `/Applications`.

Para desenvolvimento (recarrega ao salvar; usa dados separados e atalhos ⌥⇧⌘J / ⌃⌥⌘J):

```bash
npm run dev
```

### Primeiro uso

- **Voz (⌥⌘J):** o macOS pede permissão de **Microfone** e **Reconhecimento de Fala** na primeira vez. Só
  funciona no app instalado, não no `npm run dev`.
- **Modo escuro / fechar apps** (Automação): o macOS pede permissão para o Jarvis controlar o app em questão.
- **Workspaces e rotinas** começam vazios — ficam em `~/Library/Application Support/Jarvis WorkSpace/`.
- **Central de projetos** procura repositórios Git em `~/Documents`, `~/Developer` e `~/Projects`
  (até 3 níveis), além das pastas das sessões do Claude.

### Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| `npm install` falha em `node-pty` / `gyp` | Faltam as Command Line Tools: `xcode-select --install`, depois `npm install` de novo |
| `swiftc: command not found` no `install:app` | Mesmo caso acima |
| "Não encontrei o `claude` no seu PATH" no chat | Instale o Claude Code CLI e confirme `claude --version` num terminal novo |
| `codesign` reclama de "resource fork, Finder information, or similar detritus" | Já tratado: a assinatura é feita numa pasta temporária. Se persistir, rode `xattr -cr dist` e repita |
| macOS diz que o app "não pode ser aberto" (`.app` recebido pronto, sem compilar) | `xattr -dr com.apple.quarantine "/Applications/Jarvis WorkSpace.app"` |
| Voz diz que foi "interrompida pelo macOS" | Permissões negadas: Ajustes → Privacidade e Segurança → Microfone / Reconhecimento de Fala → ativar o Jarvis |

## Como funciona

- **Indexador** (`src/main/indexer.ts`) lê, somente leitura:
  - transcripts `~/.claude/projects/<projeto>/<sessionId>.jsonl` (CLI e Desktop gravam aqui);
  - metadados do Desktop em `~/Library/Application Support/Claude/claude-code-sessions/**/local_*.json`
    (título, arquivada, worktree — ligados pelo campo `cliSessionId`);
  - sessões vivas em `~/.claude/sessions/<pid>.json`.
  Cache incremental em `~/Library/Application Support/Jarvis WorkSpace/session-index.json`.
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

- **Arquivos entregues** (`src/main/files.ts`, `FileCards.tsx`): arquivos que o Claude entrega aparecem na conversa
  com prévia — imagem, vídeo e áudio (com avanço via Range), PDF, texto/código — e botões Abrir/Finder. Vale para o
  `SendUserFile` do Claude Desktop (histórico) e para a ferramenta `enviar_arquivo` do servidor MCP do Jarvis (os
  chats do Jarvis não têm o `SendUserFile`). Só caminhos que apareceram numa entrega podem ser lidos, pelo
  protocolo interno `jarvis-file://`.
- **Memória** (`src/main/search.ts`, `memory.ts`, `summary.ts`, `mcp.ts`, módulo Memória na interface):
  - **Busca nas conversas:** índice de texto de todas as sessões (pedidos, respostas e um resumo de cada ferramenta,
    sem resultados de ferramentas), incremental e guardado em `search/`. Termos sem acento/maiúscula, "frase exata".
    Também pela busca rápida ou voz: "buscar migration postgres".
  - **Cadernos dos workspaces:** notas em Markdown por workspace (`memory/<id>.md`). Entram no prompt de sistema
    de toda sessão nova do chat do Jarvis daquele projeto. O módulo também mostra (só leitura) o CLAUDE.md e as
    memórias automáticas do Claude de cada projeto do workspace.
  - **Resumo de passagem:** botão ✦ Resumo na sessão. Uma chamada avulsa ao Claude (sem ferramentas, sem gravar
    sessão) escreve objetivo, o que foi feito, decisões, estado e próximos passos; "Continuar em nova sessão" abre uma
    sessão limpa a partir dele. Guardado em `summaries/`.
  - O servidor MCP do Jarvis expõe tudo isso ao Claude (ver Lab MCP).
- **Lab MCP** (`src/main/mcp.ts`, `src/main/mcpLab.ts`, módulo Lab MCP):
  - **Servidor MCP do Jarvis:** HTTP em `127.0.0.1:47821/mcp` (dev: 47822) com token (`mcp-token`). Ferramentas:
    `buscar_conversas`, `ler_conversa`, `memoria_workspace`, `anotar_memoria`, `contexto_projeto`,
    `estado_ambiente`, `logs_container`, `quem_alterou`, `enviar_arquivo`. Nos chats do Jarvis as ferramentas de leitura
    rodam sem pedir permissão (`anotar_memoria` pede). Os chats do Jarvis já o recebem; "Conectar ao Claude Code"
    roda `claude mcp add --scope user` para que sessões do terminal e do Desktop também o tenham.
    Só funciona com o Jarvis aberto.
  - **Atividade:** cada ferramenta que o Claude chamou no servidor do Jarvis, com argumentos, tempo e resposta.
  - **Servidores do Claude Code:** lista (só leitura, segredos mascarados) os servidores dos escopos usuário e local
    (`~/.claude.json`) e dos `.mcp.json` dos projetos; conecta como cliente (stdio, HTTP ou SSE) para listar e testar
    ferramentas com um formulário gerado do schema. Ferramentas que não são somente leitura pedem confirmação.

Os formatos do Claude são internos e podem mudar — o Jarvis nunca escreve neles.
