# MII WEB SYNC

Extensão VS Code para sincronização completa de projetos com servidores **SAP MII**
(Manufacturing Integration & Intelligence). Inclui gestão de arquivos WEB e catálogo,
controle de versão Git integrado, editor visual de transações TRX, e um **servidor
MCP** que expõe 62 ferramentas para agentes de IA (Claude Code, Gemini CLI, Copilot).

---

## 🚀 Funcionalidades Principais

### 📁 Gestão de Arquivos (Web e Catálogo)

- **Upload/Download** de arquivos e pastas (individuais ou em massa)
- **Detecção automática** de tipo — WEB (`/WEB/`) vs Catálogo (TRX/queries) — serviço correto para cada um
- **Upload com Backup do Servidor**: cria cópia `_BKP_data_hora` no servidor antes de sobrescrever
- **Upload em massa**: envia todas as alterações de um projeto, com ou sem backup
- **Sanitização de caminhos**: caracteres especiais incompatíveis com Windows tratados automaticamente
- **Detecção binária**: diferencia arquivos de texto e binários por extensão

### 🔄 Sincronização e Projetos Locais

- **Aba Local Changes**: lista projetos baixados com arquivos modificados — categorizado em **Web** e **Catalog (TRX & Queries)**
- **Detecção via Git**: usa `git status` como fonte de verdade quando o projeto tem `.git/`
- **Aba Projects**: visão geral de todos os projetos, com upload em massa por projeto
- **Sync Project**: re-baixa o projeto inteiro com substituição segura (overwrite in-place, sem EPERM Windows)
  - Detecta alterações locais não commitadas antes de sincronizar
  - Opções: salvar no git, salvar + subir ao servidor, ignorar ou cancelar

### 🌿 Integração Git

- **Auto-init**: cria repositório git com commit baseline ao baixar um projeto
- **`.gitignore` inteligente**: exclui `.miisync/`, `*_BKP_*`, `*.log`, `*.tmp`, `node_modules/`
- **Commit após upload/sync**: pergunta se deseja registrar no git (com memória de escolha)
- **Pre-sync check**: detecta mudanças locais e oferece ações antes do sync
- **Configuração `gitCommitOnUpload`**: `ask` | `always` | `disabled`

### 🗂️ TRX & Queries Explorer

- **Explorador dedicado** de transações e queries no catálogo MII
- **Abrir do servidor**: abre `.trx` / `.qmf` como arquivo temporário para edição
- **Upload direto** do temporário de volta ao servidor (com ou sem backup)
- **Baixar como projeto**: transforma pasta do catálogo em projeto local rastreado

### 📊 TRX Viewer (Editor Visual)

- **Editor custom** para `.trx` — abre automaticamente ao clicar
- **Diagrama interativo**: visualiza sequences, actions e branches true/false com conexões SVG
- **Abas**: Diagrama | Variáveis | Informações
- **Sidebar de actions**: catálogo carregado do servidor, filtrável, com ícones por tipo
- **Edição visual**: add/delete sequences e actions, editar links e configuração de cada objeto
- **Editor de links**: painel lateral com source tree e formulário de mapeamento from→to

### 🔐 Autenticação e Sistemas

- **Multi-sistema**: vários servidores MII com severidade configurável (low/medium/high/critical)
- **Sessão persistente**: cookies salvos, refresh automático configurável
- **Transfer**: copia arquivos de um sistema para outro

---

## 🤖 MCP Server — Agente de IA para SAP MII

A extensão inclui um **servidor MCP (Model Context Protocol)** integrado que expõe
**62 ferramentas** para agentes de IA, permitindo que Claude Code, Gemini CLI e
Copilot operem o SAP MII diretamente via chat.

### Como funciona

O servidor MCP roda como processo filho local (stdio) spawanado pelo agente quando
necessário. Autentica no MII automaticamente lendo o `miisync.json` do projeto,
opera no servidor real e encerra ao fechar o agente.

```
Você → claude / gemini / copilot
         └── spawna out/mcp/server.js
               ├── lê .vscode/miisync.json (credenciais + policy)
               ├── faz login no MII
               └── HTTP → servidor SAP MII
```

### Ativar no miisync.json

