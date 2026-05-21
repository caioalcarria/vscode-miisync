import * as vscode from 'vscode';
import { XMLParser } from 'fast-xml-parser';
import { MIIServer } from '../extension/system';
import { catalogService } from '../miiservice/catalogservice';
import logger from '../ui/logger';

export interface CatalogCategory {
    name: string;
    label: string;
    description: string;
    components: CatalogComponent[];
}

export interface CatalogComponent {
    name: string;
    label: string;
    description: string;
}

class ActionCatalog {
    private categories: CatalogCategory[] = [];

    private _onDidUpdate = new vscode.EventEmitter<CatalogCategory[]>();
    readonly onDidUpdate = this._onDidUpdate.event;

    getCategories(): CatalogCategory[] {
        return this.categories;
    }

    async loadFromServer(server: MIIServer): Promise<void> {
        try {
            const xml = await catalogService.call(server);
            if (!xml) return;
            this.categories = this.parseCatalogXml(xml);
            this._onDidUpdate.fire(this.categories);
            logger.info(`Loaded ${this.categories.length} action categories from server`);
        } catch (e) {
            logger.error('Failed to load action catalog: ' + e);
        }
    }

    private parseCatalogXml(xml: string): CatalogCategory[] {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
        });
        const doc = parser.parse(xml);
        const catalog = doc?.ComponentCatalog;
        if (!catalog) return [];

        const rawCategories = Array.isArray(catalog.Category)
            ? catalog.Category
            : catalog.Category ? [catalog.Category] : [];

        return rawCategories.map((cat: any) => {
            const components = Array.isArray(cat.Component)
                ? cat.Component
                : cat.Component ? [cat.Component] : [];
            return {
                name: cat['@_Name'] || '',
                label: cat['@_Label'] || '',
                description: cat['@_Description'] || '',
                components: components.map((comp: any) => ({
                    name: comp['@_Name'] || '',
                    label: comp['@_Label'] || '',
                    description: comp['@_Description'] || '',
                })),
            };
        });
    }

    dispose() {
        this._onDidUpdate.dispose();
    }
}

export const actionCatalog = new ActionCatalog();
