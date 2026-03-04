# iOS First Release (Expo + EAS)

This project is already configured for EAS. The required iOS identifier is set in `app.json`:

- `ios.bundleIdentifier = com.midaskiebert.mobile`

## 1. One-time setup

From `mobile/`:

```bash
npx expo login
npx eas login
```

If this is your first iOS build on this Expo project:

```bash
npx eas build:configure
```

## 2. Create the App Store Connect app record

In App Store Connect:

1. Go to **Apps** -> **+** -> **New App**
2. Platform: **iOS**
3. Bundle ID: `com.midaskiebert.mobile`
4. SKU: any unique value (for example `mikino-ios-1`)

## 3. Build the production iOS binary

From `mobile/`:

```bash
npx eas build --platform ios --profile production
```

For the first build, let EAS manage certificates/profiles automatically when prompted.

## 4. Submit to TestFlight

After build completes:

```bash
npx eas submit --platform ios --profile ios-testflight --latest
```

Alternative all-in-one flow:

```bash
npx testflight
```

## 5. Enable testers

In App Store Connect:

1. Open your app -> **TestFlight**
2. Wait until build processing is complete
3. Add **Internal Testers** (fastest path)
4. For **External Testers**, submit the build for Beta App Review before external distribution

## 6. Next app versions

For each new release candidate:

```bash
npx eas build --platform ios --profile production
npx eas submit --platform ios --profile ios-testflight --latest
```

Because `eas.json` uses `"appVersionSource": "remote"`, keep versioning in EAS/Expo workflow for subsequent uploads.
