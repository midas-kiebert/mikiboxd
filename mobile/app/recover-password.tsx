/**
 * Expo Router screen/module for recover-password. It controls navigation and screen-level state for this route.
 */
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';

import { LoginService } from 'shared';
import AuthPrimaryButton from '@/components/auth/AuthPrimaryButton';
import AuthScreenShell from '@/components/auth/AuthScreenShell';
import AuthTextField from '@/components/auth/AuthTextField';
import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';
import { EMAIL_PATTERN } from '@/constants/auth';

type RecoverPasswordForm = {
  email: string;
};

const COOLDOWN_SECONDS = 30;

export default function RecoverPasswordScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const router = useRouter();
  // Read the active theme color tokens used by this screen/component.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Seconds remaining before the user can retry sending another email.
  const [cooldown, setCooldown] = useState(0);
  // The address the last successful send went to, so the confirmation can name it.
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Data hooks keep this module synced with backend data and shared cache state.
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecoverPasswordForm>({
    defaultValues: { email: '' },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => Math.max(prev - 1, 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Calls the backend endpoint that triggers password-recovery email delivery.
  const recoverPasswordMutation = useMutation({
    mutationFn: (data: RecoverPasswordForm) =>
      LoginService.recoverPassword({
        email: data.email,
      }),
    // Confirmed in place rather than through a native alert the user has to
    // dismiss before they can see the screen it was talking about.
    onSuccess: (_data, variables) => {
      setSentToEmail(variables.email);
    },
    onError: (error) => {
      console.error('Error recovering password:', error);
      setErrorMessage('Could not send the recovery email. Please try again.');
      setCooldown(0);
    },
  });

  const onSubmit = async (data: RecoverPasswordForm) => {
    // Guard against repeated taps while cooldown is active.
    if (cooldown > 0 || isSubmitting || recoverPasswordMutation.isPending) return;
    setErrorMessage(null);
    setCooldown(COOLDOWN_SECONDS);
    try {
      await recoverPasswordMutation.mutateAsync(data);
    } catch {
      // Handled in onError above.
    }
  };

  // Wrapped so both the button and the keyboard's Go key call the same thing,
  // without either having to care that it returns a promise.
  const submitForm = () => {
    void handleSubmit(onSubmit)();
  };

  const isBusy = isSubmitting || recoverPasswordMutation.isPending;

  // Render/output using the state and derived values prepared above.
  return (
    <AuthScreenShell
      title="Password recovery"
      subtitle="We'll email a reset link to the address on your account."
      error={errorMessage}
      footer={
        <TouchableOpacity
          onPress={() => router.replace('/login')}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <ThemedText style={styles.linkText}>
            Back to <ThemedText style={styles.link}>Log In</ThemedText>
          </ThemedText>
        </TouchableOpacity>
      }
    >
      {sentToEmail ? (
        <View style={styles.sentPanel}>
          <MaterialIcons name="mark-email-read" size={26} color={colors.green.secondary} />
          <ThemedText style={styles.sentTitle}>Check your inbox</ThemedText>
          <ThemedText style={styles.sentText}>
            If an account exists for {sentToEmail}, a reset link is on its way.
          </ThemedText>
          <TouchableOpacity
            onPress={() => setSentToEmail(null)}
            disabled={cooldown > 0}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <ThemedText style={[styles.resendLink, cooldown > 0 && styles.resendLinkDisabled]}>
              {cooldown > 0 ? `You can try again in ${cooldown}s` : 'Use a different address'}
            </ThemedText>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.form}>
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
                returnKeyType="go"
                onSubmitEditing={submitForm}
              />
            )}
          />

          <AuthPrimaryButton
            label={cooldown > 0 ? `Please wait ${cooldown}s` : 'Send recovery email'}
            onPress={submitForm}
            isBusy={isBusy}
            isDisabled={cooldown > 0}
          />
        </View>
      )}
    </AuthScreenShell>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    form: {
      gap: 18,
    },
    sentPanel: {
      alignItems: 'center',
      gap: 8,
      padding: 20,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
    },
    sentTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
    },
    sentText: {
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
      color: colors.textSecondary,
    },
    resendLink: {
      paddingTop: 6,
      fontSize: 13,
      fontWeight: '600',
      color: colors.tint,
    },
    resendLinkDisabled: {
      color: colors.textSecondary,
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
