import { XMLParser, XMLBuilder } from 'fast-xml-parser';

export interface TrxData {
    name: string;
    version: string;
    attributes: Record<string, string>;
    context: TrxVar[];
    local: TrxVar[];
    steps: TrxStep[];
    actionDefs: Record<string, string>;  // name → xsi:type
    actionProps: Record<string, Record<string, any>>; // name → raw properties
}

export interface TrxVar {
    name: string;
    description: string;
    type: string;
    readOnly: boolean;
}

export interface TrxStep {
    name: string;
    type: string;  // ActionSequence | Conditional | ForNextRepeater | WhileRepeater | ...
    description: string;
    steps: TrxStep[];
    actions: TrxActionRef[];
}

export interface TrxActionRef {
    name: string;
    description: string;
    incoming: TrxLink[];
    outgoing: TrxLink[];
}

export interface TrxLink {
    from: string;
    to: string;
    type: string; // Assign | AssignXml
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
}

function str(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'object' && v !== null && '#text' in v) return String((v as Record<string, unknown>)['#text'] ?? '');
    return String(v);
}

export function parseTrx(xml: string): TrxData | null {
    try {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            textNodeName: '#text',
            isArray: (name) => ['ContextItem', 'Step', 'Action', 'Assign'].includes(name),
            processEntities: { maxTotalExpansions: 50000, maxEntityCount: 50000 },
        });

        const doc = parser.parse(xml);
        const tx = doc?.Transaction;
        if (!tx) return null;

        // Metadata attributes
        const attributes: Record<string, string> = {};
        for (const item of asArray(tx.TransactionAttributes?.ContextItem)) {
            const name = str(item.Name);
            const val = item.Value;
            attributes[name] = val == null ? '' : (typeof val === 'object' ? str(val) : String(val));
        }

        const parseVar = (item: Record<string, unknown>): TrxVar => ({
            name: str(item.Name),
            description: str(item.Description),
            type: (item.Value as Record<string, unknown>)?.['@_xsi:type'] as string || 'string',
            readOnly: str(item.ReadOnly) === 'true',
        });

        const context = asArray<Record<string, unknown>>(tx.Context?.ContextItem).map(parseVar);
        const local = asArray<Record<string, unknown>>(tx.Local?.ContextItem).map(parseVar);

        const actionDefs: Record<string, string> = {};
        const actionProps: Record<string, Record<string, any>> = {};
        for (const item of asArray(tx.Actions?.ContextItem)) {
            const name = str(item.Name);
            const val = item.Value as Record<string, unknown> ?? {};
            const type = val['@_xsi:type'] as string || 'Unknown';
            actionDefs[name] = type;
            // Store all properties except the xsi:type discriminator
            const props: Record<string, any> = {};
            for (const [k, v] of Object.entries(val)) {
                if (k !== '@_xsi:type') props[k] = v;
            }
            actionProps[name] = props;
        }

        const steps = asArray(tx.Steps?.Step).map(parseStep);

        return {
            name: str(tx.Name),
            version: str(tx.Version),
            attributes,
            context,
            local,
            steps,
            actionDefs,
            actionProps,
        };
    } catch (e: any) {
        console.error('[MiiSync] parseTrx exception:', e);
        throw new Error(`TRX parse failed: ${e?.message || String(e)}`);
    }
}

function parseStep(s: Record<string, unknown>): TrxStep {
    const stepsNode = s.Steps as Record<string, unknown> | undefined;
    const actionsNode = s.Actions as Record<string, unknown> | undefined;
    return {
        type: s['@_xsi:type'] as string || 'ActionSequence',
        name: str(s.Name),
        description: str(s.Description),
        steps: asArray(stepsNode?.Step as Record<string, unknown>[]).map(parseStep),
        actions: asArray(actionsNode?.Action as Record<string, unknown>[]).map(parseActionRef),
    };
}

function parseActionRef(a: Record<string, unknown>): TrxActionRef {
    const inNode = a.IncomingLinks as Record<string, unknown> | undefined;
    const outNode = a.OutgoingLinks as Record<string, unknown> | undefined;
    return {
        name: str(a.Name),
        description: str(a.Description),
        incoming: asArray(inNode?.Assign as Record<string, unknown>[]).map(parseLink),
        outgoing: asArray(outNode?.Assign as Record<string, unknown>[]).map(parseLink),
    };
}

