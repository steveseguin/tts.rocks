// Model Cache Manager for TTS.Rocks
// Handles caching of all TTS models in IndexedDB

class ModelCacheManager {
    constructor() {
        this.dbName = 'ttsRocksModels';
        this.dbVersion = 2;
        this.stores = {
            models: 'models',
            metadata: 'metadata'
        };
    }

    async openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create models store if it doesn't exist
                if (!db.objectStoreNames.contains(this.stores.models)) {
                    db.createObjectStore(this.stores.models);
                }
                
                // Create metadata store for tracking model info
                if (!db.objectStoreNames.contains(this.stores.metadata)) {
                    const metadataStore = db.createObjectStore(this.stores.metadata);
                    metadataStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    async saveModel(modelKey, modelData, metadata = {}) {
        const db = await this.openDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.stores.models, this.stores.metadata], 'readwrite');
            
            // Save model data
            const modelStore = transaction.objectStore(this.stores.models);
            const modelRequest = modelStore.put(modelData, modelKey);
            
            // Save metadata
            const metadataStore = transaction.objectStore(this.stores.metadata);
            const metaData = {
                ...metadata,
                key: modelKey,
                size: modelData.byteLength || modelData.length,
                timestamp: Date.now(),
                lastAccessed: Date.now()
            };
            const metaRequest = metadataStore.put(metaData, modelKey);
            
            transaction.oncomplete = () => {
                console.log(`Model ${modelKey} cached successfully (${this.formatBytes(metaData.size)})`);
                resolve();
            };
            
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async getModel(modelKey) {
        try {
            const db = await this.openDB();
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.stores.models, this.stores.metadata], 'readwrite');
                
                // Get model data
                const modelStore = transaction.objectStore(this.stores.models);
                const modelRequest = modelStore.get(modelKey);
                
                // Update last accessed time
                const metadataStore = transaction.objectStore(this.stores.metadata);
                
                modelRequest.onsuccess = () => {
                    const modelData = modelRequest.result;
                    
                    if (modelData) {
                        // Update metadata
                        const metaRequest = metadataStore.get(modelKey);
                        metaRequest.onsuccess = () => {
                            const metadata = metaRequest.result || {};
                            metadata.lastAccessed = Date.now();
                            metadataStore.put(metadata, modelKey);
                        };
                        
                        console.log(`Model ${modelKey} loaded from cache`);
                        resolve(modelData);
                    } else {
                        resolve(null);
                    }
                };
                
                modelRequest.onerror = () => reject(modelRequest.error);
            });
        } catch (error) {
            console.error('Error getting cached model:', error);
            return null;
        }
    }

    async getModelMetadata(modelKey) {
        try {
            const db = await this.openDB();
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(this.stores.metadata, 'readonly');
                const store = transaction.objectStore(this.stores.metadata);
                const request = store.get(modelKey);
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error getting model metadata:', error);
            return null;
        }
    }

    async getAllMetadata() {
        try {
            const db = await this.openDB();
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(this.stores.metadata, 'readonly');
                const store = transaction.objectStore(this.stores.metadata);
                const request = store.getAll();
                
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error getting all metadata:', error);
            return [];
        }
    }

    async deleteModel(modelKey) {
        try {
            const db = await this.openDB();
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.stores.models, this.stores.metadata], 'readwrite');
                
                // Delete model data
                const modelStore = transaction.objectStore(this.stores.models);
                modelStore.delete(modelKey);
                
                // Delete metadata
                const metadataStore = transaction.objectStore(this.stores.metadata);
                metadataStore.delete(modelKey);
                
                transaction.oncomplete = () => {
                    console.log(`Model ${modelKey} deleted from cache`);
                    resolve();
                };
                
                transaction.onerror = () => reject(transaction.error);
            });
        } catch (error) {
            console.error('Error deleting model:', error);
        }
    }

    async getCacheSize() {
        const metadata = await this.getAllMetadata();
        return metadata.reduce((total, meta) => total + (meta.size || 0), 0);
    }

    async cleanupOldModels(maxAgeMs = 30 * 24 * 60 * 60 * 1000) { // 30 days default
        try {
            const metadata = await this.getAllMetadata();
            const now = Date.now();
            const toDelete = [];
            
            for (const meta of metadata) {
                if (meta.lastAccessed && (now - meta.lastAccessed) > maxAgeMs) {
                    toDelete.push(meta.key);
                }
            }
            
            for (const key of toDelete) {
                await this.deleteModel(key);
            }
            
            if (toDelete.length > 0) {
                console.log(`Cleaned up ${toDelete.length} old models from cache`);
            }
            
            return toDelete.length;
        } catch (error) {
            console.error('Error cleaning up old models:', error);
            return 0;
        }
    }

    async clearAllCache() {
        try {
            const db = await this.openDB();
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.stores.models, this.stores.metadata], 'readwrite');
                
                // Clear both stores
                const modelStore = transaction.objectStore(this.stores.models);
                const metadataStore = transaction.objectStore(this.stores.metadata);
                
                modelStore.clear();
                metadataStore.clear();
                
                transaction.oncomplete = () => {
                    console.log('All cached models cleared');
                    resolve();
                };
                
                transaction.onerror = () => reject(transaction.error);
            });
        } catch (error) {
            console.error('Error clearing cache:', error);
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    async getCacheInfo() {
        const metadata = await this.getAllMetadata();
        const totalSize = metadata.reduce((total, meta) => total + (meta.size || 0), 0);
        
        return {
            models: metadata.map(meta => ({
                key: meta.key,
                size: this.formatBytes(meta.size || 0),
                cached: new Date(meta.timestamp).toLocaleString(),
                lastUsed: new Date(meta.lastAccessed).toLocaleString()
            })),
            totalModels: metadata.length,
            totalSize: this.formatBytes(totalSize),
            totalSizeBytes: totalSize
        };
    }
}

// Make available globally
window.ModelCacheManager = ModelCacheManager;