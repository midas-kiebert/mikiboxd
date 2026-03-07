# Android Closed Testing (Expo + EAS + Google Play)

This project is configured for Android closed testing with EAS:

- Android package name: `com.midaskiebert.mikino`
- EAS build profile for Play uploads: `production-store` (builds an `aab`)
- EAS submit profile for Play closed testing: `android-closed` (`track: alpha`)

## 1. One-time setup

From `mobile/`:

```bash
npx expo login
npx eas login
```

If this is your first Android build on this Expo project:

```bash
npx eas build:configure
```

Create the Play Console app record (if it does not exist yet) with package name:

- `com.midaskiebert.mikino`

Make sure Firebase has an Android app for this exact package and replace:

- `mobile/android/app/google-services.json`

If Android notifications still fail after a fresh rebuild/reinstall with:

`Unable to retrieve the FCM server key for the recipient's app`

then the issue is Expo FCM push credentials for Android (not iOS). Verify in Expo
Credentials that `com.midaskiebert.mikino` has valid FCM credentials and rebuild/redeploy the Android app.

## 2. Build the Android App Bundle (AAB)

From `mobile/`:

```bash
npx eas build --platform android --profile production-store
```

## 2a. Build the Android App Bundle locally (without EAS Build)

If the current Play Console app was originally uploaded with an EAS-managed Android
keystore, a local `.aab` must be signed with that same upload key or Google Play
will reject it.

1. Export the existing Android keystore from Expo credentials once:

```bash
cd mobile
npx eas credentials -p android
```

Download the Android keystore and keep the `.jks` file plus its passwords/alias.

2. Configure local release signing with either environment variables or
`~/.gradle/gradle.properties`:

```properties
MIKINO_UPLOAD_STORE_FILE=/absolute/path/to/upload-keystore.jks
MIKINO_UPLOAD_STORE_PASSWORD=your-store-password
MIKINO_UPLOAD_KEY_ALIAS=your-key-alias
MIKINO_UPLOAD_KEY_PASSWORD=your-key-password
```

3. Build locally from `mobile/`:

```bash
pnpm build:aab
```

This runs Expo prebuild, then Gradle `bundleRelease`, and copies the final artifact to:

```text
mobile/dist/aab/mobile-release-<timestamp>.aab
```

If you do not configure the four `MIKINO_UPLOAD_*` values, the local release build
falls back to `debug.keystore`. That is useful for a smoke test, but it is not
uploadable to the existing Play app.

## 3. Submit the build to Google Play closed testing

From `mobile/`:

```bash
npx eas submit --platform android --profile android-closed --latest
```

`track: alpha` in EAS maps to Play closed testing.

## 4. Enable opt-in testers in Play Console

In Play Console:

1. Open your app -> **Testing** -> **Closed testing**
2. Create/select your testing track
3. Add testers via email lists or Google Groups
4. Save and copy the generated opt-in URL from **How testers can join your test**
5. Share that opt-in URL with testers

## 5. Requirement for some personal developer accounts

Google requires personal developer accounts created on or after **November 13, 2023** to run a closed test with at least **12 opted-in testers for 14 continuous days** before applying for production access.

## 6. Next app versions

For each new Android closed-testing candidate:

```bash
npx eas build --platform android --profile production-store
npx eas submit --platform android --profile android-closed --latest
```

## 7. Android App Links (`mikino.nl` opens in app)

For Android App Links, the website must publish
`frontend/public/.well-known/assetlinks.json` with the certificate fingerprint
used by the installed app build.

- Do not use the Android `debug.keystore` fingerprint in production. Its SHA256 is:
  `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`
- The Expo/EAS Android keystore for this project currently has SHA256:
  `B3:0C:36:16:6C:83:89:86:D9:C1:69:35:0A:0F:A3:AF:19:01:DA:03:74:77:65:10:DB:AF:7F:07:F7:A8:24:DC`
- The Google Play app-signing certificate shown by Play Console for this app is:
  `B8:77:61:74:BC:50:33:CF:20:36:63:6A:A9:F5:8B:DF:54:73:AD:6D:7E:3D:05:28:FE:78:B8:4A:CF:D9:D0:76`
- For Play-installed builds, `assetlinks.json` should use the Play app-signing
  certificate fingerprint, not the Expo upload keystore fingerprint. Only keep
  the debug fingerprint in the file if you intentionally want local debug builds
  to verify App Links too.

After updating `assetlinks.json`, redeploy the frontend and then reinstall the
Play test build or reset supported links on the device before testing again.
