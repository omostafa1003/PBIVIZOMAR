"use strict";
// Testparser/queryParser.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenize = tokenize;
exports.parseExpression = parseExpression;
exports.parseOrExpression = parseOrExpression;
exports.parseAndExpression = parseAndExpression;
exports.parsePrimaryExpression = parsePrimaryExpression;
exports.parseQuery = parseQuery;
exports.buildFilterFromParsed = buildFilterFromParsed;
exports.buildFlexibleFilter = buildFlexibleFilter;
function tokenize(query) {
    const tokens = [];
    let i = 0;
    while (i < query.length) {
        const char = query[i];
        if (char === '"') {
            // Quoted phrase
            let j = i + 1;
            while (j < query.length && query[j] !== '"') {
                j++;
            }
            if (j < query.length) {
                tokens.push({ type: 'quoted', value: query.slice(i + 1, j) });
                i = j + 1;
            }
            else {
                // Unclosed quote - treat as regular word
                tokens.push({ type: 'word', value: query.slice(i + 1) });
                i = query.length;
            }
        }
        else if (char === '(' || char === ')') {
            tokens.push({ type: 'paren', value: char });
            i++;
        }
        else if (char === '+' || char === '-') {
            // Check if followed by a word (no space)
            if (i + 1 < query.length && /[a-zA-Z0-9_]/.test(query[i + 1])) {
                // Modifier attached to word - consume the word too
                let j = i + 1;
                while (j < query.length && /[a-zA-Z0-9_]/.test(query[j])) {
                    j++;
                }
                const word = query.slice(i + 1, j);
                tokens.push({
                    type: 'word',
                    value: char + word // Include the modifier in the value
                });
                i = j;
            }
            else {
                // Standalone modifier - this shouldn't happen in valid syntax
                tokens.push({ type: 'modifier', value: char });
                i++;
            }
        }
        else if (/\s/.test(char)) {
            i++;
        }
        else if (/[a-zA-Z0-9]/.test(char) || char === '_') {
            // Word or operator
            let j = i;
            while (j < query.length && /[a-zA-Z0-9_]/.test(query[j])) {
                j++;
            }
            const word = query.slice(i, j).toUpperCase();
            if (word === 'AND' || word === 'OR' || word === 'NOT') {
                tokens.push({ type: 'operator', value: word });
            }
            else {
                tokens.push({ type: 'word', value: query.slice(i, j) });
            }
            i = j;
        }
        else {
            i++;
        }
    }
    return tokens;
}
function parseExpression(tokens, index) {
    // Parse OR expressions (lowest precedence)
    return parseOrExpression(tokens, index);
}
function parseOrExpression(tokens, index) {
    // Parse AND expressions first (higher precedence)
    let left = parseAndExpression(tokens, index);
    while (index.value < tokens.length && tokens[index.value].type === 'operator' && tokens[index.value].value === 'OR') {
        const operator = tokens[index.value].value;
        index.value++; // consume the OR
        const right = parseAndExpression(tokens, index);
        // Create a new OR group
        if ('value' in left) {
            // Left is a condition, create new group
            left = {
                logicalOperator: 'Or',
                conditions: [left, right]
            };
        }
        else {
            // Left is already a group, extend it
            left = {
                logicalOperator: 'Or',
                conditions: [left, right]
            };
        }
    }
    return left;
}
function parseAndExpression(tokens, index) {
    // Parse primary expressions (highest precedence)
    let left = parsePrimaryExpression(tokens, index);
    // Handle implicit AND between consecutive terms
    const conditions = [left];
    while (index.value < tokens.length) {
        const token = tokens[index.value];
        if (token.type === 'operator' && token.value === 'AND') {
            index.value++; // consume the AND
            const right = parsePrimaryExpression(tokens, index);
            conditions.push(right);
        }
        else if (token.type === 'operator' && token.value === 'OR') {
            // OR has lower precedence, so we stop here
            break;
        }
        else if (token.type === 'word' || token.type === 'quoted') {
            // Implicit AND - consume the next term
            const right = parsePrimaryExpression(tokens, index);
            conditions.push(right);
        }
        else if (token.type === 'paren' && token.value === ')') {
            // End of parenthesized expression
            break;
        }
        else {
            // Skip other tokens (like modifiers that were already consumed)
            index.value++;
        }
    }
    if (conditions.length === 1) {
        return conditions[0];
    }
    return {
        logicalOperator: 'And',
        conditions: conditions
    };
}
function parsePrimaryExpression(tokens, index) {
    if (index.value >= tokens.length) {
        throw new Error('Unexpected end of expression');
    }
    const token = tokens[index.value];
    if (token.type === 'paren' && token.value === '(') {
        index.value++;
        const subExpr = parseExpression(tokens, index);
        // Skip the closing parenthesis
        if (index.value < tokens.length && tokens[index.value].type === 'paren' && tokens[index.value].value === ')') {
            index.value++;
        }
        return subExpr;
    }
    else if (token.type === 'operator' && token.value === 'NOT') {
        // Handle NOT operator - next token should be excluded
        index.value++;
        if (index.value < tokens.length) {
            const nextToken = tokens[index.value];
            if (nextToken.type === 'word' || nextToken.type === 'quoted') {
                const condition = {
                    value: nextToken.value,
                    isQuoted: nextToken.type === 'quoted',
                    isRequired: false,
                    isExcluded: true
                };
                index.value++;
                return condition;
            }
        }
        throw new Error('Expected term after NOT operator');
    }
    else if (token.type === 'word' || token.type === 'quoted') {
        // Handle modifiers in the word value
        let value = token.value;
        let isRequired = false;
        let isExcluded = false;
        if (value.startsWith('+')) {
            isRequired = true;
            value = value.substring(1);
        }
        else if (value.startsWith('-')) {
            isExcluded = true;
            value = value.substring(1);
        }
        const condition = {
            value: value,
            isQuoted: token.type === 'quoted',
            isRequired: isRequired,
            isExcluded: isExcluded
        };
        index.value++;
        return condition;
    }
    throw new Error(`Unexpected token: ${token.type} "${token.value}"`);
}
function parseQuery(query) {
    const tokens = tokenize(query);
    const index = { value: 0 };
    return parseExpression(tokens, index);
}
// Example: Building Power BI filter from parsed query
function buildFilterFromParsed(parsed, table, column) {
    function convertCondition(condition) {
        if ('value' in condition) {
            // It's a Condition
            const cond = condition;
            if (cond.isExcluded) {
                // For excluded terms, we need to create a NOT condition
                return {
                    not: {
                        operator: 'Contains', // Always use Contains for search functionality
                        value: cond.value
                    }
                };
            }
            else {
                return {
                    operator: 'Contains', // Always use Contains for search functionality
                    value: cond.value
                };
            }
        }
        else {
            // It's a ParsedQuery
            return {
                operator: condition.logicalOperator === 'And' ? 'And' : 'Or',
                conditions: condition.conditions.map(convertCondition)
            };
        }
    }
    if ('value' in parsed) {
        return {
            $schema: "http://powerbi.com/product/schema#advanced",
            target: { table, column },
            logicalOperator: "Or",
            conditions: [convertCondition(parsed)]
        };
    }
    else {
        return {
            $schema: "http://powerbi.com/product/schema#advanced",
            target: { table, column },
            logicalOperator: parsed.logicalOperator === 'And' ? 'And' : 'Or',
            conditions: parsed.conditions.map(convertCondition)
        };
    }
}
// Flexible filter builder that accepts dynamic table/column
function buildFlexibleFilter(parsed, options) {
    return buildFilterFromParsed(parsed, options.table, options.column);
}
// Allow running from command line
if (require.main === module) {
    try {
        const args = process.argv.slice(2);
        let input = '';
        let table = 'Employees';
        let column = 'JobTitle';
        // Parse arguments
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg === '--table' && i + 1 < args.length) {
                table = args[i + 1];
                i++; // Skip next arg
            }
            else if (arg === '--column' && i + 1 < args.length) {
                column = args[i + 1];
                i++; // Skip next arg
            }
            else if (arg.endsWith('.txt') || arg.endsWith('.query')) {
                // File input
                const fs = require('fs');
                if (fs.existsSync(arg)) {
                    input = fs.readFileSync(arg, 'utf8').trim();
                }
                else {
                    console.error(`Error: File ${arg} not found.`);
                    process.exit(1);
                }
            }
            else if (!input) {
                input = arg;
            }
        }
        if (!input) {
            console.error('Usage: node dist/queryParser.js [query] [--table <table>] [--column <column>]');
            console.error('Or: node dist/queryParser.js <file.txt> [--table <table>] [--column <column>]');
            process.exit(1);
        }
        const result = parseQuery(input);
        console.log('Parsed Query:');
        console.log(JSON.stringify(result, null, 2));
        // Build flexible filter
        const filterJson = buildFlexibleFilter(result, { table, column });
        console.log('\nPower BI Filter JSON:');
        console.log(JSON.stringify(filterJson, null, 2));
    }
    catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}
//# sourceMappingURL=queryParser.js.map