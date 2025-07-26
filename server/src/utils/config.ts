import dotenv from "dotenv";
dotenv.config();

// ssl workaround
const isProduction = process.env.NODE_ENV === 'production';
if (!isProduction) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    console.log('[Config] ⚠️  SSL certificate validation disabled for corporate proxy compatibility');
    console.log('[Config] ⚠️  This should NOT be used in production environments');
}

// SDLC and Jira Usage
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
export const GITHUB_ORG = process.env.GITHUB_ORG || "ncratleos-it-cio";
export const GITHUB_BASE_URL = process.env.GITHUB_BASE_URL || "https://api.github.com";

// export const serviceBaseUrl = `http://localhost`;
// export const dbaPort = process.env.DBA_PORT || 3003;
// export const jiraPort = process.env.JIRA_PORT || 3002;
// export const helpdeskPort = process.env.HELPDESK_PORT || 3001;

//helpdesk service
export const serviceNowBaseUrl = process.env.SERVICENOW_BASE_URL || "https://atmcodev.service-now.com/api/cartr/servicenow_table_api";
export const serviceNowApiKey = process.env.SERVICENOW_API_KEY || "";
export const defaultCustomerEmail = process.env.DEFAULT_CUSTOMER_EMAIL || "Uddeshya.Gupta@ncratleos.com";

// Jira service
export const jiraApiToken = process.env.JIRA_API_TOKEN || '';
export const jiraBaseUrl = process.env.JIRA_BASE_URL || 'https://ncratleosengtools.atlassian.net';
export const jiraUserEmail = process.env.JIRA_USER_EMAIL || 'aj385009@ncratleos.com';

export const REDIS_PORT = "6379";
// export const REDIS_HOST = process.env.REDIS_HOST || "localhost";
export const REDIS_HOST ="redis";

// DBA service
export const dBAserviceBaseUrl = process.env.DB_BASE_URL || "https://gdba.victoriousisland-087bc982.eastus.azurecontainerapps.io";
export const dBAMidUrl = "api/db";