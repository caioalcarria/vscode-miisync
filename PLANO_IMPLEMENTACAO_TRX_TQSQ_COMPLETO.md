# PLANO COMPLETO — EDITOR, RUNNER E MCP PARA TRX & TQSQ NO SAP MII
**Extensão: MII WEB SYNC (vscode-miisync)**  
**Data:** 2026-05-22  
**Baseado em:** análise de 77 requisições Fiddler + estrutura real de arquivos TRX e TQSQ

---

## 1. ESTADO ATUAL E GAPS

### O que já existe
| Componente | Status |
|---|---|
| TRX Viewer (webview) | ⚠️ Incompleto — diagrama SVG com bugs, sem edição de links real |
| TRX Explorer (sidebar) | ✅ Funciona — lista, abre arquivo temp, upload |
| `loadMesFileService` | ⚠️ Usa `Mode=Load` sem `Class=` — funciona mas retorna dados extras |
| `saveMesFileService` | ⚠️ Usa `Mode=Save` sem `Class=` — pode causar erros de tipo |
| Download de projeto catalog | ✅ Corrigido (fix 2026-05-22) |

### O que está faltando (descoberto via Fiddler)
1. Load de TRX correto: falta `Class=Transaction`
2. Load de TQSQ correto: falta `Class=Template` (versão sem TempTableList)
3. Save de TRX correto: falta `Class=Transaction`
4. Save de TQSQ correto: falta `Class=SQLQuery`
5. Editor visual de TQSQ (SQL, parâmetros, servidor)
6. Runner de query (fluxo: UUID → Exists → Save temp → Execute → Delete)
7. Runner de transaction (POST /XMII/Runner)
8. Painel de propriedades de actions (JCO, SQL, Assignment, Tracer)
9. Editor de links (IncomingLinks / OutgoingLinks / Assign / AssignXml)
10. MCP Server local (para agentes AI)

---

## 2. ARQUITETURA ALVO

```
src/
├── miiservice/
│   ├── catalogservice.ts       ← NOVO: serviços tipados por Class
│   ├── illuminatorservice.ts   ← NOVO: ServerList, TableList, ColumnList, TimePeriod
│   ├── runnerservice.ts        ← NOVO: execução de TRX via /XMII/Runner
│   └── (existentes mantidos)
│
├── models/                     ← NOVO: tipos TypeScript dos objetos MII
│   ├── trx.ts                  ← Transaction completa (Steps, Actions, Context, Local)
│   ├── tqsq.ts                 ← SQLQuery (params, SQL, server, mode)
│   └── links.ts                ← Assign, AssignXml, IncomingLinks, OutgoingLinks
│
├── ui/
│   ├── trxviewer/
│   │   ├── trxViewerProvider.ts       ← já existe, refatorar
│   │   ├── trxViewerDocument.ts       ← NOVO: modelo de documento
│   │   └── panels/
│   │       ├── DiagramPanel.ts        ← já existe (bugs a corrigir)
│   │       ├── VariablesPanel.ts      ← refatorar
│   │       ├── LinksPanel.ts          ← NOVO: editor de links
│   │       └── PropertiesPanel.ts     ← NOVO: propriedades de action
│   │
│   └── tqsqeditor/             ← NOVO
│       ├── TqsqEditorProvider.ts      ← CustomEditor para .tqsq
│       ├── TqsqDocument.ts
│       └── index.html
│
├── modules/
│   ├── trxparser.ts            ← NOVO: parse/serialize XML TRX
│   ├── tqsqparser.ts           ← NOVO: parse/serialize XML TQSQ
│   └── queryrunner.ts          ← NOVO: lógica do test runner
│
└── mcp/                        ← FASE FINAL
    ├── mcpserver.ts
    └── toolhandlers.ts
```

---

## 3. CAMADA DE SERVIÇOS (API MII — o que descobrimos)

### 3.1 `src/miiservice/catalogservice.ts` (NOVO)

Todos via `POST /XMII/Catalog` com `Content-Type: application/x-www-form-urlencoded`.

