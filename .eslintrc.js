module.exports = {
    parser: 'babel-eslint',
    env: {
        browser: true,
        node: true,
        es6: true,
        jest: true,
        mongo: true
    },
    parserOptions:{
        ecmaVersion: 8
    },
    plugins: ['import'],
    rules: {
        'max-len': ['error', 480],
        'no-mixed-operators': 'off',
        'prefer-destructuring': [
            'error',
            {
                VariableDeclarator: {
                    array: false,
                    object: true,
                },
                AssignmentExpression: {
                    array: true,
                    object: false,
                },
            },
            {
                enforceForRenamedProperties: false,
            },
        ],
        'import/prefer-default-export': 'off',
    },
};
