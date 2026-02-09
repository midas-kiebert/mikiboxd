import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';

import { LoginService } from 'shared';
import { useThemeColors } from '@/hooks/use-theme-color';

type RecoverPasswordForm = {
  email: string;
};

const COOLDOWN_SECONDS = 30;

export default function RecoverPasswordScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [cooldown, setCooldown] = useState(0);

  const {
    control,
    handleSubmit,
    reset,
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

  const recoverPasswordMutation = useMutation({
    mutationFn: (data: RecoverPasswordForm) =>
      LoginService.recoverPassword({
        email: data.email,
      }),
    onSuccess: () => {
      Alert.alert('Success', 'Password recovery email sent successfully.');
      reset();
    },
    onError: (error) => {
      console.error('Error recovering password:', error);
      Alert.alert('Error', 'Could not send password recovery email.');
      setCooldown(0);
    },
  });

  const onSubmit = async (data: RecoverPasswordForm) => {
    if (cooldown > 0) return;
    setCooldown(COOLDOWN_SECONDS);
    await recoverPasswordMutation.mutateAsync(data);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.form}>
        <Text style={styles.title}>Password Recovery</Text>
        <Text style={styles.subtitle}>
          A password recovery email will be sent to the registered account.
        </Text>

        <Controller
          control={control}
          name="email"
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
                style={[styles.input, errors.email && styles.inputError]}
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
              {errors.email ? <Text style={styles.fieldError}>{errors.email.message}</Text> : null}
            </View>
          )}
        />

        <TouchableOpacity
          style={[
            styles.button,
            (recoverPasswordMutation.isPending || isSubmitting || cooldown > 0) && styles.buttonDisabled,
          ]}
          onPress={handleSubmit(onSubmit)}
          disabled={recoverPasswordMutation.isPending || isSubmitting || cooldown > 0}
        >
          {recoverPasswordMutation.isPending || isSubmitting ? (
            <ActivityIndicator color={colors.pillActiveText} />
          ) : (
            <Text style={styles.buttonText}>
              {cooldown > 0 ? `Please wait ${cooldown}s` : 'Send Recovery Email'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace('/login')}>
          <Text style={styles.linkText}>
            Back to <Text style={styles.link}>Log In</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
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
      marginBottom: 10,
      textAlign: 'center',
      color: colors.text,
    },
    subtitle: {
      textAlign: 'center',
      color: colors.textSecondary,
      marginBottom: 24,
      fontSize: 14,
    },
    inputContainer: {
      marginBottom: 16,
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
    linkText: {
      textAlign: 'center',
      marginTop: 20,
      color: colors.textSecondary,
    },
    link: {
      color: colors.tint,
      fontWeight: '600',
    },
  });
