import * as vscode from 'vscode';
import { LocalProject, ServerDifference, ServerDiffType } from '../ui/treeview/localprojectstree';

/**
 * Comando para mostrar diferenças do servidor em uma interface dedicada
 */
export async function OnCommandShowServerDifferences(project: LocalProject): Promise<void> {
    if (!project.serverVerification || !project.serverVerification.differences.length) {
        vscode.window.showInformationMessage('❌ Nenhuma diferença encontrada para este projeto.');
        return;
    }

    const differences = project.serverVerification.differences;
    
    // Cria painel de informações detalhadas
    const panel = vscode.window.createWebviewPanel(
        'serverDifferences',
        `🔍 Diferenças: ${project.name}`,
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            enableCommandUris: true,
            retainContextWhenHidden: true
        }
    );

    panel.webview.html = generateDifferencesHTML(project, differences);
}

/**
 * Gera HTML para exibir as diferenças
 */
function generateDifferencesHTML(project: LocalProject, differences: ServerDifference[]): string {
    const lastChecked = project.serverVerification?.lastChecked?.toLocaleString() || 'Desconhecido';
    
    // Agrupa diferenças por tipo
    const grouped = {
        localNewer: differences.filter(d => d.diffType === ServerDiffType.LocalNewer),
        serverNewer: differences.filter(d => d.diffType === ServerDiffType.ServerNewer),
        onlyLocal: differences.filter(d => d.diffType === ServerDiffType.OnlyInLocal),
        onlyServer: differences.filter(d => d.diffType === ServerDiffType.OnlyInServer),
        different: differences.filter(d => d.diffType === ServerDiffType.Different)
    };

    let content = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Diferenças do Servidor</title>
        <style>
            body { 
                font-family: var(--vscode-font-family); 
                color: var(--vscode-foreground);
                background: var(--vscode-editor-background);
                padding: 20px;
                line-height: 1.6;
            }
            .header {
                border-bottom: 2px solid var(--vscode-panel-border);
                padding-bottom: 15px;
                margin-bottom: 20px;
            }
            .project-info {
                background: var(--vscode-textBlockQuote-background);
                padding: 15px;
                border-radius: 5px;
                margin-bottom: 20px;
                border-left: 4px solid var(--vscode-textLink-foreground);
            }
            .diff-section {
                margin-bottom: 25px;
                background: var(--vscode-editor-inactiveSelectionBackground);
                padding: 15px;
                border-radius: 5px;
            }
            .diff-title {
                font-weight: bold;
                font-size: 1.1em;
                margin-bottom: 10px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .diff-item {
                padding: 8px 12px;
                margin: 5px 0;
                border-radius: 3px;
                font-family: var(--vscode-editor-font-family);
                border-left: 3px solid;
            }
            .local-newer { 
                background: var(--vscode-diffEditor-insertedTextBackground);
                border-left-color: var(--vscode-gitDecoration-addedResourceForeground);
            }
            .server-newer { 
                background: var(--vscode-diffEditor-removedTextBackground);
                border-left-color: var(--vscode-gitDecoration-deletedResourceForeground);
            }
            .only-local { 
                background: var(--vscode-diffEditor-insertedLineBackground);
                border-left-color: var(--vscode-charts-blue);
            }
            .only-server { 
                background: var(--vscode-diffEditor-removedLineBackground);
                border-left-color: var(--vscode-charts-orange);
            }
            .different { 
                background: var(--vscode-diffEditor-diagonalFill);
                border-left-color: var(--vscode-charts-purple);
            }
            .file-path {
                font-weight: bold;
                color: var(--vscode-textLink-foreground);
            }
            .description {
                color: var(--vscode-descriptionForeground);
                margin-top: 5px;
            }
            .summary {
                background: var(--vscode-notifications-background);
                border: 1px solid var(--vscode-notifications-border);
                padding: 15px;
                border-radius: 5px;
                margin-bottom: 20px;
            }
            .icon { font-size: 1.2em; }
            .count { 
                background: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 0.9em;
                margin-left: 8px;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🔍 Diferenças do Servidor</h1>
            <div class="project-info">
                <strong>📂 Projeto:</strong> ${project.name}<br>
                <strong>📍 Local:</strong> ${project.localPath}<br>
                <strong>🌐 Servidor:</strong> ${project.remotePath}<br>
                <strong>🕒 Última verificação:</strong> ${lastChecked}<br>
                <strong>📊 Total de diferenças:</strong> ${differences.length}
            </div>
        </div>

        <div class="summary">
            <h3>📈 Resumo</h3>
            <p>Foram encontradas <strong>${differences.length}</strong> diferenças entre o projeto local e o servidor:</p>
            <ul>
                <li><span class="icon">🔼</span> ${grouped.localNewer.length} arquivo(s) local mais recente</li>
                <li><span class="icon">🔽</span> ${grouped.serverNewer.length} arquivo(s) servidor mais recente</li>
                <li><span class="icon">➕</span> ${grouped.onlyLocal.length} arquivo(s) apenas local</li>
                <li><span class="icon">➖</span> ${grouped.onlyServer.length} arquivo(s) apenas servidor</li>
                <li><span class="icon">⚖️</span> ${grouped.different.length} arquivo(s) com conteúdos diferentes</li>
            </ul>
        </div>
    `;

    // Adiciona seções para cada tipo de diferença
    if (grouped.localNewer.length > 0) {
        content += generateDiffSection(
            "🔼 Local Mais Recente", 
            "local-newer",
            grouped.localNewer,
            "Estes arquivos foram modificados localmente após a última versão do servidor. Considere fazer upload."
        );
    }

    if (grouped.serverNewer.length > 0) {
        content += generateDiffSection(
            "🔽 Servidor Mais Recente", 
            "server-newer",
            grouped.serverNewer,
            "Estes arquivos foram atualizados no servidor. Considere fazer download."
        );
    }

    if (grouped.onlyLocal.length > 0) {
        content += generateDiffSection(
            "➕ Apenas Local", 
            "only-local",
            grouped.onlyLocal,
            "Estes arquivos existem apenas localmente. Considere fazer upload se devem estar no servidor."
        );
    }

    if (grouped.onlyServer.length > 0) {
        content += generateDiffSection(
            "➖ Apenas Servidor", 
            "only-server",
            grouped.onlyServer,
            "Estes arquivos existem apenas no servidor. Considere fazer download se devem estar localmente."
        );
    }

    if (grouped.different.length > 0) {
        content += generateDiffSection(
            "⚖️ Conteúdos Diferentes", 
            "different",
            grouped.different,
            "Estes arquivos têm conteúdos diferentes apesar de timestamps similares. Verificação manual necessária."
        );
    }

    content += `
        </body>
    </html>
    `;

    return content;
}

/**
 * Gera seção HTML para um tipo específico de diferença
 */
function generateDiffSection(title: string, cssClass: string, differences: ServerDifference[], description: string): string {
    const count = differences.length;
    
    let section = `
        <div class="diff-section">
            <div class="diff-title">
                ${title}
                <span class="count">${count}</span>
            </div>
            <p style="margin-bottom: 15px; color: var(--vscode-descriptionForeground);">${description}</p>
    `;

    differences.forEach(diff => {
        const localTime = diff.localModified ? diff.localModified.toLocaleString() : 'N/A';
        const serverTime = diff.serverModified ? diff.serverModified.toLocaleString() : 'N/A';
        
        section += `
            <div class="diff-item ${cssClass}">
                <div class="file-path">${diff.relativePath}</div>
                <div class="description">
                    ${diff.description}
                    ${diff.localModified || diff.serverModified ? 
                        `<br><small>Local: ${localTime} | Servidor: ${serverTime}</small>` : 
                        ''
                    }
                </div>
            </div>
        `;
    });

    section += `</div>`;
    return section;
}
