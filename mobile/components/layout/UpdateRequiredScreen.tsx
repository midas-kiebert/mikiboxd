/**
 * Full-screen, non-dismissable overlay shown when the backend rejects this
 * build's API calls with 426 Upgrade Required (see `shared/updateRequired.ts`
 * and `backend/app/core/middleware.py`). Rendered by the root layout in place
 * of the app shell — there's no way to route around it, since every API call
 * would keep 426ing anyway.
 */
import { Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import type { UpdateRequiredInfo } from 'shared';

type UpdateRequiredScreenProps = {
  info: UpdateRequiredInfo;
};

export default function UpdateRequiredScreen({ info }: UpdateRequiredScreenProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = createStyles(colors);

  const handleUpdate = () => {
    if (info.storeUrl) {
      void Linking.openURL(info.storeUrl);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Image
          source={require('../../assets/images/splash-icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Update Required</Text>
        <Text style={styles.body}>
          This version of the app is no longer supported. Please update to keep using MiKiNO.
        </Text>
        {info.storeUrl && (
          <TouchableOpacity style={styles.button} onPress={handleUpdate}>
            <Text style={styles.buttonText}>Update Now</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    logo: {
      width: 96,
      height: 96,
      marginBottom: 24,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: colors.text,
      marginBottom: 12,
      textAlign: 'center',
    },
    body: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 32,
      lineHeight: 22,
    },
    button: {
      backgroundColor: colors.tint,
      borderRadius: 8,
      paddingVertical: 15,
      paddingHorizontal: 32,
      alignItems: 'center',
    },
    buttonText: {
      color: colors.pillActiveText,
      fontSize: 16,
      fontWeight: '600',
    },
  });