```typescript
// Carrega uma transaction completa
loadTransaction(system, objectName: string): Promise<string>
// → Mode=Load&Class=Transaction&ObjectName={path}&TemporaryFile=false&Content-Type=text/xml

// Salva uma transaction
saveTransaction(system, objectName: string, content: string): Promise<boolean>
// → Mode=Save&Class=Transaction&ObjectName={path}&Content={urlencoded-XML}

// Carrega TQSQ em modo Template (sem TempTableList — lean, adequado para edição/sync)
loadQueryTemplate(system, objectName: string): Promise<string>
// → Mode=Load&Class=Template&Content-Type=text/xml&TemporaryFile=false&ObjectName={path}

// Carrega TQSQ completo (com TempTableList — só usar quando precisar da lista de tabelas)
loadQueryFull(system, objectName: string): Promise<string>
// → Mode=Load&ObjectName={path}&Content-Type=text%2Fxml

// Salva TQSQ
saveQuery(system, objectName: string, content: string): Promise<boolean>
// → Mode=Save&Class=SQLQuery&ObjectName={path}&Content={urlencoded-XML}

// Salva TQSQ temporário para teste
saveTempQuery(system, tmpName: string, content: string): Promise<boolean>
// → Mode=Save&Class=SQLQuery&ObjectName={tmpName}&TemporaryFile=true&TempFileName={tmpName}&Content={urlencoded-XML}

// Verifica se objeto existe
objectExists(system, objectName: string, class?: string): Promise<0 | 1 | 2>
// → Mode=Exists&Class={class}&ObjectName={objectName}
// retorna: 0=não existe, 1=arquivo, 2=pasta

// Propriedades de arquivo
getFileProperties(system, objectName: string): Promise<FileProperties>
// → Mode=ListFileProperties&Content-Type=text/xml&ObjectName={path-sem-extensao}
```

### 3.2 `src/miiservice/illuminatorservice.ts` (NOVO)

Todos via `POST /XMII/Illuminator`.

```typescript
// Lista de servidores SQL disponíveis
getSQLServerList(system): Promise<{Name: string, Description: string}[]>
// → Content-Type=text/xml&Service=SystemInfo&Method=SQL&RowCount=250&Mode=ServerList

// Modos disponíveis para um servidor
getServerModes(system, serverName: string): Promise<string[]>
// → Content-Type=text/xml&Server={serverName}&Mode=ModeList
// Valores: ColumnList, Command, FixedQuery, FixedQueryWithOutput, ModeList, Query, TableList

// Lista de tabelas de um servidor (CACHEAR por servidor/sessão)
getTableList(system, serverName: string): Promise<string[]>
// → Content-Type=text/xml&Server={serverName}&Mode=TableList

// Colunas de uma tabela (CACHEAR)
getColumnList(system, serverName: string, tableName: string): Promise<string[]>
// → Content-Type=text/xml&Mode=ColumnList&Server={serverName}&Group={tableName}

// Períodos de tempo
getTimePeriods(system): Promise<string[]>
// → Content-Type=text/xml&Connector=Illuminator&Mode=TimePeriodList&Service=SystemInfo&RowCount=250

// Schedules
getSchedules(system): Promise<string[]>
// → Content-Type=text/xml&Connector=Illuminator&Mode=ScheduleList&Service=SystemInfo&RowCount=250

// Lista de conexões JCO
getJCOConnections(system): Promise<string[]>
// → Type=JCO&Mode=ConnectionList&Service=SystemInfo&Content-Type=raw/xmii

// Detalhes de uma conexão JCO (R3NAME, CLIENT, SERVER, LANGUAGE, etc.)
getJCOConnectionInfo(system, connectionName: string): Promise<JCOConnectionInfo>
// → Type=JCO&Mode=ConnectionInfo&Service=SystemInfo&Name={name}&Content-Type=raw/xmii

// Lista de credentials BLS
getBLSCredentials(system): Promise<string[]>
// → Type=BLS&Mode=CredentialList&Service=SystemInfo&Content-Type=raw/xmii

// Lista de breakpoints de uma transaction
getBreakpoints(system, transactionPath: string): Promise<Breakpoint[]>
// → service=BLSManager&Mode=Breakpoints&Operation=List&Content-Type=text/xml&Transaction={path}

// Executa query de teste
executeTestQuery(system, tmpName: string): Promise<string>
// → IsTesting=T&QueryTemplate={tmpName}&Content-Type=text%2Fxml&QueryTemplate={tmpName}
// NOTA: QueryTemplate é enviado DUAS vezes (comportamento original do Workbench)
```

