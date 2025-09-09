# 🔄 Exemplo Prático: Ignorando Configurações do miisync.json

## Cenário Real

### Configuração Atual (`miisync.json`)

```json
{
  "remotePath": "MES/test",
  "removeFromLocalPath": ["webapp"]
  // ... outras configurações
}
```

### Diretório Baixado com Mapeamento

Quando você baixa um diretório remoto `/WEB/projeto/vendas`, o sistema cria:

**Arquivo**: `C:\Workspace\vendas\.miisync\path-mapping.json`

```json
{
  "rootRemotePath": "/WEB/projeto/vendas",
  "rootLocalPath": "C:\\Workspace\\vendas",
  "mappings": [
    {
      "localPath": "controllers\\vendaController.js",
      "remotePath": "/WEB/projeto/vendas/controllers/vendaController.js",
      "lastUpdated": 1704067200000
    },
    {
      "localPath": "models\\produto.js",
      "remotePath": "/WEB/projeto/vendas/models/produto.js",
      "lastUpdated": 1704067200000
    }
  ]
}
```

## 🎯 Comportamento do Upload

### Arquivo COM Mapeamento

```
Arquivo local: C:\Workspace\vendas\controllers\vendaController.js

❌ NÃO usa: MES/test/controllers/vendaController.js (das configurações)
✅ USA: /WEB/projeto/vendas/controllers/vendaController.js (do mapeamento)
```

### Arquivo SEM Mapeamento

```
Arquivo local: C:\Workspace\novo-arquivo.js

✅ USA: MES/test/novo-arquivo.js (das configurações - método tradicional)
```

## 📊 Comparação de Comportamentos

| Situação                | Arquivo Local                           | Configuração miisync.json | Mapeamento                                           | Caminho Final Usado                                      |
| ----------------------- | --------------------------------------- | ------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| **Arquivo mapeado**     | `vendas\controllers\vendaController.js` | `remotePath: "MES/test"`  | `/WEB/projeto/vendas/controllers/vendaController.js` | **`/WEB/projeto/vendas/controllers/vendaController.js`** |
| **Arquivo não-mapeado** | `novo-arquivo.js`                       | `remotePath: "MES/test"`  | ❌ Não existe                                        | **`MES/test/novo-arquivo.js`**                           |
| **Subpasta mapeada**    | `vendas\views\index.html`               | `remotePath: "MES/test"`  | Root: `/WEB/projeto/vendas`                          | **`/WEB/projeto/vendas/views/index.html`**               |

## 🚀 Vantagens desta Abordagem

### ✅ Preserva Contexto Original

- Arquivos baixados mantêm referência exata ao servidor
- Não são afetados por mudanças nas configurações locais

### ✅ Flexibilidade Total

- Cada diretório baixado pode ter origem diferente
- Configurações globais não interferem em downloads específicos

### ✅ Segurança

- Evita uploads acidentais em locais errados
- Mantém integridade dos caminhos originais

## 💡 Casos de Uso

### Caso 1: Múltiplos Projetos

```
Workspace/
├── projeto-a/           (baixado de /WEB/sistema/projeto-a)
│   └── .miisync/        → usa /WEB/sistema/projeto-a/*
├── projeto-b/           (baixado de /WEB/outro/projeto-b)
│   └── .miisync/        → usa /WEB/outro/projeto-b/*
└── novos-arquivos/      (sem mapeamento)
                         → usa MES/test/* (das configurações)
```

### Caso 2: Estruturas Complexas

```
Downloads/
├── vendas/              (de /WEB/modulos/vendas)
├── compras/             (de /WEB/modulos/compras)
└── relatorios/          (de /APPS/relatorios)

Cada um mantém sua origem específica, independente das configurações!
```

---

**🔑 Resumo**: O sistema de mapeamento tem prioridade absoluta sobre as configurações do `miisync.json`, garantindo que arquivos baixados sempre retornem ao local correto no servidor.
