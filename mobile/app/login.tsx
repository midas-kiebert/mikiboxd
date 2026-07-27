/**
 * Expo Router screen/module for login. It controls navigation and screen-level state for this route.
 */
import { useRef, useState } from 'react'
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useForm, Controller } from 'react-hook-form'
import useAuth from 'shared/hooks/useAuth'
import type { Body_login_login_access_token as AccessToken } from 'shared'

import AuthPrimaryButton from '@/components/auth/AuthPrimaryButton'
import AuthScreenShell from '@/components/auth/AuthScreenShell'
import AuthTextField from '@/components/auth/AuthTextField'
import SocialSignInSection from '@/components/auth/SocialSignInSection'
import { ThemedText } from '@/components/themed-text'
import { useThemeColors } from '@/hooks/use-theme-color'
import { useSingleFireNavigation } from '@/hooks/useSingleFireNavigation'
import { completeLogin } from '@/utils/complete-login'
import { EMAIL_PATTERN } from '@/constants/auth'

export default function LoginScreen() {
    // Read flow: local state and data hooks first, then handlers, then the JSX screen.
    const router = useRouter()
    // Read the active theme color tokens used by this screen/component.
    const colors = useThemeColors()
    const styles = createStyles(colors)
    const passwordRef = useRef<TextInput>(null)
    const goToSignUp = useSingleFireNavigation(() => router.push('/signup'))
    const goToRecoverPassword = useSingleFireNavigation(() => router.push('/recover-password'))
    // Set while a provider sheet is open, so the email form below cannot be
    // driven at the same time.
    const [isSocialSignInBusy, setIsSocialSignInBusy] = useState(false)
    // useAuth centralizes token storage and error mapping for auth screens.
    const { loginMutation, socialLoginMutation, error, resetError } = useAuth()

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
        if (isSubmitting || isSocialSignInBusy) return
        resetError()
        try {
            // `mutateAsync` throws on failure so the catch block can handle unknown errors.
            await loginMutation.mutateAsync(data)
            await completeLogin(router)
        } catch (loginError) {
            console.log('Login error', loginError)
            // Error handled by useAuth
        }
    }

    // Wrapped so both the button and the keyboard's Go key call the same thing,
    // without either having to care that it returns a promise.
    const submitForm = () => {
        void handleSubmit(onSubmit)()
    }

    // Render/output using the state and derived values prepared above.
    return (
        <AuthScreenShell
            title="Welcome back"
            subtitle="Your cinema agenda, and your friends' too."
            error={error}
            footer={
                <TouchableOpacity
                    onPress={goToSignUp}
                    disabled={isSubmitting || isSocialSignInBusy}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                >
                    <ThemedText style={styles.linkText}>
                        Don&apos;t have an account? <ThemedText style={styles.link}>Sign Up</ThemedText>
                    </ThemedText>
                </TouchableOpacity>
            }
        >
            {/* One-tap sign-in/sign-up: no navigation to /signup needed for either
                provider, since the backend creates the account on first use. */}
            <SocialSignInSection
                mode="sign-in"
                socialLoginMutation={socialLoginMutation}
                resetError={resetError}
                isDisabled={isSubmitting}
                onBusyChange={setIsSocialSignInBusy}
            />

            <View style={styles.form}>
                {/* Email field uses Controller so validation and input stay in sync. */}
                <Controller
                    control={control}
                    name="username"
                    rules={{
                        required: 'Email is required',
                        pattern: {
                            value: EMAIL_PATTERN,
                            message: 'Invalid email address',
                        },
                    }}
                    render={({ field: { onChange, onBlur, value } }) => (
                        <AuthTextField
                            label="Email"
                            placeholder="you@example.com"
                            error={errors.username?.message}
                            onBlur={onBlur}
                            onChangeText={onChange}
                            value={value}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="email-address"
                            autoComplete="email"
                            returnKeyType="next"
                            editable={!isSocialSignInBusy}
                            onSubmitEditing={() => passwordRef.current?.focus()}
                        />
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
                        <AuthTextField
                            ref={passwordRef}
                            label="Password"
                            placeholder="Your password"
                            error={errors.password?.message}
                            onBlur={onBlur}
                            onChangeText={onChange}
                            value={value}
                            secureTextEntry
                            autoCapitalize="none"
                            autoComplete="password"
                            returnKeyType="go"
                            editable={!isSocialSignInBusy}
                            onSubmitEditing={submitForm}
                        />
                    )}
                />

                <TouchableOpacity
                    style={styles.forgotButton}
                    onPress={goToRecoverPassword}
                    disabled={isSubmitting || isSocialSignInBusy}
                    hitSlop={6}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                >
                    <ThemedText style={styles.forgotLink}>Forgot password?</ThemedText>
                </TouchableOpacity>

                <AuthPrimaryButton
                    label="Log In"
                    onPress={submitForm}
                    isBusy={isSubmitting}
                    isDisabled={isSocialSignInBusy}
                />
            </View>

            {/* Dev-only shortcut: lets the pick-username screen be reached and
                tested straight from Expo Go, without a real Apple/Google sign-in. */}
            {__DEV__ && (
                <TouchableOpacity
                    style={styles.devButton}
                    onPress={() =>
                        router.push({ pathname: '/pick-username', params: { suggestion: 'Jan de Vries' } })
                    }
                >
                    <ThemedText style={styles.devLink}>[dev] Preview pick-username screen</ThemedText>
                </TouchableOpacity>
            )}
        </AuthScreenShell>
    )
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
    StyleSheet.create({
        form: {
            gap: 12,
        },
        linkText: {
            textAlign: 'center',
            fontSize: 14,
            color: colors.textSecondary,
        },
        link: {
            fontSize: 14,
            color: colors.tint,
            fontWeight: '700',
        },
        forgotButton: {
            alignSelf: 'flex-end',
            marginTop: -4,
        },
        forgotLink: {
            fontSize: 13,
            color: colors.tint,
            fontWeight: '600',
        },
        devButton: {
            paddingTop: 14,
        },
        devLink: {
            textAlign: 'center',
            color: colors.textSecondary,
            fontSize: 12,
        },
    })
