# Plano de Implementação — MCP Server MiiSync

> Documento de planejamento técnico para o servidor MCP que expõe as
> funcionalidades da extensão MiiSync como ferramentas para agentes de IA
> (Claude Code, Gemini CLI, Copilot). Pensado para habilitar um agente capaz de
> **criar telas WEB, entender estruturas de tabelas, gerar/testar TQSQ e TRX, e
> manipular dados** — sempre dentro de uma camada de segurança não-burlável.

---

## 1. Objetivo

Permitir que um agente execute tarefas de ponta a ponta no SAP MII, por exemplo:

- *"Crie uma tela de criação de reserva no padrão das existentes"* → ler telas
  similares, entender a tabela, gerar TQSQ + TRX, testar, acoplar no WEB.
- *"Identifique o problema no fluxo X"* → carregar a TRX, reproduzir via
  execução, inspecionar dados, corrigir e revalidar.
- *"Insira um dado novo na tabela Y"* → descrever a tabela, rodar o INSERT,
  conferir.

Tudo isso **sem nunca dar ao agente poder destrutivo que não foi explicitamente
liberado**, e com criticidade escalando conforme o ambiente (dev → prod).

---

## 2. Arquitetura

```
Máquina local
└── claude / gemini / copilot (CLI)
      └── spawna  out/mcp/server.js   (processo filho, stdio)
            ├── lê  .vscode/miisync.json   (credenciais + policy)
            ├── autentica no MII (Basic Auth)
            ├── aplica CAMADA DE SEGURANÇA   ← gargalo não-burlável
            └── HTTP → Servidor MII (XMII/Catalog, /Illuminator, /Runner)
```

**Princípio central:** o `server.js` é o único ponto que sempre executa. Toda
regra de proteção mora aqui — não no prompt do agente, não na confiança do
modelo. Prompt injection, alucinação ou ambiguidade não atravessam o server.

### Estrutura de arquivos

```
src/mcp/
├── server.ts              # entrypoint + registro de tools + dispatch
├── configReader.ts        # lê miisync.json (cwd / MIISYNC_PROJECT)
├── miiClient.ts           # auth + HTTP + parse XML
├── mcpWriter.ts           # gera configs dos clientes (.mcp.json etc.) + fallback enterprise
├── security/
│   ├── policy.ts          # carrega e normaliza a policy do config
│   ├── guard.ts           # aplica gating (severity, mode, protected-paths)
│   ├── sqlGuard.ts        # classifica statements SQL (SELECT/write/DDL)
│   ├── token.ts           # geração/validação de confirm-token (2 etapas)
│   ├── backup.ts          # backup-antes-de-escrever no servidor
│   ├── git.ts             # commit no git do projeto após upload
│   └── audit.ts           # log em .miisync/mcp-audit.log
└── tools/
    ├── config.ts          # config_* / auth_*
    ├── web.ts             # web_*
    ├── catalog.ts         # catalog_*
    ├── tqsq.ts            # tqsq_*
    └── trx.ts             # trx_*
```

---

## 3. Modelo de Segurança

### 3.1 Proteções (legenda)

| Símbolo | Proteção | O que faz |
|---|---|---|
| 🔓 | Leitura segura | sem risco, nenhuma proteção extra |
| 🔒 | Escopo confinado | só opera dentro do `remotePath` do projeto |
| 🙈 | Mascarar segredo | nunca devolve senha/credencial pro modelo |
| 🛡️ | Policy-gated | só funciona se a flag estiver ligada no config |
| 🔑 | Confirm token | exige 2 chamadas (dry-run + token) |
| 💾 | Backup automático | salva versão atual no servidor antes de sobrescrever/apagar |
| 🚫 | Protected-paths | negado incondicional se bate em `protectedPaths` |
| ⚠️ | Severity-gated | comportamento escala com a criticidade do sistema |
| 🧮 | SQL guard | filtra tipo de statement (SELECT livre; write/DDL gated) |
| 🌿 | Git commit | registra no git do projeto ao subir |
| 📝 | Auditoria | grava em `.miisync/mcp-audit.log` |

