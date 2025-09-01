# Search Query Visual

A minimal Power BI custom visual that applies a "contains" text filter to a single bound column based on user input.

## Bindings
- Fields: Bind exactly one text column to the "Search Field" well.

## Behavior
- Typing in the input applies an AdvancedFilter (Contains) on the bound column.
- Clearing the input removes the filter.

## Develop
Prereqs:
- Node.js LTS
- Global tools: `npm i -g powerbi-visuals-tools`

Install and run:

```
npm install
pbiviz start
```

Package:

```
pbiviz package
```

Then import the generated `.pbiviz` from `dist/` into Power BI Desktop.
