// for storing tokens on both web and native platforms

interface Storage {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
}

let storageImplementation: Storage;

export const setStorage = (implementation: Storage) => {
    storageImplementation = implementation;
};

export const storage = {
    getItem: async (key: string): Promise<string | null> => {
        if (!storageImplementation) {
            throw new Error("Storage implementation not set. Call setStorage() first.");
        }
        return storageImplementation.getItem(key);
    },
    setItem: async (key: string, value: string): Promise<void> => {
        if (!storageImplementation) {
            throw new Error("Storage implementation not set. Call setStorage() first.");
        }
        return storageImplementation.setItem(key, value);
    },
    removeItem: async (key: string): Promise<void> => {
        if (!storageImplementation) {
            throw new Error("Storage implementation not set. Call setStorage() first.");
        }
        return storageImplementation.removeItem(key);
    },
}