### 3.3 `src/miiservice/runnerservice.ts` (NOVO)

```typescript
// Executa transaction com parâmetros de entrada
runTransaction(system, transactionPath: string, inputParams: Record<string, string>): Promise<TransactionOutput>
// POST /XMII/Runner
// Body: Transaction=Default/Path/MyTrx.trx&Context.Param1=value&OutputParameter=XML
// Response: XML com variáveis de contexto de saída
```

---

## 4. MODELOS DE DADOS (TypeScript)

### 4.1 `src/models/trx.ts`

```typescript
export interface Transaction {
  name: string;
  version: number;
  writerRoles: string;
  readerRoles: string;
  attributes: ContextItem[];      // TransactionAttributes (Description, Status, etc.)
  context: ContextItem[];         // parâmetros públicos (inputs/outputs)
  local: ContextItem[];           // variáveis internas
  actions: ActionDefinition[];    // definições de actions (com xsi:type e props)
  steps: Step[];                  // sequências de execução
  layout: GUILayoutItem[];        // posições visuais no canvas
}

export interface ContextItem {
  name: string;
  description?: string;
  value: { type: string; content: string }; // type = xsi:type (string, xml, boolean...)
  readOnly?: boolean;
  validateXMLOnExecution?: boolean;
}

export interface ActionDefinition {
  name: string;
  type: ActionType;           // xsi:type: IlluminatorSQLQueryObject, SAPJCOInterface, Assignment, Tracer...
  properties: Record<string, any>; // propriedades específicas do tipo
}

export type ActionType =
  | 'IlluminatorSQLQueryObject'
  | 'SAPJCOInterface'
  | 'Assignment'
  | 'Tracer'
  | 'TransactionCall'
  | 'XMLLoader'
  | 'DBProcedure'
  | 'ExceptionEnabler'
  | string; // extensível

export interface Step {
  type: 'ActionSequence' | 'Conditional' | 'ForNext' | 'While' | 'Iterator' | 'Catch';
  name: string;
  description?: string;
  steps: Step[];     // sub-sequências
  actions: ActionUsage[];
  // Conditional:
  condition?: string;
  trueSteps?: Step[];
  falseSteps?: Step[];
}

export interface ActionUsage {
  name: string;                    // referência ao ActionDefinition
  description?: string;
  incomingLinks: Link[];
  outgoingLinks: Link[];
}

export interface Link {
  type: 'Assign' | 'AssignXml';
  to: string;     // ex: "NotasQM.Param.1" ou "Transaction.output{/Rowsets/Rowset/Nota}"
  from: string;   // ex: "Transaction.centro" ou expressão BLS
}

export interface GUILayoutItem {
  name: string;
  x: number; y: number;
  width: number; height: number;
  spacingWidth: number;
  descendantWidth: number;
}
```

### 4.2 `src/models/tqsq.ts`

```typescript
export interface SQLQuery {
  // Atributos do root element
  id: string;
  pathId: string;
  server: string;           // ex: "dbmid11"
  mode: QueryMode;
  saveDate: string;
  version: string;
  readerRoles: string;
  writerRoles: string;
  rowCount: number;
  tempTable?: string;
  
  // SQL e parâmetros
  query: string;            // SQL com placeholders [Param.N]
  params: QueryParam[];     // até 32 parâmetros
  
  // Metadata (presente no Template)
  joins?: JoinDefinition[];
  tasks?: TaskDefinition[];
  etcServers?: ETCServer[];
  etcObjects?: ETCObject[];
  
  // NÃO armazenar TempTableList — é gerado dinamicamente pelo servidor
}

export type QueryMode = 'FixedQuery' | 'FixedQueryWithOutput' | 'Query' | 'Command';

export interface QueryParam {
  index: number;            // 1-based
  value: string;            // Param.N
  description: string;      // ParamDescription.N
  type: string;             // ParamType.N (String, Integer, DateTime, etc.)
}
```

