# Search Query Visual

A lightweight Power BI custom visual for filtering a single bound text column using human-friendly queries. It supports chips (inclusive OR), correct AND/OR grouping (CNF), quoted phrases, negation (including groups), and an optional measure input.

## Quick setup
- Data roles
   - Search Field (Grouping): bind the text column to filter.
   - Search Query (Measure, optional): a DAX measure that yields a query string.
- UI basics
   - Type and press Enter to add a chip. Remove with ×.
   - Format pane > Display: toggle Applied Filter JSON and Log.

## Feature overview

| Area | What you get | Notes |
|---|---|---|
| Column binding | One text column to filter | Required (Search Field) |
| Query entry | Input with Enter-to-add chips | No auto-apply while typing |
| Chips logic | Chips are OR’d together | Each chip may include AND/OR/NOT inside |
| Boolean parsing | AND, OR, NOT, parentheses | Case-insensitive; AND > OR precedence |
| Phrases | "quoted phrases" | Case-insensitive substring; preserves spaces as typed |
| Negation | -term, -"phrase", -(group) | De Morgan applied; see table below |
| Measure support | Optional Search Query measure | Auto-applied if no chips; OR’d with chips if present |
| Filters emitted | Advanced ORs; merged AND; Basic In for numeric lists | Unlimited OR terms |
| Diagnostics | Applied Filter JSON, Log | Disabled by default to save CPU |

## Query syntax: quick reference

| Element | Examples | Meaning | Notes |
|---|---|---|---|
| Word | manager lead director | Substring match (Contains) | Case-insensitive |
| Phrase | "executive assistant" | Match phrase as substring | Preserves spaces inside quotes |
| Implicit AND | marketing affiliate | marketing AND affiliate | AND binds tighter than OR |
| Explicit AND/OR | A AND B; A OR B | Boolean operators | Case-insensitive |
| Grouping | (A or B) and (C or D) | Parenthesize expressions | Nested groups allowed |
| Required | +term | Must appear | Same as AND with term |
| Excluded | -term; -"phrase" | Must not appear | Maps to DoesNotContain |
| Negated group | -(A OR B) | Exclude any of A or B | Transforms to -A AND -B |
| Wildcards | Manag | Use prefixes instead of * | Asterisk is treated literally |

## Boolean semantics and emitted filters

CNF (AND of ORs) is used so multiple filters AND together in Power BI. We merge singleton AND terms and emit separate OR filters for multi-term clauses.

| Expression | CNF (conceptual) | Filters emitted (summary) | Why |
|---|---|---|---|
| A AND B | (A) ∧ (B) | One AND filter with A, B | Fewer filters; same semantics |
| A OR B OR C | (A ∨ B ∨ C) | One OR filter with A, B, C | Unlimited OR terms |
| (A OR B) AND (C OR D) | (A ∨ B) ∧ (C ∨ D) | Two OR filters: [A,B] and [C,D] | Power BI ANDs filters |
| A AND (B OR C) | (A) ∧ (B ∨ C) | One AND filter (A) + one OR filter [B,C] | Mixed clauses |
| Numeric list 1 OR 2 OR 3 | (1 ∨ 2 ∨ 3) | Basic In [1,2,3] | Optimized for performance |

## Negation guide

| Input | Transform | Filters emitted | Notes |
|---|---|---|---|
| -"phrase" | DoesNotContain("phrase") | AND filter with DoesNotContain | Preserves spaces |
| -(A OR B) | (-A) AND (-B) | Two DoesNotContain terms (ANDed) | Preferred for “exclude any of these” |
| -(A AND B) | (-A) OR (-B) | One OR of DoesNotContain | Weaker; only excludes rows containing both |

## Chips and measure interaction

| Chips present? | Measure present? | Combined logic | When applied |
|---|---|---|---|
| No | Yes | Use measure query | On data update |
| Yes | No | OR across chips | On Enter (chip add/remove) |
| Yes | Yes | (chip1 OR chip2 …) OR (measure query) | On Enter (chips) or data update (measure) |

## Scenarios and examples

| Goal | Query | Filters emitted (summary) | Notes |
|---|---|---|---|
| Manager in Ops or Delivery | "Manager" AND ("Operations" OR Ops OR delivery) | OR("Manager"); OR("Operations","Ops","delivery") | Two OR filters ANDed |
| Senior leadership but exclude marketing/affiliate/EA | ("Manager" OR lead OR "director" OR "executive") AND -(affiliate OR marketing OR "executive assistant") | OR(Manager,lead,director,executive); AND: DoesNotContain affiliate, marketing, executive assistant | Negated group becomes AND of negatives |
| Pair of disjunctions | (A OR B) AND (C OR D) | OR(A,B); OR(C,D) | Standard CNF |
| Exclude any of these | -(marketing OR affiliate) | AND: DoesNotContain marketing, affiliate | Strong “exclude any” behavior |
| Caution: weak negation | -(marketing affiliate) | OR: DoesNotContain marketing OR DoesNotContain affiliate | Only excludes rows containing both terms |

## Limits and notes

- Contains/DoesNotContain are substring matches. Word-boundary matching isn’t native; a whole-word approximation can be added if needed.
- Basic In optimization is used only for plain numeric OR lists.
- Applied Filter JSON and Log are disabled by default to reduce overhead; enable from the Display pane when debugging.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Filters re-apply while typing | Auto-apply expectation | Applies only on Enter; identical applies are deduped |
| Quoted single word matches longer words | Substring semantics | Ask for whole-word option, or normalize data |
| Negation doesn’t exclude enough | Used -(A B) (implicit AND) | Use -(A OR B) to exclude any of A or B |

## Version highlights

- 0.1.17.0: Format pane toggles persist correctly.
- 0.1.16.0: Negated groups exclude any term by default (-(a b c) → -a AND -b AND -c).
- 0.1.15.0: Trim quoted phrases; improved negation behavior.
- 0.1.14.0: Debounce, duplicate-apply guard, conditional JSON/log rendering. Chips-only apply on Enter.

## Privacy and support

- Uses Power BI filtering APIs only. No external calls, no telemetry.
- For help, open an issue with your example query and expected/actual behavior.