function parseLink(l: Record<string, unknown>): TrxLink {
    return {
        from: str(l.From),
        to: str(l.To),
        type: l['@_xsi:type'] as string || 'Assign',
    };
}

// ─── Raw XML round-trip (for editing) ────────────────────────────────────────

const RAW_PARSER_OPTIONS = {
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: (name: string) => ['ContextItem', 'Step', 'Action', 'Assign'].includes(name),
};

export function parseRawTrx(xml: string): any {
    const parser = new XMLParser(RAW_PARSER_OPTIONS);
    return parser.parse(xml);
}

export function buildTrxXml(obj: any): string {
    const builder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        format: true,
        indentBy: '  ',
        suppressEmptyNode: false,
    });
    let xml: string = builder.build(obj);
    if (!xml.startsWith('<?xml')) {
        xml = '<?xml version="1.0" encoding="UTF-8"?>' + xml;
    }
    return xml;
}

// Navigate to a step in the raw parsed object using a path of indices
function navigateToStep(rawObj: any, path: number[]): any {
    let current = rawObj?.Transaction?.Steps;
    for (let i = 0; i < path.length; i++) {
        const steps = current?.Step;
        if (!steps || !steps[path[i]]) return null;
        current = steps[path[i]];
        if (i < path.length - 1) {
            current = current.Steps;
        }
    }
    return current;
}

function navigateToParentSteps(rawObj: any, path: number[]): any {
    if (path.length === 0) return null;
    if (path.length === 1) return rawObj?.Transaction?.Steps;
    return navigateToStep(rawObj, path.slice(0, -1))?.Steps;
}

function collectAllStepNames(rawObj: any): Set<string> {
    const names = new Set<string>();
    function walk(stepsNode: any) {
        for (const step of asArray(stepsNode?.Step)) {
            if (step.Name) names.add(String(step.Name));
            walk(step.Steps);
        }
    }
    walk(rawObj?.Transaction?.Steps);
    return names;
}

function generateUniqueName(rawObj: any, prefix = 'Sequence'): string {
    const existing = collectAllStepNames(rawObj);
    for (let i = 0; ; i++) {
        const name = `${prefix}_${i}`;
        if (!existing.has(name)) return name;
    }
}

function collectAllActionNames(rawObj: any): Set<string> {
    const names = new Set<string>();
    for (const item of asArray(rawObj?.Transaction?.Actions?.ContextItem)) {
        if (item.Name) names.add(String(item.Name));
    }
    return names;
}

function generateUniqueActionName(rawObj: any, baseName: string): string {
    const existing = collectAllActionNames(rawObj);
    if (!existing.has(baseName)) return baseName;
    for (let i = 0; ; i++) {
        const name = `${baseName}_${i}`;
        if (!existing.has(name)) return name;
    }
}

const DEFAULT_ACTION_VALUES: Record<string, any> = {
    Tracer: { '@_xsi:type': 'Tracer', Message: '', Level: 'INFO' },
    XmlTracer: { '@_xsi:type': 'XmlTracer', Message: '', Level: 'INFO' },
    EventLogger: { '@_xsi:type': 'EventLogger', Message: '', Level: 'INFO' },
    Assignment: { '@_xsi:type': 'Assignment' },
    ConditionalAction: { '@_xsi:type': 'ConditionalAction', Output: 'false', InputCount: '1', LogicalAnd: 'false', Input1: 'false' },
    Throw: { '@_xsi:type': 'Throw' },
    CatchAction: { '@_xsi:type': 'CatchAction' },
    ExceptionEnabler: { '@_xsi:type': 'ExceptionEnabler' },
    TerminateTransaction: { '@_xsi:type': 'TerminateTransaction' },
    TransactionCall: { '@_xsi:type': 'TransactionCall', TransactionPath: '' },
    DynamicTransactionCall: { '@_xsi:type': 'DynamicTransactionCall' },
    Pause: { '@_xsi:type': 'Pause', Delay: '1000' },
    ForNextRepeaterAction: { '@_xsi:type': 'ForNextRepeaterAction' },
    WhileRepeaterAction: { '@_xsi:type': 'WhileRepeaterAction' },
    IteratorAction: { '@_xsi:type': 'IteratorAction' },
    RepeaterAction: { '@_xsi:type': 'RepeaterAction' },
    SwitcherAction: { '@_xsi:type': 'SwitcherAction' },
};

