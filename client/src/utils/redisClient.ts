import { createClient } from 'redis';
import { REDIS_HOST, REDIS_PORT } from './config';

export class RedisClient {
    private client: any;
    private isConnected: boolean = false;

    constructor() {
        this.client = createClient({
            socket: {
                host: REDIS_HOST,
                port: REDIS_PORT,
                reconnectStrategy: (retries) => {
                    console.log(`Redis reconnection attempt ${retries}`);
                    return Math.min(retries * 50, 500);
                }
            }
        });

        this.client.on('error', (err: any) => {
            console.error('Redis Client Error:', err);
            this.isConnected = false;
        });

        this.client.on('connect', () => {
            console.log('Redis Client Connected');
            this.isConnected = true;
        });

        this.client.on('ready', () => {
            console.log('Redis Client Ready');
            this.isConnected = true;
        });

        this.client.on('end', () => {
            console.log('Redis Client Disconnected');
            this.isConnected = false;
        });
    }

    get isOpen(): boolean {
        return this.isConnected && this.client.isOpen;
    }

    async connect(): Promise<void> {
        if (!this.isConnected) {
            await this.client.connect();
        }
    }

    async disconnect(): Promise<void> {
        if (this.isConnected) {
            await this.client.disconnect();
        }
    }

    async get(key: string): Promise<string | null> {
        return await this.client.get(key);
    }

    async set(key: string, value: string, options?: { EX?: number }): Promise<string> {
        if (options?.EX) {
            return await this.client.setEx(key, options.EX, value);
        }
        return await this.client.set(key, value);
    }

    async del(...keys: string[]): Promise<number> {
        return await this.client.del(keys);
    }

    async setex(key: string, seconds: number, value: string): Promise<string> {
        return await this.client.setEx(key, seconds, value);
    }

    async quit(): Promise<void> {
        await this.client.quit();
    }
}

export const redisClient = new RedisClient();