---

## 5. MÓDULOS DE PARSE/SERIALIZE

### 5.1 `src/modules/trxparser.ts`

```typescript
// Parse: XML string → Transaction object
export function parseTrx(xml: string): Transaction

// Serialize: Transaction object → XML string
export function serializeTrx(tx: Transaction): string

// Atualização incremental (sem re-serializar tudo)
export function updateActionInTrx(xml: string, actionName: string, newProps: Record<string, any>): string
export function addLinkToStep(xml: string, stepName: string, actionName: string, link: Link): string
export function removeLinkFromStep(xml: string, stepName: string, actionName: string, linkIndex: number): string
export function addActionToStep(xml: string, stepName: string, actionUsage: ActionUsage): string
export function updateContextItem(xml: string, scope: 'context' | 'local', item: ContextItem): string
```

### 5.2 `src/modules/tqsqparser.ts`

```typescript
// Parse: XML string → SQLQuery object
export function parseTqsq(xml: string): SQLQuery

// Serialize: SQLQuery object → XML string (Template format, sem TempTableList)
export function serializeTqsq(q: SQLQuery): string

// Injeta test values para execução
export function fillTestParams(q: SQLQuery, testValues: Record<number, string>): SQLQuery
```

---

## 6. TRX EDITOR — REDESIGN (fix dos bugs atuais)

### 6.1 Carregamento correto

**Problema atual:** `loadMesFileService` usa `Mode=Load` sem `Class=Transaction`.  
**Fix:** usar `catalogService.loadTransaction(system, path)` que usa `Class=Transaction`.

**Sequência correta de abertura (igual ao Workbench):**
```
1. loadTransaction → XML completo do TRX
2. getBreakpoints → lista de breakpoints (para painel Debug)  
3. getFileProperties → metadata (Created, Modified, Version, etc.)
```

### 6.2 Painéis do TRX Viewer (webview)

#### Aba: Diagrama
- Canvas SVG mostrando Sequences como retângulos azuis e Actions como retângulos menores
- Conexões SVG entre Actions (setas de links)
- Drag & drop para reposicionar (atualiza Layout)
- **Clique em Action → abre PropertiesPanel no lado direito**
- **Clique em seta/link → abre LinksPanel**
- Botões: + Add Sequence, + Add Action, Delete

#### Aba: Variáveis
Duas sub-seções:
- **Context** (parâmetros públicos): tabela com Name / Type / Value / ReadOnly / Description
  - Botões: Add / Edit / Delete
  - Type: dropdown (string, xml, boolean, integer, float, date)
- **Local** (variáveis internas): mesma estrutura

#### Aba: Informações
- TransactionAttributes editáveis: Description, Category, Status, Comments
- ReadOnly: CreatedBy, CreationDate, LastEditedBy, LastEditedDate, Version
- WriterRoles, ReaderRoles (input de texto)

#### Painel lateral: Properties (contexto de Action selecionada)
Formulário específico por `xsi:type`:

**IlluminatorSQLQueryObject:**
- QueryTemplate: seletor de arquivo .tqsq no catálogo
- Timeout: número
- QueryParameters: tabela de parâmetros com binding BLS

**SAPJCOInterface:**
- ConnPropAlias: dropdown ← `getJCOConnections()`
- CredentialAlias: dropdown ← `getBLSCredentials()`
- SAPRFC: texto (nome da BAPI/RFC)
- SAPServerName, SAPClient, SAPSystemNumber, Language: auto-preenchidos ao escolher alias
- ExecuteFunction, AutoCommit, AllowMultipleRows: checkboxes
- Request XML: editor expandível
- Response XML: editor expandível (read-only, mostra estrutura esperada)

**Assignment:**
- Sem propriedades (serve apenas como ponto de atribuição no Step)

**Tracer:**
- Message: texto (expressão BLS)
- Level: dropdown (INFO, WARNING, ERROR)

