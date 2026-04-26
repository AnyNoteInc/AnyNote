import type { ESLint, Linter } from 'eslint'
import js from '@eslint/js'
import { globalIgnores } from 'eslint/config'
import eslintConfigPrettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'
import pluginReactHooks from 'eslint-plugin-react-hooks'
import pluginReact from 'eslint-plugin-react'
import globals from 'globals'
import pluginNext from '@next/eslint-plugin-next'
import { config as baseConfig } from './base.js'

const nextPluginRules = {
  ...pluginNext.configs.recommended.rules,
  ...pluginNext.configs['core-web-vitals'].rules,
} as Linter.RulesRecord

const nextPluginConfig: Linter.Config = {
  plugins: {
    '@next/next': pluginNext as unknown as ESLint.Plugin,
  },
  rules: nextPluginRules,
}

const reactHooksConfig: Linter.Config = {
  plugins: {
    'react-hooks': pluginReactHooks as unknown as ESLint.Plugin,
  },
  settings: { react: { version: 'detect' } },
  rules: {
    ...pluginReactHooks.configs.recommended.rules,
    'react/react-in-jsx-scope': 'off',
  },
}

/**
 * A custom ESLint configuration for libraries that use Next.js.
 */
export const nextJsConfig: Linter.Config[] = [
  ...baseConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  nextPluginConfig,
  reactHooksConfig,
]

export default nextJsConfig
