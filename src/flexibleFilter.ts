import * as models from "powerbi-models";

export type Logical = 'And' | 'Or';

export interface Condition {
  value: string;
  isQuoted: boolean;
  isRequired?: boolean;
  isExcluded?: boolean;
}

export type Node = Condition | ParsedQuery;

export interface ParsedQuery {
  logicalOperator: Logical;
  conditions: Node[];
}

export interface TargetRef {
  table: string;
  column: string;
}

function isParsedQuery(n: Node): n is ParsedQuery {
  return (n as ParsedQuery).conditions !== undefined && (n as any).logicalOperator !== undefined;
}

function flattenAtoms(node: Node): Condition[] {
  if (!isParsedQuery(node)) {
    return [node];
  }
  const out: Condition[] = [];
  for (const child of node.conditions) {
    out.push(...flattenAtoms(child));
  }
  return out;
}

export function buildFlexibleFilters(parsed: ParsedQuery, target: TargetRef): models.IFilter | models.IFilter[] {
  // Strategy: merge all AND atoms into one And filter; emit separate Or filters for each OR sub-group.
  const andAtoms: Condition[] = [];
  const orGroups: Condition[][] = [];

  const walk = (node: Node, parentOp: Logical | null) => {
    if (!isParsedQuery(node)) {
      if (parentOp === 'Or') {
        orGroups.push([node]);
      } else {
        andAtoms.push(node);
      }
      return;
    }

    const op = node.logicalOperator;
    if (op === 'Or') {
      // Collect all atoms under this OR subtree into one group
      const atoms = flattenAtoms(node);
      if (atoms.length > 0) {
        orGroups.push(atoms);
      }
      return;
    }

    // AND: walk children preserving grouping behavior
    for (const c of node.conditions) {
      walk(c, op);
    }
  };

  walk(parsed, null);

  const targetRef: models.IFilterTarget = { table: target.table, column: target.column } as any;
  const filters: models.IFilter[] = [];

  if (andAtoms.length > 0) {
    const conditions = andAtoms.map(toAdvancedCondition);
    const adv = new models.AdvancedFilter(targetRef, 'And', conditions);
    filters.push(adv.toJSON());
  }

  for (const group of orGroups) {
    if (canUseBasicIn(group)) {
      const values = group.map(v => toBasicValue(v));
      const basic = new models.BasicFilter(targetRef as any, 'In', values as any);
      filters.push(basic.toJSON());
    } else {
      const conditions = group.map(toAdvancedCondition);
      const adv = new models.AdvancedFilter(targetRef, 'Or', conditions);
      filters.push(adv.toJSON());
    }
  }

  if (filters.length === 1) {
    return filters[0];
  }
  return filters;
}

function toAdvancedCondition(c: Condition): models.IAdvancedFilterCondition {
  // Exclusions use DoesNotContain; others use Contains
  const op: models.AdvancedFilterConditionOperators = c.isExcluded ? 'DoesNotContain' : 'Contains';
  return { operator: op, value: c.value } as any;
}

function canUseBasicIn(group: Condition[]): boolean {
  // Use Basic 'In' only if:
  // - All terms are included (not excluded)
  // - No required modifiers (we can't express +term in equality list)
  // - Group is an OR-like list of equality candidates
  // Equality candidates: quoted strings (exact) OR numeric-like tokens
  if (!group.length) return false;
  for (const c of group) {
    if (c.isExcluded || c.isRequired) return false;
    if (!(c.isQuoted || isNumericString(c.value))) return false;
  }
  return true;
}

function isNumericString(s: string): boolean {
  // Accept integers or floats, optional leading sign
  return /^[-+]?\d*(?:\.\d+)?$/.test(s) && s.length > 0 && s !== ".";
}

function toBasicValue(c: Condition): string | number {
  if (c.isQuoted) return c.value;
  if (isNumericString(c.value)) {
    const num = Number(c.value);
    return Number.isNaN(num) ? c.value : num;
  }
  return c.value;
}