**TransactionCall:**
- Transaction: seletor de .trx no catálogo
- Parâmetros de entrada e saída: tabela

#### Painel lateral: Links (contexto de Action ou Step selecionado)
Duas seções:
- **IncomingLinks** (entradas): tabela To / From / Type
- **OutgoingLinks** (saídas): tabela To / From / Type

Tipos de link:
- `Assign`: atribuição simples → `To = BLS expression`
- `AssignXml`: atribuição em XPath → `To = target{/xpath}` ou `From = source{/xpath}`

Editor inline para cada linha: autocomplete de nomes de actions, variáveis Context/Local e funções BLS.

### 6.3 Salvar TRX

```
1. Serializar Transaction → XML
2. catalogService.saveTransaction(system, path, xml)
   POST /XMII/Catalog
   Mode=Save&Class=Transaction&ObjectName={path}&Content={urlencoded-XML}
3. Incrementar Version no modelo local
4. Toast de sucesso + oferta de git commit
```

---

## 7. TQSQ EDITOR — NOVO

### 7.1 CustomEditor para `.tqsq`

Registrar em `package.json`:
```json
"customEditors": [{
  "viewType": "miisync.tqsqEditor",
  "displayName": "MII Query Editor",
  "selector": [{"filenamePattern": "*.tqsq"}]
}]
```

### 7.2 Sequência de abertura

```
1. loadQueryTemplate(system, path) → XML sem TempTableList
2. parseTqsq(xml) → SQLQuery object
3. getSQLServerList(system) → popula dropdown de servidor
4. getServerModes(system, serverName) → popula dropdown de modo
5. getTableList(system, serverName) → CACHEAR; popula autocomplete de tabela
   (chamada apenas uma vez por servidor/sessão)
```

### 7.3 Layout do editor

```
┌─────────────────────────────────────────────────────┐
│ [Server: dbmid11 ▼] [Mode: FixedQuery ▼] [Rows: 500]│
├─────────────────────────────────────────────────────┤
│                                                     │
│   SQL EDITOR (monaco-style textarea com highlight)  │
│                                                     │
│   SELECT * FROM SapNotaQM                          │
│   WHERE Centro = [Param.1]                         │
│   AND DataAbertura >= [Param.2]                    │
│                                                     │
├─────────────────────────────────────────────────────┤
│ PARÂMETROS                                          │
│ #  │ Valor (default/test)  │ Descrição    │ Tipo   │
│ 1  │ [input]               │ Centro       │ String │
│ 2  │ [input]               │ Data Início  │ String │
│ + Adicionar parâmetro                               │
├─────────────────────────────────────────────────────┤
│ [▶ Testar Query]  [💾 Salvar]  [Git Commit]         │
├─────────────────────────────────────────────────────┤
│ RESULTADO DO TESTE                (500 rows)        │
│ [tabela com os dados]                               │
└─────────────────────────────────────────────────────┘
```

### 7.4 Salvar TQSQ

```
1. parseTqsq → editar → serializeTqsq → XML (Template format, sem TempTableList)
2. catalogService.saveQuery(system, path, xml)
   POST /XMII/Catalog
   Mode=Save&Class=SQLQuery&ObjectName={path}&Content={urlencoded-XML}
3. Toast + oferta de git commit
```

---

## 8. QUERY TEST RUNNER

### 8.1 `src/modules/queryrunner.ts`

Implementa exatamente o fluxo do Workbench:

```typescript
export async function runQueryTest(
  system: System,
  query: SQLQuery,
  testParams: Record<number, string>   // { 1: "5103", 2: "2026-01-01", ... }
): Promise<QueryTestResult>
```

