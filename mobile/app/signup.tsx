/**
 * Expo Router screen/module for signup. It controls navigation and screen-level state for this route.
 */
import { useRef, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import useAuth from 'shared/hooks/useAuth';
import type { UserRegister } from 'shared';
import { usernameMaxLength, usernamePattern } from 'shared/utils';

import AuthPrimaryButton from '@/components/auth/AuthPrimaryButton';
import AuthScreenShell from '@/components/auth/AuthScreenShell';
import AuthTextField from '@/components/auth/AuthTextField';
import SocialSignInSection from '@/components/auth/SocialSignInSection';
import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';
import { completeLogin } from '@/utils/complete-login';
import { markIntroPending } from '@/utils/intro';
import { EMAIL_PATTERN, PASSWORD_MIN_LENGTH } from '@/constants/auth';

type SignUpForm = UserRegister & {
  confirm_password: string;
};

export default function SignUpScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const router = useRouter();
  // Read the active theme color tokens used by this screen/component.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  // Set while a provider sheet is open, so the email form cannot be driven at
  // the same time.
  const [isSocialSignInBusy, setIsSocialSignInBusy] = useState(false);
  // Data hooks keep this module synced with backend data and shared cache state.
  const { signUpMutation, loginMutation, socialLoginMutation, error, resetError } = useAuth();

  const {
    control,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<SignUpForm>({
    // Default empty values keep every input controlled from the first render.
    defaultValues: {
      display_name: '',
      email: '',
      password: '',
      confirm_password: '',
    },
  });

  const onSubmit = async (data: SignUpForm) => {
    // Guard against duplicate submits from rapid taps.
    if (isSubmitting || signUpMutation.isPending || isSocialSignInBusy) return;
    resetError();
    try {
      // Submit only backend-required fields (confirm_password is local validation only).
      await signUpMutation.mutateAsync({
        display_name: data.display_name,
        email: data.email,
        password: data.password,
      });
      // A brand-new account: the first-run intro is owed. Recorded before the
      // login below, which is the thing that reads it.
      markIntroPending();
      // Signing up already proved the user knows these credentials, so making
      // them retype both on a login screen they were silently dropped onto was
      // busywork — and a jarring bounce out of a form they had just completed.
      // The account is usable immediately (no verification step), so go in.
      await loginMutation.mutateAsync({ username: data.email, password: data.password });
      await completeLogin(router);
    } catch (signUpError) {
      console.log('Sign-up error', signUpError);
      // Error handled by useAuth. If the account was created but the automatic
      // login failed, the login screen is the one place that can recover.
      if (signUpMutation.isSuccess) {
        router.replace('/login');
      }
    }
  };

  // Wrapped so both the button and the keyboard's Go key call the same thing,
  // without either having to care that it returns a promise.
  const submitForm = () => {
    void handleSubmit(onSubmit)();
  };

  // Render/output using the state and derived values prepared above.
  return (
    <AuthScreenShell
      title="Create your account"
      subtitle="Find what's on, and see what your friends are watching."
      error={error}
      footer={
        <TouchableOpacity
          onPress={() => router.replace('/login')}
          disabled={isSubmitting || isSocialSignInBusy}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <ThemedText style={styles.linkText}>
            Already have an account? <ThemedText style={styles.link}>Log In</ThemedText>
          </ThemedText>
        </TouchableOpacity>
      }
    >
      <SocialSignInSection
        mode="sign-up"
        socialLoginMutation={socialLoginMutation}
        resetError={resetError}
        isDisabled={isSubmitting}
        onBusyChange={setIsSocialSignInBusy}
      />

      <View style={styles.form}>
        {/* Username helps other users identify this account in social screens. */}
        <Controller
          control={control}
          name="display_name"
          rules={{
            required: 'Username is required',
            pattern: usernamePattern,
            maxLength: {
              value: usernameMaxLength,
              message: `Username must be at most ${usernameMaxLength} characters`,
            },
          }}
          render={({ field: { onChange, onBlur, value } }) => (
            <AuthTextField
              label="Username"
              placeholder="How friends will find you"
              error={errors.display_name?.message}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ''}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              maxLength={usernameMaxLength}
              returnKeyType="next"
              editable={!isSocialSignInBusy}
              onSubmitEditing={() => emailRef.current?.focus()}
            />
          )}
        />

        {/* Email is the login identifier and must be in valid email format. */}
        <Controller
          control={control}
          name="email"
          rules={{
            required: 'Email is required',
            pattern: {
              value: EMAIL_PATTERN,
              message: 'Invalid email address',
            },
          }}
          render={({ field: { onChange, onBlur, value } }) => (
            <AuthTextField
              ref={emailRef}
              label="Email"
              placeholder="you@example.com"
              error={errors.email?.message}
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

        {/* Password minimum mirrors backend auth requirements. */}
        <Controller
          control={control}
          name="password"
          rules={{
            required: 'Password is required',
            minLength: {
              value: PASSWORD_MIN_LENGTH,
              message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
            },
          }}
          render={({ field: { onChange, onBlur, value } }) => (
            <AuthTextField
              ref={passwordRef}
              label="Password"
              placeholder="At least 8 characters"
              error={errors.password?.message}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              returnKeyType="next"
              editable={!isSocialSignInBusy}
              onSubmitEditing={() => confirmPasswordRef.current?.focus()}
            />
          )}
        />

        {/* Confirm password runs local cross-field validation against `password`. */}
        <Controller
          control={control}
          name="confirm_password"
          rules={{
            required: 'Please confirm your password',
            validate: (value) =>
              value === getValues('password') || 'Passwords do not match',
          }}
          render={({ field: { onChange, onBlur, value } }) => (
            <AuthTextField
              ref={confirmPasswordRef}
              label="Confirm password"
              placeholder="Type it once more"
              error={errors.confirm_password?.message}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              returnKeyType="go"
              editable={!isSocialSignInBusy}
              onSubmitEditing={submitForm}
            />
          )}
        />

        <AuthPrimaryButton
          label="Create account"
          onPress={submitForm}
          isBusy={isSubmitting || signUpMutation.isPending}
          isDisabled={isSocialSignInBusy}
        />
      </View>
    </AuthScreenShell>
  );
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
  });
