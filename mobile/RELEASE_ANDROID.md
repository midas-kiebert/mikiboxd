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

## 2. Build the Android App Bundle (AAB)

From `mobile/`:

```bash
npx eas build --platform android --profile production-store
```

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
