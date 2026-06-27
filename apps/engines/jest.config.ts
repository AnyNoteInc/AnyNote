import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['<rootDir>/test/integration/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@repo/db$': '<rootDir>/../../packages/db/src/index.ts',
    '^@repo/auth/secret-encryption(\\.ts)?$':
      '<rootDir>/../../packages/auth/src/secret-encryption.ts',
    '^@repo/auth/provider-connection(\\.ts)?$':
      '<rootDir>/../../packages/auth/src/provider-connection.ts',
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.cjs'],
}

export default config
