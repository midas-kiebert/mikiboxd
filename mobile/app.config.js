const fs = require("fs")
const path = require("path")

module.exports = ({ config }) => {
  const android = config.android || {}
  const { googleServicesFile: _ignoredGoogleServicesFile, ...androidWithoutGoogleServices } = android

  const localGoogleServicesPath = "./android/app/google-services.json"
  const hasLocalGoogleServicesFile = fs.existsSync(path.resolve(__dirname, localGoogleServicesPath))
  const resolvedGoogleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ||
    (hasLocalGoogleServicesFile ? localGoogleServicesPath : undefined)

  return {
    ...config,
    android: {
      ...androidWithoutGoogleServices,
      ...(resolvedGoogleServicesFile ? { googleServicesFile: resolvedGoogleServicesFile } : {}),
    },
  }
}
