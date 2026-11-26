const { withAndroidManifest } = require('@expo/config-plugins');

/** Keep the private Tailnet client fail-closed to cleartext traffic in native Android builds. */
module.exports = function withPrivateAndroidManifest(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) throw Error('Android manifest has no application element');
    application.$['android:usesCleartextTraffic'] = 'false';
    return mod;
  });
};
