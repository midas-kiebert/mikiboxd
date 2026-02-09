import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useFetchReceivedRequests } from 'shared/hooks/useFetchReceivedRequests';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const { data: receivedRequests } = useFetchReceivedRequests({ refetchIntervalMs: 15000 });
  const receivedCount = receivedRequests?.length ?? 0;
  const showBadge = receivedCount > 0;
  const badgeLabel = receivedCount > 99 ? '99+' : String(receivedCount);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.tint,
        headerShown: false,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />,
        }}
      />

      <Tabs.Screen
        name="agenda"
        options={{
          title: 'Agenda',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Showtimes',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="list.bullet.rectangle" color={color} />,
        }}
      />
      <Tabs.Screen
        name="movies"
        options={{
          title: 'Movies',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="film.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ color }) => (
            <View style={styles.iconContainer}>
              <IconSymbol size={28} name="person.2.fill" color={color} />
              {showBadge ? (
                <View style={[styles.badge, { backgroundColor: palette.red.secondary }]}>
                  <Text style={styles.badgeText}>{badgeLabel}</Text>
                </View>
              ) : null}
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    position: 'relative',
    width: 28,
    height: 28,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    elevation: 2,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});
