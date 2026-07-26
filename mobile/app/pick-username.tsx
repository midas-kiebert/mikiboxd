/**
 * Expo Router screen/module for pick-username. It controls navigation and screen-level state for this route.
 */
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Controller, useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { MeService, type ApiError, type UserUpdate } from 'shared'
import { handleError, usernameMaxLength, usernamePattern } from 'shared/utils'
import { useThemeColors } from '@/hooks/use-theme-color'
import { completeLogin } from '@/utils/complete-login'

type PickUsernameForm = {
    display_name: string
}

// A raw provider name (e.g. Apple's "Jan de Vries") isn't a valid app
// username — strip anything outside [A-Za-z0-9_] and truncate, purely as a
// starting suggestion the user can still edit or replace entirely.
function suggestUsername(rawName: string | undefined): string {
    if (!rawName) return ''
    return rawName.replace(/[^A-Za-z0-9_]/g, '').slice(0, usernameMaxLength)
}

export default function PickUsernameScreen() {
    const router = useRouter()
    const { suggestion } = useLocalSearchParams<{ suggestion?: string }>()
    const colors = useThemeColors()
    const styles = createStyles(colors)

    const {
        control,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<PickUsernameForm>({
        defaultValues: { display_name: suggestUsername(suggestion) },
    })

    const updateUsernameMutation = useMutation({
        mutationFn: (data: UserUpdate) => MeService.updateUserMe({ requestBody: data }),
    })

    const onSubmit = async (data: PickUsernameForm) => {
        try {
            await updateUsernameMutation.mutateAsync({ display_name: data.display_name })
            await completeLogin(router)
        } catch (error) {
            setError('display_name', { message: handleError(error as ApiError) })
        }
    }

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.flex}
            >
                <ScrollView
                    contentContainerStyle={styles.form}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>🎬</Text>
                    </View>
                    <Text style={styles.title}>Pick a username</Text>
                    <Text style={styles.subtitle}>
                        This is how friends will find and recognize you in the app.
                    </Text>

                    <Controller
                        control={control}
                        name="display_name"
                        rules={{
                            required: 'Username is required',
                            pattern: usernamePattern,
                        }}
                        render={({ field: { onChange, onBlur, value } }) => (
                            <View style={styles.inputContainer}>
                                <TextInput
                                    style={[styles.input, errors.display_name && styles.inputError]}
                                    placeholder="Username"
                                    placeholderTextColor={colors.textSecondary}
                                    onBlur={onBlur}
                                    onChangeText={onChange}
                                    value={value}
                                    autoCapitalize="none"
                                    autoComplete="off"
                                    autoCorrect={false}
                                    maxLength={usernameMaxLength}
                                    selectionColor={colors.tint}
                                    autoFocus
                                />
                                {errors.display_name ? (
                                    <Text style={styles.fieldError}>{errors.display_name.message}</Text>
                                ) : (
                                    <Text style={styles.hint}>
                                        4-15 characters. Letters, numbers, and underscores only.
                                    </Text>
                                )}
                            </View>
                        )}
                    />

                    <TouchableOpacity
                        style={[
                            styles.button,
                            (isSubmitting || updateUsernameMutation.isPending) && styles.buttonDisabled,
                        ]}
                        onPress={handleSubmit(onSubmit)}
                        disabled={isSubmitting || updateUsernameMutation.isPending}
                    >
                        {isSubmitting || updateUsernameMutation.isPending ? (
                            <ActivityIndicator color={colors.pillActiveText} />
                        ) : (
                            <Text style={styles.buttonText}>Continue</Text>
                        )}
                    </TouchableOpacity>
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
            flexGrow: 1,
            justifyContent: 'center',
            padding: 20,
        },
        badge: {
            alignSelf: 'center',
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: colors.cardBackground,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
        },
        badgeText: {
            fontSize: 28,
        },
        title: {
            fontSize: 28,
            fontWeight: 'bold',
            marginBottom: 8,
            textAlign: 'center',
            color: colors.text,
        },
        subtitle: {
            textAlign: 'center',
            color: colors.textSecondary,
            marginBottom: 28,
            fontSize: 14,
            paddingHorizontal: 12,
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
            textAlign: 'center',
        },
        inputError: {
            borderColor: colors.red.secondary,
        },
        fieldError: {
            color: colors.red.secondary,
            fontSize: 12,
            marginTop: 6,
            textAlign: 'center',
        },
        hint: {
            color: colors.textSecondary,
            fontSize: 12,
            marginTop: 6,
            textAlign: 'center',
        },
        button: {
            backgroundColor: colors.tint,
            borderRadius: 8,
            padding: 15,
            alignItems: 'center',
            marginTop: 8,
        },
        buttonDisabled: {
            opacity: 0.6,
        },
        buttonText: {
            color: colors.pillActiveText,
            fontSize: 16,
            fontWeight: '600',
        },
    })