export function addSequenceToRawTrx(xml: string, parentPath: number[], position: 'below' | 'parent'): string {
    const rawObj = parseRawTrx(xml);
    const name = generateUniqueName(rawObj);

    if (position === 'below') {
        const parentSteps = navigateToParentSteps(rawObj, parentPath);
        if (!parentSteps) return xml;
        if (!parentSteps.Step) parentSteps.Step = [];
        const idx = parentPath[parentPath.length - 1];
        parentSteps.Step.splice(idx + 1, 0, {
            '@_xsi:type': 'ActionSequence',
            Name: name,
            Description: '',
            Steps: '',
            Actions: '',
        });
    } else {
        // Wrap selected step in a new parent ActionSequence
        const parentSteps = navigateToParentSteps(rawObj, parentPath);
        if (!parentSteps?.Step) return xml;
        const idx = parentPath[parentPath.length - 1];
        const existingStep = parentSteps.Step[idx];
        parentSteps.Step[idx] = {
            '@_xsi:type': 'ActionSequence',
            Name: name,
            Description: '',
            Steps: { Step: [existingStep] },
            Actions: '',
        };
    }

    return buildTrxXml(rawObj);
}

export function addActionToRawTrx(xml: string, stepPath: number[], actionType: string, actionLabel: string): string {
    const rawObj = parseRawTrx(xml);
    const step = navigateToStep(rawObj, stepPath);
    if (!step) return xml;

    const actionName = generateUniqueActionName(rawObj, actionLabel || actionType);

    // Add action reference to step
    if (!step.Actions) step.Actions = {};
    if (!step.Actions.Action) step.Actions.Action = [];
    step.Actions.Action.push({
        Name: actionName,
        Description: ' ',
        IncomingLinks: '',
        OutgoingLinks: '',
    });

    // Add action definition to Transaction.Actions
    if (!rawObj.Transaction.Actions) rawObj.Transaction.Actions = {};
    if (!rawObj.Transaction.Actions.ContextItem) rawObj.Transaction.Actions.ContextItem = [];
    const defaultValue = DEFAULT_ACTION_VALUES[actionType]
        ? { ...DEFAULT_ACTION_VALUES[actionType] }
        : { '@_xsi:type': actionType };

    rawObj.Transaction.Actions.ContextItem.push({
        Name: actionName,
        Description: '',
        MinRange: '0',
        MaxRange: '0',
        Value: defaultValue,
        ReadOnly: 'false',
        AlertXMLAssigned: 'false',
    });

    return buildTrxXml(rawObj);
}

export function deleteActionFromRawTrx(xml: string, stepPath: number[], actionName: string): string {
    const rawObj = parseRawTrx(xml);
    const step = navigateToStep(rawObj, stepPath);
    if (!step) return xml;

    const actions = step.Actions?.Action;
    if (Array.isArray(actions)) {
        step.Actions.Action = actions.filter((a: any) => String(a.Name) !== actionName);
        if (step.Actions.Action.length === 0) step.Actions = '';
    }

    // Remove global action definition if no longer used anywhere
    if (countActionUsages(rawObj, actionName) === 0) {
        const contextItems = rawObj.Transaction.Actions?.ContextItem;
        if (Array.isArray(contextItems)) {
            rawObj.Transaction.Actions.ContextItem = contextItems.filter(
                (item: any) => String(item.Name) !== actionName
            );
        }
    }

    return buildTrxXml(rawObj);
}

function countActionUsages(rawObj: any, actionName: string): number {
    let count = 0;
    function walkSteps(stepsNode: any) {
        for (const step of asArray(stepsNode?.Step)) {
            for (const action of asArray(step.Actions?.Action)) {
                if (String(action.Name) === actionName) count++;
            }
            walkSteps(step.Steps);
        }
    }
    walkSteps(rawObj?.Transaction?.Steps);
    return count;
}

export function deleteSequenceFromRawTrx(xml: string, stepPath: number[]): string {
    const rawObj = parseRawTrx(xml);
    if (stepPath.length === 0) return xml;

    const parentSteps = navigateToParentSteps(rawObj, stepPath);
    if (!parentSteps?.Step) return xml;

    const idx = stepPath[stepPath.length - 1];
    if (idx < 0 || idx >= parentSteps.Step.length) return xml;

    parentSteps.Step.splice(idx, 1);
    if (parentSteps.Step.length === 0) {
        delete parentSteps.Step;
    }

    return buildTrxXml(rawObj);
}
