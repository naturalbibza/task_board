import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/', '**/node_modules/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Аргументы с префиксом _ (например, _next в обработчике ошибок) — намеренно неиспользуемые.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
