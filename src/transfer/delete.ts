import * as path from 'path';
import { Uri } from "vscode";
import * as fs from 'fs';
import { System, UserConfig } from "../extension/system";
import { IsFatalResponse } from '../miiservice/abstract/filters';
import { blowoutService } from "../miiservice/blowoutservice";
import { deleteBatchService } from "../miiservice/deletebatchservice";
import { GetRemotePathWithMapping, PrepareUrisForService } from "../modules/file";
import { CheckSeverity, CheckSeverityFolder, SeverityOperation } from '../modules/severity';
import { ActionReturn, ActionType, StartAction } from './action';
import { DoesFileExist, DoesFolderExist, Validate } from "./gate";
import { DeleteComplexLimited } from './limited/deletecomplex';


export async function DeleteFile(uri: Uri, userConfig: UserConfig, system: System) {
    if (!await Validate(userConfig, { system, localPath: uri.fsPath })) {
        return false;
    }
    const fileName = path.basename(uri.fsPath);
    const deleteR = async (): Promise<ActionReturn> => {
        const sourcePath = await GetRemotePathWithMapping(uri.fsPath, userConfig);
        if (!sourcePath) {
            return { aborted: true, error: true, message: "Could not determine remote path for " + fileName };
        }
        if (!await DoesFileExist(sourcePath, system)) {
            return { aborted: true, error: true, message: fileName + " doesn't exist" };
        }

        // Deletar do servidor primeiro
        const response = await deleteBatchService.call(system, sourcePath);
        if (!response) return { aborted: true };
        if (!IsFatalResponse(response)) {
            await blowoutService.call(system, sourcePath);
            
            // Após sucesso no servidor, deletar localmente também
            try {
                if (fs.existsSync(uri.fsPath)) {
                    fs.unlinkSync(uri.fsPath);
                }
            } catch (error) {
                // Se falhar a deleção local, apenas log, não aborta a operação
                console.log(`Erro ao deletar arquivo local: ${error}`);
            }
            
            return { aborted: false };
        }
        return { aborted: true, error: true, message: response.Rowsets.FatalError };
    }
    StartAction(ActionType.delete, { name: "Delete File", resource: fileName, system }, { isSimple: true }, deleteR);
}
export async function DeleteFolder(uri: Uri, userConfig: UserConfig, system: System) {
    if (!await Validate(userConfig, { system, localPath: uri.fsPath })) {
        return false;
    }
    const folderName = path.basename(uri.fsPath);
    const deleteR = async (): Promise<ActionReturn> => {
        const sourcePath = await GetRemotePathWithMapping(uri.fsPath, userConfig);
        if (!sourcePath) {
            return { aborted: true, error: true, message: "Could not determine remote path for " + folderName };
        }
        if (!await DoesFolderExist(sourcePath, system)) {
            return { aborted: true, error: true, message: folderName + " doesn't exist" };
        }

        // Deletar do servidor primeiro
        const response = await deleteBatchService.call(system, sourcePath);
        if (!response) return { aborted: true };
        if (!IsFatalResponse(response)) {
            await blowoutService.call(system, sourcePath);
            
            // Após sucesso no servidor, deletar pasta localmente também
            try {
                if (fs.existsSync(uri.fsPath)) {
                    fs.rmSync(uri.fsPath, { recursive: true, force: true });
                }
            } catch (error) {
                // Se falhar a deleção local, apenas log, não aborta a operação
                console.log(`Erro ao deletar pasta local: ${error}`);
            }
            
            return { aborted: false };
        }
        return { aborted: true, error: true, message: response.Rowsets.FatalError };
    };
    StartAction(ActionType.delete, { name: "Delete Folder", resource: folderName, system }, { isSimple: false }, deleteR);
}

/**
 * Uses Limited
 */
export async function DeleteUris(uris: Uri[], userConfig: UserConfig, system: System, processName: string) {
    const deleteR = async (): Promise<ActionReturn> => {
        const folder = await PrepareUrisForService(uris);
        if (!await CheckSeverity(folder, SeverityOperation.delete, userConfig, system)) return { aborted: true };;
        const response = await DeleteComplexLimited(folder, userConfig, system);
        return { aborted: response.aborted };
    };
    StartAction(ActionType.delete, { name: processName, system }, { isSimple: false }, deleteR);

}