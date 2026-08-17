import js from '@eslint/js';

/* GJS provides these without an import; gi:// modules are imported normally. */
const gjsGlobals = {
    console: 'readonly',
    imports: 'readonly',
    log: 'readonly',
    logError: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    pkg: 'readonly',
    TextDecoder: 'readonly',
    TextEncoder: 'readonly',
    globalThis: 'readonly',
};

export default [
    {
        ignores: ['node_modules/**', 'schemas/gschemas.compiled'],
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: gjsGlobals,
        },
        rules: {
            /* GNOME Shell style keeps the class passed to GObject.registerClass()
             * flush with the call, so its members sit at one indent level. */
            'indent': ['error', 4, {
                SwitchCase: 1,
                ignoredNodes: [
                    'CallExpression > ClassExpression',
                    'CallExpression > ClassExpression > ClassBody > *',
                ],
            }],
            'quotes': ['error', 'single', {avoidEscape: true}],
            'semi': ['error', 'always'],
            'comma-dangle': ['error', 'always-multiline'],
            'max-len': ['error', {code: 200}],
            'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
            'prefer-const': 'error',
            'eqeqeq': ['error', 'always'],
            'curly': ['error', 'multi-or-nest', 'consistent'],
        },
    },
];
