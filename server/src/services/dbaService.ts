import { dBAMidUrl, dBAserviceBaseUrl } from "../utils/config";

export class DBAService {
    private baseUrl: string = dBAserviceBaseUrl;
    private midUrl: string = dBAMidUrl;

    constructor() {}

    async testDbaConnection() {
        try {
            const body = {
                "db_name": "test_db",
                "user_id": "test_user"
            }
            const response = await fetch(`${this.baseUrl}/${this.midUrl}/health`,{
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'SDLC-MCP-Client/1.0.0'
                },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[DBAService] Health check failed: ${response.status} - ${errorText}`);
                return {
                    success: false,
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText
                };
            }

            const data = await response.json();
            console.log(`[DBAService] Health check successful:`, data);
                
            return {
                success: true,
                status: response.status,
                data: data
            };
    } catch (error: any) {
        console.error(`[DBAService] Health check failed:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}

    async unlockDbUser(dbName: string, userId: string) {
        try {
            if (!dbName) {
                throw new Error("Missing required parameter: dbName");
            }

            const body = {
                "db_name": dbName,
                "user_id": userId
            };

             // Increase fetch timeout to 5 minutes
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

            const response = await fetch(`${this.baseUrl}/${this.midUrl}/unlock`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'SDLC-MCP-Client/1.0.0'
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timeoutId); // Clear the timeout if the request completes successfully
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[DBAService] Unlock failed: ${response.status} - ${errorText}`);
                throw new Error(`Failed to unlock database user: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            console.log(`[DBAService] User unlocked successfully:`, data);
                
            return {
                success: true,
                status: response.status,
                data: data,
                message: `User ${userId} unlocked successfully for database ${dbName}`
            };
    } catch (error: any) {
        console.error(`[DBAService] Unlock failed:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}
}

export const dbaService = new DBAService();