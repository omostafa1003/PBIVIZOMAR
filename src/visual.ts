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
    private chips: { id: string; raw: string; parsed: any; display: string; color?: string }[] = [];
    private filterView: HTMLTextAreaElement;
    private copyFilterBtn: HTMLButtonElement;
    private toggleFilterBtn: HTMLButtonElement;
    private logArea: HTMLTextAreaElement;
    private copyLogBtn: HTMLButtonElement;
    private clearLogBtn: HTMLButtonElement;
    private filterResizer?: HTMLDivElement;
    private logs: string[] = [];
    private currentFilter?: models.IBasicFilter;
    private categoryColumnQueryRef?: string;
    private filterTarget?: models.IFilterTarget;
    private settings: SearchSettings = {};

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
    this.target = document.createElement("div");
    this.target.className = "visual-container";
    this.inputEl = document.createElement("input");
        this.inputEl.type = "text";
        this.inputEl.placeholder = "Enter keyword and press Enter";
        this.inputEl.addEventListener("input", this.onSearchChange);
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
    // Wrap input to position inline X button
    const inputWrap = document.createElement("div");
    inputWrap.className = "input-wrap";
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

    private onSearchChange = (ev: Event) => {
    const query = (ev.target as HTMLInputElement).value || "";
    // If chips exist, typing doesn't auto-apply; chips drive filters
    if (this.chips.length > 0) return;
    this.applyFilter(query);
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

        // Capture the bound category queryName to build a filter target
        const cat = dataView.categorical && dataView.categorical.categories && dataView.categorical.categories[0];
        if (cat && cat.source && cat.source.queryName) {
            this.categoryColumnQueryRef = cat.source.queryName;
            this.filterTarget = this.buildFilterTarget(this.categoryColumnQueryRef);
            this.log("Bound column queryRef detected", this.categoryColumnQueryRef);
            if (this.filterTarget) {
                this.log("Derived filter target", this.filterTarget);
            }
        }
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
                const filter = buildFlexibleFilters(parsed, target);
                // Clear previous filters, then apply the entire set in one merge to preserve AND across groups
                this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
                this.host.applyJsonFilter(filter as any, "general", "filter", FilterAction.merge);
                this.updateFilterView(filter);
                this.log("Applied filter", filter);
            } catch (e) {
                this.log("Failed to parse/build filter", e);
            }
            return;
        } else {
            // Clear filter
            this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
            this.updateFilterView(null);
            this.log("Cleared filter");
        }
    }

    // Chips helpers
    private addChip(raw: string) {
        if (!this.filterTarget) return;
        // de-dup identical text
        if (this.chips.some(c => c.raw === raw)) {
            this.log(`Skipped duplicate query: ${raw}`);
            return;
        }
        try {
            const parsed = parser.parseQuery(raw);
            const display = raw;
            const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
            // Assign a color class cycling through presets
            const palette = [
                '#e7f0ff', '#e8f7e7', '#fff4e6', '#f3e8ff', '#e6f9ff', '#ffe8ef'
            ];
            const color = palette[this.chips.length % palette.length];
            this.chips.push({ id, raw, parsed, display, color });
            this.renderChips();
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
            if (this.chips.length > 0) {
                this.applyChipsFilters();
            } else {
                // No chips left -> clear filters
                this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
                this.updateFilterView(null);
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
            chipEl.className = 'chip';
            if (c.color) {
                chipEl.style.background = c.color;
                chipEl.style.borderColor = c.color;
            }
            chipEl.title = c.raw;
            const label = document.createElement('span');
            label.className = 'chip-label';
            label.textContent = c.display;
            const close = document.createElement('button');
            close.className = 'chip-remove';
            close.type = 'button';
            close.setAttribute('aria-label', `Remove ${c.display}`);
            close.textContent = '×';
            close.onclick = () => this.removeChip(c.id);
            chipEl.appendChild(label);
            chipEl.appendChild(close);
            this.chipsContainer.appendChild(chipEl);
        }
    }

    private applyChipsFilters() {
        if (!this.filterTarget) return;
        if (this.chips.length === 0) return;
        const ast = this.combineWithOr(this.chips.map(c => c.parsed));
        const target = this.filterTarget as any as { table: string; column: string };
        try {
            const filter = buildFlexibleFilters(ast, target);
            this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
            this.host.applyJsonFilter(filter as any, "general", "filter", FilterAction.merge);
            this.updateFilterView(filter);
            this.log(`Applied ${Array.isArray(filter) ? filter.length : 1} filter(s) from ${this.chips.length} chip(s)`);
        } catch (e) {
            this.log('Failed to build/apply filters from chips', e);
        }
    }

    private combineWithOr(nodes: any[]): any {
        if (nodes.length === 1) return nodes[0];
        return { logicalOperator: 'Or', conditions: nodes };
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
        if (typeof data !== "undefined") {
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
        this.logArea.value = this.logs.join("\n\n");
        // Scroll to bottom
    // keep focus behavior but no internal scroll management
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
                    placeholder: this.settings.placeholder || "Type to search..."
                }
            });
        }
        return instances;
    }
}
