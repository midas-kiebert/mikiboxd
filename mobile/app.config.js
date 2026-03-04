const appJson = require("./app.json")
const fs = require("fs")
const path = require("path")

module.exports = () => {
  const expo = appJson.expo
  const android = expo.android || {}
  const { googleServicesFile: _ignoredGoogleServicesFile, ...androidWithoutGoogleServices } = android
  const localGoogleServicesPath = "./android/app/google-services.json"
  const hasLocalGoogleServicesFile = fs.existsSync(path.resolve(__dirname, localGoogleServicesPath))
  const resolvedGoogleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ||
    (hasLocalGoogleServicesFile ? localGoogleServicesPath : undefined)

  return {
    ...expo,
    android: {
      ...androidWithoutGoogleServices,
      // In EAS Build, set GOOGLE_SERVICES_JSON as a file env var.
      // EAS injects the absolute file path into this env var at build time.
      ...(resolvedGoogleServicesFile ? { googleServicesFile: resolvedGoogleServicesFile } : {}),
    },
  }
}
