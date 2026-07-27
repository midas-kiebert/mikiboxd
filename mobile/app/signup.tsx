/**
 * Expo Router screen/module for signup. It controls navigation and screen-level state for this route.
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import * as AppleAuthentication from 'expo-apple-authentication';
import { getGoogleSignin, isGoogleSignInAvailable } from '@/utils/google-signin';

import useAuth from 'shared/hooks/useAuth';
import type { UserRegister } from 'shared';
import { usernameMaxLength, usernamePattern } from 'shared/utils';
import { useThemeColors } from '@/hooks/use-theme-color';
import { completeLogin } from '@/utils/complete-login';
import { markIntroPending } from '@/utils/intro';

type SignUpForm = UserRegister & {
  confirm_password: string;
};

export default function SignUpScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const router = useRouter();
  // Read the active theme color tokens used by this screen/component.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Data hooks keep this module synced with backend data and shared cache state.
  const { signUpMutation, socialLoginMutation, error, resetError } = useAuth(
    () => router.replace('/login'),
    () => router.replace('/login')
  );

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
    if (isSubmitting || signUpMutation.isPending) return;
    resetError();
    // Submit only backend-required fields (confirm_password is local validation only).
    await signUpMutation.mutateAsync({
      display_name: data.display_name,
      email: data.email,
      password: data.password,
    });
    // A brand-new account: the first-run intro is owed. Recorded here rather
    // than after login, which every returning user goes through too, and it
    // survives the trip via the login screen this path ends on.
    markIntroPending();
  };

  // Social sign-in logs the user in directly (the backend creates the
  // account on first use), unlike the email path above which still requires
  // a separate login step.
  const handleAppleSignIn = async () => {
    resetError();
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) return;
      const displayName = credential.fullName
        ? [credential.fullName.givenName, credential.fullName.familyName]
            .filter(Boolean)
            .join(' ')
        : undefined;
      const { needsUsername } = await socialLoginMutation.mutateAsync({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (needsUsername) {
        // No username yet means the backend just created this account.
        markIntroPending();
        router.replace({ pathname: '/pick-username', params: { suggestion: displayName ?? '' } });
        return;
      }
      await completeLogin(router);
    } catch (appleError: unknown) {
      if ((appleError as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return;
      console.log('Apple sign-in error', appleError);
      // Error handled by useAuth for API failures; silently ignored otherwise.
    }
  };

  const handleGoogleSignIn = async () => {
    if (!isGoogleSignInAvailable) return;
    resetError();
    try {
      const { GoogleSignin } = getGoogleSignin();
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (response.type !== 'success' || !response.data.idToken) return;
      const { needsUsername } = await socialLoginMutation.mutateAsync({
        provider: 'google',
        token: response.data.idToken,
      });
      if (needsUsername) {
        markIntroPending();
        router.replace({
          pathname: '/pick-username',
          params: { suggestion: response.data.user.name ?? '' },
        });
        return;
      }
      await completeLogin(router);
    } catch (googleError: unknown) {
      const { statusCodes } = getGoogleSignin();
      const code = (googleError as { code?: string })?.code;
      if (code === statusCodes.SIGN_IN_CANCELLED) return;
      console.log('Google sign-in error', googleError);
      // Error handled by useAuth for API failures; silently ignored otherwise.
    }
  };

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      {/* Scrollable so the "Create account" button stays reachable: five fields
          plus the keyboard is taller than an SE/360dp viewport. */}
      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Sign Up</Text>

        {error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {Platform.OS === 'ios' && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
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
          <Text style={styles.dividerText}>or sign up with email</Text>
          <View style={styles.dividerLine} />
        </View>

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
            <View style={styles.inputContainer}>
              <TextInput
                style={[styles.input, errors.display_name && styles.inputError]}
                placeholder="Username"
                placeholderTextColor={colors.textSecondary}
                onBlur={onBlur}
                onChangeText={onChange}
                value={value ?? ''}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                maxLength={usernameMaxLength}
                selectionColor={colors.tint}
              />
              {errors.display_name ? (
                <Text style={styles.fieldError}>{errors.display_name.message}</Text>
              ) : null}
            </View>
          )}
        />

        {/* Email is the login identifier and must be in valid email format. */}
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

        {/* Password minimum mirrors backend auth requirements. */}
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
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
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
      marginBottom: 30,
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
      marginBottom: 16,
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
