import type { Config } from "jest"

const config: Config = {
  preset: "ts-jest/presets/default-esm",
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: "test/integration/.*\\.e2e\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: "tsconfig.json" }],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^@src/(.*)$": "<rootDir>/src/$1",
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@repo/db$": "<rootDir>/../../packages/db/src/index.ts",
    "^@repo/storage$": "<rootDir>/../../packages/storage/src/index.ts",
  },
  testEnvironment: "node",
  testTimeout: 60000,
  setupFiles: ["<rootDir>/jest.setup.cjs"],
}

export default config
