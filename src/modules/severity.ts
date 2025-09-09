import * as path from 'path';
import { Uri, window } from "vscode";
import { Severity, System, UserConfig } from "../extension/system";
import { DoesFileExist, DoesFolderExist } from "../transfer/gate";
import { ComplexFolder } from "../types/miisync";
import { GetRemotePath, GetRemotePathWithMapping } from "./file";

export enum SeverityOperation { 'upload', 'download', 'delete', 'transfer' };
type SimpleAction = (message: string) => Promise<boolean>;
type ComplexAction = { file: SimpleAction, newFile?: SimpleAction, folder: SimpleAction, newFolder?: SimpleAction };
interface SeverityHandler {
    [SeverityOperation.upload]: SimpleAction | ComplexAction,
    [SeverityOperation.download]: SimpleAction | ComplexAction,
    [SeverityOperation.delete]: SimpleAction | ComplexAction,
    [SeverityOperation.transfer]: SimpleAction | ComplexAction
}
const SeverityHandlers: { [key: string]: SeverityHandler } = {
    [Severity.low]: {
        [SeverityOperation.upload]: ShowNothing,
        [SeverityOperation.download]: ShowNothing,
        [SeverityOperation.delete]: ShowNothing,
        [SeverityOperation.transfer]: ShowNothing,
    },
    [Severity.medium]: {
        [SeverityOperation.upload]: { file: ShowNothing, newFile: ShowSideConfirmation, folder: ShowNothing, newFolder: ShowSideConfirmation },
        [SeverityOperation.download]: ShowNothing,
        [SeverityOperation.delete]: ShowSideConfirmation,
        [SeverityOperation.transfer]: ShowNothing,
    },
    [Severity.high]: {
        [SeverityOperation.upload]: ShowSideConfirmation,
        [SeverityOperation.download]: ShowNothing,
        [SeverityOperation.delete]: ShowSideConfirmation,
        [SeverityOperation.transfer]: ShowSideConfirmation,
    },
    [Severity.critical]: {
        [SeverityOperation.upload]: { file: ShowSideConfirmation, folder: ShowModalConfirmation },
        [SeverityOperation.download]: ShowSideConfirmation,
        [SeverityOperation.delete]: ShowModalConfirmation,
        [SeverityOperation.transfer]: ShowModalConfirmation,
    }
}
const messages: { type: SeverityOperation, isNew: boolean, text: string }[] = [
    { type: SeverityOperation.upload, isNew: false, text: 'Are you sure you want to upload {0}?' },
    { type: SeverityOperation.upload, isNew: true, text: '{0} does not exist. Do you want to create it?' },
    { type: SeverityOperation.download, isNew: false, text: 'Are you sure you want to download {0}?' },
    { type: SeverityOperation.transfer, isNew: false, text: 'Are you sure you want to transfer {0}?' },
    { type: SeverityOperation.delete, isNew: false, text: 'Are you sure you want to delete {0} from system?' }
]


export async function CheckSeverity(folder: ComplexFolder, type: SeverityOperation, userConfig: UserConfig, system: System) {
    const rootPath = folder.isRemotePath ? folder.path : GetRemotePath(folder.path, userConfig);
    const rootFolder = path.basename(folder.path);

    const handler = SeverityHandlers[system.severity];
    const handlerType = handler[type];

    let text = constructMessage({ name: "selection" }, system, type);
    if ("folder" in handlerType) {
        if (handlerType.newFolder) {
            const rootExists = await DoesFolderExist(rootPath, system);
            if (!rootExists) {
                text = constructMessage({ name: rootFolder, isNew: !rootExists }, system, type);
                return await handlerType.newFolder(text);
            }
        }
        return await handlerType.folder(text);
    }
    else {
        return await handlerType(text);
    }
}