### 3.2 Classes de operação

Toda tool é classificada por **o que faz**, não só pelo nome:

| Classe | Descrição | Exemplos |
|---|---|---|
| **READ** | leitura pura, sem efeito | list, read, download, get, describe, SELECT |
| **TRANSFORM** | edita XML em memória, não toca servidor | `trx_add_action`, `tqsq_build_xml` |
| **CREATE** | cria item **que não existe** (validado) | `web_upload_file` (novo), `web_create_folder` |
| **EDIT** | sobrescreve item **existente** | `web_upload_file` (existente), `trx_save`, `tqsq_save` |
| **DELETE** | remove item do servidor | `web_delete`, `catalog_delete` |
| **EXECUTE** | roda lógica com efeito colateral | `trx_run`, `tqsq_run_adhoc` (write) |

> **Validação CREATE vs EDIT (regra-chave):** as tools de upload checam a
> existência do alvo **antes** (`*_file_exists`). Se **não existe** → é CREATE.
> Se **existe** → é EDIT (mais restrito, com backup). Isso é o que permite
> liberar criação sem afrouxar edição.

### 3.3 Matriz Severity × Classe de operação

O `severity` do sistema (`0-low`, `1-medium`, `2-high`, `3-critical`) define
automaticamente o nível de cuidado:

| Classe \ Severity | low | medium | **high** | critical |
|---|---|---|---|---|
| READ / SELECT | ✅ livre | ✅ livre | ✅ **livre** | ✅ livre |
| TRANSFORM (in-memory) | ✅ livre | ✅ livre | ✅ livre | ✅ livre |
| CREATE arquivo (novo, validado) | ✅ livre | ✅ livre | ✅ **livre** | 🔑 token |
| CREATE pasta (WEB + catalog) | ✅ livre | ✅ livre | ✅ **livre** | 🔑 token |
| EDIT (sobrescrever existente) | ✅ livre | ✅ livre | 🔑 **token + 💾** | 🔑 token + 💾 |
| DELETE | 🔑 token + 💾 | 🔑 token + 💾 | 🔑 token + 💾 | 🚫 **bloqueado** |
| EXECUTE TRX (`trx_run`) | ✅ livre | ✅ livre | ✅ **livre** | ✅ livre¹ |
| EXECUTE SQL write/DDL | 🛡️ flag | 🛡️ flag | 🛡️ flag + 🔑 | 🚫 bloqueado |

¹ `trx_run` liberado sem token em todos os níveis por decisão de projeto
(execução de transação é parte central do fluxo do agente). Continua sob
`allowTrxRun` (default `true`) e auditoria. Ajustável.

**Resumo do que `high` libera sem token** (conforme decidido):
- ✅ Criar arquivo WEB novo (que não existe) — validado como CREATE
- ✅ Criar pasta (WEB e catalog)
- ✅ Todos os SELECT
- ✅ Executar TRX (`trx_run`)
- ❌ Continua exigindo token: **editar** arquivo existente, **deletar**, **SQL write/DDL**

### 3.4 Policy no `miisync.json`

```json
"mcp": {
  "enabled": true,
  "clients": { "claudeCode": true, "geminiCLI": false, "copilotCLI": false, "copilotVSCode": false },
  "policy": {
    "mode": "write",                          // readonly | write | full
    "allowDelete": false,                     // habilita classe DELETE
    "allowSqlWrite": false,                    // INSERT/UPDATE/DELETE no ad-hoc
    "allowSqlDDL": false,                      // DROP/ALTER/TRUNCATE
    "allowTrxRun": true,                       // permite trx_run
    "confirmToken": true,                      // exige token em ops gated
    "protectedPaths": ["Default/PROD/**", "**/core/**"],
    "severityBlock": "3-critical",             // bloqueia destrutivo daqui pra cima
    "severityRequireToken": "2-high",          // exige token (p/ EDIT/DELETE) daqui pra cima
    "git": "inherit",                          // inherit (usa gitCommitOnUpload) | always | disabled
    "audit": true
  }
}
```

