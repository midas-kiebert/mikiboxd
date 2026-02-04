// mobile/app/login.tsx
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

export default function LoginScreen() {
    const router = useRouter()
    const { loginMutation, error, resetError } = useAuth(
        () => router.replace('/(tabs)'), // onLoginSuccess - navigate to home
        () => router.replace('/login') // onLogout
    )

    const {
        control,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<AccessToken>({
        defaultValues: {
            username: '',
            password: '',
        },
    })

    const onSubmit = async (data: AccessToken) => {
        if (isSubmitting) {
            console.log("Submission in progress, please wait.")
            return
        }
        resetError()
        try {
            console.log("About to call login mutation")
            await loginMutation.mutateAsync(data)
            console.log("loginMutation successful")
        } catch (error) {
            console.log("UNKNOWN ERROR", error)
            // Error handled by useAuth
        }
    }

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
                                placeholderTextColor="#999"
                                onBlur={onBlur}
                                onChangeText={onChange}
                                value={value}
                                autoCapitalize="none"
                                keyboardType="email-address"
                                autoComplete="email"
                            />
                            {errors.username && (
                                <Text style={styles.fieldError}>{errors.username.message}</Text>
                            )}
                        </View>
                    )}
                />

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
                                placeholderTextColor="#999"
                                onBlur={onBlur}
                                onChangeText={onChange}
                                value={value}
                                secureTextEntry
                                autoCapitalize="none"
                                autoComplete="password"
                            />
                            {errors.password && (
                                <Text style={styles.fieldError}>{errors.password.message}</Text>
                            )}
                        </View>
                    )}
                />

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

                <TouchableOpacity onPress={
                    () => { }
                    // router.push('/signup')
                }>
                    <Text style={styles.linkText}>
                        Don't have an account? <Text style={styles.link}>Sign Up</Text>
                    </Text>
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
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
    },
    inputContainer: {
        marginBottom: 20,
    },
    input: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        padding: 15,
        fontSize: 16,
    },
    inputError: {
        borderColor: '#ff0000',
    },
    fieldError: {
        color: '#ff0000',
        fontSize: 12,
        marginTop: 5,
    },
    button: {
        backgroundColor: '#007AFF',
        borderRadius: 8,
        padding: 15,
        alignItems: 'center',
        marginTop: 10,
    },
    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    linkText: {
        textAlign: 'center',
        marginTop: 20,
        color: '#666',
    },
    link: {
        color: '#007AFF',
        fontWeight: '600',
    },
    errorContainer: {
        backgroundColor: '#ffe6e6',
        padding: 10,
        borderRadius: 8,
        marginBottom: 20,
    },
    errorText: {
        color: '#ff0000',
        textAlign: 'center',
    },
})
