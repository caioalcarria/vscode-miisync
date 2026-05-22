import { ConfigurationChangeEvent, EventEmitter, workspace } from "vscode";
import { EXTENSION_SETTINGS } from "../constants";

export interface ExtensionSettings {
    sessionDuration: number,
    refreshSession: boolean,
    requestLimit: number,
    showDiffNotification: boolean,
    gitCommitOnUpload: 'disabled' | 'ask' | 'always'
}

const defaultSettings: ExtensionSettings = {
    sessionDuration: 60,
    refreshSession: true,
    requestLimit: 40,
    showDiffNotification: true,
    gitCommitOnUpload: 'ask'
}

class SettingsManager {
    private settings: ExtensionSettings;
    public onSettingsChange: EventEmitter<ExtensionSettings> = new EventEmitter();
    
    public get Settings() {
        return { ...this.settings };
    }

    constructor() {
        const config = workspace.getConfiguration(EXTENSION_SETTINGS);

        this.settings = {
            ...defaultSettings,
            ...{
                sessionDuration: config.get('sessionDuration'),
                refreshSession: config.get('refreshSession'),
                requestLimit: config.get('requestLimit'),
                showDiffNotification: config.get('showDiffNotification'),
                gitCommitOnUpload: config.get('gitCommitOnUpload')
            }
        }
    }

    updateSettings(event: ConfigurationChangeEvent) {
        const config = workspace.getConfiguration(EXTENSION_SETTINGS);

        let changed = false;
        for (const key in this.settings) {
            if (event.affectsConfiguration(EXTENSION_SETTINGS + "." + key) && Object.prototype.hasOwnProperty.call(this.settings, key)) {
                this.settings[key] = config.get(key, defaultSettings[key]);
                changed = true;
            }
        }
        if(changed){
            this.onSettingsChange.fire(this.Settings);
        }
    }
}



export const settingsManager = new SettingsManager();