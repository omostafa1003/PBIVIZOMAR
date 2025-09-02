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
  // Convert the expression into Conjunctive Normal Form (CNF): AND of OR-clauses
  const clauses = toCNF(parsed);
  const targetRef: models.IFilterTarget = { table: target.table, column: target.column } as any;
  const filters: models.IFilter[] = [];

  // Optimization: if every clause is a single term (pure AND of terms), collapse into one Advanced AND filter
  if (clauses.length > 1 && clauses.every(c => c.length === 1)) {
    const allConds = clauses.flat().map(toAdvancedCondition);
    return makeAdvanced(targetRef, 'And', allConds);
  }

  // If mixed: some OR-clauses (size>1) and some singletons, merge all singletons into one AND filter
  const singles = clauses.filter(c => c.length === 1).flat();
  const multis = clauses.filter(c => c.length > 1);
  if (singles.length && multis.length) {
    filters.push(makeAdvanced(targetRef, 'And', singles.map(toAdvancedCondition)));
    for (const clause of multis) {
      if (canUseBasicIn(clause)) {
        const values = clause.map(v => toBasicValue(v));
        const basic = new models.BasicFilter(targetRef as any, 'In', values as any);
        filters.push(basic.toJSON());
      } else {
        const conditions = clause.map(toAdvancedCondition);
        filters.push(makeAdvanced(targetRef, 'Or', conditions));
      }
    }
    return filters.length === 1 ? filters[0] : filters;
  }

  for (const clause of clauses) {
    if (clause.length > 1) {
      // Multi-term clause => OR within clause
      if (canUseBasicIn(clause)) {
        const values = clause.map(v => toBasicValue(v));
        const basic = new models.BasicFilter(targetRef as any, 'In', values as any);
        filters.push(basic.toJSON());
      } else {
        const conditions = clause.map(toAdvancedCondition);
        filters.push(makeAdvanced(targetRef, 'Or', conditions));
      }
    } else if (clause.length === 1) {
      // Single-term clause => simple AND against others
      const conditions = clause.map(toAdvancedCondition);
      filters.push(makeAdvanced(targetRef, 'And', conditions));
    }
  }

  return filters.length === 1 ? filters[0] : filters;
}

// Convert the parsed tree to CNF: list of clauses (each clause is OR over conditions)
function toCNF(node: Node): Condition[][] {
  if (!isParsedQuery(node)) {
    return [[node]];
  }
  if (node.logicalOperator === 'And') {
    // AND => concatenate clauses from children
    let result: Condition[][] = [];
    for (const child of node.conditions) {
      const childCNF = toCNF(child);
      result = result.concat(childCNF);
    }
    return result;
  } else {
    // OR => distribute over children's CNF
    let result: Condition[][] = [];
    for (let i = 0; i < node.conditions.length; i++) {
      const childCNF = toCNF(node.conditions[i]);
      if (i === 0) {
        result = childCNF;
      } else {
        result = distributeOr(result, childCNF);
      }
    }
    return result;
  }
}

// Distribute OR over AND: given two CNFs (lists of clauses), return cross-product union of clauses
function distributeOr(cnfA: Condition[][], cnfB: Condition[][]): Condition[][] {
  const out: Condition[][] = [];
  for (const clauseA of cnfA) {
    for (const clauseB of cnfB) {
      out.push([...clauseA, ...clauseB]);
    }
  }
  return out;
}

function toAdvancedCondition(c: Condition): models.IAdvancedFilterCondition {
  // Exclusions use DoesNotContain; others use Contains
  const op: models.AdvancedFilterConditionOperators = c.isExcluded ? 'DoesNotContain' : 'Contains';
  return { operator: op, value: c.value } as any;
}

function canUseBasicIn(group: Condition[]): boolean {
  if (!group.length) return false;
  // Only allow Basic In for purely numeric lists without modifiers.
  if (group.some(c => c.isExcluded || c.isRequired)) return false;
  return group.every(c => isNumericString(c.value));
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

function makeAdvanced(target: models.IFilterTarget, logical: 'And' | 'Or', conditions: models.IAdvancedFilterCondition[]): models.IAdvancedFilter {
  return {
    $schema: "http://powerbi.com/product/schema#advanced",
    target,
    filterType: models.FilterType.Advanced,
    logicalOperator: logical,
    conditions
  } as models.IAdvancedFilter;
}
