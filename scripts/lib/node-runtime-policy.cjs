/** Whether a stable runtime includes the supported LTS trust-store fixes. */
exports.isSupportedNodeVersion = function isSupportedNodeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+.*)?$/.exec(String(version).trim());
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (major === 22) return minor > 23 || (minor === 23 && patch >= 4);
  return major === 24 && (minor > 22 || (minor === 22 && patch >= 1));
};

exports.assertSupportedNodeVersion = function assertSupportedNodeVersion(version) {
  if (!exports.isSupportedNodeVersion(version)) {
    throw new Error('require Node 22.23.4+ (22.x) or 24.22.1+ (24.x) for CA trust-store security');
  }
};
