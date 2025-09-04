import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
import VisualObjectInstanceEnumeration = powerbi.VisualObjectInstanceEnumeration;
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualObjectInstance = powerbi.VisualObjectInstance;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import FilterAction = powerbi.FilterAction;

import * as models from "powerbi-models";
// Use the vendor parser (CommonJS) and our flexible filter builder
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parser: any = require('./vendor/queryParser');
import { buildFlexibleFilters } from './flexibleFilter';

interface SearchSettings {
    placeholder?: string;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private inputEl: HTMLInputElement;
    private clearBtn: HTMLButtonElement; // deprecated UI; keep reference but not rendered
    private inputClearBtn?: HTMLButtonElement;
    private chipsContainer?: HTMLDivElement;
    private chips: { id: string; raw: string; parsed: any; display: string; color?: string; fixed?: boolean; blocked?: boolean }[] = [];
    private filterView: HTMLTextAreaElement;
    private filterSectionEl?: HTMLDivElement;
    private copyFilterBtn: HTMLButtonElement;
    private toggleFilterBtn: HTMLButtonElement;
    private logArea: HTMLTextAreaElement;
    private logSectionEl?: HTMLDivElement;
    private copyLogBtn: HTMLButtonElement;
    private clearLogBtn: HTMLButtonElement;
    private filterResizer?: HTMLDivElement;
    private logs: string[] = [];
    private currentFilter?: models.IBasicFilter;
    private categoryColumnQueryRef?: string;
    private filterTarget?: models.IFilterTarget;
    private settings: SearchSettings = {};
    private measureQueryRaw?: string;
    private measureQueryParsed?: any;
    // Performance: debounce and skip duplicate apply
    private applyTimer?: number;
    private lastAppliedKey?: string;
    private lastAppliedJson: any | null = null;
    private showFilterJsonVisible = false;
    private showLogVisible = false;
    private lastStateKey?: string;
    private lastQueryRef?: string;
    private lastMeasureText?: string;
    // Limits / guardrails
    private allowMeasureChip = true;
    private maxQueryLength = 500; // characters
    private maxTokens = 100; // token count
    private maxClauses = 50; // leaf conditions
    private lastGuardReason?: string;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
    this.target = document.createElement("div");
    this.target.className = "visual-container";
    this.inputEl = document.createElement("input");
        this.inputEl.type = "text";
    this.inputEl.placeholder = "Enter keyword and press Enter";
    // Do not auto-apply while typing; only act on Enter key
        // Add on Enter: add as chip
        this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const raw = (this.inputEl.value || '').trim();
                if (raw) {
                    this.addChip(raw);
                    this.inputEl.value = '';
                }
            }
        });
    this.clearBtn = document.createElement("button");
    // Not appended anymore; replaced by inline X button

    // Controls row
    const controls = document.createElement("div");
    controls.className = "controls";
    // Wrap input to position inline search and clear buttons
    const inputWrap = document.createElement("div");
    inputWrap.className = "input-wrap";
    // Left search icon (decorative)
    const inputIcon = document.createElement('span');
    inputIcon.className = 'input-icon';
    // Inline SVG magnifying glass
    const svgNS = 'http://www.w3.org/2000/svg';
    const searchSvg = document.createElementNS(svgNS, 'svg');
    searchSvg.setAttribute('viewBox', '0 0 16 16');
    searchSvg.setAttribute('width', '14');
    searchSvg.setAttribute('height', '14');
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', '7');
    circle.setAttribute('cy', '7');
    circle.setAttribute('r', '5');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', '#6b7280');
    circle.setAttribute('stroke-width', '1.5');
    const handle = document.createElementNS(svgNS, 'line');
    handle.setAttribute('x1', '10.5');
    handle.setAttribute('y1', '10.5');
    handle.setAttribute('x2', '14');
    handle.setAttribute('y2', '14');
    handle.setAttribute('stroke', '#6b7280');
    handle.setAttribute('stroke-width', '1.5');
    handle.setAttribute('stroke-linecap', 'round');
    searchSvg.appendChild(circle);
    searchSvg.appendChild(handle);
    inputIcon.appendChild(searchSvg);
    inputIcon.setAttribute('aria-hidden', 'true');
    inputWrap.appendChild(inputIcon);
    inputWrap.appendChild(this.inputEl);
    this.inputClearBtn = document.createElement("button");
    this.inputClearBtn.type = "button";
    this.inputClearBtn.className = "input-clear";
    this.inputClearBtn.title = "Clear all queries";
    this.inputClearBtn.innerHTML = "&times;";
    this.inputClearBtn.addEventListener("click", this.onClearClick);
    inputWrap.appendChild(this.inputClearBtn);
    controls.appendChild(inputWrap);

    // Chips area under input
    const chipsSection = document.createElement("div");
    chipsSection.className = "chips-section";
    this.chipsContainer = document.createElement("div") as HTMLDivElement;
    this.chipsContainer.className = "chips";
    chipsSection.appendChild(this.chipsContainer);

    // Filter JSON display
    const filterSection = document.createElement("div");
    filterSection.className = "filter-section";
    this.filterSectionEl = filterSection;
    // Header with title and copy action, matching log section layout
    const filterHeader = document.createElement("div");
    filterHeader.className = "section-title with-action";
    const filterTitleSpan = document.createElement("span");
    filterTitleSpan.textContent = "Applied filter JSON";
    // Expand/Collapse toggle
    this.toggleFilterBtn = document.createElement("button");
    this.toggleFilterBtn.type = "button";
    this.toggleFilterBtn.className = "toggle-section";
    this.toggleFilterBtn.textContent = "Collapse";
    this.toggleFilterBtn.addEventListener("click", () => this.toggleSection(filterSection, this.toggleFilterBtn));
    // Add copy button for the JSON
    this.copyFilterBtn = document.createElement("button");
    this.copyFilterBtn.type = "button";
    this.copyFilterBtn.textContent = "Copy JSON";
    this.copyFilterBtn.className = "copy-json";
    this.copyFilterBtn.addEventListener("click", this.onCopyFilterJson);
    filterHeader.appendChild(filterTitleSpan);
    filterHeader.appendChild(this.toggleFilterBtn);
    filterHeader.appendChild(this.copyFilterBtn);
    // Use a resizable textarea so the user can control height and scroll independently
    this.filterView = document.createElement("textarea");
    this.filterView.className = "filter-area";
    this.filterView.readOnly = true;
    this.filterView.value = "(none)";
    // Add a custom resizer to guarantee resizing even if host CSS limits native handles
    this.filterResizer = document.createElement("div");
    this.filterResizer.className = "filter-resizer";
    this.attachVerticalResizer(this.filterResizer, this.filterView, 60);
    filterSection.appendChild(filterHeader);
    filterSection.appendChild(this.filterView);
    filterSection.appendChild(this.filterResizer);

    // Log area with copy button
    const logSection = document.createElement("div");
    logSection.className = "log-section";
    this.logSectionEl = logSection;
    const logHeader = document.createElement("div");
    logHeader.className = "section-title with-action";
    const logTitle = document.createElement("span");
    logTitle.textContent = "Log";
    const toggleLogBtn = document.createElement("button");
    toggleLogBtn.type = "button";
    toggleLogBtn.className = "toggle-section";
    toggleLogBtn.textContent = "Collapse";
    toggleLogBtn.addEventListener("click", () => this.toggleSection(logSection, toggleLogBtn));
    this.copyLogBtn = document.createElement("button");
    this.copyLogBtn.type = "button";
    this.copyLogBtn.textContent = "Copy Log";
    this.copyLogBtn.className = "copy-log";
    this.copyLogBtn.addEventListener("click", this.onCopyLog);
    this.clearLogBtn = document.createElement("button");
    this.clearLogBtn.type = "button";
    this.clearLogBtn.textContent = "Clear Log";
    this.clearLogBtn.className = "clear-log";
    this.clearLogBtn.addEventListener("click", this.onClearLog);
    logHeader.appendChild(logTitle);
    logHeader.appendChild(toggleLogBtn);
    logHeader.appendChild(this.copyLogBtn);
    logHeader.appendChild(this.clearLogBtn);
    this.logArea = document.createElement("textarea");
    this.logArea.className = "log-area";
    this.logArea.readOnly = true;
    this.logArea.value = "";
    // Disable internal scroll; outer container will scroll
    this.logArea.style.overflow = 'hidden';
    this.logArea.style.resize = 'none';
    logSection.appendChild(logHeader);
    logSection.appendChild(this.logArea);

    this.target.appendChild(controls);
    this.target.appendChild(chipsSection);
    this.target.appendChild(filterSection);
    this.target.appendChild(logSection);
        options.element.appendChild(this.target);

    this.log("Visual initialized");
    }

    private onSearchChange = (_ev: Event) => {
        // typing ignored; Enter key handler adds chip and triggers apply
    };

    private onClearClick = () => {
        this.inputEl.value = "";
        // Also clear chips if any
        if (this.chips.length) {
            this.chips = [];
            this.renderChips();
        }
        this.applyFilter("");
    };

    private onCopyLog = async () => {
        try {
            if (navigator && (navigator as any).clipboard && (navigator as any).clipboard.writeText) {
                await (navigator as any).clipboard.writeText(this.logArea.value);
                this.log("Log copied to clipboard");
            } else {
                // Fallback: select the text itself
                this.logArea.focus();
                this.logArea.select();
                this.log("Clipboard API unavailable; text selected for manual copy");
            }
        } catch (e) {
            this.log("Failed to copy log", e);
        }
    };

    private onCopyFilterJson = async () => {
        try {
            const text = this.filterView.value || "";
            if (navigator && (navigator as any).clipboard && (navigator as any).clipboard.writeText) {
                await (navigator as any).clipboard.writeText(text);
                this.log("Filter JSON copied to clipboard");
            } else {
                // Fallback: select the text so user can manually copy
                this.filterView.focus();
                this.filterView.select();
                this.log("Clipboard API unavailable; filter JSON selected for manual copy");
            }
        } catch (e) {
            this.log("Failed to copy filter JSON", e);
        }
    };

    private onClearLog = () => {
        this.logs = [];
        this.logArea.value = "";
        this.log("Log cleared");
    };

    public update(options: VisualUpdateOptions) {
    const dataView = options.dataViews && options.dataViews[0];
        if (!dataView) { return; }

        // Read placeholder from objects if present
        const objects = dataView.metadata && dataView.metadata.objects as any;
        if (objects && objects.search && objects.search.placeholder) {
            this.settings.placeholder = objects.search.placeholder as string;
            this.inputEl.placeholder = this.settings.placeholder || "Enter keyword and press Enter";
        }

    // Read limits from format pane if provided
    const limitsObj = (dataView.metadata && (dataView.metadata.objects as any) && (dataView.metadata.objects as any).limits) || {};
    if (typeof limitsObj.allowMeasureChip === 'boolean') this.allowMeasureChip = limitsObj.allowMeasureChip;
    if (typeof limitsObj.maxQueryLength === 'number' && limitsObj.maxQueryLength > 0) this.maxQueryLength = Math.floor(limitsObj.maxQueryLength);
    if (typeof limitsObj.maxTokens === 'number' && limitsObj.maxTokens > 0) this.maxTokens = Math.floor(limitsObj.maxTokens);
    if (typeof limitsObj.maxClauses === 'number' && limitsObj.maxClauses > 0) this.maxClauses = Math.floor(limitsObj.maxClauses);

    // Capture the bound category queryName to build a filter target
        const cat = dataView.categorical && dataView.categorical.categories && dataView.categorical.categories[0];
        if (cat && cat.source && cat.source.queryName) {
            const queryRef = cat.source.queryName;
            if (this.lastQueryRef !== queryRef) {
                this.lastQueryRef = queryRef;
                this.categoryColumnQueryRef = queryRef;
                this.filterTarget = this.buildFilterTarget(queryRef);
                this.log("Bound column queryRef detected", queryRef);
                if (this.filterTarget) {
                    this.log("Derived filter target", this.filterTarget);
                }
                // Target changed -> force re-apply path by invalidating state key
                this.lastStateKey = undefined;
            }
        }

    // Optional: read Search Query measure (first value)
        const values = dataView.categorical && dataView.categorical.values;
        let measureText: string | undefined;
        if (values && values.length > 0) {
            const v0: any = values[0];
            const arr: any[] = (v0 && v0.values) ? v0.values : [];
            if (arr && arr.length > 0 && arr[0] != null) {
                measureText = String(arr[0]);
            }
        }
        this.measureQueryRaw = measureText && String(measureText).length ? measureText : undefined;
        if (this.lastMeasureText !== this.measureQueryRaw) {
            this.lastMeasureText = this.measureQueryRaw;
            // Validate before parsing to avoid heavy work on huge strings
            const validated = this.validateAndParseMeasure(this.measureQueryRaw);
            this.measureQueryParsed = validated.parsed;
            this.lastGuardReason = validated.reason;
            // Invalidate state key so apply can reflect measure changes
            this.lastStateKey = undefined;
            // Sync a fixed measure chip for visibility and OR semantics
            this.syncMeasureChip();
        }

        // Display toggles: hide by default unless enabled in format pane
    const displayObj = (dataView.metadata && (dataView.metadata.objects as any) && (dataView.metadata.objects as any).display) || {};
    // Respect existing state unless user explicitly toggles
    const showFilterJson = typeof displayObj.showFilterJson === 'boolean' ? displayObj.showFilterJson : this.showFilterJsonVisible;
    const showLog = typeof displayObj.showLog === 'boolean' ? displayObj.showLog : this.showLogVisible;
        this.showFilterJsonVisible = showFilterJson;
        this.showLogVisible = showLog;
        this.setSectionVisibility(this.filterSectionEl, showFilterJson);
        this.setSectionVisibility(this.logSectionEl, showLog);
        // If sections became visible, refresh their contents without recomputing
        if (showFilterJson && this.filterSectionEl) {
            this.updateFilterView(this.lastAppliedJson);
        }
        if (showLog && this.logSectionEl) {
            this.renderLogArea();
        }

        // Apply filters from current state (chips, input, or measure) only if state changed
        const stateKey = this.getCurrentStateKey();
        if (stateKey !== this.lastStateKey) {
            this.applyFromState();
        }
    }

    // Ensure a single fixed chip mirrors the Search Query measure when present
    private syncMeasureChip() {
        // Remove any existing fixed chip
        const before = this.chips.length;
        this.chips = this.chips.filter(c => !c.fixed);
        const after = this.chips.length;
        if (before !== after) {
            this.renderChips();
        }
    if (this.allowMeasureChip && this.measureQueryRaw) {
            // If guard blocked parsing, show a warning chip; else show the actual measure chip
            const id = `measure`;
            if (this.measureQueryParsed) {
                const display = this.measureQueryRaw;
                const color = '#ddeeff';
                this.chips.unshift({ id, raw: this.measureQueryRaw, parsed: this.measureQueryParsed, display, color, fixed: true });
            } else if (this.lastGuardReason) {
        const reason = this.lastGuardReason;
        const display = reason; // show reason directly, without the word 'measure'
        // Use raw for tooltip as the plain reason
        this.chips.unshift({ id, raw: reason, parsed: { logicalOperator: 'And', conditions: [] }, display, fixed: true, blocked: true });
            }
            this.renderChips();
        }
    }

    // Validate and (if acceptable) parse the measure query string
    private validateAndParseMeasure(raw?: string): { parsed?: any; reason?: string } {
        if (!raw) return { parsed: undefined };
        if (!this.allowMeasureChip) return { parsed: undefined, reason: 'Disabled' };
        // Length guard
        if (raw.length > this.maxQueryLength) {
            return { parsed: undefined, reason: `Too long (${raw.length} chars > ${this.maxQueryLength})` };
        }
        // Token guard (cheap)
        let tokens: any[] = [];
        try {
            tokens = parser.tokenize ? parser.tokenize(raw) : [];
        } catch {
            // If tokenizer failed, fall back to simple split estimate
            tokens = raw.split(/\s+/);
        }
        if (this.maxTokens > 0 && tokens.length > this.maxTokens) {
            return { parsed: undefined, reason: `Too many tokens (${tokens.length} > ${this.maxTokens})` };
        }
        // Parse and leaf-count guard
        try {
            const parsed = parser.parseQuery(raw);
            const leaves = this.countLeaves(parsed);
            if (this.maxClauses > 0 && leaves > this.maxClauses) {
                return { parsed: undefined, reason: `Too many conditions (${leaves} > ${this.maxClauses})` };
            }
            return { parsed };
        } catch (e) {
            return { parsed: undefined, reason: 'Parse error' };
        }
    }

    // Count leaf conditions in the parsed AST, including within negations and groups
    private countLeaves(node: any): number {
        if (!node || typeof node !== 'object') return 0;
        if ('value' in node) return 1;
        if ('not' in node && node.not && node.node) return this.countLeaves(node.node);
        if ('conditions' in node && Array.isArray(node.conditions)) {
            return node.conditions.reduce((sum: number, ch: any) => sum + this.countLeaves(ch), 0);
        }
        return 0;
    }

    private applyFilter(query: string) {
        if (!this.filterTarget) {
            return;
        }

        // If chips exist, apply from chips combined OR
        if (this.chips.length > 0) {
            this.applyChipsFilters();
            return;
        }

        if (query.trim().length > 0) {
            try {
                // Parse with flexible parser and build one or many filters for the bound column
                const parsed = parser.parseQuery(query);
                const target = this.filterTarget as any as { table: string; column: string };
                // If a measure query exists and no chips are present, prefer manual input only (do not combine)
                const filter = buildFlexibleFilters(parsed, target);
                this.applyBuiltFilter(filter, "Applied filter");
            } catch (e) {
                this.log("Failed to parse/build filter", e);
            }
            return;
        } else {
            // Clear filter
            this.applyBuiltFilter(null, "Cleared filter");
        }
    }

    // Chips helpers
    private addChip(raw: string) {
        if (!this.filterTarget) return;
        // Guard user-entered queries as well
        if (raw.length > this.maxQueryLength) {
            this.log(`Skipped chip: too long (${raw.length} > ${this.maxQueryLength})`);
            return;
        }
        // de-dup identical text
        if (this.chips.some(c => c.raw === raw)) {
            this.log(`Skipped duplicate query: ${raw}`);
            return;
        }
        try {
            // Token guard
            const tokens = parser.tokenize ? parser.tokenize(raw) : raw.split(/\s+/);
            if (this.maxTokens > 0 && tokens.length > this.maxTokens) {
                this.log(`Skipped chip: too many tokens (${tokens.length} > ${this.maxTokens})`);
                return;
            }
            const parsed = parser.parseQuery(raw);
            const leaves = this.countLeaves(parsed);
            if (this.maxClauses > 0 && leaves > this.maxClauses) {
                this.log(`Skipped chip: too many conditions (${leaves} > ${this.maxClauses})`);
                return;
            }
            const display = raw;
            const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
            // Assign a color class cycling through presets
            const palette = [
                '#e7f0ff', '#e8f7e7', '#fff4e6', '#f3e8ff', '#e6f9ff', '#ffe8ef'
            ];
            const color = palette[this.chips.length % palette.length];
            this.chips.push({ id, raw, parsed, display, color });
            this.renderChips();
            this.lastStateKey = undefined;
            this.applyChipsFilters();
        } catch (err) {
            this.log(`Parse error adding chip "${raw}":`, err);
        }
    }

    private removeChip(id: string) {
        const idx = this.chips.findIndex(c => c.id === id);
        if (idx >= 0) {
            const removed = this.chips[idx].display;
            this.chips.splice(idx, 1);
            this.renderChips();
            this.log(`Removed query chip: ${removed}`);
            this.lastStateKey = undefined;
            if (this.chips.length > 0) {
                this.applyChipsFilters();
            } else {
                // No chips left -> clear filters
                this.applyBuiltFilter(null, "Cleared filter");
            }
        }
    }

    private renderChips() {
        if (!this.chipsContainer) return;
        this.chipsContainer.innerHTML = '';
        if (this.chips.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'chips-hint';
            hint.textContent = 'Press Enter to add the current query';
            this.chipsContainer.appendChild(hint);
            return;
        }
        for (const c of this.chips) {
            const chipEl = document.createElement('span');
            chipEl.className = 'chip' + (c.fixed ? ' chip-fixed' : '') + (c.blocked ? ' chip-blocked' : '');
            if (c.color && !c.blocked) {
                chipEl.style.background = c.color;
                chipEl.style.borderColor = c.color;
            }
            chipEl.title = c.raw;
            const label = document.createElement('span');
            label.className = 'chip-label';
            // If fixed (measure), prepend an inline FX SVG icon (calculated column style)
            if (c.fixed) {
                const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                icon.setAttribute('width', '14');
                icon.setAttribute('height', '14');
                icon.setAttribute('viewBox', '0 0 16 16');
                icon.classList.add('chip-icon');
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', '8');
                text.setAttribute('y', '11.5');
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('font-family', 'Segoe UI, SegoeUI, Arial, sans-serif');
                text.setAttribute('font-weight', '700');
                text.setAttribute('font-size', '11');
                text.setAttribute('fill', c.blocked ? '#ffffff' : '#2b5fc1');
                text.textContent = 'fx';
                icon.appendChild(text);
                chipEl.appendChild(icon);
            }
            label.textContent = c.display;
            chipEl.appendChild(label);
            if (!c.fixed) {
                const close = document.createElement('button');
                close.className = 'chip-remove';
                close.type = 'button';
                close.setAttribute('aria-label', `Remove ${c.display}`);
                close.textContent = '×';
                close.onclick = () => this.removeChip(c.id);
                chipEl.appendChild(close);
            }
            this.chipsContainer.appendChild(chipEl);
        }
    }

    private applyChipsFilters() {
        if (!this.filterTarget) return;
        if (this.chips.length === 0) return;
    const stateKey = this.getCurrentStateKey();
        if (stateKey === this.lastStateKey) return;
    // Chips already include a fixed measure chip when present
    const nodes: any[] = this.chips.map(c => c.parsed);
    const ast = this.combineWithOr(nodes);
        const target = this.filterTarget as any as { table: string; column: string };
        try {
            const filter = buildFlexibleFilters(ast, target);
            this.applyBuiltFilter(filter, `Applied ${Array.isArray(filter) ? filter.length : 1} filter(s) from ${this.chips.length} chip(s)`);
            this.lastStateKey = stateKey;
        } catch (e) {
            this.log('Failed to build/apply filters from chips', e);
        }
    }

    private combineWithOr(nodes: any[]): any {
        if (nodes.length === 1) return nodes[0];
        return { logicalOperator: 'Or', conditions: nodes };
    }

    private applyFromState() {
        if (!this.filterTarget) return;
        if (this.chips.length > 0) {
            this.applyChipsFilters();
            return;
        }
        // Do not auto-apply from raw input; wait for Enter (chip added)
        // If no chips and no manual input, but a measure query exists -> apply it
        if (this.measureQueryParsed) {
            const target = this.filterTarget as any as { table: string; column: string };
            try {
        const filter = buildFlexibleFilters(this.measureQueryParsed, target);
        this.applyBuiltFilter(filter, "Applied measure-based filter");
                this.lastStateKey = this.getCurrentStateKey();
            } catch (e) {
                this.log("Failed to apply measure-based filter", e);
            }
            return;
        }
        // Nothing -> clear
    this.applyBuiltFilter(null, "Cleared filter");
        this.lastStateKey = this.getCurrentStateKey();
    }

    private setSectionVisibility(el: HTMLElement | undefined, visible: boolean) {
        if (!el) return;
        el.style.display = visible ? '' : 'none';
    }

    // Attempt to parse a queryRef like "Table.Column" or "Table[Column]" into a filter target
    private buildFilterTarget(queryRef: string): models.IFilterTarget | undefined {
        // Handle "Table[Column]" pattern
        const bracketMatch = /^(.*?)\[(.*)\]$/.exec(queryRef);
        if (bracketMatch) {
            const [, table, column] = bracketMatch;
            return { table, column } as any;
        }

        // Handle "Schema.Table.Column" or "Table.Column" pattern -> use last segment as column, the one before as table
        const dotParts = queryRef.split(".");
        if (dotParts.length >= 2) {
            const column = dotParts[dotParts.length - 1];
            const table = dotParts[dotParts.length - 2];
            return { table, column } as any;
        }

        return undefined;
    }

    private updateFilterView(json: any | null) {
        this.lastAppliedJson = json;
        if (!this.showFilterJsonVisible) {
            return; // Skip heavy stringify when hidden
        }
        if (!json) {
            this.filterView.value = "(none)";
            return;
        }
        try {
            this.filterView.value = JSON.stringify(json, null, 2);
        } catch {
            this.filterView.value = String(json);
        }
    }

    private log(message: string, data?: any) {
        const ts = new Date().toISOString();
        let line = `[${ts}] ${message}`;
        if (this.showLogVisible && typeof data !== "undefined") {
            try {
                line += `\n${JSON.stringify(data, null, 2)}`;
            } catch {
                line += `\n${String(data)}`;
            }
        }
        this.logs.push(line);
        // Keep log from growing indefinitely; cap at last 200 lines
        if (this.logs.length > 200) {
            this.logs.splice(0, this.logs.length - 200);
        }
        if (this.showLogVisible) {
            this.renderLogArea();
        }
        // Scroll to bottom
    // keep focus behavior but no internal scroll management
    }

    private renderLogArea() {
        this.logArea.value = this.logs.join("\n\n");
    }

    // Optional: keep function in case we want to re-enable autosizing later
    private autosizeLog() { /* no-op: outer container scrolls */ }

    private toggleSection(sectionEl: HTMLElement, btn: HTMLButtonElement) {
        const isCollapsed = sectionEl.classList.toggle('collapsed');
        btn.textContent = isCollapsed ? 'Expand' : 'Collapse';
    }

    private attachVerticalResizer(handle: HTMLDivElement, targetEl: HTMLElement, minHeightPx = 60, maxHeightPx?: number) {
        let startY = 0;
        let startH = 0;
        const onMouseMove = (e: MouseEvent) => {
            const dy = e.clientY - startY;
            let newH = startH + dy;
            if (minHeightPx) newH = Math.max(minHeightPx, newH);
            if (maxHeightPx) newH = Math.min(maxHeightPx, newH);
            (targetEl as HTMLElement).style.height = newH + 'px';
        };
        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
        handle.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            startY = e.clientY;
            const cs = window.getComputedStyle(targetEl);
            startH = parseInt(cs.height, 10) || (targetEl as HTMLElement).offsetHeight;
            // Set an explicit height so dragging has effect
            (targetEl as HTMLElement).style.height = startH + 'px';
            // Use container height as max if not provided
            if (!maxHeightPx) {
                const container = this.target as HTMLElement;
                maxHeightPx = Math.max(120, container.clientHeight - 40);
            }
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    public enumerateObjectInstances(options: powerbi.EnumerateVisualObjectInstancesOptions): VisualObjectInstanceEnumeration {
        const instances: VisualObjectInstance[] = [];
        if (options.objectName === "search") {
            instances.push({
                objectName: "search",
                selector: undefined,
                properties: {
                    placeholder: this.settings.placeholder || "Enter keyword and press Enter"
                }
            });
        } else if (options.objectName === "display") {
            instances.push({
                objectName: "display",
                selector: undefined,
                properties: {
                    showFilterJson: this.showFilterJsonVisible,
                    showLog: this.showLogVisible
                }
            });
        } else if (options.objectName === 'limits') {
            instances.push({
                objectName: 'limits',
                selector: undefined,
                properties: {
                    allowMeasureChip: this.allowMeasureChip,
                    maxQueryLength: this.maxQueryLength,
                    maxTokens: this.maxTokens,
                    maxClauses: this.maxClauses
                }
            });
        }
        return instances;
    }

    // Centralized application with duplicate guard and debouncing helpers
    private applyBuiltFilter(filter: any | null, reason: string) {
        // Compute a stable key
        let key = 'clear';
        try {
            key = filter ? JSON.stringify(filter) : 'clear';
        } catch {
            key = 'unknown';
        }
        if (this.lastAppliedKey === key) {
            // Skip duplicate apply
            return;
        }
        // Apply
        this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
        if (filter) {
            this.host.applyJsonFilter(filter as any, "general", "filter", FilterAction.merge);
        }
        this.lastAppliedKey = key;
        this.updateFilterView(filter);
        this.log(reason, this.showLogVisible ? filter : undefined);
    }

    // Debounce helper for input/chip driven updates
    private scheduleApplyFromState(delayMs = 150) {
        if (this.applyTimer) {
            clearTimeout(this.applyTimer);
        }
        this.applyTimer = window.setTimeout(() => {
            this.applyFromState();
        }, delayMs) as unknown as number;
    }

    private getCurrentStateKey(): string {
        const tgt = this.categoryColumnQueryRef || '';
    const chipsKey = this.chips.map(c => (c.fixed ? `#${c.raw}` : c.raw)).join('||');
        const inputKey = (this.inputEl && this.inputEl.value) ? this.inputEl.value.trim() : '';
        const measureKey = this.measureQueryRaw || '';
        // Only some parts are active depending on state, but composing all is fine
        return `t=${tgt}|chips=${chipsKey}|input=${inputKey}|measure=${measureKey}`;
    }
}