**`mode`** define a linha de base:
- `readonly` → só READ/TRANSFORM. Nenhuma tool de CREATE/EDIT/DELETE/EXECUTE registrada.
- `write` → CREATE/EDIT/upload/save liberados (com gating). DELETE e SQL-write conforme flags.
- `full` → tudo conforme flags individuais.

A matriz de severity é aplicada **por cima** do mode (mais restritiva sempre vence).

### 3.5 Confirm-token (2 etapas)

Como o MCP roda headless (sem diálogo "tem certeza?"), operações gated usam
dry-run + token:

```
1ª chamada: web_delete({ path: "Default/WEB/reserva.html" })
   → NÃO executa. Retorna:
     {
       "preview": "DELETE Default/WEB/reserva.html (modificado há 2h, 4KB)",
       "confirm_token": "a8f3e1",
       "expires_in": "60s"
     }

2ª chamada: web_delete({ path: "...", confirm_token: "a8f3e1" })
   → valida token (path + ação + janela de tempo) → executa
```

O token é derivado de `hash(tool + path + timestamp)` com validade curta. Força
uma decisão consciente e fica visível no chat para o humano revisar.

### 3.6 SQL Guard

`tqsq_run_adhoc` e as tools de introspecção classificam o statement antes de enviar:

```
SELECT / WITH ... SELECT     → READ      → sempre livre
INSERT / UPDATE / DELETE     → write     → exige allowSqlWrite (+ token em high)
DROP / ALTER / TRUNCATE / CREATE → DDL    → exige allowSqlDDL (+ token; bloqueado em critical)
múltiplos statements (;)     → rejeitado por padrão
```

As tools `tqsq_describe_table`, `tqsq_list_stored_procedures`,
`tqsq_get_stored_procedure` embutem SQL **SELECT-only** sobre
`INFORMATION_SCHEMA` (ANSI; troca para `ALL_*`/`sys.*` se o server for Oracle/MSSQL),
então são sempre seguras.

### 3.7 Backup automático

Antes de qualquer EDIT ou DELETE no servidor, baixa a versão atual e salva em
`Backup/` no próprio servidor (reaproveita o fluxo `upload_with_backup` da
extensão). DELETE vira "mover para Backup/", não exclusão dura.

### 3.8 Git commit no upload

Toda tool 🌿 (CREATE/EDIT de arquivo) registra no **git do projeto baixado**
(as ramificações, não a raiz) após subir pro servidor:

```
sobe pro MII → git add <arquivo> → git commit -m "miisync(mcp): upload <arquivo>"
```

Mapeamento do `gitCommitOnUpload` existente:

| Config | Comportamento no MCP |
|---|---|
| `disabled` | não commita |
| `ask` | trata como `always` (sem UI pra perguntar) |
| `always` | commita automático |

### 3.9 Auditoria

Todo CREATE/EDIT/DELETE/EXECUTE grava em `.miisync/mcp-audit.log`:

```
2026-06-01T14:22:10Z  EDIT    web_upload_file  Default/WEB/reserva.html  ok    sev=2-high  token=a8f3e1
2026-06-01T14:25:03Z  EXECUTE trx_run          Default/CriaReserva       ok    sev=2-high
```

### 3.10 Mascaramento de segredos

`config_get` e `config_list_systems` nunca devolvem o campo `password`. Ver
nota da seção 6 sobre o risco de credencial em texto plano.

---

## 4. Catálogo completo de tools

### 4.1 Configuração & Sessão

