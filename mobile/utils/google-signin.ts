import Constants, { ExecutionEnvironment } from 'expo-constants'

type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin')

// Expo Go doesn't bundle this native module — merely importing it there
// crashes immediately (TurboModuleRegistry throws at module load), so it must
// only ever be required from a build that actually contains it.
export const isGoogleSignInAvailable =
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient

let cachedModule: GoogleSigninModule | null = null

export function getGoogleSignin(): GoogleSigninModule {
    if (!isGoogleSignInAvailable) {
        throw new Error(
            'Google Sign-In is not available in Expo Go — use a development build.'
        )
    }
    if (!cachedModule) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        cachedModule = require('@react-native-google-signin/google-signin')
    }
    return cachedModule as GoogleSigninModule
}
