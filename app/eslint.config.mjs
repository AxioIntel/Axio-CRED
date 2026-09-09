import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {ignores:['node_modules/**','**/dist/**','.dev/**','.tools/**','frontend/vite.config.js','frontend/vite.config.d.ts']},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {files:['**/*.{ts,tsx,mjs}'],languageOptions:{globals:{...globals.node,...globals.browser}},rules:{
    // Existing JSON/provider adapters have gradual types; tsc remains a separate gate.
    '@typescript-eslint/no-explicit-any':'off',
    '@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_',caughtErrors:'none'}],
    'no-empty':['error',{allowEmptyCatch:true}]
  }}
);