| Tool | Classe | Função | Proteções |
|---|---|---|---|
| `config_get` | READ | Config do projeto (remotePath, sistema ativo) | 🙈 🔓 |
| `config_list_systems` | READ | Lista sistemas configurados | 🙈 🔓 |
| `config_switch_system` | — | Define sistema ativo | 📝 |
| `auth_status` | READ | Sistema/usuário conectado | 🔓 |
| `auth_current_user` | READ | Usuário logado no MII | 🔓 |

### 4.2 Web Server (arquivos `/WEB/`)

| Tool | Classe | Função | Proteções |
|---|---|---|---|
| `web_list_tree` | READ | Lista pastas + arquivos (default = remotePath) | 🔓 🔒 |
| `web_read_file` | READ | Lê conteúdo (base64 decode) | 🔓 🔒 |
| `web_download_file` | READ | Baixa arquivo pro disco | 🔓 🔒 |
| `web_download_folder` | READ | Baixa pasta recursiva | 🔓 🔒 |
| `web_upload_file` | CREATE/EDIT | Cria (livre até high) ou atualiza (token em high + backup) | 🛡️ ⚠️ 🚫 💾 🌿 📝 🔒 |
| `web_upload_with_backup` | EDIT | Backup + sobe nova versão | 🛡️ ⚠️ 💾 🚫 🌿 📝 🔒 |
| `web_delete` | DELETE | Apaga arquivo/pasta | 🛡️ 🔑 ⚠️ 💾 🚫 📝 🔒 |
| `web_create_folder` | CREATE | Cria pasta (livre até high) | 🛡️ ⚠️ 🚫 📝 🔒 |
| `web_file_exists` | READ | Verifica existência (usado na validação CREATE/EDIT) | 🔓 🔒 |
| `web_file_properties` | READ | Metadados (Modified, lock, Version) | 🔓 🔒 |
| `web_open_screen` | READ | URL do iView | 🔓 |
| `web_get_diff` | READ | Compara local vs servidor | 🔓 🔒 |

### 4.3 Server Catalog (transactions, queries, templates)

| Tool | Classe | Função | Proteções |
|---|---|---|---|
| `catalog_list_tree` | READ | Lista pastas/arquivos | 🔓 🔒 |
| `catalog_load_main` | READ | Carrega Main.CAT | 🔓 |
| `catalog_read_file` | READ | Lê arquivo como texto | 🔓 🔒 |
| `catalog_download_file` | READ | Baixa pro disco | 🔓 🔒 |
| `catalog_save_file` | CREATE/EDIT | Cria (livre até high) ou atualiza (token em high) | 🛡️ ⚠️ 🚫 💾 🌿 📝 🔒 |
| `catalog_save_with_backup` | EDIT | Backup + salva | 🛡️ ⚠️ 💾 🚫 🌿 📝 🔒 |
| `catalog_delete` | DELETE | Apaga arquivo | 🛡️ 🔑 ⚠️ 💾 🚫 📝 🔒 |
| `catalog_create_folder` | CREATE | Cria pasta no catalog (livre até high) | 🛡️ ⚠️ 🚫 📝 🔒 |
| `catalog_file_properties` | READ | Metadados | 🔓 🔒 |
| `catalog_file_exists` | READ | Verifica existência | 🔓 🔒 |

### 4.4 TQSQ (SQL Queries)

**Introspecção de schema**

| Tool | Classe | Função | Proteções |
|---|---|---|---|
| `tqsq_list_sql_servers` | READ | Lista SQL servers | 🔓 |
| `tqsq_get_server_modes` | READ | Modos disponíveis | 🔓 |
| `tqsq_list_tables` | READ | Lista tabelas | 🔓 |
| `tqsq_list_columns` | READ | Lista colunas | 🔓 |
| `tqsq_describe_table` | READ | Colunas com tipos (SQL embutido) | 🧮 🔓 |
| `tqsq_list_stored_procedures` | READ | Lista SPs (SQL embutido) | 🧮 🔓 |
| `tqsq_get_stored_procedure` | READ | Código de uma SP (SQL embutido) | 🧮 🔓 |

