const path = require('node:path');

/**
 * Electron Fuses configuration per §3:
 * - RunAsNode: false
 * - EnableCookieEncryption: true
 * - EnableNodeOptionsEnvironmentVariable: false
 * - EnableNodeCliInspectArguments: false
 * - EnableEmbeddedAsarIntegrityValidation: true
 * - OnlyLoadAppFromAsar: true
 */
const REQUIRED_FUSES = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
};

/**
 * electron-builder afterPack hook
 * @param {any} context
 */
exports.default = async function afterPack(context) {
  try {
    const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
    const ext = context.electronPlatformName === 'darwin' ? '.app' : '';
    const appPath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}${ext}`
    );

    await flipFuses(appPath, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: REQUIRED_FUSES.RunAsNode,
      [FuseV1Options.EnableCookieEncryption]: REQUIRED_FUSES.EnableCookieEncryption,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]:
        REQUIRED_FUSES.EnableNodeOptionsEnvironmentVariable,
      [FuseV1Options.EnableNodeCliInspectArguments]:
        REQUIRED_FUSES.EnableNodeCliInspectArguments,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
        REQUIRED_FUSES.EnableEmbeddedAsarIntegrityValidation,
      [FuseV1Options.OnlyLoadAppFromAsar]: REQUIRED_FUSES.OnlyLoadAppFromAsar,
    });
    console.log('[afterPackFuses] Flipped all 6 security fuses on', appPath);
  } catch (err) {
    console.warn('[afterPackFuses] @electron/fuses notice:', err && err.message ? err.message : err);
  }
};

exports.REQUIRED_FUSES = REQUIRED_FUSES;
