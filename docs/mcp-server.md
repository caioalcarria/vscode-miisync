# MCP Server MiiSync

Servidor MCP que expõe as funcionalidades da extensão MiiSync como ferramentas
para agentes de IA (Claude Code, Gemini CLI, Copilot). Permite que um agente
explore o servidor SAP MII, leia/edite arquivos WEB e de catálogo, consulte o
banco, e crie/teste TQSQ e TRX — sempre dentro de uma camada de segurança
não-burlável.

> Plano de implementação completo e modelo de segurança: ver
> [mcp-implementation-plan.md](mcp-implementation-plan.md).

---

## Como ativar

No `.vscode/miisync.json` do projeto:

```json
{
  "systems": [{ "name": "...", "isMain": true, "host": "...", "port": 50000, "username": "...", "password": "...", "severity": "2-high" }],
  "remotePath": "Default/",
  "mcp": {
    "enabled": true,
    "clients": { "claudeCode": true, "geminiCLI": false, "copilotCLI": false, "copilotVSCode": false },
    "policy": {
      "mode": "readonly",
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
}
```

Ao abrir o projeto no VS Code, a extensão gera os arquivos de config dos clientes
(`.mcp.json` para Claude Code, `.gemini/settings.json` para Gemini). Em ambientes
enterprise com restrição, o Claude Code recebe um fallback automático (registro no
`~/.claude.json` sob um nome permitido da allowlist).

Também dá para configurar tudo pela aba **MiiSync Configurações → 🤖 MCP / AI Tools**.

---

## Arquitetura

```
claude / gemini / copilot
  └── spawna out/mcp/server.js (stdio)
        ├── lê .vscode/miisync.json (credenciais + policy)
        ├── login de sessão no MII (cookie + Basic Auth)
        └── REGISTRY → dispatch guardado → HTTP no servidor MII
```

Cada tool passa **obrigatoriamente** pelo dispatch:
`classify → guard (scope/protected/severity/token) → backup → handler → audit`.

Detalhes técnicos descobertos para este MII (15.0 SP3 / Sybase):
- **Content-Length explícito** nos POSTs (o servlet não lê body chunked).
- **Sessão real** via `Session=true` → 302 `goService.jsp`.
- Queries: XML SQLQuery **completo** (32 slots de param) + `Mode=FixedQuery`, salvas e executadas via `QueryTemplate`.
- `loadTransaction`/`loadQueryTemplate`/`saveTransaction` têm fallback para `Mode=Load/Save` simples (sem `Class=`).
- Introspecção de schema usa dialeto **Sybase** (`sysobjects`/`syscolumns`/`syscomments`); opção `dialect: "mssql"`.

---

## Tools (62)

### Configuração & Sessão
`config_get` · `config_list_systems` · `auth_status` · `auth_current_user`

### Web Server (`/WEB/`)
Leitura: `web_list_tree` · `web_read_file` · `web_download_file` · `web_download_folder` · `web_file_exists` · `web_file_properties` · `web_get_diff` · `web_open_screen`
Escrita: `web_upload_file` · `web_create_folder` · `web_delete`

### Server Catalog
Leitura: `catalog_list_tree` · `catalog_load_main` · `catalog_read_file` · `catalog_download_file` · `catalog_file_exists` · `catalog_file_properties`
Escrita: `catalog_save_file` · `catalog_create_folder` · `catalog_delete`

### TQSQ (SQL Queries)
Schema: `tqsq_list_sql_servers` · `tqsq_get_server_modes` · `tqsq_list_tables` · `tqsq_list_columns` · `tqsq_describe_table` · `tqsq_list_stored_procedures` · `tqsq_get_stored_procedure`
Execução: `tqsq_run_adhoc` · `tqsq_test_template` · `tqsq_test_local`
CRUD: `tqsq_load` · `tqsq_save` · `tqsq_create`

### TRX (Transactions)
Carregar/salvar: `trx_load` · `trx_save` · `trx_create`
Leitura: `trx_get_metadata` · `trx_get_variables` · `trx_get_steps` · `trx_get_actions` · `trx_get_action_config` · `trx_get_action_links`
Edição (in-memory): `trx_add_sequence` · `trx_delete_sequence` · `trx_rename_step` · `trx_add_action` · `trx_delete_action` · `trx_set_action_config` · `trx_set_action_links` · `trx_add_link` · `trx_delete_link` · `trx_add_variable` · `trx_edit_variable` · `trx_delete_variable`
Execução/helpers: `trx_run` · `trx_list_jco_connections` · `trx_get_jco_connection_info` · `trx_list_bls_credentials`

---

## Modelo de segurança (resumo)

| Classe | low/medium | high | critical |
|---|---|---|---|
| READ / SELECT / TRANSFORM | livre | livre | livre |
| CREATE (arquivo novo / pasta) | livre | **livre** | token |
| EDIT (sobrescrever) | livre + backup | **token + backup** | token + backup |
| DELETE | token + backup | token + backup | **bloqueado** |
| trx_run | livre | **livre** | livre |
| SQL write/DDL | flag | flag + token | bloqueado |

- **mode** `readonly` (padrão) esconde todas as tools de escrita/execução.
- **CREATE vs EDIT** é decidido dinamicamente pela existência do arquivo.
- **Edição de TRX** é in-memory (retorna XML novo); só `trx_save` persiste (gated).
- **Confirm-token**: operações gated devolvem um token na 1ª chamada e executam na 2ª.
- **Backup** automático antes de EDIT/DELETE (cópia `_BKP_<timestamp>` no servidor).
- **protectedPaths** negam escrita/delete incondicionalmente.
- **Auditoria** em `.miisync/mcp-audit.log`.

---

## Build

```
npm run esbuild        # gera out/extension.js + out/mcp/server.js
npm run esbuild-mcp    # só o servidor MCP
```
