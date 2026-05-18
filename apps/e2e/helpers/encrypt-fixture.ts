/**
 * Encrypt a fixture value with the same AES-256-GCM helper the app uses,
 * so seeded WorkspaceAiSettings rows can be decrypted at runtime.
 *
 * SECRETS_ENCRYPTION_KEY must be set in the playwright webServer env.
 */
export function encryptFixture(value: object): object {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const { encryptSecret } = require('../../../packages/auth/src/index') as {
    encryptSecret: (s: string) => object
  }
  return encryptSecret(JSON.stringify(value))
}
