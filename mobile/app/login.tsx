/**
 * Expo Router screen/module for login. It controls navigation and screen-level state for this route.
 */
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useForm, Controller } from 'react-hook-form'
import * as AppleAuthentication from 'expo-apple-authentication'
import { getGoogleSignin, isGoogleSignInAvailable } from '@/utils/google-signin'
import useAuth from 'shared/hooks/useAuth'
import type { Body_login_login_access_token as AccessToken } from 'shared'
import { useThemeColors } from '@/hooks/use-theme-color'
import { completeLogin } from '@/utils/complete-login'
import { markIntroPending } from '@/utils/intro'

export default function LoginScreen() {
    // Read flow: local state and data hooks first, then handlers, then the JSX screen.
    const router = useRouter()
    // Read the active theme color tokens used by this screen/component.
    const colors = useThemeColors()
    const styles = createStyles(colors)
    // useAuth centralizes token storage and error mapping for auth screens.
    const { loginMutation, socialLoginMutation, error, resetError } = useAuth(
        undefined,
        () => router.replace('/login') // onLogout
    )

    const {
        control,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<AccessToken>({
        // Keep fields controlled from first render to avoid uncontrolled->controlled warnings.
        defaultValues: {
            username: '',
            password: '',
        },
    })

    const onSubmit = async (data: AccessToken) => {
        // Prevent duplicate mutation calls while react-hook-form is already submitting.
        if (isSubmitting) {
            console.log("Submission in progress, please wait.")
            return
        }
        resetError()
        try {
            // `mutateAsync` throws on failure so the catch block can handle unknown errors.
            console.log("About to call login mutation")
            await loginMutation.mutateAsync(data)
            await completeLogin(router)
            console.log("loginMutation successful")
        } catch (error) {
            console.log("UNKNOWN ERROR", error)
            // Error handled by useAuth
        }
    }

    const handleAppleSignIn = async () => {
        resetError()
        try {
            const credential = await AppleAuthentication.signInAsync({
                requestedScopes: [
                    AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                    AppleAuthentication.AppleAuthenticationScope.EMAIL,
                ],
            })
            if (!credential.identityToken) return
            // fullName is only populated on the very first authorization for a
            // given app, so this is only usable as a pick-username suggestion
            // on account creation.
            const displayName = credential.fullName
                ? [credential.fullName.givenName, credential.fullName.familyName]
                    .filter(Boolean)
                    .join(' ')
                : undefined
            const { needsUsername } = await socialLoginMutation.mutateAsync({
                provider: 'apple',
                token: credential.identityToken,
            })
            if (needsUsername) {
                // No username yet means the backend just created this account.
                markIntroPending()
                router.replace({ pathname: '/pick-username', params: { suggestion: displayName ?? '' } })
                return
            }
            await completeLogin(router)
        } catch (appleError: unknown) {
            if ((appleError as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return
            console.log('Apple sign-in error', appleError)
            // Error handled by useAuth for API failures; silently ignored otherwise.
        }
    }

    const handleGoogleSignIn = async () => {
        if (!isGoogleSignInAvailable) return
        resetError()
        try {
            const { GoogleSignin } = getGoogleSignin()
            await GoogleSignin.hasPlayServices()
            const response = await GoogleSignin.signIn()
            if (response.type !== 'success' || !response.data.idToken) return
            const { needsUsername } = await socialLoginMutation.mutateAsync({
                provider: 'google',
                token: response.data.idToken,
            })
            if (needsUsername) {
                markIntroPending()
                router.replace({
                    pathname: '/pick-username',
                    params: { suggestion: response.data.user.name ?? '' },
                })
                return
            }
            await completeLogin(router)
        } catch (googleError: unknown) {
            const { statusCodes } = getGoogleSignin()
            const code = (googleError as { code?: string })?.code
            if (code === statusCodes.SIGN_IN_CANCELLED) return
            console.log('Google sign-in error', googleError)
            // Error handled by useAuth for API failures; silently ignored otherwise.
        }
    }

    // Render/output using the state and derived values prepared above.
    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.flex}
        >
            {/* Scrollable so the submit button stays reachable when the keyboard
                takes half the screen on a small phone, or when the user's font
                scale makes the form taller than the viewport. */}
            <ScrollView
                contentContainerStyle={styles.form}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <Text style={styles.title}>Log In</Text>

                {error && (
                    <View style={styles.errorContainer}>
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                )}

                {/* One-tap sign-in/sign-up: no navigation to /signup needed for either
                    provider, since the backend creates the account on first use. */}
                {Platform.OS === 'ios' && (
                    <AppleAuthentication.AppleAuthenticationButton
                        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                        cornerRadius={8}
                        style={styles.appleButton}
                        onPress={handleAppleSignIn}
                    />
                )}

                {isGoogleSignInAvailable && (
                    <TouchableOpacity style={styles.googleButton} onPress={handleGoogleSignIn}>
                        <Text style={styles.googleButtonText}>Continue with Google</Text>
                    </TouchableOpacity>
                )}

                <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>or continue with email</Text>
                    <View style={styles.dividerLine} />
                </View>

                {/* Email field uses Controller so validation and input stay in sync. */}
                <Controller
                    control={control}
                    name="username"
                    rules={{
                        required: 'Email is required',
                        pattern: {
                            value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                            message: 'Invalid email address',
                        },
                    }}
                    render={({ field: { onChange, onBlur, value } }) => (
                        <View style={styles.inputContainer}>
                            <TextInput
                                style={[styles.input, errors.username && styles.inputError]}
                                placeholder="Email"
                                placeholderTextColor={colors.textSecondary}
                                onBlur={onBlur}
                                onChangeText={onChange}
                                value={value}
                                autoCapitalize="none"
                                keyboardType="email-address"
                                autoComplete="email"
                                selectionColor={colors.tint}
                            />
                            {errors.username && (
                                <Text style={styles.fieldError}>{errors.username.message}</Text>
                            )}
                        </View>
                    )}
                />

                {/* Password field follows the same controlled/validated pattern. */}
                <Controller
                    control={control}
                    name="password"
                    rules={{
                        required: 'Password is required',
                    }}
                    render={({ field: { onChange, onBlur, value } }) => (
                        <View style={styles.inputContainer}>
                            <TextInput
                                style={[styles.input, errors.password && styles.inputError]}
                                placeholder="Password"
                                placeholderTextColor={colors.textSecondary}
                                onBlur={onBlur}
                                onChangeText={onChange}
                                value={value}
                                secureTextEntry
                                autoCapitalize="none"
                                autoComplete="password"
                                selectionColor={colors.tint}
                            />
                            {errors.password && (
                                <Text style={styles.fieldError}>{errors.password.message}</Text>
                            )}
                        </View>
                    )}
                />

                <TouchableOpacity onPress={() => router.push('/recover-password')}>
                    <Text style={styles.forgotLink}>Forgot Password?</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.button}
                    onPress={handleSubmit(onSubmit)}
                    disabled={isSubmitting}
                >
                    {isSubmitting ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.buttonText}>Log In</Text>
                    )}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.push('/signup')}>
                    <Text style={styles.linkText}>
                        Don&apos;t have an account? <Text style={styles.link}>Sign Up</Text>
                    </Text>
                </TouchableOpacity>

                {/* Dev-only shortcut: lets the pick-username screen be reached and
                    tested straight from Expo Go, without a real Apple/Google sign-in. */}
                {__DEV__ && (
                    <TouchableOpacity
                        onPress={() =>
                            router.push({ pathname: '/pick-username', params: { suggestion: 'Jan de Vries' } })
                        }
                    >
                        <Text style={styles.devLink}>[dev] Preview pick-username screen</Text>
                    </TouchableOpacity>
                )}
            </ScrollView>
        </KeyboardAvoidingView>
        </SafeAreaView>
    )
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
    StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: colors.background,
        },
        flex: {
            flex: 1,
        },
        form: {
            // flexGrow (not flex) so the form still centres when it fits, but the
            // ScrollView can grow past the viewport when it doesn't.
            flexGrow: 1,
            justifyContent: 'center',
            padding: 20,
        },
        title: {
            fontSize: 32,
            fontWeight: 'bold',
            marginBottom: 40,
            textAlign: 'center',
            color: colors.text,
        },
        appleButton: {
            height: 48,
            marginBottom: 12,
        },
        googleButton: {
            height: 48,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            backgroundColor: colors.cardBackground,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
        },
        googleButtonText: {
            color: colors.text,
            fontSize: 16,
            fontWeight: '600',
        },
        dividerRow: {
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 20,
        },
        dividerLine: {
            flex: 1,
            height: 1,
            backgroundColor: colors.cardBorder,
        },
        dividerText: {
            marginHorizontal: 10,
            color: colors.textSecondary,
            fontSize: 13,
        },
        inputContainer: {
            marginBottom: 20,
        },
        input: {
            borderWidth: 1,
            borderColor: colors.cardBorder,
            borderRadius: 8,
            padding: 15,
            fontSize: 16,
            color: colors.text,
            backgroundColor: colors.cardBackground,
        },
        inputError: {
            borderColor: colors.red.secondary,
        },
        fieldError: {
            color: colors.red.secondary,
            fontSize: 12,
            marginTop: 5,
        },
        button: {
            backgroundColor: colors.tint,
            borderRadius: 8,
            padding: 15,
            alignItems: 'center',
            marginTop: 10,
        },
        buttonText: {
            color: colors.pillActiveText,
            fontSize: 16,
            fontWeight: '600',
        },
        linkText: {
            textAlign: 'center',
            marginTop: 20,
            color: colors.textSecondary,
        },
        link: {
            color: colors.tint,
            fontWeight: '600',
        },
        forgotLink: {
            color: colors.tint,
            marginTop: -2,
            marginBottom: 8,
            alignSelf: 'flex-start',
            fontWeight: '600',
        },
        devLink: {
            textAlign: 'center',
            marginTop: 16,
            color: colors.textSecondary,
            fontSize: 12,
        },
        errorContainer: {
            backgroundColor: colors.red.primary,
            padding: 10,
            borderRadius: 8,
            marginBottom: 20,
            borderWidth: 1,
            borderColor: colors.red.secondary,
        },
        errorText: {
            color: colors.red.secondary,
            textAlign: 'center',
        },
    })
