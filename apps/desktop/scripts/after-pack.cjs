const { execFileSync } = require("node:child_process");
const path = require("node:path");

// electron-builder drops dot-dirs (.next, node_modules/.pnpm) from
// extraResources, so the server is copied in here instead, symlinks intact.
exports.default = async ({ appOutDir, packager }) => {
  const resources = path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents/Resources");
  execFileSync("cp", ["-R", path.join(__dirname, "../build/server"), resources]);
};
