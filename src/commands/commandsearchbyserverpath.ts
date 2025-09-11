import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function OnCommandSearchByServerPath(projectItem: any) {
    try {
        const projectPath = projectItem.projectPath || projectItem;
        
        // Solicitar a rota do servidor
        const serverPath = await vscode.window.showInputBox({
            prompt: 'Digite a rota do servidor',
            placeHolder: 'Ex: /home/user/projeto/arquivo.js',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'A rota do servidor não pode estar vazia';
                }
                return null;
            }
        });

        if (!serverPath) {
            return; // Usuário cancelou
        }

        // Buscar o arquivo correspondente no projeto
        const localFile = await findFileByServerPath(projectPath, serverPath.trim());
        
        if (localFile) {
            // Abrir o arquivo encontrado
            const document = await vscode.workspace.openTextDocument(localFile);
            await vscode.window.showTextDocument(document);
            
            vscode.window.showInformationMessage(`Arquivo encontrado: ${path.basename(localFile)}`);
        } else {
            vscode.window.showWarningMessage(`Arquivo não encontrado para a rota: ${serverPath}`);
        }

    } catch (error) {
        vscode.window.showErrorMessage(`Erro ao buscar arquivo: ${error}`);
    }
}

async function findFileByServerPath(projectPath: string, serverPath: string): Promise<string | null> {
    try {
        // Verificar se existe o arquivo de mapeamento de caminhos
        const pathMappingFile = path.join(projectPath, '.miisync', 'path-mapping.json');
        
        if (!fs.existsSync(pathMappingFile)) {
            return null;
        }

        // Ler o mapeamento de caminhos
        const mappingContent = fs.readFileSync(pathMappingFile, 'utf8');
        const mappingData = JSON.parse(mappingContent);
        
        // Verificar se tem a estrutura esperada com array mappings
        if (!mappingData.mappings || !Array.isArray(mappingData.mappings)) {
            console.log('Estrutura de mappings não encontrada');
            return null;
        }

        // Procurar pela rota EXATA do servidor no array mappings
        for (const mapping of mappingData.mappings) {
            if (mapping.remotePath === serverPath) {
                // Usar rootLocalPath + localPath para construir o caminho completo
                const rootLocalPath = mappingData.rootLocalPath || projectPath;
                const fullLocalPath = path.join(rootLocalPath, mapping.localPath);
                
                if (fs.existsSync(fullLocalPath)) {
                    return fullLocalPath;
                } else {
                    console.log(`Arquivo local não existe: ${fullLocalPath}`);
                    return null;
                }
            }
        }

        // Se não encontrou correspondência exata
        console.log(`Rota não encontrada no mapeamento: ${serverPath}`);
        return null;

    } catch (error) {
        console.error('Erro ao ler path-mapping.json:', error);
        return null;
    }
}
