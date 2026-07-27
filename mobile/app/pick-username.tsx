/**
 * Expo Router screen/module for pick-username. It controls navigation and screen-level state for this route.
 */
import { useEffect, useRef } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Controller, useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { MeService, type ApiError, type UserUpdate } from 'shared'
import useAuth from 'shared/hooks/useAuth'
import { handleError, usernameMaxLength, usernamePattern } from 'shared/utils'

import AuthPrimaryButton from '@/components/auth/AuthPrimaryButton'
import AuthScreenShell from '@/components/auth/AuthScreenShell'
import AuthTextField from '@/components/auth/AuthTextField'
import { completeLogin } from '@/utils/complete-login'

type PickUsernameForm = {
    display_name: string
}

/**
 * The keyboard is worth opening for a one-field screen, but not while the
 * screen is still sliding in: focusing during the transition makes the card
 * animate and the window resize at the same time, and the two fight visibly.
 */
const AUTOFOCUS_DELAY_MS = 420

// A raw provider name (e.g. Apple's "Jan de Vries") isn't a valid app
// username — strip anything outside [A-Za-z0-9_] and truncate, purely as a
// starting suggestion the user can still edit or replace entirely.
function suggestUsername(rawName: string | undefined): string {
    if (!rawName) return ''
    return rawName.replace(/[^A-Za-z0-9_]/g, '').slice(0, usernameMaxLength)
}

export default function PickUsernameScreen() {
    // Read flow: local state and data hooks first, then handlers, then the JSX screen.
    const router = useRouter()
    const { suggestion } = useLocalSearchParams<{ suggestion?: string }>()
    const inputRef = useRef<TextInput>(null)
    const { user } = useAuth()

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

    // Belt and braces on top of the backend's `needs_username`: this screen is
    // only ever for an account that has no username, so one that turns out to
    // have one is sent straight on rather than asked to pick a second. Positive
    // check only — an unloaded/absent user is not treated as "has a username",
    // which would bounce the very accounts this screen exists for. Left out in
    // __DEV__ so the login screen's preview shortcut still opens it.
    const existingUsername = user?.display_name?.trim()
    useEffect(() => {
        if (__DEV__ || !existingUsername) return
        void completeLogin(router)
    }, [existingUsername, router])

    useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.focus(), AUTOFOCUS_DELAY_MS)
        return () => clearTimeout(timer)
    }, [])

    const onSubmit = async (data: PickUsernameForm) => {
        if (isSubmitting || updateUsernameMutation.isPending) return
        try {
            await updateUsernameMutation.mutateAsync({ display_name: data.display_name })
            await completeLogin(router)
        } catch (error) {
            setError('display_name', { message: handleError(error as ApiError) })
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
            title="Pick a username"
            subtitle="This is how friends will find and recognize you in the app."
        >
            <View style={styles.form}>
                <Controller
                    control={control}
                    name="display_name"
                    rules={{
                        required: 'Username is required',
                        pattern: usernamePattern,
                    }}
                    render={({ field: { onChange, onBlur, value } }) => (
                        <AuthTextField
                            ref={inputRef}
                            label="Username"
                            placeholder="Username"
                            error={errors.display_name?.message}
                            hint="4-15 characters. Letters, numbers, and underscores only."
                            onBlur={onBlur}
                            onChangeText={onChange}
                            value={value}
                            autoCapitalize="none"
                            autoComplete="off"
                            autoCorrect={false}
                            maxLength={usernameMaxLength}
                            returnKeyType="go"
                            onSubmitEditing={submitForm}
                        />
                    )}
                />

                <AuthPrimaryButton
                    label="Continue"
                    onPress={submitForm}
                    isBusy={isSubmitting || updateUsernameMutation.isPending}
                />
            </View>
        </AuthScreenShell>
    )
}

const styles = StyleSheet.create({
    form: {
        gap: 18,
    },
})
