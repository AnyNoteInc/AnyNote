// Custom electron-builder macOS sign hook (mac.sign in electron-builder.yml).
//
// We have no Apple Developer ID certificate. electron-builder's default path,
// even with `identity: "-"`, only skips signing in v25 (it treats "-" as a
// keychain identity name to look up, finds none, and skips) — leaving the
// linker's bare ad-hoc signature with NO sealed bundle resources, which macOS
// reports as "приложение повреждено" ("app is damaged") on launch.
//
// This hook applies a PROPER ad-hoc signature with `codesign --deep --force
// --sign -` and our entitlements (disable-library-validation, so the ad-hoc
// app can load Electron's Team-ID'd frameworks). That seals the bundle
// resources and fixes the "damaged" error. The app is still unnotarized, so
// users get the normal "unidentified developer" prompt (right-click → Open /
// `xattr -dr com.apple.quarantine`) instead of the dead-end "damaged" dialog.
//
// Verified locally: codesign --verify --deep --strict → "valid on disk,
// satisfies its Designated Requirement"; Gatekeeper verdict changes from
// "code has no resources..." to a plain notarization rejection.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

// Absolute path: electron-builder's sign-hook spawn environment doesn't reliably
// have /usr/bin on PATH, so a bare `codesign` resolves to "No such file or
// directory". codesign always lives at /usr/bin/codesign on macOS.
const CODESIGN = '/usr/bin/codesign'

exports.default = async function signMacAdhoc(configuration) {
  // electron-builder 25 passes the bundle path as `app` (not `path`, which some
  // older docs show — that key is undefined here and would sign `undefined`).
  const appPath = configuration.app
  if (!appPath) {
    throw new Error(`[sign-mac-adhoc] no app path in configuration: ${Object.keys(configuration)}`)
  }
  const entitlements = path.join(__dirname, '..', 'build', 'entitlements.mac.plist')

  // --deep: sign nested frameworks/helpers; --force: replace the linker's
  // partial ad-hoc sig; --sign -: ad-hoc; --options runtime: hardened runtime
  // (pairs with the entitlements that re-enable what Electron needs).
  execFileSync(
    CODESIGN,
    ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, '--options', 'runtime', appPath],
    { stdio: 'inherit' },
  )

  // Fail loudly if the seal didn't take (don't ship a "damaged" app silently).
  execFileSync(CODESIGN, ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  })
}
