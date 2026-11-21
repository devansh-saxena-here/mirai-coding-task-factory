import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: [
      'dist/**/*',
      'frontend/**/*',
      'server/**/*',
      'server.ts',
      'node_modules/**/*',
      '.mirai-state/**/*',
      'eslint.config.js',
    ],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
