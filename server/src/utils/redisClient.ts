import Redis, { type ChainableCommander } from "ioredis";
import { REDIS_HOST, REDIS_PORT } from "./config.js";

export class RedisClient {
    private client: Redis;

    constructor() {
        // Updated connection configuration for Docker environment
        const redisConfig = {
            host: String(REDIS_HOST),
            port: Number(REDIS_PORT),
            retryDelayOnFailover: 100,
            enableReadyCheck: false,
            lazyConnect: true, // Don't connect immediately
            // Add connection timeout
            connectTimeout: 10000,
            // Retry configuration
            retryDelayOnClusterDown: 300,
            retryDelayOnClusterFailover: 100,
            maxRetriesPerRequest: 3,
        };

        console.log(`[RedisClient] Attempting to connect to Redis at ${REDIS_HOST}:${REDIS_PORT}`);
        this.client = new Redis(redisConfig);

        this.client.on('connect', () => { 
            console.log(`[RedisClient] Connected to Redis at ${REDIS_HOST}:${REDIS_PORT}`); 
        });

        this.client.on('error', (err: any) => { 
            console.error(`[RedisClient] Redis error:`, err); 
        });

        this.client.on('close', () => {
            console.log('[RedisClient] Redis connection closed');
        });

        this.client.on('reconnecting', () => {
            console.log('[RedisClient] Redis reconnecting...');
        });
    }

    async connect(): Promise<void> {
        try {
            await this.client.connect();
            console.log('[RedisClient] Redis client connected successfully');
        } catch (error) {
            console.error('[RedisClient] Failed to connect to Redis:', error);
            throw error;
        }
    }

    async get(key: string): Promise<string | null> {
        try {
            return await this.client.get(key);
        } catch (error) {
            console.error(`[RedisClient] Error getting key ${key}:`, error);
            return null;
        }
    }

    async set(key: string, value: string, ex?: string, expirySeconds?: number): Promise<void> {
        try {
            if (ex === 'EX' && expirySeconds) {
                await this.client.setex(key, expirySeconds, value);
            } else if (expirySeconds) {
                await this.client.setex(key, expirySeconds, value);
            } else {
                await this.client.set(key, value);
            }
        } catch (error) {
            console.error(`[RedisClient] Error setting key ${key}:`, error);
            throw error;
        }
    }

    // Add pipeline method
    pipeline(): ChainableCommander {
        return this.client.pipeline();
    }

    // Add set operations
    async sadd(key: string, ...members: string[]): Promise<number> {
        try {
            return await this.client.sadd(key, ...members);
        } catch (error) {
            console.error(`[RedisClient] Error adding to set ${key}:`, error);
            throw error;
        }
    }

    async smembers(key: string): Promise<string[]> {
        try {
            return await this.client.smembers(key);
        } catch (error) {
            console.error(`[RedisClient] Error getting set members ${key}:`, error);
            return [];
        }
    }

    // Add hash operations
    async hset(key: string, field: string | object, value?: string): Promise<number> {
        try {
            if (typeof field === 'object') {
                return await this.client.hset(key, field);
            } else {
                return await this.client.hset(key, field, value!);
            }
        } catch (error) {
            console.error(`[RedisClient] Error setting hash ${key}:`, error);
            throw error;
        }
    }

    async hgetall(key: string): Promise<Record<string, string>> {
        try {
            return await this.client.hgetall(key);
        } catch (error) {
            console.error(`[RedisClient] Error getting hash ${key}:`, error);
            return {};
        }
    }

    // Add key operations
    async keys(pattern: string): Promise<string[]> {
        try {
            return await this.client.keys(pattern);
        } catch (error) {
            console.error(`[RedisClient] Error getting keys with pattern ${pattern}:`, error);
            return [];
        }
    }

    async del(...keys: string[]): Promise<number> {
        try {
            return await this.client.del(...keys);
        } catch (error) {
            console.error(`[RedisClient] Error deleting keys:`, error);
            throw error;
        }
    }

    // Add expiration methods
    async setex(key: string, seconds: number, value: string): Promise<string> {
        try {
            return await this.client.setex(key, seconds, value);
        } catch (error) {
            console.error(`[RedisClient] Error setting key with expiration ${key}:`, error);
            throw error;
        }
    }

    async quit(): Promise<void> {
        try {
            await this.client.quit();
            console.log('[RedisClient] Redis client disconnected');
        } catch (error) {
            console.error('[RedisClient] Error disconnecting Redis:', error);
        }
    }
}

export const redisClient = new RedisClient();