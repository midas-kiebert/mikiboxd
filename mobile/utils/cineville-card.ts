import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'cineville_card_number';

export const CINEVILLE_PREFIX = 'CP$';
export const CINEVILLE_DIGITS_LENGTH = 9;

export const saveCinevilleCardDigits = async (digits: string): Promise<void> => {
  await SecureStore.setItemAsync(STORAGE_KEY, digits);
};

export const loadCinevilleCardDigits = async (): Promise<string | null> => {
  return SecureStore.getItemAsync(STORAGE_KEY);
};

export const deleteCinevilleCard = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
};

export const buildCinevilleCardNumber = (digits: string): string =>
  `${CINEVILLE_PREFIX}${digits}`;