**Execução / Teste**

| Tool | Classe | Função | Proteções |
|---|---|---|---|
| `tqsq_run_adhoc` | READ/EXECUTE | SQL cru (SELECT livre; write/DDL gated) | 🧮 🛡️ ⚠️ 🔑 📝 |
| `tqsq_test_template` | READ/EXECUTE | Executa `.tqsq` salva | 🧮 ⚠️ 📝 |
| `tqsq_test_local` | READ/EXECUTE | Executa XML `.tqsq` local | 🧮 ⚠️ 📝 |

**CRUD de query**

| Tool | Classe | Função | Proteções |
|---|---|---|---|
| `tqsq_load` | READ | Carrega XML da query | 🔓 🔒 |
| `tqsq_build_xml` | TRANSFORM | Gera XML `<SQLQuery>` (sem salvar) | 🔓 |
| `tqsq_save` | CREATE/EDIT | Salva query (criar livre até high; editar com token) | 🛡️ ⚠️ 🚫 💾 🌿 📝 🔒 |
| `tqsq_create` | CREATE | build + save (item novo) | 🛡️ ⚠️ 🚫 🌿 📝 🔒 |

### 4.5 TRX (Transactions)

**Carregar / criar / salvar**

| Tool | Classe | Função | Proteções |
|---|---|---|---|
| `trx_load` | READ | Carrega XML | 🔓 🔒 |
| `trx_save` | CREATE/EDIT | Salva (criar livre até high; editar com token) | 🛡️ ⚠️ 🚫 💾 🌿 📝 🔒 |
| `trx_create` | CREATE | Cria TRX nova a partir de template | 🛡️ ⚠️ 🚫 🌿 📝 🔒 |

**Leitura / parse**

| Tool | Classe | Função | Proteções |
|---|---|---|---|
| `trx_get_metadata` | READ | Nome, versão, atributos | 🔓 |
| `trx_get_variables` | READ | Variáveis Context/Local | 🔓 |
| `trx_get_steps` | READ | Árvore de steps | 🔓 |
| `trx_get_actions` | READ | Actions + propriedades | 🔓 |
| `trx_get_action_config` | READ | Config de uma action | 🔓 |
| `trx_get_action_links` | READ | Links de uma action | 🔓 |
| `trx_get_action_catalog` | READ | Tipos de action disponíveis | 🔓 |

**Edição (TRANSFORM — operam em memória, retornam XML novo, NÃO tocam servidor)**

| Tool | Classe | Função | Proteções |
|---|---|---|---|
| `trx_add_sequence` | TRANSFORM | Adiciona sequence | 🔓 |
| `trx_delete_sequence` | TRANSFORM | Remove sequence do XML | 🔓 |
| `trx_rename_step` | TRANSFORM | Renomeia step | 🔓 |
| `trx_add_action` | TRANSFORM | Insere action por tipo | 🔓 |
| `trx_delete_action` | TRANSFORM | Remove action do XML | 🔓 |
| `trx_set_action_config` | TRANSFORM | Edita config do objeto | 🔓 |
| `trx_set_action_links` | TRANSFORM | Edita links | 🔓 |
| `trx_add_link` / `trx_delete_link` | TRANSFORM | Liga/desliga mapeamento | 🔓 |
| `trx_add_variable` | TRANSFORM | Adiciona variável | 🔓 |
| `trx_edit_variable` | TRANSFORM | Altera variável | 🔓 |
| `trx_delete_variable` | TRANSFORM | Remove variável | 🔓 |

> A persistência só acontece quando o agente chama `trx_save` (gated). Editar a
> string XML é inócuo até salvar.

**Teste / execução + helpers**

