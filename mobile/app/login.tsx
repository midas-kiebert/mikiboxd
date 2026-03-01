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
} from 'react-native'
import { useRouter } from 'expo-router'
import { useForm, Controller } from 'react-hook-form'
import useAuth from 'shared/hooks/useAuth'
import type { Body_login_login_access_token as AccessToken } from 'shared'
import { storage } from 'shared/storage'
import { useThemeColors } from '@/hooks/use-theme-color'
import { registerPushTokenForCurrentDevice } from '@/utils/push-notifications'
import { PENDING_FRIEND_INVITE_RECEIVER_ID_KEY } from '@/constants/friend-invite'
import { PENDING_SHOWTIME_PING_LINK_KEY } from '@/constants/ping-link'

export default function LoginScreen() {
    // Read flow: local state and data hooks first, then handlers, then the JSX screen.
    const router = useRouter()
    // Read the active theme color tokens used by this screen/component.
    const colors = useThemeColors()
    const styles = createStyles(colors)
    // useAuth centralizes token storage and error mapping for auth screens.
    const { loginMutation, error, resetError } = useAuth(
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
            try {
                await registerPushTokenForCurrentDevice()
            } catch (notificationError) {
                console.error('Error initializing push notifications after login:', notificationError)
            }
            const pendingFriendReceiverId = await storage.getItem(PENDING_FRIEND_INVITE_RECEIVER_ID_KEY)
            if (pendingFriendReceiverId) {
                await storage.removeItem(PENDING_FRIEND_INVITE_RECEIVER_ID_KEY)
                router.replace(`/add-friend/${encodeURIComponent(pendingFriendReceiverId)}`)
                return
            }
            const pendingShowtimePingLink = await storage.getItem(PENDING_SHOWTIME_PING_LINK_KEY)
            if (pendingShowtimePingLink) {
                await storage.removeItem(PENDING_SHOWTIME_PING_LINK_KEY)
                try {
                    const parsed = JSON.parse(pendingShowtimePingLink) as {
                        showtimeId?: unknown
                        sender?: unknown
                    }
                    if (
                        typeof parsed?.showtimeId === 'string' &&
                        parsed.showtimeId.length > 0 &&
                        typeof parsed?.sender === 'string' &&
                        parsed.sender.length > 0
                    ) {
                        router.replace(
                            (`/ping/${encodeURIComponent(parsed.showtimeId)}/${encodeURIComponent(parsed.sender)}` as never)
                        )
                        return
                    }
                } catch {
                    // Ignore malformed stored payload and continue to default route.
                }
            }
            router.replace('/(tabs)')
            console.log("loginMutation successful")
        } catch (error) {
            console.log("UNKNOWN ERROR", error)
            // Error handled by useAuth
        }
    }

    // Render/output using the state and derived values prepared above.
    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <View style={styles.form}>
                <Text style={styles.title}>Log In</Text>

                {error && (
                    <View style={styles.errorContainer}>
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                )}

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
            </View>
        </KeyboardAvoidingView>
    )
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
    StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: colors.background,
        },
        form: {
            flex: 1,
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
