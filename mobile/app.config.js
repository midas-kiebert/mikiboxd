const fs = require("fs")
const path = require("path")
const { withAndroidManifest } = require("expo/config-plugins")
const withIosFromRightBackAnim = require("./plugins/with-ios-from-right-back-anim")

function resolvePathFromProjectRoot(filePath) {
  if (!filePath) return undefined
  return path.isAbsolute(filePath) ? filePath : path.resolve(__dirname, filePath)
}

function readAndroidPackageNamesFromGoogleServices(filePath) {
  const absolutePath = resolvePathFromProjectRoot(filePath)
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new Error(
      `Android googleServicesFile does not exist: ${filePath ?? "<empty>"} (resolved: ${
        absolutePath ?? "<empty>"
      })`
    )
  }

  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"))
  } catch (error) {
    throw new Error(
      `Unable to parse Android googleServicesFile JSON at ${absolutePath}: ${String(
        error?.message || error
      )}`
    )
  }

  const packageNames = (parsed?.client || [])
    .map((client) => client?.client_info?.android_client_info?.package_name)
    .filter(Boolean)

  return { absolutePath, packageNames }
}

module.exports = ({ config }) => {
  const android = config.android || {}
  const { googleServicesFile: _ignoredGoogleServicesFile, ...androidWithoutGoogleServices } = android

  const localGoogleServicesPath = "./android/app/google-services.json"
  const hasLocalGoogleServicesFile = fs.existsSync(path.resolve(__dirname, localGoogleServicesPath))
  const resolvedGoogleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ||
    (hasLocalGoogleServicesFile ? localGoogleServicesPath : undefined)
  const expectedAndroidPackage = androidWithoutGoogleServices.package

  if (resolvedGoogleServicesFile && expectedAndroidPackage) {
    const { absolutePath, packageNames } =
      readAndroidPackageNamesFromGoogleServices(resolvedGoogleServicesFile)

    if (!packageNames.includes(expectedAndroidPackage)) {
      throw new Error(
        `Android package mismatch for googleServicesFile.\n` +
          `Expected package: ${expectedAndroidPackage}\n` +
          `Found packages: ${packageNames.length > 0 ? packageNames.join(", ") : "<none>"}\n` +
          `Resolved file: ${absolutePath}\n` +
          `Hint: update or remove GOOGLE_SERVICES_JSON in EAS env so mikino builds use the correct Firebase app JSON.`
      )
    }
  }

  // The iOS URL scheme is the reversed-DNS form of the Google iOS OAuth
  // client ID (from Google Cloud Console), e.g.
  // "com.googleusercontent.apps.1234567890-abc123". Sign-in on iOS silently
  // fails to return to the app without it, but it's harmless to omit locally
  // before the client ID exists.
  const googleIosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME
  // The Web OAuth client ID — used as `webClientId` when configuring
  // GoogleSignin at app startup, and as the token audience the backend checks.
  const googleWebClientId = process.env.GOOGLE_WEB_CLIENT_ID

  const plugins = [
    ...(config.plugins || []),
    [
      "@react-native-google-signin/google-signin",
      ...(googleIosUrlScheme ? [{ iosUrlScheme: googleIosUrlScheme }] : []),
    ],
  ]

  const baseConfig = {
    ...config,
    plugins,
    extra: {
      ...config.extra,
      ...(googleWebClientId ? { googleWebClientId } : {}),
    },
    android: {
      ...androidWithoutGoogleServices,
      ...(resolvedGoogleServicesFile ? { googleServicesFile: resolvedGoogleServicesFile } : {}),
    },
  }

  const configWithBackAnim = withIosFromRightBackAnim(baseConfig)

  return withAndroidManifest(configWithBackAnim, (manifestConfig) => {
    const manifest = manifestConfig.modResults.manifest
    const permissions = manifest["uses-permission"] || []

    const hasPostNotificationsPermission = permissions.some(
      (permission) =>
        permission?.$?.["android:name"] === "android.permission.POST_NOTIFICATIONS"
    )

    if (!hasPostNotificationsPermission) {
      permissions.push({
        $: {
          "android:name": "android.permission.POST_NOTIFICATIONS",
        },
      })
      manifest["uses-permission"] = permissions
    }

    return manifestConfig
  })
}