```json
"mcp": {
  "enabled": true,
  "clients": {
    "claudeCode": true,
    "geminiCLI": false,
    "copilotCLI": false,
    "copilotVSCode": false
  },
  "policy": {
    "mode": "write",
    "allowDelete": false,
    "allowSqlWrite": false,
    "allowSqlDDL": false,
    "allowTrxRun": true,
    "confirmToken": true,
    "protectedPaths": ["Default/PROD/**"],
    "severityBlock": "3-critical",
    "severityRequireToken": "2-high",
    "git": "inherit",
    "audit": true
  }
}
```

Ao salvar a configuração com `enabled: true`, a extensão gera automaticamente os
arquivos de config dos clientes habilitados (`.mcp.json` para Claude Code,
`.gemini/settings.json` para Gemini, etc.).

> **Ambientes enterprise (Accenture/managed):** a extensão detecta
> `~/.claude/remote-settings.json` e, quando há `allowedMcpServers` whitelist, registra
> o servidor automaticamente no `~/.claude.json` sob um nome permitido (ex: `shell`)
> sem necessidade de configuração manual.

### As 62 ferramentas

| Categoria | Ferramentas |
|---|---|
| **Config & Auth** | `config_get`, `config_list_systems`, `auth_status`, `auth_current_user` |
| **Web Server** | `web_list_tree`, `web_read_file`, `web_download_file/folder`, `web_file_exists`, `web_file_properties`, `web_get_diff`, `web_open_screen`, `web_upload_file`, `web_create_folder`, `web_delete` |
| **Catálogo** | `catalog_list_tree`, `catalog_load_main`, `catalog_read_file`, `catalog_download_file`, `catalog_file_exists/properties`, `catalog_save_file`, `catalog_create_folder`, `catalog_delete` |
| **TQSQ** | `tqsq_list_sql_servers`, `tqsq_list_tables/columns`, `tqsq_describe_table`, `tqsq_list_stored_procedures`, `tqsq_get_stored_procedure`, `tqsq_run_adhoc`, `tqsq_test_template/local`, `tqsq_load`, `tqsq_save`, `tqsq_create` |
| **TRX — leitura** | `trx_load`, `trx_get_metadata/variables/steps/actions/action_config/action_links` |
| **TRX — edição in-memory** | `trx_add/delete_sequence`, `trx_rename_step`, `trx_add/delete_action`, `trx_set_action_config`, `trx_set_action_links`, `trx_add/delete_link`, `trx_add/edit/delete_variable` |
| **TRX — persistência** | `trx_save`, `trx_create`, `trx_run` |
| **SAP helpers** | `trx_list_jco_connections`, `trx_get_jco_connection_info`, `trx_list_bls_credentials` |

### Modelo de segurança

O servidor aplica uma camada de segurança não-burlável antes de toda operação:

| Classe | severity low/medium | **severity high** | severity critical |
|---|---|---|---|
| Leitura / SELECT | ✅ livre | ✅ **livre** | ✅ livre |
| Edição TRX in-memory | ✅ livre | ✅ **livre** | ✅ livre |
| CREATE (arquivo novo) | ✅ livre | ✅ **livre** | 🔑 token |
| EDIT (sobrescrever) | ✅ livre | 🔑 **token + backup** | 🔑 token + backup |
| DELETE | 🔑 token + backup | 🔑 **token + backup** | 🚫 **bloqueado** |
| `trx_run` | ✅ livre | ✅ **livre** | ✅ livre |
| SQL write/DDL | flag | flag | 🚫 bloqueado |

- **Confirm-token em 2 etapas**: operações gated devolvem um token na 1ª chamada; executam na 2ª com `confirm_token: "..."` (60s de validade)
- **Backup automático**: antes de EDIT/DELETE, salva cópia `_BKP_timestamp` no servidor
- **protectedPaths**: globs que negam escrita/delete incondicionalmente
- **SQL guard**: classifica SELECT/INSERT/DELETE/DDL antes de enviar
- **Auditoria**: log em `.miisync/mcp-audit.log`

### Workflows típicos com o agente

```
"Crie uma tela de criação de reserva no padrão das existentes"
  → web_list_tree → web_read_file (telas similares) → tqsq_describe_table
  → tqsq_create → trx_create + trx_add_action + trx_save → trx_run → web_upload_file

"Identifique o problema no fluxo X"
  → trx_load → trx_get_steps/actions → trx_run → tqsq_run_adhoc → corrigir → trx_save

"Insira um dado na tabela Y"
  → tqsq_describe_table → tqsq_run_adhoc (INSERT)
```

---

## ⚙️ Configuração

### miisync.json completo (`.vscode/miisync.json`)

