import {
  SettingItem,
  miiSyncSettingsProvider,
} from "../ui/treeview/miisyncSettings";

/**
 * Comando para editar uma configuração específica
 */
export async function OnCommandEditSetting(
  setting: SettingItem
): Promise<void> {
  await miiSyncSettingsProvider.editSetting(setting);
}
