import { serviceNowApiKey, serviceNowBaseUrl } from "../utils/config";

interface ServiceNowIncident {
    number: string;
    short_description: string;
    description?: string;
    state: string;
    priority: string;
    category?: string;
    assignment_group?: string;
    assigned_to?: string;
    opened_at: string;
    updated_on: string;
    sys_id: string;
}

interface ServiceNowKnowledgeArticle {
    number: string;
    short_description: string;
    text: string;
    workflow_state: string;
    valid_to: string;
    author: string;
    sys_id: string;
}

interface MappedIncident {
    number: string;
    short_description: string;
    description?: string;
    state: string;
    priority: string;
    category?: string;
    assignment_group?: string;
    assigned_to?: string;
    created_on: string;
    updated_on: string;
}

export class HelpDeskService {
    private baseURL: string;
    private apiKey: string;
    private headers: Record<string, string>;
    // private username: string;
    // private password: string;
    
    constructor() {
        // Parse the base URL - remove any trailing slashes and paths
        this.baseURL = serviceNowBaseUrl;
        this.apiKey = serviceNowApiKey;
        this.headers ={
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'SDLC-MCP-Client/1.0.0',
            'x-sn-apikey': this.apiKey // For ServiceNow API Key
        };
    
        
        console.log(`[HelpDeskService] Initialized with baseURL: ${this.baseURL}`);
        console.log(`[HelpDeskService] API Key present: ${!!this.apiKey}`);
        
        if (!this.apiKey || this.apiKey.trim() === '') {
            console.error(`[HelpDeskService] ERROR: ServiceNow API Key is missing!`);
            throw new Error('ServiceNow API Key is required');
        }
    }

    /**
     * Get a ServiceNow incident by number or sys_id (mirrors ServiceNowClient.getIncident)
     */
    async getHelpdeskIncident(incidentId: string) {
        try {
            if (!incidentId) {
                throw new Error("Missing required parameter: incidentId");
            }

            console.log(`[HelpDeskService] Getting incident: ${incidentId}`);

            const endpoint = `incident?sysparm_query=number=${incidentId}&sysparm_limit=1&sysparm_display_value=all`;
            const completeUrl = `${this.baseURL}/${endpoint}`;
            const incidents = await fetch(completeUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'SDLC-MCP-Client/1.0.0',
                    'x-sn-apikey': this.apiKey // For ServiceNow API Key
                }
            }).catch((error) => {
                console.error(`[HelpDeskService] Error fetching incident ${incidentId}:`, error);
            });
            if (!incidents || !incidents.ok) {
                const errorText = incidents ? await incidents.text() : 'Unknown error';
                console.error(`[HelpDeskService] Error fetching incident ${incidentId}:`, errorText);
                throw new Error(`Failed to fetch helpdesk incident: ${errorText}`);
            }
            const data = await incidents.json();
            if (!data || !data.result || data.result.length === 0) {
                throw new Error(`Incident ${incidentId} not found`);
            }
            
