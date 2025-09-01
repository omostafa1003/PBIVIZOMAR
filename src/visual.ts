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
        this.target.appendChild(this.inputEl);
        options.element.appendChild(this.target);
    }

    private onSearchChange = (ev: Event) => {
        const query = (ev.target as HTMLInputElement).value || "";
        this.applyFilter(query);
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
        }
    }

    private applyFilter(query: string) {
        if (!this.filterTarget) {
            return;
        }

        if (query.trim().length > 0) {
            // Use AdvancedFilter for true contains match on the bound column
            const adv = new models.AdvancedFilter(this.filterTarget, "And", [{ operator: "Contains", value: query }]);

            this.host.applyJsonFilter(adv.toJSON(), "general", "filter", FilterAction.merge);
            return;
        } else {
            // Clear filter
            this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
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
