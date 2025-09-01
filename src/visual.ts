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

interface SearchSettings {
    placeholder?: string;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private inputEl: HTMLInputElement;
    private clearBtn: HTMLButtonElement;
    private filterView: HTMLPreElement;
    private logArea: HTMLTextAreaElement;
    private copyLogBtn: HTMLButtonElement;
    private clearLogBtn: HTMLButtonElement;
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
        this.inputEl.placeholder = "Type to search...";
        this.inputEl.addEventListener("input", this.onSearchChange);
    this.clearBtn = document.createElement("button");
    this.clearBtn.type = "button";
    this.clearBtn.textContent = "Clear";
    this.clearBtn.title = "Clear search";
    this.clearBtn.addEventListener("click", this.onClearClick);

    // Controls row
    const controls = document.createElement("div");
    controls.className = "controls";
    controls.appendChild(this.inputEl);
    controls.appendChild(this.clearBtn);

    // Filter JSON display
    const filterSection = document.createElement("div");
    filterSection.className = "filter-section";
    const filterTitle = document.createElement("div");
    filterTitle.className = "section-title";
    filterTitle.textContent = "Applied filter JSON:";
    this.filterView = document.createElement("pre");
    this.filterView.className = "filter-json";
    this.filterView.textContent = "(none)";
    filterSection.appendChild(filterTitle);
    filterSection.appendChild(this.filterView);

    // Log area with copy button
    const logSection = document.createElement("div");
    logSection.className = "log-section";
    const logHeader = document.createElement("div");
    logHeader.className = "section-title with-action";
    const logTitle = document.createElement("span");
    logTitle.textContent = "Log";
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
    logHeader.appendChild(this.copyLogBtn);
    logHeader.appendChild(this.clearLogBtn);
    this.logArea = document.createElement("textarea");
    this.logArea.className = "log-area";
    this.logArea.readOnly = true;
    this.logArea.value = "";
    logSection.appendChild(logHeader);
    logSection.appendChild(this.logArea);

    this.target.appendChild(controls);
    this.target.appendChild(filterSection);
    this.target.appendChild(logSection);
        options.element.appendChild(this.target);

    this.log("Visual initialized");
    }

    private onSearchChange = (ev: Event) => {
        const query = (ev.target as HTMLInputElement).value || "";
        this.applyFilter(query);
    };

    private onClearClick = () => {
        this.inputEl.value = "";
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
            this.inputEl.placeholder = this.settings.placeholder || "Type to search...";
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

        if (query.trim().length > 0) {
            // Use AdvancedFilter for true contains match on the bound column
            const adv = new models.AdvancedFilter(this.filterTarget, "And", [{ operator: "Contains", value: query }]);
            const json = adv.toJSON();
            this.host.applyJsonFilter(json, "general", "filter", FilterAction.merge);
            this.updateFilterView(json);
            this.log("Applied filter", json);
            return;
        } else {
            // Clear filter
            this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
            this.updateFilterView(null);
            this.log("Cleared filter");
        }
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
            this.filterView.textContent = "(none)";
            return;
        }
        try {
            this.filterView.textContent = JSON.stringify(json, null, 2);
        } catch {
            this.filterView.textContent = String(json);
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
        this.logArea.scrollTop = this.logArea.scrollHeight;
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