            return {
                success: true,
                data: data,
            };

        } catch (error: any) {
            console.error(`[HelpDeskService] Error fetching incident ${incidentId}:`, error.message);
            return { 
                success: false,
                error: `Failed to fetch helpdesk incident: ${error.message}`,
                details: error.message,
                incident_id: incidentId
            };
        }
    }

    /**
     * Search ServiceNow knowledge base (mirrors ServiceNowClient.searchKnowledge)
     */
    async searchKnowledge(query: string, limit: number = 10) {
        try {
            if (!query) {
                throw new Error("Missing required parameter: query");
            }

            console.log(`[HelpDeskService] Getting incident: ${query}`);

            const endpoint = `kb_knowledge?sysparm_query=short_descriptionCONTAINS${query}^workflow_state=published&sysparm_limit=${limit}&sysparm_display_value=all`;
            const completeUrl = `${this.baseURL}/${endpoint}`;
            const incidents = await fetch(completeUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'SDLC-MCP-Client/1.0.0',
                    'x-sn-apikey': this.apiKey // For ServiceNow API Key
                }
            }).catch((error) => {
                console.error(`[HelpDeskService] Error fetching incident for ${query}:`, error);
            });
            if (!incidents || !incidents.ok) {
                const errorText = incidents ? await incidents.text() : 'Unknown error';
                console.error(`[HelpDeskService] Error fetching incident for ${query}:`, errorText);
                throw new Error(`Failed to fetch helpdesk incident: ${errorText}`);
            }
            const data = await incidents.json();
            if (!data || !data.result || data.result.length === 0) {
                throw new Error(`Incident ${query} not found`);
            }
            
            return {
                success: true,
                data: data,
            };

        } catch (error: any) {
            console.error(`[HelpDeskService] Error fetching incident ${query}:`, error.message);
            return { 
                success: false,
                error: `Failed to fetch helpdesk incident: ${error.message}`,
                details: error.message,
                query: query
            };
        }
    }

    /**
     * Search ServiceNow incidents by description (mirrors ServiceNowClient.searchIncidentsByDescription)
     * https://atmcodev.service-now.com/api/cartr/servicenow_table_api/incident?sysparm_query=short_descriptionLIKEFCCS&sysparm_limit=10&sysparm_display_value=all
     */
    async searchIncidents(query: string, field: string = 'short_description', limit: number = 5) {
        try {
            if (!query) {
                throw new Error("Missing required parameter: query");
            }

            console.log(`[HelpDeskService] Searching incidents: "${query}" in field: ${field}, limit: ${limit}`);

            const endpoint = `incident?sysparm_query=short_descriptionLIKE${query}&sysparm_limit=${limit}&sysparm_display_value=all`;
            const completeUrl = `${this.baseURL}/${endpoint}`;
            const incidents = await fetch(completeUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'SDLC-MCP-Client/1.0.0',
                    'x-sn-apikey': this.apiKey // For ServiceNow API Key
                }
            }).catch((error) => {
                console.error(`[HelpDeskService] Error fetching incident ${query}:`, error);
            });
            if (!incidents || !incidents.ok) {
                const errorText = incidents ? await incidents.text() : 'Unknown error';
                console.error(`[HelpDeskService] Error fetching incident ${query}:`, errorText);
                throw new Error(`Failed to fetch helpdesk incident: ${errorText}`);
            }
            const data = await incidents.json();
            if (!data || !data.result || data.result.length === 0) {
                throw new Error(`Incident for ${query} not found`);
            }

            return {
                success: true,
                data: data,
            };
        } catch (error: any) {
            console.error(`[HelpDeskService] Error searching incidents:`, error.message);
            return { 
                success: false,
                error: `Failed to search incidents: ${error.message}`,
                details: error.message
            };
        }
    }

    /**
     * Create a new ServiceNow incident (mirrors ServiceNowClient.createIncident)
     */
    async createIncident(incidentData: any) {
        try {
            if (!incidentData || !incidentData.short_description) {
                throw new Error("Missing required parameter: short_description");
            }

            console.log(`[HelpDeskService] Creating incident with data:`, JSON.stringify(incidentData, null, 2));

            const endpoint = `incident`;
            const completeUrl = `${this.baseURL}/${endpoint}`;

            // Prepare incident data with ServiceNow defaults
            const incident = {
                short_description: incidentData.short_description,
                description: incidentData.description || incidentData.short_description,
                priority: incidentData.priority || '3',
                category: incidentData.category || 'Software',
                state: '1', // New
                urgency: incidentData.urgency || '3',
                impact: incidentData.impact || '3',
                caller_id: incidentData.caller_id || incidentData.caller_email
            };

            // Remove undefined/null values
            Object.keys(incident).forEach(key => {
                if ((incident as any)[key] === undefined || (incident as any)[key] === null || (incident as any)[key] === '') {
                    delete (incident as any)[key];
                }
            });

            const response = await fetch(completeUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'SDLC-MCP-Client/1.0.0',
                    'x-sn-apikey': this.apiKey // For ServiceNow API Key
                },
                body: JSON.stringify(incident)
            }).catch((error) => {
                console.error(`[HelpDeskService] Error creating incident:`, error);
                throw error;
            });

            if (!response || !response.ok) {
                const errorText = response ? await response.text() : 'Unknown error';
                console.error(`[HelpDeskService] Error creating incident:`, errorText);
                throw new Error(`Failed to create incident: ${errorText}`);
            }

            const data = await response.json();
            console.log(`[HelpDeskService] Created incident: ${data.result?.number || 'Unknown'}`);
            
            return {
                success: true,
                data: data.result,
            };

        } catch (error: any) {
            console.error(`[HelpDeskService] Error creating incident:`, error.message);
            return { 
                success: false,
                error: `Failed to create incident: ${error.message}`,
                details: error.message
            };
        }
    }
}

export const helpdeskService = new HelpDeskService();