**Fluxo interno:**
```
1. Gerar UUID: `TMP${uuid()}` (formato: TMP + RFC4122 UUID)

2. POST /XMII/Catalog
   Mode=Exists&Class=SQLQuery&ObjectName=TMP{uuid}
   → espera Message=0 (não existe, como esperado)

3. Preencher valores de teste nos params: fillTestParams(query, testParams)

4. POST /XMII/Catalog
   Mode=Save&Class=SQLQuery&ObjectName=TMP{uuid}&TemporaryFile=true
   &TempFileName=TMP{uuid}&Content={urlencoded-XML-com-params-preenchidos}
   → espera Message=Object was saved

5. POST /XMII/Illuminator
   IsTesting=T&QueryTemplate=TMP{uuid}&Content-Type=text%2Fxml&QueryTemplate=TMP{uuid}
   (QueryTemplate enviado DUAS vezes — comportamento correto do Workbench)
   → retorna Rowsets XML com resultados

6. Parse dos resultados: XML → array de objetos
   (TMP auto-deletado pelo servidor após execução)

7. Retornar { rows: any[], columns: string[], rowCount: number, executionTime: number }
```

### 8.2 Exibição dos resultados

No TQSQ Editor, seção de resultado:
- Tabela virtual (scroll) com os dados
- Header com contagem de linhas e tempo de execução
- Botão "Exportar CSV"
- Highlight de células com erro

---

## 9. TRANSACTION RUNNER

### 9.1 `src/miiservice/runnerservice.ts`

```typescript
class RunnerService {
  async execute(
    system: System,
    transactionPath: string,
    inputParams: Record<string, string>
  ): Promise<TransactionRunResult>
  // POST /XMII/Runner
  // Body: Transaction={path}&Context.{key}={value}&...&OutputParameter=XML
  // Response: XML com contexto de saída
}

interface TransactionRunResult {
  success: boolean;
  outputs: Record<string, any>;  // variáveis de contexto de saída
  error?: string;
  executionLog?: string[];       // se disponível
}
```

### 9.2 UI no TRX Viewer

Botão "▶ Executar" no TRX Viewer abre painel:

```
┌──────────────────────────────────────────┐
│  EXECUTAR: CQMData                       │
├──────────────────────────────────────────┤
│  PARÂMETROS DE ENTRADA                   │
│  centro:  [5103        ]                 │
├──────────────────────────────────────────┤
│  [▶ Executar]  [Cancelar]                │
├──────────────────────────────────────────┤
│  SAÍDA                                   │
│  output: <Rowsets><Rowset>...</Rowset>   │
│  [Visualizar como tabela]                │
└──────────────────────────────────────────┘
```

---

## 10. MCP SERVER (FASE FINAL — integração AI)

### 10.1 Arquitetura

```
src/mcp/
├── mcpserver.ts          ← HTTP server na porta configurável (padrão 3722)
├── toolhandlers.ts       ← implementação de cada tool
└── mcpschemas.ts         ← schemas JSON dos tools
```

**Protocolo:** JSON-RPC 2.0 sobre HTTP (POST /mcp)

### 10.2 Tools disponíveis para o agente

| Tool | Descrição |
|------|-----------|
| `mii_list_catalog` | Lista pastas e arquivos em um caminho do catálogo |
| `mii_read_trx` | Lê uma transaction do servidor (retorna XML ou objeto estruturado) |
| `mii_write_trx` | Salva uma transaction no servidor |
| `mii_read_query` | Lê uma fixed query do servidor |
| `mii_write_query` | Salva uma fixed query no servidor |
| `mii_run_query` | Executa query em modo teste com parâmetros |
| `mii_run_transaction` | Executa transaction com parâmetros de entrada |
| `mii_get_catalog_info` | Retorna ações disponíveis por categoria, JCO connections, SQL servers |
| `mii_validate_trx` | Valida estrutura XML de um TRX localmente |
| `mii_create_trx` | Cria um TRX novo via TrxBuilder API |
| `mii_add_action` | Adiciona action a uma sequência de um TRX existente |

### 10.3 Configuração para Claude Code

```json
// .claude/settings.json
{
  "mcpServers": {
    "miisync": {
      "type": "http",
      "url": "http://localhost:3722"
    }
  }
}
```

### 10.4 TrxBuilder API (para os tools de criação)

