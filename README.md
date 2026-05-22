# MII WEB SYNC

Extensão VS Code para sincronização completa de projetos web com servidores **SAP MII** (Manufacturing Integration & Intelligence). Suporte a upload/download, controle de versão git integrado, editor visual de transações TRX e explorador de catálogo.

---

## 🚀 Funcionalidades Principais

### 📁 Gestão de Arquivos (Web e Catálogo)

- **Upload/Download** de arquivos e pastas para o servidor MII
- **Detecção automática** de arquivos Web (`/WEB/`) vs Catálogo (TRX/queries) — serviços corretos para cada tipo
- **Upload com Backup do Servidor**: cria cópia `_BKP_data_hora` no servidor antes de substituir
- **Upload em massa**: envia todas as alterações de um projeto de uma vez, com ou sem backup
- **Sanitização de caminhos**: trata caracteres especiais incompatíveis com Windows automaticamente
- **Detecção binária**: diferencia arquivos de texto e binários por extensão

### 🔄 Sincronização e Projetos Locais

- **Aba Local Changes**: lista projetos baixados com arquivos modificados, categorizado por **Web** e **Catalog — TRX & Queries**
- **Detecção via Git**: se o projeto tiver `.git/`, usa `git status` como fonte de verdade (zero falsos positivos)
- **Aba Projects**: visão de todos os projetos locais, também categorizada por Web e Catalog
- **Sync Project**: re-baixa todo o projeto do servidor com substituição segura (overwrite in-place, sem EPERM)
  - Detecta e pergunta sobre alterações locais não commitadas antes de sincronizar
  - Opções: salvar em git, salvar em git + subir ao servidor, ignorar ou cancelar
  - Botões inline: `Sync com git` / `Sync sem git`

### 🌿 Integração Git

- **Auto-init**: ao baixar um projeto, cria repositório git automaticamente com commit baseline
- **`.gitignore` inteligente**: exclui `.miisync/`, `*_BKP_*`, `*.log`, `*.tmp`, `Thumbs.db`, `node_modules/`, `.vscode/`
- **Commit após upload**: pergunta se deseja registrar o upload no git (com memória de escolha — ✓ lembrado / Sempre / Nunca mais)
- **Commit após sync**: idem para sincronizações
- **Pre-sync check**: detecta alterações não commitadas e oferece ações antes do sync
- **Configuração `gitCommitOnUpload`**: `ask` (padrão) | `always` | `disabled`

### 🗂️ TRX & Queries Explorer

- **Explorador dedicado** de transações e queries no catálogo MII (aba dentro do MiiSync)
- **Caminho raiz configurável** (padrão: raiz do catálogo)
- **Abrir do servidor**: abre `.trx` ou `.qmf` como arquivo temporário para edição
- **Upload direto** do arquivo temporário de volta ao servidor (com ou sem backup)
- **Baixar como projeto**: transforma pasta do catálogo em projeto local rastreado

### 📊 TRX Viewer (Editor Visual)

- **Editor custom** para arquivos `.trx` — abre automaticamente ao clicar em `.trx`
- **Diagrama interativo**: visualiza sequences, actions, branches true/false com conexões SVG
- **Abas**: Diagrama | Variáveis | Informações
- **Sidebar de actions**: catálogo carregado do servidor, filtrável, com ícones por tipo
- **Edição visual**: adicionar/remover sequences e actions diretamente no diagrama
- **Links**: popup mostrando incoming/outgoing links de cada action

### 🔐 Autenticação e Sistemas

- **Multi-sistema**: suporte a vários servidores MII com severidade configurável (low/medium/high/critical)
- **Sistema principal** (isMain) como alvo padrão de operações
- **Sessão persistente**: cookies salvos, refresh automático configurável
- **Transfer**: copia arquivos de um sistema para outro

---

## 📋 Requisitos

- Visual Studio Code 1.83.1 ou superior
- Servidor MII configurado e acessível
- Arquivo `.vscode/miisync.json` no workspace
- **Git** instalado (opcional, mas recomendado para rastreamento de mudanças)

---

## ⚙️ Configuração

### miisync.json (`.vscode/miisync.json`)

```json
{
  "systems": [
    {
      "name": "dev",
      "host": "10.20.30.40",
      "port": 50000,
      "protocol": "http",
      "username": "user",
      "password": "pass",
      "isMain": true,
      "severity": "1-medium"
    }
  ],
  "remotePath": "Default",
  "removeFromLocalPath": ["webapp"],
  "uploadOnSave": false,
  "downloadOnOpen": false,
  "ignore": ["package.json", ".*"]
}
```

### Configurações da Extensão (`miisync.settings.*`)

| Configuração | Padrão | Descrição |
|---|---|---|
| `sessionDuration` | 60 | Duração da sessão em minutos |
| `refreshSession` | true | Renovar sessão automaticamente |
| `requestLimit` | 40 | Limite de requisições simultâneas |
| `showDiffNotification` | true | Notificar quando arquivo difere do servidor |
| `gitCommitOnUpload` | `ask` | Commit git após upload: `ask` \| `always` \| `disabled` |

---

## 🗺️ Abas da Sidebar

| Aba | Descrição |
|---|---|
| **Remote Directory** | Navega o sistema de arquivos do servidor MII |
| **Local Changes** | Projetos locais com arquivos modificados (Web / Catalog) |
| **Projects** | Todos os projetos baixados (Web / Catalog) |
| **TRX & Queries** | Explorador do catálogo MII (TRX, queries, runners) |
| **MiiSync Configurações** | Painel de configurações com webview |

---

## 🔧 Comandos Principais

| Comando | Descrição |
|---|---|
| `mii: Login` | Autenticar no servidor MII |
| `mii: Upload` | Upload do arquivo ativo |
| `mii: Upload with Server Backup` | Upload com backup automático no servidor |
| `mii: Download` | Download do arquivo ativo |
| `mii: Sync Project` | Re-sincroniza projeto completo do servidor |
| `mii: Upload All Changes` | Envia todas as alterações do projeto de uma vez |
| `mii: Upload All with Backup` | Idem com backup de cada arquivo |
| `mii: Switch System` | Trocar sistema MII ativo |

---

## 🌿 Fluxo Git Recomendado

```
1. Baixar projeto (Remote Directory → Download as Project)
   └─ git init automático + commit "sync: download inicial"

2. Editar arquivos localmente
   └─ git status mostra exatamente o que mudou

3. Upload individual (botão ↑ no arquivo) ou em massa (botão ⬆ no projeto)
   └─ pergunta se quer registrar no git (com memória de escolha)

4. Quando servidor atualiza:
   └─ Sync Project → "Sync com git" → commit "sync: servidor → local"
   └─ git log mostra histórico completo de sincronizações e uploads
```

---

## 📁 Estrutura de Metadados Local

Cada projeto baixado cria uma pasta `.miisync/` com:

```
.miisync/
└── path-mapping.json   → mapeamento local→remoto + hash baseline
```

O arquivo `.gitignore` gerado automaticamente exclui `.miisync/` do rastreamento git.

---

## 🛣️ Roadmap

- [ ] **MCP Server**: exposição das ferramentas MII para agentes AI (Claude Code, etc.)
- [ ] **TRX Builder AI**: construção assistida de transações via agente
- [ ] **Fixed Query Builder**: criação e teste de queries via agente
- [ ] **MII Workbench Runner**: execução de testes de transações
- [ ] **AI Chat no TRX Viewer**: assistente integrado ao editor visual

---

## 📄 Licença

MIT — baseado no projeto original de [TaBayram](https://github.com/TaBayram/vscode-miisync), com extensas melhorias por caioalcarria.
