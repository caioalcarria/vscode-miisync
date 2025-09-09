import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";
import { ModifiedFile } from "../ui/treeview/localprojectstree";
import { PathMappingManager } from "../modules/pathmapping";

/**
 * Comando para mostrar diferenças entre arquivo local e versão original
 */
export async function OnCommandShowFileDiff(uri: vscode.Uri, modifiedFile: ModifiedFile): Promise<void> {
    try {
        // Encontra o projeto (pasta com .miisync)
        const projectPath = await findProjectPath(uri.fsPath);
        if (!projectPath) {
            vscode.window.showWarningMessage("Não foi possível encontrar o projeto para este arquivo.");
            return;
        }

        // Cria arquivo temporário com conteúdo original
        const originalContent = await getOriginalFileContent(projectPath, modifiedFile.relativePath);
        if (!originalContent) {
            vscode.window.showWarningMessage("Não foi possível recuperar o conteúdo original do arquivo.");
            return;
        }

        const tempDir = path.join(projectPath, '.miisync', 'temp');
        await fs.ensureDir(tempDir);
        
        const originalTempPath = path.join(tempDir, `${path.basename(modifiedFile.fileName)}.original`);
        await fs.writeFile(originalTempPath, originalContent, 'utf8');

        // Cria URIs para comparação
        const originalUri = vscode.Uri.file(originalTempPath);
        const currentUri = vscode.Uri.file(modifiedFile.filePath);

        // Abre diff no VS Code
        await vscode.commands.executeCommand(
            'vscode.diff',
            originalUri,
            currentUri,
            `${modifiedFile.fileName} (Comparação)`,
            {
                preview: true,
                preserveFocus: false
            }
        );

        console.log(`📊 Diff aberto para: ${modifiedFile.fileName}`);

    } catch (error) {
        console.error("❌ Erro ao mostrar diff do arquivo:", error);
        vscode.window.showErrorMessage(`Erro ao mostrar diferenças para "${modifiedFile.fileName}".`);
    }
}

/**
 * Encontra o caminho do projeto (pasta com .miisync) para um arquivo
 */
async function findProjectPath(filePath: string): Promise<string | null> {
    let currentPath = path.dirname(filePath);
    
    while (currentPath !== path.dirname(currentPath)) {
        const miisyncPath = path.join(currentPath, '.miisync');
        if (await fs.pathExists(miisyncPath)) {
            return currentPath;
        }
        currentPath = path.dirname(currentPath);
    }
    
    return null;
}

/**
 * Recupera o conteúdo original do arquivo do backup local ou do servidor
 */
async function getOriginalFileContent(projectPath: string, relativePath: string): Promise<string | null> {
    try {
        // Primeiro tenta encontrar backup local
        const backupPath = path.join(projectPath, '.miisync', 'backup', relativePath);
        if (await fs.pathExists(backupPath)) {
            return await fs.readFile(backupPath, 'utf8');
        }

        // Se não tem backup, cria um vazio indicando que é arquivo novo
        return `// Arquivo novo - não existe versão original para comparação
// Este arquivo foi criado localmente e não existe no servidor

`;
    } catch (error) {
        console.error('❌ Erro ao recuperar conteúdo original:', error);
        return null;
    }
}