```typescript
// src/ai/trxbuilder.ts
const builder = new TrxBuilder("ConsultaMaterial");
builder.addContextVar("MaterialNumber", "string");
builder.addContextVar("Description", "string", { readOnly: true });

const seq = builder.addSequence("MainSeq");
const jco = seq.addAction("JCOCall", "SAPJCOInterface");
jco.setProperty("SAPRFC", "BAPI_MATERIAL_GET_DETAIL");
jco.setProperty("ConnPropAlias", "MelitaQAS");
jco.addLink("in", { to: "JCOCall.Request{/BAPI/INPUT/MATNR}", from: "Transaction.MaterialNumber" });
jco.addLink("out", { to: "Transaction.Description", from: "JCOCall.Response{/BAPI/OUTPUT/Matl_Desc}" });

const xml = builder.toXML(); // → XML TRX válido
```

---

## 11. CORREÇÕES CRÍTICAS NO TRX VIEWER ATUAL

### Bug 1: Carregamento usa serviço errado
**Arquivo:** `src/ui/trxviewer/trxViewerProvider.ts`  
**Problema:** Usa `loadMesFileService` (sem `Class=Transaction`)  
**Fix:** Substituir por `catalogService.loadTransaction()`

### Bug 2: Save usa serviço errado
**Arquivo:** `src/ui/trxviewer/trxViewerProvider.ts`  
**Problema:** Usa `saveMesFileService` (sem `Class=Transaction`)  
**Fix:** Substituir por `catalogService.saveTransaction()`

### Bug 3: Parse do XML TRX incompleto
**Problema:** fast-xml-parser não preserva order dos Steps nem xsi:type corretamente  
**Fix:** Parser customizado em `trxparser.ts` com tratamento especial de:
- `xsi:type` como discriminador de tipo
- Sequências aninhadas (Steps dentro de Steps)
- Valores XML escapados como CDATA ou entidades HTML (`&lt;`, `&gt;`)
- `AssignXml` vs `Assign` como tipos diferentes de links
- Layout como mapa separado

### Bug 4: Diagrama SVG não reflete estrutura real
**Problema:** Diagrama não posiciona Actions dentro das Sequences corretas  
**Fix:** Usar `Layout` do TRX para posicionamento; renderizar sub-sequências como grupos aninhados

### Bug 5: Links não são editáveis
**Problema:** Links são exibidos mas não podem ser criados/editados  
**Fix:** Implementar LinksPanel com editor inline

---

## 12. ORDEM DE IMPLEMENTAÇÃO (FASEADA)

### Fase 1 — Fundação (1-2 semanas)
1. `src/models/trx.ts` e `src/models/tqsq.ts` — tipos TypeScript
2. `src/modules/trxparser.ts` — parse/serialize TRX
3. `src/modules/tqsqparser.ts` — parse/serialize TQSQ
4. `src/miiservice/catalogservice.ts` — serviços com Class corretos
5. Corrigir TrxViewerProvider para usar `catalogService.loadTransaction/saveTransaction`

### Fase 2 — TQSQ Editor (1-2 semanas)
6. `src/miiservice/illuminatorservice.ts` — ServerList, TableList, ModeList
7. `src/ui/tqsqeditor/` — CustomEditor para .tqsq
8. `src/modules/queryrunner.ts` — fluxo UUID→Save→Execute→Delete
9. UI de resultado na tabela (dentro do editor)

### Fase 3 — TRX Editor melhorado (2-3 semanas)
10. Refatorar painéis do TRX Viewer com base nos modelos corretos
11. PropertiesPanel (formulário por tipo de Action)
12. LinksPanel (editor de IncomingLinks/OutgoingLinks)
13. VariablesPanel melhorado (Context + Local)
14. Diagrama SVG corrigido (layout real do TRX)

### Fase 4 — Runners (1 semana)
15. `src/miiservice/runnerservice.ts` — POST /XMII/Runner
16. Painel de execução no TRX Viewer
17. Painel de histórico de execuções

### Fase 5 — MCP Server (1-2 semanas)
18. `src/mcp/mcpserver.ts` — HTTP server JSON-RPC 2.0
19. `src/mcp/toolhandlers.ts` — implementação dos tools
20. `src/ai/trxbuilder.ts` — API de construção programática
21. Configuração automática do .claude/settings.json

---

