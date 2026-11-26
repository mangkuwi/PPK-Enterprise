// Tanpa sertifikat Developer ID, electron-builder 25 melewati tanda tangan sepenuhnya, padahal macOS Apple Silicon
// menolak menjalankan aplikasi tanpa tanda tangan. Di sini .app diberi tanda tangan ad-hoc sebelum dikemas ke DMG/ZIP.
// Dengan sertifikat (CSC_LINK), electron-builder menandatangani ulang dengan Developer ID sesudah hook ini.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin' || process.env.CSC_LINK) return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
