# Sistema de Mapeamento de Caminhos - MiiSync

## Visão Geral

O sistema de mapeamento de caminhos foi criado para resolver o problema de atualização de arquivos quando diretórios são baixados do servidor MII. Quando você baixa um diretório remoto, o sistema agora cria um arquivo de mapeamento que vincula os caminhos locais aos caminhos remotos correspondentes.

## Como Funciona

### 1. Download de Diretórios

Quando você baixa um diretório remoto usando os comandos:

- `miisync.downloadremotefolder`
- `miisync.downloadremotedirectory`

O sistema automaticamente:

1. **Cria uma pasta oculta `.miisync`** no diretório raiz baixado
2. **Gera um arquivo `path-mapping.json`** dentro dessa pasta
3. **Registra todos os arquivos e pastas** baixados com seus caminhos remotos correspondentes

### 2. Estrutura do Arquivo de Mapeamento

O arquivo `.miisync/path-mapping.json` contém:

```json
{
  "rootRemotePath": "/WEB/projeto/modulo",
  "rootLocalPath": "C:\\Workspace\\projeto\\modulo",
  "mappings": [
    {
      "localPath": "src\\main.js",
      "remotePath": "/WEB/projeto/modulo/src/main.js",
      "lastUpdated": 1704067200000
    },
    {
      "localPath": "docs\\readme.md",
      "remotePath": "/WEB/projeto/modulo/docs/readme.md",
      "lastUpdated": 1704067200000
    },
    {
      "localPath": "config",
      "remotePath": "/WEB/projeto/modulo/config",
      "lastUpdated": 1704067200000
    }
  ],
  "version": "1.0.0",
  "createdAt": 1704067200000
}
```

### 3. Upload com Mapeamento

Quando você faz upload de arquivos que estão em diretórios com mapeamento:

1. O sistema primeiro verifica se existe um arquivo de mapeamento
2. Se encontrar, usa o caminho remoto correto do mapeamento
3. Se não encontrar, usa o método tradicional baseado na configuração

## Funcionalidades

### PathMappingManager

A classe `PathMappingManager` oferece os seguintes métodos:

#### `hasMappingFile(rootLocalPath: string): Promise<boolean>`

Verifica se existe um arquivo de mapeamento no diretório especificado.

#### `createMappingFile(rootLocalPath, rootRemotePath, mappings): Promise<void>`

Cria um novo arquivo de mapeamento com os dados fornecidos.

#### `loadMappingFile(rootLocalPath: string): Promise<PathMappingConfig | null>`

Carrega e retorna a configuração de mapeamento de um diretório.

#### `getRemotePathFromMapping(localFilePath: string): Promise<string | null>`

Busca o caminho remoto correto para um arquivo local, subindo na hierarquia de diretórios até encontrar um mapeamento.

#### `addMapping(rootLocalPath, localPath, remotePath): Promise<void>`

Adiciona ou atualiza um mapeamento específico.

#### `addMultipleMappings(rootLocalPath, mappings): Promise<void>`

Adiciona múltiplos mapeamentos de uma vez.

### GetRemotePathWithMapping

Nova função assíncrona que:

1. **Primeiro tenta usar o mapeamento de caminhos** - se encontrar, usa exatamente o caminho salvo no arquivo de mapeamento, **ignorando completamente** o `remotePath` das configurações
2. **Se não encontrar mapeamento**, usa o método tradicional `GetRemotePath` baseado nas configurações

**⚠️ Importante**: Quando um arquivo tem mapeamento, o sistema usa apenas o caminho do arquivo de mapeamento, ignorando totalmente as configurações do `miisync.json`.

## Benefícios

1. **Upload Correto**: Arquivos baixados mantêm a referência correta ao servidor
2. **Flexibilidade**: Funciona com estruturas de pastas complexas
3. **Transparência**: Não interfere com o fluxo de trabalho existente
4. **Automático**: Criado automaticamente durante downloads

## Exemplo de Uso

### Cenário 1: Download de Diretório Remoto

```
1. Usuário baixa diretório remoto: /WEB/projeto/modulo
2. Sistema cria: C:\Workspace\projeto\modulo\.miisync\path-mapping.json
3. Todos os arquivos baixados são mapeados
```

### Cenário 2: Upload de Arquivo Mapeado

```
1. Usuário edita: C:\Workspace\projeto\modulo\src\main.js
2. Usuário faz upload do arquivo
3. Sistema encontra mapeamento e envia para: /WEB/projeto/modulo/src/main.js
4. Upload é feito no caminho correto!
```

### Cenário 3: Upload de Arquivo Não-Mapeado

```
1. Usuário cria novo arquivo em diretório sem mapeamento
2. Sistema usa método tradicional baseado na configuração
3. Upload funciona normalmente
```

## Compatibilidade

- ✅ Mantém compatibilidade total com código existente
- ✅ Funciona com uploads tradicionais (sem mapeamento)
- ✅ Funciona com downloads de diretórios configurados localmente
- ✅ Adiciona funcionalidade apenas quando necessário

## Arquivos Modificados

1. **`src/modules/pathmapping.ts`** - Novo módulo para gerenciar mapeamentos
2. **`src/modules/file.ts`** - Adicionada função `GetRemotePathWithMapping`
3. **`src/transfer/upload.ts`** - Upload de arquivo usa mapeamento quando disponível
4. **`src/transfer/limited/downloadcomplex.ts`** - Cria mapeamentos durante download
