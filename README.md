# MII WEB SYNC

**MII WEB SYNC** é um## ⚡ **Melhorias Implementadas**

### **v0.14.1 - Versão Atual**

- ✅ **Upload com Server Backup**: Backup automático antes de upload
- ✅ **Download Resiliente**: Continua mesmo com arquivos problemáticos
- ✅ **Menu Simplificado**: Comandos diretos no contexto (sem submenus)
- ✅ **Sanitização de Caminhos**: Corrige caracteres especiais automaticamente
- ✅ **Confirmações de Segurança**: Dupla confirmação para exclusões
- ✅ **Mapeamento Inteligente**: Sistema robusto de path mapping
- ✅ **Recuperação de Erros**: Não para downloads por arquivos únicos com problema

## 📋 **Requisitos**

- Visual Studio Code 1.83.1 ou superior
- Servidor MII configurado e acessível
- Arquivo `.vscode/miisync.json` para funcionalidades completas

## ⚙️ **Configurações da Extensão**

- **Session Duration**: Duração da sessão em minutos no sistema MII
- **Refresh Session**: Renovar sessão automaticamente para evitar timeouts
- **Request Limit**: Limite de requisições simultâneas (padrão: seguro para estabilidade)
- **Show Diff Notification**: Notificar quando arquivo local difere do servidor

---

## 📁 **Configuração do Projeto**

Seu projeto deve conter o arquivo `miisync.json` na pasta `.vscode` para funcionar completamente.para Visual Studio Code que permite sincronização robusta e inteligente de projetos web com servidores MII. A extensão oferece recursos completos de backup, recuperação de download e mapeamento de caminhos.

## 🚀 Funcionalidades Principais

### 📁 **Gestão de Arquivos e Pastas**

- **Upload com Backup do Servidor**: Antes de fazer upload, cria automaticamente um backup do arquivo existente no servidor
- **Download Robusto**: Sistema de download que continua mesmo quando alguns arquivos falham (não para mais aos 94%)
- **Sanitização de Caminhos**: Corrige automaticamente nomes de arquivos com caracteres especiais incompatíveis com Windows
- **Detecção Binária Inteligente**: Detecta automaticamente arquivos binários vs texto baseado na extensão

### 🔄 **Sincronização Avançada**

- **Mapeamento de Caminhos**: Sistema completo de mapeamento entre caminhos locais e remotos
- **Verificação de Integridade**: Verifica se arquivos foram modificados por outros usuários
- **Recuperação de Erros**: Continua downloads mesmo quando arquivos específicos falham (ENOENT, caracteres inválidos, etc.)

### 🛡️ **Segurança e Confirmações**

- **Confirmação Dupla para Exclusões**: Mostra o caminho completo do servidor antes de deletar
- **Backup Automático**: Cria backups com timestamp antes de sobrescrever arquivos
- **Validação de Sessão**: Renovação automática de sessão para evitar timeouts

## 📋 **Como Usar**

### Primeira Configuração:

1. Instale e ative a extensão
2. Use `Ctrl+Shift+P` → Digite `mii: create config`
3. Configure o arquivo `miisync.json` criado
4. Defina `isMain: true` para o sistema principal

### Comandos Principais:

- **Botão direito em arquivos/pastas** → Acesso direto aos comandos MiiSync
- **Upload with Server Backup** → Upload com backup automático
- **Download Project** → Download completo com recuperação de erros
- **Show Server Differences** → Visualiza diferenças com servidor
- **Copy Server Path** → Copia caminho do servidor

### Menu Simplificado:

Todos os comandos MiiSync agora aparecem diretamente no menu de contexto (sem submenus), facilitando o acesso rápido.

## Planned Features

## Requirements

- Visual Studio Code.
- MII system to connect to.
- .vscode/miisync.json file for full features.

## Extension Settings

- `Session Duration`: How long does session lasts in minutes in the MII system.
- `Refresh Session`: Should extension perodically send request to renew session?
- `Request Limit`: The maximum number of requests to server it can send. Used in folder download/upload/transfer. Increasing it can introduce instability.
- `Show Diff Notification`: Should the extension see if the currently opened file is different from the remote file and show a notification if it is?

---

Your folder must contain miisync.json file in .vscode folder to work.

### **Configurações do miisync.json:**

```json
{
  "system": [
    {
      "name": "Servidor Principal",
      "isMain": true,
      "severity": 2,
      "host": "meu-servidor.com",
      "port": 50000,
      "username": "meu-usuario",
      "password": "opcional"
    }
  ],
  "remotePath": "PROJETO/WEB/MeuApp",
  "removeFromLocalPath": ["webapp"],
  "ignore": ["node_modules/**", "*.log"],
  "include": ["src/**"],
  "uploadOnSave": true,
  "downloadOnOpen": false,
  "useRootConfig": false,
  "rootConfig": ""
}
```

**Parâmetros Principais:**

- **`system`**: Array de sistemas MII (apenas um com `isMain: true`)
- **`remotePath`**: Caminho do projeto no servidor (ex: "PROJETO/WEB/App")
- **`removeFromLocalPath`**: Pastas locais que não existem no servidor
- **`ignore/include`**: Padrões glob para filtrar arquivos
- **`uploadOnSave`**: Upload automático ao salvar
- **`downloadOnOpen`**: Download automático ao abrir

## 🎮 **Comandos Disponíveis**

### **Via Command Palette (Ctrl+Shift+P):**

- `mii: Create Config` - Cria arquivo de configuração (primeiro comando)
- `mii: Log in/out` - Gerencia sessão no servidor
- `mii: Upload Changes` - Faz upload de arquivos modificados
- `mii: Toggle Upload/Download` - Liga/desliga funcionalidades automáticas

### **Menu de Contexto (Botão Direito):**

- 📥 **Download** - Baixa arquivo/pasta do servidor
- 📤 **Upload** - Envia arquivo/pasta para servidor
- 📤 **Upload with Server Backup** - Upload com backup automático
- 🔄 **Transfer** - Transfere entre sistemas
- 🗑️ **Delete** - Remove do servidor (com confirmação dupla)
- 📋 **Copy Server Path** - Copia caminho do servidor
- 🔍 **Show Server Differences** - Mostra diferenças
- ⚙️ **Open Screen** - Abre tela no navegador (index.html)

### **Sidebar MiiSync:**

- 🌐 **Remote Directory** - Navega arquivos do servidor
- 📁 **Local Projects** - Gerencia projetos locais
- ⚙️ **Settings** - Abre configurações

## 🛠️ **Solução de Problemas**

### **Downloads que Param aos 94%:**

✅ **Solucionado!** A extensão agora continua o download mesmo quando alguns arquivos falham

### **Caracteres Especiais em Nomes:**

✅ **Solucionado!** Sanitização automática de caminhos problemáticos

### **Arquivos Não Encontrados (ENOENT):**

✅ **Solucionado!** Sistema ignora arquivos problemáticos e continua

---

## 📝 **Changelog Recente**

**v0.14.1:**

- 🆕 Upload with Server Backup
- 🔧 Download recovery system
- 🎨 Menu simplification
- 🛡️ Enhanced error handling
- 📁 Path sanitization system

* `Download Remote Folder`: Downloads the selected remote folder and its contents.
* `Download Remote File`: Downloads the selected remote file.
* `Download File Properties`: Downloads the file properties like created time, updated user.

## Known Issues

-

**Enjoy!**
