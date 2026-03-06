const fs = require("fs")
const path = require("path")
const { withAndroidManifest } = require("expo/config-plugins")

module.exports = ({ config }) => {
  const android = config.android || {}
  const { googleServicesFile: _ignoredGoogleServicesFile, ...androidWithoutGoogleServices } = android

  const localGoogleServicesPath = "./android/app/google-services.json"
  const hasLocalGoogleServicesFile = fs.existsSync(path.resolve(__dirname, localGoogleServicesPath))
  const resolvedGoogleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ||
    (hasLocalGoogleServicesFile ? localGoogleServicesPath : undefined)

  const baseConfig = {
    ...config,
    android: {
      ...androidWithoutGoogleServices,
      ...(resolvedGoogleServicesFile ? { googleServicesFile: resolvedGoogleServicesFile } : {}),
    },
  }

  return withAndroidManifest(baseConfig, (manifestConfig) => {
    const manifest = manifestConfig.modResults.manifest
    manifest["supports-screens"] = [
      {
        $: {
          "android:smallScreens": "true",
          "android:normalScreens": "true",
          "android:largeScreens": "false",
          "android:xlargeScreens": "false",
          "android:anyDensity": "true",
          "android:resizeable": "false",
        },
      },
    ]
    return manifestConfig
  })
}
