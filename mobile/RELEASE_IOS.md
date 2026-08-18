# iOS First Release (Expo + EAS)

This project is already configured for EAS. The required iOS identifier is set in `app.json`:

- `ios.bundleIdentifier = com.midaskiebert.mikino`

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
3. Bundle ID: `com.midaskiebert.mikino`
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

## 7. App Review submission notes

Fill in before submitting for review — the 2026-08-13 rejection (guideline
5.1.1(v)) came from a reviewer who could not get past the login screen, so
these exist to make sure the next one can:

- **Demo account**: give App Review a working email/password, and make sure
  that account already has at least one friend and one pending invite, so the
  Friends tab and the invite flow aren't empty on first look. Create this
  account manually before submitting — it is not seeded automatically.
- **Guest mode**: mention in the review notes that "Continue without an
  account" on the login/signup screen lets a reviewer browse showtimes, movies
  and cinemas without signing in — this is the fix for the 5.1.1(v) rejection,
  and it's worth pointing at explicitly rather than leaving it to be found.
- **Account deletion**: Settings → Danger zone → Delete account, if the
  reviewer asks to verify it.
- **Sign in with Apple**: only real users decide whether to hide their email;
  App Review's own test accounts already work this way, nothing to prep.

## 8. Before raising `MIN_SUPPORTED_CLIENT_VERSION_IOS`

Do not raise the iOS floor (`backend/app/core/config.py`) while a build is in
review — a 426 mid-review reads as the app being broken. Also confirm
`APP_STORE_URL_IOS` is set first: `UpdateRequiredScreen` only shows an "Update
Now" button when it has a store URL, so raising the floor before that is set
strands an iOS user on a screen with nothing to tap.