| Tool | Classe | Função | Proteções |
|---|---|---|---|
| `trx_run` | EXECUTE | Executa a transação (Context.X) — **sem token** | 🛡️(`allowTrxRun`) 📝 |
| `trx_list_jco_connections` | READ | Lista conexões JCO | 🔓 |
| `trx_get_jco_connection_info` | READ | Detalhes da conexão | 🔓 |
| `trx_list_bls_credentials` | READ | Lista nomes de credenciais BLS | 🔓 |

---

## 5. Lógica CREATE vs EDIT (detalhe de implementação)

Pseudocódigo do gating dentro de `web_upload_file` / `catalog_save_file` /
`tqsq_save` / `trx_save`:

```
function gateWrite(path, severity, policy):
    if matchesProtectedPath(path): DENY                       # 🚫 sempre
    exists = fileExists(path)
    classe = exists ? "EDIT" : "CREATE"

    if classe == "CREATE":
        if severity >= severityBlock(critical): require token
        else: ALLOW                                            # livre até high ✅
    if classe == "EDIT":
        backup(path)                                           # 💾 sempre
        if severity >= severityRequireToken(high): require token
        else: ALLOW
    audit(classe, path)
    gitCommitAfterUpload(path)                                 # 🌿
```

`web_create_folder` / `catalog_create_folder`:

```
function gateCreateFolder(path, severity):
    if matchesProtectedPath(path): DENY
    if severity >= critical: require token
    else: ALLOW                                               # livre até high ✅
```

`trx_run`:

```
function gateTrxRun(path, policy):
    if not policy.allowTrxRun: DENY
    audit("EXECUTE", path)
    EXECUTE                                                    # sem token ✅
```

`tqsq_run_adhoc`:

```
function gateSql(sql, severity, policy):
    kind = classify(sql)                                      # READ | WRITE | DDL
    if kind == READ: ALLOW                                    # SELECT sempre livre ✅
    if kind == WRITE:
        if not policy.allowSqlWrite: DENY
        if severity >= severityRequireToken: require token
    if kind == DDL:
        if not policy.allowSqlDDL: DENY
        if severity >= severityBlock: DENY
        else: require token
    audit(kind, sql)
```

---

## 6. Acesso a arquivos locais (nota de segurança)

O **MCP não amplia** o acesso a arquivos: o Claude já tem Read/Edit/Write em
todo o projeto pelas ferramentas nativas dele. O MCP em si só lê o
`miisync.json` (para auth).

**Risco real:** o `miisync.json` guarda a **senha em texto plano**, e o agente
pode lê-la pelo `Read` nativo e jogar no contexto do modelo.

Mitigações recomendadas:
- Mover a senha para `miisyncuser.json` (já gitignored) ou variável de ambiente.
- `config_get` / `config_list_systems` com 🙈 (nunca devolvem senha).
- Opcional: `.claudeignore` apontando para o arquivo de credencial.

---

## 7. Fases de implementação

| Fase | Entregas | Objetivo |
|---|---|---|
| **0 — Fundação de segurança** | `security/*` (policy, guard, sqlGuard, token, backup, git, audit), `mode:readonly` default, mascaramento de senha | nenhuma tool destrutiva nasce sem trava |
| **1 — Leitura** | `config_*`, `auth_*`, `web_list_tree`✅, `web_read_file`, `web_download_*`, `catalog_*` (read), `tqsq_list_*`, `trx_load`/`trx_get_*` | visão total ao agente, risco zero |
| **2 — Backend / introspecção** | `tqsq_run_adhoc`, `tqsq_test_*`, `tqsq_describe_table`, SP tools, `trx_run` | consultas e testes |
| **3 — Escrita** | `web_upload_*`, `web_create_folder`, `catalog_save_*`, `catalog_create_folder`, `tqsq_save`/`create`, `trx_save`/`create` + git commit | criação/alteração real |
| **4 — Edição fina TRX** | `trx_add_action`, `set_config`, `set_links`, variáveis, `trx_create` template | montar TRX do zero |
| **5 — Delete** | `web_delete`, `catalog_delete` (token + backup obrigatórios) | por último, com toda a trava pronta |

