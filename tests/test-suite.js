const { tokenize, parseQuery, buildFlexibleFilter } = require('../lib/queryParser');

// Helper function to count all conditions recursively
function countAllConditions(parsed) {
    if (!parsed) return 0;
    if ('value' in parsed) return 1;

    let count = 0;
    parsed.conditions.forEach(cond => {
        if ('value' in cond) {
            count++;
        } else {
            count += countAllConditions(cond);
        }
    });
    return count;
}

// Helper function to log all conditions recursively with their properties
function logAllConditions(parsed, indent = '') {
    if (!parsed) return;

    if ('value' in parsed) {
        // It's a Condition
        console.log(`${indent}📝 Term: "${parsed.value}"`);
        console.log(`${indent}   "isQuoted": ${parsed.isQuoted},`);
        console.log(`${indent}   "isRequired": ${parsed.isRequired},`);
        console.log(`${indent}   "isExcluded": ${parsed.isExcluded}`);
    } else {
        // It's a ParsedQuery
        console.log(`${indent}🔗 Group (${parsed.logicalOperator}):`);
        parsed.conditions.forEach((cond, i) => {
            console.log(`${indent}  ${i + 1}.`);
            logAllConditions(cond, indent + '     ');
        });
    }
}

// Test suite for advanced search query parser
function runTestSuite() {
    console.log('🧪 Running Advanced Search Query Parser Test Suite...\n');

    const testCases = [
        {
            name: 'Simple phrase search',
            query: 'customer service',
            table: 'Tickets',
            column: 'Category',
            expectedTokens: 2,
            expectedConditions: 2
        },
        {
            name: 'Quoted phrase search',
            query: '"customer service"',
            table: 'Tickets',
            column: 'Category',
            expectedTokens: 1,
            expectedConditions: 1
        },
        {
            name: 'Required term (+)',
            query: '+urgent',
            table: 'Tickets',
            column: 'Priority',
            expectedTokens: 1,
            expectedConditions: 1
        },
        {
            name: 'Excluded term (-)',
            query: '-draft',
            table: 'Tickets',
            column: 'Status',
            expectedTokens: 1,
            expectedConditions: 1
        },
        {
            name: 'AND logic',
            query: 'urgent AND high',
            table: 'Tickets',
            column: 'Priority',
            expectedTokens: 3,
            expectedConditions: 2
        },
        {
            name: 'OR logic',
            query: 'urgent OR high',
            table: 'Tickets',
            column: 'Priority',
            expectedTokens: 3,
            expectedConditions: 2
        },
        {
            name: 'Parentheses grouping',
            query: '(urgent OR high) AND critical',
            table: 'Tickets',
            column: 'Priority',
            expectedTokens: 7,
            expectedConditions: 3
        },
        {
            name: 'Complex query with all features',
            query: '"customer service" +resolved -escalated',
            table: 'Tickets',
            column: 'Category',
            expectedTokens: 3,
            expectedConditions: 3
        },
        {
            name: 'Nested parentheses',
            query: '((urgent OR high) AND (critical OR blocker))',
            table: 'Tickets',
            column: 'Priority',
            expectedTokens: 13,
            expectedConditions: 4
        },
        {
            name: 'Mixed operators',
            query: 'urgent OR high AND critical',
            table: 'Tickets',
            column: 'Priority',
            expectedTokens: 5,
            expectedConditions: 3
        }
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach((testCase, index) => {
        try {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`Test ${index + 1}: ${testCase.name}`);
            console.log(`Query: "${testCase.query}"`);
            console.log(`${'='.repeat(60)}`);

            // Tokenize
            const tokens = tokenize(testCase.query);
            console.log(`📊 Tokens: ${tokens.length} (expected: ${testCase.expectedTokens})`);

            // Parse
            const parsed = parseQuery(testCase.query);
            const actualConditions = countAllConditions(parsed);
            console.log(`📊 Conditions: ${actualConditions} (expected: ${testCase.expectedConditions})`);

            // Log detailed condition analysis
            console.log(`\n🔍 Condition Analysis:`);
            logAllConditions(parsed);

            // Build filter
            const filter = buildFlexibleFilter(parsed, { table: testCase.table, column: testCase.column });
            console.log(`\n🏗️  Generated Filter JSON:`);
            console.log(JSON.stringify(filter, null, 2));

            // Validate expectations
            const tokensMatch = tokens.length === testCase.expectedTokens;
            const conditionsMatch = actualConditions === testCase.expectedConditions;
            const filterExists = !!filter;

            console.log(`\n📋 Validation Results:`);
            console.log(`   Tokens match: ${tokensMatch ? '✅' : '❌'} (${tokens.length}/${testCase.expectedTokens})`);
            console.log(`   Conditions match: ${conditionsMatch ? '✅' : '❌'} (${actualConditions}/${testCase.expectedConditions})`);
            console.log(`   Filter generated: ${filterExists ? '✅' : '❌'}`);

            if (tokensMatch && conditionsMatch && filterExists) {
                console.log('\n🎉 RESULT: PASSED');
                passed++;
            } else {
                console.log('\n💥 RESULT: FAILED');
                failed++;
            }

        } catch (error) {
            console.log(`\n💥 ERROR: ${error.message}`);
            console.log('🎉 RESULT: FAILED');
            failed++;
        }
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 FINAL TEST RESULTS`);
    console.log(`${'='.repeat(60)}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`🎯 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

    if (failed === 0) {
        console.log('\n🎉 ALL TESTS PASSED! The parser is working perfectly.');
        console.log('🚀 Ready for production use!');
    } else {
        console.log('\n⚠️  Some tests failed. Please review the implementation.');
        console.log('🔧 Check the detailed output above for debugging information.');
    }
}

// Run the test suite
if (require.main === module) {
    runTestSuite();
}

module.exports = { runTestSuite };
