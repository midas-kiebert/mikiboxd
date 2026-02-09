import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';

import useAuth from 'shared/hooks/useAuth';
import type { UserRegister } from 'shared';
import { useThemeColors } from '@/hooks/use-theme-color';

type SignUpForm = UserRegister & {
  confirm_password: string;
};

export default function SignUpScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { signUpMutation, error, resetError } = useAuth(
    () => router.replace('/login'),
    () => router.replace('/login')
  );

  const {
    control,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<SignUpForm>({
    defaultValues: {
      display_name: '',
      email: '',
      password: '',
      confirm_password: '',
    },
  });

  const onSubmit = async (data: SignUpForm) => {
    if (isSubmitting || signUpMutation.isPending) return;
    resetError();
    await signUpMutation.mutateAsync({
      display_name: data.display_name,
      email: data.email,
      password: data.password,
    });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.form}>
        <Text style={styles.title}>Sign Up</Text>

        {error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Controller
          control={control}
          name="display_name"
          rules={{
            required: 'Display name is required',
            minLength: {
              value: 2,
              message: 'Display name must be at least 2 characters',
            },
          }}
          render={({ field: { onChange, onBlur, value } }) => (
            <View style={styles.inputContainer}>
              <TextInput
                style={[styles.input, errors.display_name && styles.inputError]}
                placeholder="Display Name"
                placeholderTextColor={colors.textSecondary}
                onBlur={onBlur}
                onChangeText={onChange}
                value={value ?? ''}
                autoCapitalize="words"
                autoComplete="name"
                selectionColor={colors.tint}
              />
              {errors.display_name ? (
                <Text style={styles.fieldError}>{errors.display_name.message}</Text>
              ) : null}
            </View>
          )}
        />

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

        <Controller
          control={control}
          name="password"
          rules={{
            required: 'Password is required',
            minLength: {
              value: 8,
              message: 'Password must be at least 8 characters',
            },
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
                autoComplete="new-password"
                selectionColor={colors.tint}
              />
              {errors.password ? (
                <Text style={styles.fieldError}>{errors.password.message}</Text>
              ) : null}
            </View>
          )}
        />

        <Controller
          control={control}
          name="confirm_password"
          rules={{
            required: 'Please confirm your password',
            validate: (value) =>
              value === getValues('password') || 'Passwords do not match',
          }}
          render={({ field: { onChange, onBlur, value } }) => (
            <View style={styles.inputContainer}>
              <TextInput
                style={[styles.input, errors.confirm_password && styles.inputError]}
                placeholder="Confirm password"
                placeholderTextColor={colors.textSecondary}
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                selectionColor={colors.tint}
              />
              {errors.confirm_password ? (
                <Text style={styles.fieldError}>{errors.confirm_password.message}</Text>
              ) : null}
            </View>
          )}
        />

        <TouchableOpacity
          style={[styles.button, signUpMutation.isPending && styles.buttonDisabled]}
          onPress={handleSubmit(onSubmit)}
          disabled={signUpMutation.isPending || isSubmitting}
        >
          {signUpMutation.isPending || isSubmitting ? (
            <ActivityIndicator color={colors.pillActiveText} />
          ) : (
            <Text style={styles.buttonText}>Create account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace('/login')}>
          <Text style={styles.linkText}>
            Already have an account? <Text style={styles.link}>Log In</Text>
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
      marginBottom: 30,
      textAlign: 'center',
      color: colors.text,
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
  });
