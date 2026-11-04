// electron-builder afterPack hook. Hangar has no Apple Developer ID, so the Mac
// app is signed "ad hoc" (a local signature): an Apple Silicon Mac will not run
// an app whose signature broke when it was renamed from Electron.app, and a
// build made on this Mac is not quarantined, so it opens without a warning.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log(`  • signed ad hoc  ${app}`)
}
