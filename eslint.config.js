import js from '@eslint/js';
import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: [
      'dist/**/*',
      'frontend/**/*',
      'server/**/*',
      'server.ts',
      'tests/**/*',
      'node_modules/**/*',
      '.mirai-state/**/*',
      '.phase8-work/**/*',
    ],
  },
  {
    files: ['eslint.config.js'],
    ...js.configs.recommended,
  },
  {
    files: ['firestore.rules'],
    ...firebaseRulesPlugin.configs['flat/recommended'],
  },
];
