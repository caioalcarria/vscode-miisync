# Sistema de Mapeamento de Arquivos Locais Modificados

## Visão Geral

Este sistema implementa um novo mecanismo de rastreamento de mudanças em arquivos locais baseado em um arquivo JSON de mapeamento. O sistema substitui/complementa o método anterior de rastreamento em memória, fornecendo persistência e melhor controle sobre os estados dos arquivos.

## Estrutura do Sistema

### 1. Arquivo de Mapeamento JSON (`local-files-mapping.json`)

Localizado em `.miisync/local-files-mapping.json` no workspace, contém:

```json
{
  "version": "1.0.0",
  "lastUpdated": "2025-09-12T10:30:00.000Z",
  "files": {
    "/caminho/absoluto/arquivo.js": {
      "localPath": "/caminho/absoluto/arquivo.js",
      "remotePath": "/servidor/caminho/arquivo.js",
      "lastModified": "2025-09-12T10:25:00.000Z",
      "hasLocalChanges": true,
      "originalHash": "abc123...",
      "status": "modified",
      "createdAt": "2025-09-12T09:00:00.000Z",
      "lastChecked": "2025-09-12T10:30:00.000Z"
    }
  },
  "settings": {
    "autoDetectChanges": true,
    "checkInterval": 5000
  }
}
```

### 2. Estados de Arquivos

- **unchanged**: Arquivo não foi alterado desde o download
- **modified**: Arquivo foi modificado localmente
- **added**: Arquivo novo, não existia no servidor
- **deleted**: Arquivo foi deletado localmente

### 3. Flag `hasLocalChanges`

Controla se o arquivo deve aparecer nas decorações e na árvore Local Changes:

- `true`: Arquivo aparece com badge (M, N, D)
- `false`: Arquivo não aparece nas listagens de mudanças

## Componentes Integrados

### 1. LocalFilesMappingManager (`src/modules/localfilesmapping.ts`)

**Métodos Principais:**

- `addOrUpdateFile()`: Adiciona/atualiza arquivo no mapeamento
- `hasLocalChanges()`: Verifica se arquivo tem alterações
- `updateLocalChangesFlag()`: Atualiza flag de alterações
- `checkIfFileModified()`: Verifica se arquivo foi realmente modificado
- `getFilesWithLocalChanges()`: Retorna arquivos com alterações

**Eventos:**

- `onDidChangeMappings`: Disparado quando o mapeamento muda

### 2. FileStatusDecorationProvider (`src/ui/decorations/filestatusdecorations.ts`)

**Integração:**

- Verifica primeiro no sistema de mapeamento JSON
- Fallback para sistema legado se necessário
- Badges personalizados com informações do servidor remoto

**Badges:**

- `N` (Verde): Arquivo novo
- `M` (Laranja): Arquivo modificado
- `D` (Vermelho): Arquivo deletado

### 3. LocalProjectsTreeProvider (`src/ui/treeview/localprojectstree.ts`)

**Integração:**

- Auto-registra arquivos de projetos no sistema de mapeamento
- Converte dados do JSON para formato da árvore
- Monitora eventos de mudança do mapeamento

## Fluxo de Funcionamento

### 1. Carregamento de Projeto

```
1. Projeto detectado com .miisync/path-mapping.json
2. Arquivos registrados no LocalFilesMappingManager
3. Status inicial: "unchanged", hasLocalChanges: false
4. Sistema monitora mudanças nos arquivos
```

### 2. Modificação de Arquivo

```
1. VS Code detecta salvamento do arquivo
2. FileStatusDecorationProvider verifica se está no mapeamento
3. LocalFilesMappingManager calcula hash e compara
4. Se diferente: status = "modified", hasLocalChanges = true
5. Evento disparado -> decoração atualizada + árvore refreshed
```

### 3. Exibição de Mudanças

```
1. FileStatusDecorationProvider consulta mapeamento
2. Se hasLocalChanges = true -> exibe badge
3. LocalProjectsTreeProvider lista arquivos na árvore
4. Tooltip mostra caminho remoto e data de modificação
```

## Exemplo de Uso Programático

```typescript
import { localFilesMappingManager } from "../modules/localfilesmapping";

// Adicionar arquivo ao mapeamento
await localFilesMappingManager.addOrUpdateFile(
  "/projeto/src/main.js",
  "/servidor/projeto/src/main.js",
  true, // tem alterações locais
  "modified"
);

// Verificar se arquivo tem alterações
const hasChanges = localFilesMappingManager.hasLocalChanges(
  "/projeto/src/main.js"
);

// Obter todos arquivos modificados
const modifiedFiles = localFilesMappingManager.getFilesWithLocalChanges();

// Verificar se arquivo foi realmente modificado
const isModified = await localFilesMappingManager.checkIfFileModified(
  "/projeto/src/main.js"
);
```

## Vantagens do Novo Sistema

### 1. Persistência

- Mudanças persistem entre sessões do VS Code
- Não há perda de estado ao reiniciar

### 2. Precisão

- Comparação por hash MD5 para detecção precisa
- Diferencia entre arquivos salvos sem mudanças reais

### 3. Performance

- Verificação sob demanda ao invés de varredura constante
- Cache inteligente com timestamps

### 4. Informações Ricas

- Histórico de modificações
- Relacionamento local ↔ servidor
- Timestamps detalhados

### 5. Flexibilidade

- Sistema de flags configurável
- Status granular (modified, added, deleted, unchanged)
- Eventos para integração com outros sistemas

## Compatibilidade

O sistema mantém compatibilidade com o método anterior através de:

- Fallback para sistema legado em `FileStatusDecorationProvider`
- Conversão de dados entre formatos em `LocalProjectsTreeProvider`
- Detecção automática de projetos existentes

## Configurações

```json
{
  "settings": {
    "autoDetectChanges": true, // Detecta mudanças automaticamente
    "checkInterval": 5000 // Intervalo de verificação em ms
  }
}
```

## Logs e Debugging

O sistema gera logs detalhados no console do VS Code:

- `📋 Mapeamento de arquivos carregado: N arquivos`
- `💾 Mapeamento salvo: N arquivos`
- `🔄 Sistema de mapeamento atualizado: N arquivo(s) alterados`
- `📁 Arquivo salvo (mapeado): arquivo.js - Modificado: true`

## Estrutura de Arquivos

```
src/
├── types/
│   └── localfilemapping.ts        # Interfaces e tipos
├── modules/
│   └── localfilesmapping.ts       # Gerenciador principal
├── ui/
│   ├── decorations/
│   │   └── filestatusdecorations.ts  # Provider de decorações
│   └── treeview/
│       └── localprojectstree.ts      # Árvore Local Changes
```

Este sistema fornece uma base sólida e extensível para o rastreamento de mudanças locais, com melhor performance e funcionalidades mais ricas que o sistema anterior.