## 13. DETALHES TÉCNICOS CRÍTICOS (descobertos no Fiddler)

### 13.1 TempTableList — NUNCA armazenar localmente
O `Mode=Load` (sem `Class=Template`) retorna o atributo `TempTableList` com centenas de tabelas do banco de dados — o campo sozinho tem centenas de KB. **Usar sempre `Mode=Load&Class=Template` para sync/edição local.**

### 13.2 QueryTemplate enviado duas vezes
```
IsTesting=T&QueryTemplate=TMP{uuid}&Content-Type=text%2Fxml&QueryTemplate=TMP{uuid}
```
Isso NÃO é um erro. O Workbench envia dois valores para `QueryTemplate`. Replicar exatamente.

### 13.3 Auto-delete do temp após execução
Após `IsTesting=T`, o servidor deleta automaticamente o objeto `TMP{uuid}`. Não precisar de chamada de delete explícita.

### 13.4 Version counter no TRX
Cada save incrementa `<Version>N</Version>`. O servidor gerencia isso; ao fazer save, não precisar pré-incrementar — o servidor retorna o novo valor (ou pode ser gerenciado localmente incrementando +1).

### 13.5 GlobalMemory sempre vazio
O Workbench chama `Mode=Load&Class=GlobalMemory` repetidamente ao mudar de painel. Resposta é sempre `<GlobalProperties/>`. Não implementar essa chamada — é overhead desnecessário.

### 13.6 Existe-check antes de salvar temp
O Workbench faz `Mode=Exists` antes de salvar o temp. Para nosso runner, podemos simplificar para apenas gerar UUID único e salvar diretamente.

### 13.7 Atributos sem extensão no ObjectName
O path do objeto no catálogo **NÃO inclui extensão** nas chamadas de API:
- Correto: `Default/AberturaTurno/Transactions/CockpitCQM/CQMData`
- **NÃO usar:** `Default/AberturaTurno/Transactions/CockpitCQM/CQMData.trx`

A extensão `.trx` ou `.tqsq` só aparece no campo `ObjectName` do response de `Mode=List`.

### 13.8 Parsing de links com XPath inline
Links do tipo `AssignXml` usam o formato `{/xpath/expression}`:
```xml
<To>Transaction.output{/Rowsets/Rowset/Nota}</To>
<From>NotasQM.Results</From>
```
O parser precisa separar o nome base (`Transaction.output`) do XPath (`/Rowsets/Rowset/Nota`).

### 13.9 Expressões BLS nos links
Links `From` podem conter expressões BLS complexas:
```
"WERKS EQ '" & Transaction.centro & "'"
dateformat(datenow, "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd")
stringreplace(BBP_RFC_READ_TABLE.Response, "'", "")
```
O editor deve tratar como texto livre com autocomplete de variáveis/funções.

---

## 14. RESUMO DOS ENTREGÁVEIS

| # | Entregável | Arquivo(s) Principal(is) |
|---|-----------|--------------------------|
| 1 | Modelos TypeScript | `src/models/trx.ts`, `src/models/tqsq.ts` |
| 2 | Parser TRX/TQSQ | `src/modules/trxparser.ts`, `src/modules/tqsqparser.ts` |
| 3 | Serviços MII corretos | `src/miiservice/catalogservice.ts`, `illuminatorservice.ts` |
| 4 | TRX Viewer corrigido | `src/ui/trxviewer/` (refatorar existente) |
| 5 | TQSQ Editor novo | `src/ui/tqsqeditor/` |
| 6 | Query Test Runner | `src/modules/queryrunner.ts` |
| 7 | Transaction Runner | `src/miiservice/runnerservice.ts` |
| 8 | Painel de Properties | `src/ui/trxviewer/panels/PropertiesPanel.ts` |
| 9 | Painel de Links | `src/ui/trxviewer/panels/LinksPanel.ts` |
| 10 | MCP Server | `src/mcp/` |
| 11 | TrxBuilder API | `src/ai/trxbuilder.ts` |

---

*FIM DO PLANO*
*Total: 11 entregáveis em 5 fases (~8-12 semanas de implementação gradual)*