export async function CheckSeverityFile(uri: Uri, type: SeverityOperation, userConfig: UserConfig, system: System) {
    const remotePath = GetRemotePath(uri.fsPath, userConfig);
    const name = path.basename(uri.fsPath);

    // Para upload, usa nossa confirmação personalizada que mostra o caminho
    if (type === SeverityOperation.upload) {
        // Verifica se precisa de confirmação baseado na severidade
        const handler = SeverityHandlers[system.severity];
        const handlerType = handler[type];
        
        // Se é low severity, não mostra confirmação
        if (handlerType === ShowNothing) {
            return true;
        }
        
        // Para outras severidades, usa nossa confirmação personalizada
        return await ShowUploadConfirmationWithPath(uri.fsPath, userConfig, system);
    }

    // Para outras operações, usa o sistema original
    const handler = SeverityHandlers[system.severity];
    const handlerType = handler[type];

    let text = constructMessage({ name }, system, type);
    if ("file" in handlerType) {
        if (handlerType.newFile) {
            const fileExist = await DoesFileExist(remotePath, system);
            text = constructMessage({ name, isNew: !fileExist }, system, type);
            if (!fileExist) {
                return await handlerType.newFile(text);
            }
        }
        return await handlerType.file(text);
    }
    else {
        return await handlerType(text);
    }
}

export async function CheckSeverityFolder(uri: Uri, type: SeverityOperation, userConfig: UserConfig, system: System) {
    const remotePath = GetRemotePath(uri.fsPath, userConfig);
    const name = path.basename(uri.fsPath);

    // Para upload de pasta, usa nossa confirmação personalizada que mostra o caminho
    if (type === SeverityOperation.upload) {
        const handler = SeverityHandlers[system.severity];
        const handlerType = handler[type];
        
        // Se é low severity, não mostra confirmação
        if (handlerType === ShowNothing) {
            return true;
        }
        
        // Para outras severidades, usa nossa confirmação personalizada
        return await ShowUploadConfirmationWithPath(uri.fsPath, userConfig, system);
    }

    // Para outras operações, usa o sistema original
    const handler = SeverityHandlers[system.severity];
    const handlerType = handler[type];

    let text = constructMessage({ name }, system, type);
    if ("folder" in handlerType) {
        if (handlerType.newFolder) {
            const folderExist = await DoesFolderExist(remotePath, system);
            text = constructMessage({ name, isNew: !folderExist }, system, type);
            if (!folderExist) {
                return await handlerType.newFolder(text);
            }
        }
        return await handlerType.folder(text);
    }
    else {
        return await handlerType(text);
    }
}

function constructMessage({ name, isNew = false }: { name: string, isNew?: boolean }, system: System, type: SeverityOperation) {
    const message = messages.find((fMessage) => fMessage.type == type && fMessage.isNew == isNew);
    if (message) {
        return message.text.unicornFormat(name) + '\n Target: ' + system.name;
    }
    return "";
}

async function ShowNothing(message: string) {
    return true;
}

async function ShowModalConfirmation(message: string) {
    const confirmLabel = "Yes";
    const result = await window.showWarningMessage(message, { modal: true }, { title: confirmLabel });

    return (result != null && result.title === confirmLabel);
}

async function ShowSideConfirmation(message: string) {
    const confirmLabel = "Yes", cancelLabel = "No";
    const result = await window.showWarningMessage(message, { modal: false }, { title: confirmLabel }, { title: cancelLabel });

    return (result != null && result.title === confirmLabel);
}

/**
 * Confirmação personalizada para upload que mostra o caminho de destino
 */
async function ShowUploadConfirmationWithPath(filePath: string, userConfig: UserConfig, system: System) {
    try {
        const fileName = path.basename(filePath);
        const remotePath = await GetRemotePathWithMapping(filePath, userConfig);
        
        const action = await window.showInformationMessage(
            `🚀 Upload "${fileName}"`,
            { 
                detail: `Destino: ${remotePath}\nServidor: ${system.name}`, 
                modal: true 
            },
            "✅ Confirmar",
            "❌ Cancelar"
        );

        return action === "✅ Confirmar";
    } catch (error) {
        console.error('Erro ao obter caminho remoto para confirmação:', error);
        // Fallback para confirmação tradicional
        const message = `Are you sure you want to upload ${path.basename(filePath)}?\nTarget: ${system.name}`;
        return await ShowModalConfirmation(message);
    }
}