---

## 8. Decisões em aberto (ajustáveis)

- **`trx_run` em critical:** hoje liberado sem token em todos os níveis. Se quiser
  endurecer prod, mudar para token em `critical`.
- **CREATE em critical:** hoje exige token. Pode liberar se preferir.
- **`severityBlock` / `severityRequireToken`:** limiares configuráveis por projeto.
- **Multi-statement SQL:** bloqueado por padrão; pode liberar com flag se houver caso de uso.
- **Dialeto SQL das SP tools:** auto-detecção ANSI/Oracle/MSSQL; pode forçar via config.

---

## 9. Resumo do modelo

- **Onde a segurança vive:** no `server.js`, não no agente — não-burlável.
- **Como escala:** por classe de operação × severity do sistema.
- **O que `high` libera sem token:** criar arquivo novo (validado), criar pasta,
  SELECTs, executar TRX.
- **O que continua travado:** editar existente, deletar, SQL write/DDL — com
  token, backup e (em critical) bloqueio.
- **Rastreabilidade:** git commit no upload + audit log de tudo.

---

## Status: ✅ IMPLEMENTADO

Todas as fases foram implementadas e validadas contra o servidor real (melita /
MII 15.0 SP3 / Sybase). 62 tools registradas. Ver
[mcp-server.md](mcp-server.md) para o catálogo e detalhes de uso.

| Fase | Status |
|---|---|
| 0 — Fundação de segurança | ✅ |
| Infra — cliente MII + registry guardado | ✅ |
| 1 — Leitura | ✅ |
| 2 — Backend/execução | ✅ |
| 3 — Escrita | ✅ |
| 4 — Edição fina TRX | ✅ |
| 5 — Delete (entregue na Fase 3) | ✅ |
| Acabamento — UI da policy + docs | ✅ |

---

## 10. Passos de implementação (execução)

A implementação seria dividida em **12 passos**, agrupados nas 6 fases. Cada
passo é uma unidade coerente que **compila e pode ser validada isoladamente** —
nenhum passo deixa o projeto quebrado.

### Fase 0 — Fundação de segurança

**Passo 1 — Tipos & Policy**
- `system.ts`: nova interface `McpPolicy` (mode, allowDelete, allowSqlWrite,
  allowSqlDDL, allowTrxRun, confirmToken, protectedPaths, severityBlock,
  severityRequireToken, git, audit); estende `McpConfig`.
- `security/policy.ts`: carrega e normaliza a policy com defaults seguros
  (`mode: readonly`).
- *Validação:* `tsc` compila; policy default = tudo travado.

**Passo 2 — Guard central + Auditoria**
- `security/guard.ts`: `matchProtectedPath`, `confineScope(remotePath)`,
  `decide(classe, severity, policy) → { allow, requireToken, needBackup, deny, reason }`
  (implementa a matriz da seção 3.3 e a lógica da seção 5).
- `security/audit.ts`: append em `.miisync/mcp-audit.log`.
- *Validação:* testes da matriz (CREATE livre em high, EDIT pede token, DELETE em critical nega).

**Passo 3 — Confirm-token + SQL guard**
- `security/token.ts`: `issueToken`/`validateToken` (hash + TTL, mapa em memória).
- `security/sqlGuard.ts`: `classify(sql) → READ|WRITE|DDL`, rejeita multi-statement.
- *Validação:* SELECT→READ, DELETE→WRITE, DROP→DDL; token expira.

**Passo 4 — Backup + Git**
- `security/backup.ts`: `backupRemote(path)` (baixa atual → salva em `Backup/`).
- `security/git.ts`: `commitAfterUpload(localPath)` conforme `gitCommitOnUpload`.
- *Validação:* smoke local de commit; backup gera arquivo no servidor.

### Infra compartilhada