```json
{
  "systems": [
    {
      "name": "meu-servidor",
      "host": "10.20.30.40",
      "port": 50000,
      "protocol": "http",
      "username": "user",
      "password": "pass",
      "isMain": true,
      "severity": "2-high"
    }
  ],
  "remotePath": "Default/",
  "removeFromLocalPath": ["webapp"],
  "uploadOnSave": false,
  "downloadOnOpen": false,
  "gitCommitOnUpload": "ask",
  "ignore": ["**/.git/**", "**/.vscode/**", "**/node_modules/**"],
  "include": [],
  "useRootConfig": false,
  "rootConfig": "../",
  "mcp": {
    "enabled": true,
    "clients": {
      "claudeCode": true,
      "geminiCLI": false,
      "copilotCLI": false,
      "copilotVSCode": false
    },
    "policy": {
      "mode": "write",
      "allowDelete": false,
      "allowSqlWrite": false,
      "allowSqlDDL": false,
      "allowTrxRun": true,
      "confirmToken": true,
      "protectedPaths": [],
      "severityBlock": "3-critical",
      "severityRequireToken": "2-high",
      "git": "inherit",
      "audit": true
    }
  }
}
```

#### Modos do MCP (`policy.mode`)

| Modo | O que libera |
|---|---|
| `readonly` | Só leitura — nenhuma tool de escrita/execução aparece |
| `write` | CREATE/EDIT + flags individuais (padrão recomendado) |
| `full` | Tudo conforme as flags individuais |

#### Clientes suportados

| Campo | Arquivo gerado | Observação |
|---|---|---|
| `claudeCode` | `.mcp.json` + `.claude/settings.json` | Fallback automático para enterprise (allowlist) |
| `geminiCLI` | `.gemini/settings.json` | — |
| `copilotCLI` | — | Suporte experimental |
| `copilotVSCode` | automático via `contributes.mcpServers` | Sem arquivo extra |

### Configurações VS Code (`miisync.settings.*`)

| Configuração | Padrão | Descrição |
|---|---|---|
| `sessionDuration` | 60 | Duração da sessão em minutos |
| `refreshSession` | true | Renovar sessão automaticamente |
| `requestLimit` | 40 | Limite de requisições simultâneas |
| `showDiffNotification` | true | Notificar quando arquivo difere do servidor |
| `gitCommitOnUpload` | `ask` | `ask` \| `always` \| `disabled` |

---

## 🗺️ Abas da Sidebar

| Aba | Descrição |
|---|---|
| **Remote Directory** | Navega o sistema de arquivos do servidor MII |
| **Local Changes** | Projetos com arquivos modificados (Web / Catalog) |
| **Projects** | Todos os projetos baixados |
| **TRX & Queries** | Explorador do catálogo (TRX, queries, runners) |
| **MiiSync Configurações** | Painel visual de configuração — inclui seção 🤖 MCP / AI Tools |

---

## 🔧 Comandos Principais

| Comando | Descrição |
|---|---|
| `mii: Login` | Autenticar no servidor MII |
| `mii: Upload` | Upload do arquivo ativo |
| `mii: Upload with Server Backup` | Upload com backup no servidor |
| `mii: Download` | Download do arquivo ativo |
| `mii: Sync Project` | Re-sincroniza projeto completo |
| `mii: Upload All Changes` | Envia todas as alterações do projeto |
| `mii: Upload All with Backup` | Idem com backup de cada arquivo |
| `mii: Switch System` | Trocar sistema MII ativo |

---

## 📋 Requisitos

- Visual Studio Code 1.83.1 ou superior
- Servidor SAP MII configurado e acessível
- `.vscode/miisync.json` no workspace
- Node.js instalado no PATH (para o servidor MCP)
- Git instalado (opcional, mas recomendado)

---

## 🌿 Fluxo Git Recomendado

```
1. Baixar projeto  →  git init + commit baseline automático
2. Editar localmente  →  git status mostra exatamente o que mudou
3. Upload (individual ou em massa)  →  commit opcional no git
4. Servidor atualiza  →  Sync Project → "Sync com git" → commit automático
```

---

## 📁 Estrutura de Metadados Local

```
.miisync/
├── path-mapping.json    → mapeamento local→remoto + hash baseline
└── mcp-audit.log        → log de operações do agente MCP (quando audit: true)
```

---

## 📄 Licença

MIT — baseado no projeto original de [TaBayram](https://github.com/TaBayram/vscode-miisync), com extensas melhorias por caioalcarria.