**Passo 5 — Cliente MII completo**
- Expande `miiClient.ts` com todos os métodos de baixo nível: `readFile`,
  `saveFile` (base64), `delete`, `listFiles`, `listFolders`, `fileProperties`,
  `exists`, `createFolder`, `loadCatalog`, `saveMesFile`, `loadTransaction`,
  `saveTransaction`, `loadQueryTemplate`, `saveQuery`, `saveTempQuery`,
  illuminator (`serverList`/`modes`/`tables`/`columns`/`jco`/`bls`), `runner.execute`.
- *Validação:* testar 2–3 endpoints reais contra o sistema `melita`.

**Passo 6 — Refactor do server para registry + dispatch guardado**
- `server.ts` vira um registry: cada tool declara `{ name, schema, classe, handler }`.
  O dispatch central roda o **guard antes** (scope/protected/severity/token/audit)
  e **backup + git depois**. Tools de `mode` desabilitado nem são registradas.
- Migra `web_list_tree` para `tools/web.ts`.
- *Validação:* `web_list_tree` continua funcionando via `/mcp`.

### Fase 1 — Leitura

**Passo 7 — Tools de leitura**
- `tools/config.ts` (config_*/auth_*), `tools/web.ts` (read/download/exists/properties/diff/open_screen),
  `tools/catalog.ts` (read), `tools/tqsq.ts` (list/schema), `tools/trx.ts` (load + get_* via parser).
- *Validação:* cada tool rodada contra `melita`; nenhuma escreve.

### Fase 2 — Backend / introspecção

**Passo 8 — Execução e schema**
- `tqsq_run_adhoc` (com sqlGuard), `tqsq_test_template`/`tqsq_test_local`,
  `tqsq_describe_table`, `tqsq_list_stored_procedures`, `tqsq_get_stored_procedure`
  (SQL embutido + detecção de dialeto), `trx_run` (`allowTrxRun`, sem token).
- *Validação:* SELECT real, describe real, lista de SP real, `trx_run` numa TRX de teste.

### Fase 3 — Escrita

**Passo 9 — Tools de escrita (CREATE/EDIT)**
- `web_upload_file` (gating CREATE vs EDIT por existência), `web_create_folder`,
  `catalog_save_file`, `catalog_create_folder`, `tqsq_save`/`tqsq_create`,
  `trx_save`/`trx_create` — com backup + git + token conforme severity.
- *Validação:* criar arquivo novo (livre em high), editar existente (pede token),
  conferir commit no git do projeto.

### Fase 4 — Edição fina TRX

**Passo 10 — Manipulação de TRX em memória**
- Wrappers das funções do `trxParser` (`add_action`, `delete_action`,
  `set_action_config`, `set_action_links`, `add/delete_link`, `add/delete_sequence`,
  `rename_step`) + **novas funções de variáveis** (`add/edit/delete_variable`) no
  parser + template do `trx_create`.
- *Validação:* montar uma TRX do zero em memória, salvar e executar.

### Fase 5 — Delete

**Passo 11 — Tools de delete**
- `web_delete`, `catalog_delete` — token obrigatório + backup (move para `Backup/`),
  bloqueio em critical.
- *Validação:* 1ª chamada retorna preview+token; 2ª executa; backup existe; critical nega.

### Acabamento

**Passo 12 — UI, propagação e docs**
- Expor a `policy` na aba de configurações (webview/treeview), efetivar o
  mascaramento de senha, README do MCP (tools + policy), atualizar este plano.
- *Validação:* alterar a policy pela UI reflete no comportamento do server.

### Mapa passo → fase

| Passo | Fase | Entrega |
|---|---|---|
| 1–4 | Fase 0 | fundação de segurança |
| 5–6 | infra | cliente MII + registry guardado |
| 7 | Fase 1 | leitura |
| 8 | Fase 2 | backend/execução |
| 9 | Fase 3 | escrita |
| 10 | Fase 4 | edição fina TRX |
| 11 | Fase 5 | delete |
| 12 | acabamento | UI + docs |
