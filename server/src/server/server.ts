import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { GitHubApiService } from '../services/githubService';
import { 
    CallToolRequestSchema, 
    ListToolsRequestSchema, 
    McpError, 
    ErrorCode 
} from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DBAService } from "../services/dbaService";
import { HelpDeskService } from "../services/helpdeskService";
import { JiraApiService } from "../services/jira-api";
import { JiraCacheService } from "../services/jiraCacheService";
import { GitHubApiJiraService } from "../services/github-api";
import { StoryManagementService } from "../services/storyManagementService";
import { jiraApiToken, jiraBaseUrl, jiraUserEmail } from "../utils/config";
import { AIAnalysisService } from "../utils/aiAnalysisService";

export class githubServer {
    private server: Server;
    // SDLC
    private gitHubApiService: GitHubApiService | undefined;
    // DB
    private dbaService: DBAService | undefined;
    // HELPDESK
    private helpdeskService: HelpDeskService | undefined;
    // JIRA NEW
    private jiraApi: JiraApiService;
    private cacheService: JiraCacheService;
    private githubApi: GitHubApiJiraService;
    private storyManagementService: StoryManagementService;

    constructor() {
        this.server = new Server(
            {
                name: "GitHub Server",
                description: "Server for GitHub API integration",
                version: "1.0.0",
            },
            {
                capabilities: {
                tools: {},
                },
            },
        );


        //// SDLC ////
        try {
            this.gitHubApiService = new GitHubApiService();
            console.log("[SDLCServer] GitHub service initialized successfully");
        } catch (error) {
            console.error("[SDLCServer] Failed to initialize GitHub service:", error);
            this.gitHubApiService = undefined;
        }

        //// JIRA ////
            this.jiraApi = new JiraApiService(
                jiraBaseUrl,
                jiraUserEmail,
                jiraApiToken
            );
        // Jira Cache Service
        this.cacheService = new JiraCacheService(this.jiraApi);
        this.jiraApi.setCacheService(this.cacheService);
        // Jira GitHub Integration
        this.githubApi = new GitHubApiJiraService();
        console.log("[JiraServer] GitHub service initialized successfully");
        // Initialize Story Management Service
        this.storyManagementService = new StoryManagementService(this.jiraApi, this.cacheService);

        this.setupToolHandlers();
        this.server.onerror = (error) => {
            console.error("MCP Server Error:", error);
        };
        
        /// HELPDESK ////
        try {
            this.helpdeskService = new HelpDeskService();
            console.log("[GitHubServer] Helpdesk service initialized successfully");
        } catch (error) {
            console.error("[GitHubServer] Failed to initialize Helpdesk service:", error);
            this.helpdeskService = undefined;
        }

        /// DBA ///
        try {
            this.dbaService = new DBAService();
            console.log("[DBAServer] DBA service initialized successfully");
        } catch (error) {
            console.error("[DBAServer] Failed to initialize DBA service:", error);
            this.dbaService = undefined;
        }

        process.on("SIGINT", async () => {
            console.log("SIGINT received, shutting down JIRA MCP server...");
            await this.server.close();
            process.exit(0);
        });
    }

    private setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                // SDLC //
                {
                    name: "get_repository_metadata",
                    description: "Get the metadata associated with a GitHub repository. Not associated with sdlc analysis",
                    inputSchema: {
                        type: "object",
                        properties: {
                            repositoryName: {
                                type: "string",
                                description: "repository name"
                            }
                        },
                        required: ["repositoryName"],
                        additionalProperties: false
                    }
                },
                {
                    name: "analyze_repository_code",
                    description: "Get repository code organized in chunks for LLM-powered SDLC analysis. SDLC analysis being the core objective",
                    inputSchema: {
                        type: "object",
                        properties: {
                            repositoryName: {
                                type: "string",
                                description: "repository name"
                            },
                            branch: {
                                type: "string",
                                description: "branch name (defaults to 'main')"
                            },
                            maxTokensPerChunk: {
                                type: "number",
                                description: "maximum tokens per chunk (defaults to 80000)"
                            },
                            excludePatterns: {
                                type: "array",
                                items: { type: "string" },
                                description: "file patterns to exclude from analysis"
                            }
                        },
                        required: ["repositoryName"],
                        additionalProperties: false
                    }
                },
                // Jira //
                {
                    name: "search_issues",
                    description: "Search JIRA issues using JQL",
                    inputSchema: {
                        type: "object",
                        properties: {
                        searchString: {
                            type: "string",
                            description: "JQL search string",
                        },
                        },
                        required: ["searchString"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_epic_children",
                    description:
                        "Get all child issues in an epic including their comments",
                    inputSchema: {
                        type: "object",
                        properties: {
                        epicKey: {
                            type: "string",
                            description: "The key of the epic issue",
                        },
                        },
                        required: ["epicKey"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_issue",
                    description:
                        "Get detailed information about a specific JIRA issue including comments",
                    inputSchema: {
                        type: "object",
                        properties: {
                        issueId: {
                            type: "string",
                            description: "The ID or key of the JIRA issue",
                        },
                        },
                        required: ["issueId"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "create_issue",
                    description: "Create a new JIRA issue with all necessary details for project PFA.",
                    inputSchema: {
                        type: "object",
                        properties: {
                        projectKey: {
                            type: "string",
                            description: "The project key where the issue will be created (e.g., 'PFA').",
                        },
                        issueType: {
                            type: "string",
                            description:
                            'The type of issue to create (e.g., "Bug", "Story", "Task"). For PFA, "Story" is common.',
                        },
                        summary: {
                            type: "string",
                            description: "The issue summary or title.",
                        },
                        description: { // Changed from 'description' to be more explicit about input type
                            type: "string",
                            description: "The detailed description of the issue (plain text). This is a required field for PFA.",
                        },
                        acceptanceCriteria: { // New field
                            type: "string",
                            description: "The acceptance criteria for the issue (plain text). This is a required field for PFA.",
                        },
                        processAreaOwnerName: { 
                            type: "string",
                            description: "The display name of the Process Area Owner (e.g., 'John Doe'). This name will be resolved to an Account ID. This is a required field for PFA.", // CORRECTED DESCRIPTION
                        },
                        storyPoints: { // New field
                            type: "number",
                            description: "The story points estimate for the issue. This is a required field for PFA.",
                        },
                        sprintName: { // Assuming Sprint ID is a number. If it's a string, adjust type.
                            type: "string", // Or string, depending on how Sprint IDs are represented
                            description: "Optional. The Name of the sprint to assign the issue to. This will be mapped to the relevant sprint custom field. An example for this field for reference - 'GL PFA.2025Q2.S4 (5/22-6/5)'",
                        },
                        priorityName: {
                            type: "string",
                            description: "Optional. The name of the priority to set for the issue (e.g., 'High', 'Medium', 'Lowest').",
                        },
                        // Optional Fields
                        labels: {
                            type: "array",
                            items: { type: "string" },
                            description: "Optional. A list of labels to add to the issue (e.g., ['frontend', 'bugfix']).",
                        },
                        assigneeName: {
                            type: "string",
                            description: "Optional. The display name of the user to assign the issue to (e.g., 'Jane Smith'). This name will be resolved to an Account ID.", // CORRECTED DESCRIPTION
                        },
                        parentIssueKey: {
                            type: "string",
                            description: "Optional. The issue key of the parent issue (e.g., 'PFA-123').",
                        },
                        // Optional: keep generic fields if other non-standard fields might be passed
                        // For PFA, we are being very specific, so this might be less used now.
                        additionalFields: {
                            type: "object",
                            description: "Any other additional custom fields to set on the issue, using their Jira field ID (e.g., customfield_XXXXX) as keys.",
                            additionalProperties: true,
                        },
                        },
                        required: [
                            "projectKey", 
                            "issueType", 
                            "summary", 
                            "description",
                            "acceptanceCriteria",
                            "processAreaOwnerName",
                            "storyPoints",
                            // "sprintName",
                            "priorityName", // Optional but recommended for PFA
                        ],
                        additionalProperties: false, // Set to false if only defined properties are allowed
                    },
                },
                {
                    name: "update_issue",
                    description: "Update an existing JIRA issue",
                    inputSchema: {
                        type: "object",
                        properties: {
                        issueKey: {
                            type: "string",
                            description: "The key of the issue to update",
                        },
                        fields: {
                            type: "object",
                            description: "Fields to update on the issue",
                            additionalProperties: true,
                        },
                        },
                        required: ["issueKey", "fields"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_transitions",
                    description: "Get available status transitions for a JIRA issue",
                    inputSchema: {
                        type: "object",
                        properties: {
                        issueKey: {
                            type: "string",
                            description: "The key of the issue to get transitions for",
                        },
                        },
                        required: ["issueKey"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "transition_issue",
                    description:
                        "Change the status of a JIRA issue by performing a transition",
                    inputSchema: {
                        type: "object",
                        properties: {
                        issueKey: {
                            type: "string",
                            description: "The key of the issue to transition",
                        },
                        transitionId: {
                            type: "string",
                            description: "The ID of the transition to perform",
                        },
                        comment: {
                            type: "string",
                            description: "Optional comment to add with the transition",
                        },
                        },
                        required: ["issueKey", "transitionId"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "add_attachment",
                    description: "Add a file attachment to a JIRA issue",
                    inputSchema: {
                        type: "object",
                        properties: {
                        issueKey: {
                            type: "string",
                            description: "The key of the issue to add attachment to",
                        },
                        fileContent: {
                            type: "string",
                            description: "Base64 encoded content of the file",
                        },
                        filename: {
                            type: "string",
                            description: "Name of the file to be attached",
                        },
                        },
                        required: ["issueKey", "fileContent", "filename"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "add_comment",
                    description: "Add a comment to a JIRA issue",
                    inputSchema: {
                        type: "object",
                        properties: {
                        issueIdOrKey: {
                            type: "string",
                            description: "The ID or key of the issue to add the comment to",
                        },
                        body: {
                            type: "string",
                            description: "The content of the comment (plain text)",
                        },
                        },
                        required: ["issueIdOrKey", "body"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_cached_projects",
                    description: "Retrieves details of cached Jira projects. Currently focuses on projects matching a predefined name (e.g., 'GL FP&A') during the caching process.",
                    inputSchema: { type: "object", properties: {}, additionalProperties: false },
                },
                {
                    name: "get_cached_issue_types",
                    description: "Retrieves cached issue types for a specified project key (e.g., 'PFA').",
                    inputSchema: {
                        type: "object",
                        properties: {
                        projectKey: { type: "string", description: "The project key (e.g., 'PFA')." }
                        },
                        required: ["projectKey"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_cached_assignable_users",
                    description: "Retrieves cached assignable users for a specified project key (e.g., 'PFA').",
                    inputSchema: {
                        type: "object",
                        properties: {
                        projectKey: { type: "string", description: "The project key (e.g., 'PFA')." }
                        },
                        required: ["projectKey"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_cached_sprints",
                    description: "Retrieves cached sprints for a specified board ID (e.g., '5892' for PFA).",
                    inputSchema: {
                        type: "object",
                        properties: {
                        boardId: { type: "string", description: "The board ID (e.g., '5892')." }
                        },
                        required: ["boardId"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_cached_priorities",
                    description: "Retrieves all cached Jira priorities.",
                    inputSchema: { type: "object", properties: {}, additionalProperties: false },
                },
                {
                    name: "get_cached_labels",
                    description: "Retrieves all cached Jira labels.",
                    inputSchema: { type: "object", properties: {}, additionalProperties: false },
                },
                {
                    name: "get_cached_custom_fields",
                    description: "Retrieves all cached Jira custom field definitions.",
                    inputSchema: { type: "object", properties: {}, additionalProperties: false },
                },
                { 
                    name: "get_cached_parent_issues",
                    description: "Retrieves cached parent issues (e.g., Epics) for a specified project key.",
                    inputSchema: {
                        type: "object",
                        properties: {
                        projectKey: { type: "string", description: "The project key (e.g., 'PFA')." }
                        },
                        required: ["projectKey"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_story_details_for_ai_report",
                    description: "Fetches complete story information including comments, all fields, and related GitHub activity (commits, PRs, issues) from live API calls, intended for AI report generation.",
                    inputSchema: {
                        type: "object",
                        properties: {
                        issueKey: {
                            type: "string",
                            description: "The key or ID of the JIRA story/issue (e.g., 'PFA-123').",
                        },
                        includeGithub: {
                            type: "boolean",
                            description: "Whether to include GitHub integration data (commits, PRs, issues). Default: true.",
                        },
                        },
                        required: ["issueKey"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_sprint_story_data_for_metrics",
                    description: "Fetches all stories with full details for a given sprint on a specified board. Handles 'active sprint' or 'current sprint'. Data is fetched live if not in snapshot cache, then cached.",
                    inputSchema: {
                        type: "object",
                        properties: {
                        sprintName: {
                            type: "string",
                            description: "The name of the sprint (e.g., 'GL PFA.2025Q2.S4' or 'active sprint', 'current sprint').",
                        },
                        },
                        required: ["sprintName", "boardId"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_github_info_for_story",
                    description: "Fetches comprehensive GitHub information (commits, PRs, issues, branches, repositories) for a JIRA story using its key. Results are cached for performance.",
                    inputSchema: {
                        type: "object",
                        properties: {
                        issueKey: {
                            type: "string",
                            description: "The key of the JIRA story/issue (e.g., 'PFA-123').",
                        },
                        },
                        required: ["issueKey"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_stories_for_sprint",
                    description: "Retrieves all stories for a given sprint by name. Supports 'active sprint' or 'current sprint' as special values. Results are cached and include comprehensive story details and sprint summary.",
                    inputSchema: {
                        type: "object",
                        properties: {
                        sprintName: {
                            type: "string",
                            description: "The name of the sprint (e.g., 'GL PFA.2025Q2.S4', 'active sprint', or 'current sprint').",
                        },
                        boardId: {
                            type: "string",
                            description: "Optional. The board ID (defaults to '5892' for PFA board).",
                        },
                        },
                        required: ["sprintName"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_stories_for_user",
                    description: "Retrieves stories assigned to a specific user. Can be filtered by sprint name. If no sprint is provided, returns all active stories for the user. Results are cached and include workload analysis.",
                    inputSchema: {
                        type: "object",
                        properties: {
                        userName: {
                            type: "string",
                            description: "The display name of the user (e.g., 'Abhishek Jaglan').",
                        },
                        sprintName: {
                            type: "string",
                            description: "Optional. The name of the sprint to filter by (e.g., 'GL PFA.2025Q2.S4', 'active sprint'). If not provided, returns all active stories.",
                        },
                        boardId: {
                            type: "string",
                            description: "Optional. The board ID (defaults to '5892' for PFA board).",
                        },
                        },
                        required: ["userName"],
                        additionalProperties: false,
                    },
                },
                // Helpdesk Functions //
                {
                    name: "get_helpdesk_incident",
                    description: "Get a helpdesk service now incident by ID or number",
                    inputSchema: {
                        type: "object",
                        properties: {
                            incidentId: {
                                type: "string",
                                description: "The ID or number of the helpdesk incident"
                            }
                        },
                        required: ["incidentId"],
                        additionalProperties: false
                    }
                },
                {
                    name: "search_helpdesk_knowledge",
                    description: "Search helpdesk service now knowledge base articles",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "Search query for knowledge articles"
                            },
                            limit: {
                                type: "number",
                                description: "Maximum number of results (default: 10)"
                            }
                        },
                        required: ["query"],
                        additionalProperties: false
                    }
                },
                {
                    name: "search_helpdesk_incidents",
                    description: "Search helpdesk service now incidents by description, short description or other fields",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "Search query text"
                            },
                            field: {
                                type: "string",
                                description: "Field to search in (default: short_description)"
                            },
                            limit: {
                                type: "number",
                                description: "Maximum number of results (default: 10)"
                            }
                        },
                        required: ["query"],
                        additionalProperties: false
                    }
                },
                {
                    name: "create_helpdesk_incident",
                    description: "Create a new helpdesk service now incident",
                    inputSchema: {
                        type: "object",
                        properties: {
                            short_description: {
                                type: "string",
                                description: "Brief description of the incident (required)"
                            },
                            description: {
                                type: "string",
                                description: "Detailed description of the incident"
                            },
                            priority: {
                                type: "string",
                                description: "Priority level (1-Critical, 2-High, 3-Moderate, 4-Low)"
                            },
                            category: {
                                type: "string",
                                description: "Incident category"
                            },
                            caller_id: {
                                type: "string",
                                description: "Caller user ID or email"
                            }
                        },
                        required: ["short_description"],
                        additionalProperties: false
                    }
                },
                // DBA
                {
                    name: "test_dba_connection",
                    description: "Test the DBA connection",
                    inputSchema: {
                        type: "object",
                        properties: {},
                        additionalProperties: false
                    }
                },
                {
                    name: "unlock_dba_user",
                    description: "Unlock a DBA user for a given db and user id",
                    inputSchema: {
                        type: "object",
                        properties: {
                            dbName: {
                                type: "string",
                                description: "The name of the database"
                            },
                            userId: {
                                type: "string",
                                description: "The ID of the user to unlock"
                            }
                        },
                        required: ["dbName", "userId"],
                        additionalProperties: false
                    }
                },
            ]
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                const args = request.params.arguments as Record<string, any>;
                switch (request.params.name) {
                    //SDLC
                    case "get_repository_metadata":{
                        if(!args.repositoryName) {
                            throw new McpError(
                                ErrorCode.InvalidRequest,
                                "Missing required parameter: repositoryName"
                            );
                        }
                        const response = await this.gitHubApiService?.getRepositoryMetadata(args.repositoryName);
                        return {
                            content: [
                                { type: "text", text: JSON.stringify(response, null, 2) }
                            ]
                        };
                    }
                    case "analyze_repository_code": {
                        if(!args.repositoryName) {
                            throw new McpError(
                                ErrorCode.InvalidRequest,
                                "Missing required parameter: repositoryName"
                            );
                        }
                        const analysis = await this.gitHubApiService?.getRepositoryChunks(
                            args.repositoryName,
                            args.branch || 'main',
                            args.maxTokensPerChunk || 100000,
                            args.excludePatterns || ['node_modules', 'build', 'dist', '.git',  '.next', 'coverage', 'vendor', 'target', 'logs']
                        );
                        return {
                            content: [
                                { type: "text", text: JSON.stringify(analysis, null, 2) }
                            ]
                        };
                    }
                    // DBA
                    case "test_dba_connection": {
                        try {
                            console.log("[Server] Testing DBA connection...");
                            const response = await this.dbaService?.testDbaConnection();
                            console.log("[Server] DBA connection test result:", response);
                            
                            return {
                                content: [
                                    { type: "text", text: JSON.stringify(response || { error: "DBA service not available" }, null, 2) }
                                ]
                            };
                        } catch (error) {
                            console.error("Error in test_dba_connection handler:", error);
                            return {
                                content: [
                                    { type: "text", text: JSON.stringify({
                                        error: "Failed to test DBA connection",
                                        details: error instanceof Error ? error.message : "Unknown error"
                                    }, null, 2) }
                                ]
                            };
                        }
                    }
                    case "unlock_dba_user": {
                        if(!args.dbName || !args.userId) {
                            throw new McpError(
                                ErrorCode.InvalidRequest,
                                "Missing required parameters: dbName and userId"
                            );
                        }
                        try {
                            console.log(`[Server] Unlocking DBA user: ${args.userId} for database: ${args.dbName}`);
                            const response = await this.dbaService?.unlockDbUser(args.dbName, args.userId);
                            console.log("[Server] DBA unlock result:", response);
                            
                            return {
                                content: [
                                    { type: "text", text: JSON.stringify(response || { error: "DBA service not available" }, null, 2) }
                                ]
                            };
                        } catch (error) {
                            console.error("Error in unlock_dba_user handler:", error);
                            return {
                                content: [
                                    { type: "text", text: JSON.stringify({
                                        error: "Failed to unlock DBA user",
                                        details: error instanceof Error ? error.message : "Unknown error"
                                    }, null, 2) }
                                ]
                            };
                        }
                    }
                    // Helpdesk Functions //
                    case "get_helpdesk_incident": {
                        if(!args.incidentId) {
                            throw new McpError(
                                ErrorCode.InvalidRequest,
                                "Missing required parameter: incidentId"
                            );
                        }
                        try {
                            const response = await this.helpdeskService?.getHelpdeskIncident(args.incidentId);
                            const responseContent = response || { error: "No response from helpdesk service" };
                            
                            return {
                                content: [
                                    { type: "text", text: JSON.stringify(responseContent, null, 2) }
                                ]
                            };
                        } catch (error) {
                            console.error("Error in get_helpdesk_incident handler:", error);
                            return {
                                content: [
                                    { type: "text", text: JSON.stringify({
                                        error: "Failed to get helpdesk incident",
                                        details: error instanceof Error ? error.message : "Unknown error"
                                    }, null, 2) }
                                ]
                            };
                        }
                    }
                    case "search_helpdesk_knowledge": {
                        if(!args.query) {
                            throw new McpError(
                                ErrorCode.InvalidRequest,
                                "Missing required parameter: query"
                            );
                        }
                        try {
                            const response = await this.helpdeskService?.searchKnowledge(args.query, args.limit || 10);
                            const responseContent = response || { error: "No response from helpdesk service" };
                            
                            return {
                                content: [
                                    { type: "text", text: JSON.stringify(responseContent, null, 2) }
                                ]
                            };
                        } catch (error) {
                            console.error("Error in search_helpdesk_knowledge handler:", error);
                            return {
                                content: [
                                    { type: "text", text: JSON.stringify({
                                        error: "Failed to search helpdesk knowledge",
                                        details: error instanceof Error ? error.message : "Unknown error"
                                    }, null, 2) }
                                ]
                            };
                        }
                    }
                    case "search_helpdesk_incidents": {
                        if(!args.query) {
                            throw new McpError(
                                ErrorCode.InvalidRequest,
                                "Missing required parameter: query"
                            );
                        }
                        try {
                            const response = await this.helpdeskService?.searchIncidents(
                                args.query, 
                                args.field || 'short_description', 
                                args.limit || 5
                            );
                            const responseContent = response || { error: "No response from helpdesk service" };
                            
                            return {
                                content: [
                                    { type: "text", text: JSON.stringify(responseContent, null, 2) }
                                ]
                            };
                        } catch (error) {
                            console.error("Error in search_helpdesk_incidents handler:", error);
                            return {
                                content: [
                                    { type: "text", text: JSON.stringify({
                                        error: "Failed to search helpdesk incidents",
                                        details: error instanceof Error ? error.message : "Unknown error"
                                    }, null, 2) }
                                ]
                            };
                        }
                    }
                    case "create_helpdesk_incident": {
                        if(!args.short_description) {
                            throw new McpError(
                                ErrorCode.InvalidRequest,
                                "Missing required parameter: short_description"
                            );
                        }
                        try {
                            const response = await this.helpdeskService?.createIncident(args);
                            const responseContent = response || { error: "No response from helpdesk service" };
                            
                            return {
                                content: [
                                    { type: "text", text: JSON.stringify(responseContent, null, 2) }
                                ]
                            };
                        } catch (error) {
                            console.error("Error in create_helpdesk_incident handler:", error);
                            return {
                                content: [
                                    { type: "text", text: JSON.stringify({
                                        error: "Failed to create helpdesk incident",
                                        details: error instanceof Error ? error.message : "Unknown error"
                                    }, null, 2) }
                                ]
                            };
                        }
                    }
                    // JIRA Functions //
                    case "search_issues": {
                        if (!args.searchString || typeof args.searchString !== "string") {
                        throw new McpError(
                            ErrorCode.InvalidParams,
                            "Search string is required",
                        );
                        }
                        const response = await this.jiraApi.searchIssues(args.searchString);
                        return {
                        content: [
                            { type: "text", text: JSON.stringify(response, null, 2) },
                        ],
                        };
                    }
                    case "get_epic_children": {
                        if (!args.epicKey || typeof args.epicKey !== "string") {
                        throw new McpError(
                            ErrorCode.InvalidParams,
                            "Epic key is required",
                        );
                        }
                        const response = await this.jiraApi.getEpicChildren(args.epicKey);
                        return {
                        content: [
                            { type: "text", text: JSON.stringify(response, null, 2) },
                        ],
                        };
                    }
                    case "get_issue": {
                        if (!args.issueId || typeof args.issueId !== "string") {
                        throw new McpError(
                            ErrorCode.InvalidParams,
                            "Issue ID is required",
                        );
                        }
                        const response = await this.jiraApi.getIssueWithComments(
                        args.issueId,
                        );
                        return {
                        content: [
                            { type: "text", text: JSON.stringify(response, null, 2) },
                        ],
                        };
                    }
                    case "create_issue": {
                        // Basic validation
                        if (
                        !args.projectKey || typeof args.projectKey !== "string" ||
                        !args.issueType || typeof args.issueType !== "string" ||
                        !args.summary || typeof args.summary !== "string" ||
                        !args.description || typeof args.description !== "string" || // Expect 'description'
                        !args.acceptanceCriteria || typeof args.acceptanceCriteria !== "string" || // Expect 'acceptanceCriteria'
                        !args.processAreaOwnerName || typeof args.processAreaOwnerName !== "string" || // Expect 'processAreaOwnerName'
                        args.storyPoints === undefined || typeof args.storyPoints !== "number" ||
                        !args.sprintName || typeof args.sprintName !== "string" || // Expect 'sprintName'
                        !args.priorityName || typeof args.priorityName !== "string" // Expect 'priorityName'
                        // Optional fields like assigneeName, labels, parentIssueKey are not checked here if truly optional
                        ) {
                        throw new McpError(
                            ErrorCode.InvalidParams,
                            // Corrected and accurate error message
                            "projectKey, issueType, summary, description, acceptanceCriteria, processAreaOwnerName, storyPoints (number), sprintName, and priorityName are required."
                        );
                        }
                        const response = await this.jiraApi.createIssue(
                        args.projectKey,
                        args.issueType,
                        args.summary,
                        args.description,                 // Pass 'description'
                        args.acceptanceCriteria,          // Pass 'acceptanceCriteria'
                        args.processAreaOwnerName,        // Pass 'processAreaOwnerName'
                        args.storyPoints,
                        args.sprintName,                  // Pass 'sprintName'
                        args.priorityName,                // Pass 'priorityName'
                        args.labels as string[] | undefined,
                        args.assigneeName as string | undefined, // Pass 'assigneeName'
                        args.parentIssueKey as string | undefined, // Pass 'parentIssueKey'
                        args.additionalFields as Record<string, any> | undefined
                        );
                        return {
                        content: [
                            { type: "text", text: JSON.stringify(response, null, 2) },
                        ],
                        };
                    }
                    case "update_issue": {
                        if (
                        !args.issueKey ||
                        typeof args.issueKey !== "string" ||
                        !args.fields ||
                        typeof args.fields !== "object"
                        ) {
                        throw new McpError(
                            ErrorCode.InvalidParams,
                            "issueKey and fields object are required",
                        );
                        }
                        await this.jiraApi.updateIssue(args.issueKey, args.fields);
                        return {
                        content: [
                            {
                            type: "text",
                            text: JSON.stringify(
                                { message: `Issue ${args.issueKey} updated successfully` },
                                null,
                                2,
                            ),
                            },
                        ],
                        };
                    }
                    case "get_transitions": {
                        if (!args.issueKey || typeof args.issueKey !== "string") {
                        throw new McpError(
                            ErrorCode.InvalidParams,
                            "Issue key is required",
                        );
                        }
                        const response = await this.jiraApi.getTransitions(args.issueKey);
                        return {
                        content: [
                            { type: "text", text: JSON.stringify(response, null, 2) },
                        ],
                        };
                    }
                    case "transition_issue": {
                        if (
                        !args.issueKey ||
                        typeof args.issueKey !== "string" ||
                        !args.transitionId ||
                        typeof args.transitionId !== "string"
                        ) {
                        throw new McpError(
                            ErrorCode.InvalidParams,
                            "issueKey and transitionId are required",
                        );
                        }
                        await this.jiraApi.transitionIssue(
                        args.issueKey,
                        args.transitionId,
                        args.comment as string | undefined,
                        );
                        return {
                        content: [
                            {
                            type: "text",
                            text: JSON.stringify(
                                {
                                message: `Issue ${args.issueKey} transitioned successfully${args.comment ? " with comment" : ""}`,
                                },
                                null,
                                2,
                            ),
                            },
                        ],
                        };
                    }
                    case "add_attachment": {
                        if (
                        !args.issueKey ||
                        typeof args.issueKey !== "string" ||
                        !args.fileContent ||
                        typeof args.fileContent !== "string" ||
                        !args.filename ||
                        typeof args.filename !== "string"
                        ) {
                        throw new McpError(
                            ErrorCode.InvalidParams,
                            "issueKey, fileContent, and filename are required",
                        );
                        }
                        const fileBuffer = Buffer.from(args.fileContent, "base64");
                        const result = await this.jiraApi.addAttachment(
                        args.issueKey,
                        fileBuffer,
                        args.filename,
                        );
                        return {
                        content: [
                            {
                            type: "text",
                            text: JSON.stringify(
                                {
                                message: `File ${args.filename} attached successfully to issue ${args.issueKey}`,
                                attachmentId: result.id,
                                filename: result.filename,
                                },
                                null,
                                2,
                            ),
                            },
                        ],
                        };
                    }
                    case "add_comment": {
                        if (
                        !args.issueIdOrKey ||
                        typeof args.issueIdOrKey !== "string" ||
                        !args.body ||
                        typeof args.body !== "string"
                        ) {
                        throw new McpError(
                            ErrorCode.InvalidParams,
                            "issueIdOrKey and body are required",
                        );
                        }
                        const response = await this.jiraApi.addCommentToIssue(
                        args.issueIdOrKey,
                        args.body,
                        );
                        return {
                        content: [
                            { type: "text", text: JSON.stringify(response, null, 2) },
                        ],
                        };
                    }
                    case "get_cached_projects": {
                        const projects = await this.cacheService.getAllCachedProjectDetails();
                        return { content: [{ type: "text", text: JSON.stringify(projects, null, 2) }] };
                    }
                    case "get_cached_issue_types": {
                        if (!args.projectKey || typeof args.projectKey !== "string") {
                        throw new McpError(ErrorCode.InvalidParams, "projectKey is required.");
                        }
                        const issueTypes = await this.cacheService.getCachedIssueTypesForProject(args.projectKey);
                        return { content: [{ type: "text", text: JSON.stringify(issueTypes, null, 2) }] };
                    }
                    case "get_cached_assignable_users": {
                        if (!args.projectKey || typeof args.projectKey !== "string") {
                        throw new McpError(ErrorCode.InvalidParams, "projectKey is required.");
                        }
                        const users = await this.cacheService.getCachedAssignableUsersForProject(args.projectKey);
                        return { content: [{ type: "text", text: JSON.stringify(users, null, 2) }] };
                    }
                    case "get_cached_sprints": {
                        if (!args.boardId || typeof args.boardId !== "string") {
                        throw new McpError(ErrorCode.InvalidParams, "boardId is required.");
                        }
                        const sprints = await this.cacheService.getCachedSprintsForBoard(args.boardId);
                        return { content: [{ type: "text", text: JSON.stringify(sprints, null, 2) }] };
                    }
                    case "get_cached_priorities": {
                        const priorities = await this.cacheService.getAllCachedPriorities();
                        return { content: [{ type: "text", text: JSON.stringify(priorities, null, 2) }] };
                    }
                    case "get_cached_labels": {
                        const labels = await this.cacheService.getAllCachedLabels();
                        return { content: [{ type: "text", text: JSON.stringify(labels, null, 2) }] };
                    }
                    case "get_cached_custom_fields": {
                        const customFields = await this.cacheService.getAllCachedCustomFields();
                        return { content: [{ type: "text", text: JSON.stringify(customFields, null, 2) }] };
                    }
                    case "get_cached_parent_issues": { 
                        if (!args.projectKey || typeof args.projectKey !== "string") {
                        throw new McpError(ErrorCode.InvalidParams, "projectKey is required.");
                        }
                        const parentIssues = await this.cacheService.getCachedParentIssuesForProject(args.projectKey);
                        return { content: [{ type: "text", text: JSON.stringify(parentIssues, null, 2) }] };
                    }
                    case "get_story_details_for_ai_report": {
                        if (!args.issueKey || typeof args.issueKey !== "string") {
                            throw new McpError(ErrorCode.InvalidParams, "issueKey is required and must be a string.");
                        }
                        
                        // Fetch complete story details including comments
                        const storyDetails = await this.jiraApi.getIssueWithComments(args.issueKey);
                        
                        // Include GitHub integration by default, unless explicitly disabled or service unavailable
                        const includeGithub = args.includeGithub !== false && this.githubApi !== null;
                        
                        if (args.includeGithub === true && this.githubApi === null) {
                            console.warn("[JiraServer] GitHub integration requested but service not available");
                        }
                        
                        // Generate AI-ready analysis with optional GitHub integration
                        const analysisData = includeGithub 
                            ? await AIAnalysisService.generateStoryAnalysis(storyDetails, this.githubApi!)
                            : await AIAnalysisService.generateStoryAnalysis(storyDetails);
                        
                        return { content: [{ type: "text", text: JSON.stringify(analysisData, null, 2) }] };
                    }
                    case "get_sprint_story_data_for_metrics": {
                        if (!args.sprintName || typeof args.sprintName !== "string") {
                        throw new McpError(ErrorCode.InvalidParams, "sprintName is required and must be a string.");
                        }
                        
                        // Hardcode the boardId for PFA
                        const boardId = "5892"; // PFA board ID
                        
                        let sprintId: number | undefined;
                        const sprintNameLower = args.sprintName.toLowerCase();

                        if (sprintNameLower === "active sprint" || sprintNameLower === "current sprint") {
                        const allSprintsOnBoard = await this.cacheService.getCachedSprintsForBoard(boardId);
                        const activeSprint = allSprintsOnBoard.find(s => s.state === 'active');
                        if (activeSprint && activeSprint.id) {
                            sprintId = parseInt(activeSprint.id, 10);
                            console.info(`[JiraServer] Resolved "${args.sprintName}" to active sprint ID: ${sprintId} for board ${boardId}`);
                        } else {
                            throw new McpError(ErrorCode.InvalidParams, `No active sprint found for board ${boardId}.`);
                        }
                        } else {
                        sprintId = await this.cacheService.getSprintIdByName(args.sprintName, boardId);
                        }

                        if (sprintId === undefined) {
                        throw new McpError(ErrorCode.InvalidParams, `Could not resolve sprint ID for name: "${args.sprintName}" on board ${boardId}. Ensure the sprint name is exact or use 'active sprint'.`);
                        }

                        let metricsData = await this.cacheService.getCachedSprintMetricsData(sprintId, boardId);

                        if (!metricsData) {
                        console.log(`[JiraServer] Sprint metrics cache miss for sprint ${sprintId}, board ${boardId}. Fetching live.`);
                        
                        // Hardcode the project key for PFA as well
                        const projectKeyForJql = "PFA";
                        const projectClause = `project = "${projectKeyForJql}" AND `;
                        const jql = `${projectClause}sprint = ${sprintId} AND issuetype in (Story, Task, Bug, Sub-task) ORDER BY updated DESC`;
                        
                        // Fetch only fields needed for metrics
                        const metricsFields = [
                            'key', 'summary', 'status', 'assignee', 'issuetype', 'priority', 
                            'created', 'updated', 'resolutiondate', 'labels', 'components', 
                            'fixVersions', 'customfield_10058' // Story points field
                        ];
                        
                        const storiesData = await this.jiraApi.searchDetailedIssues(jql, metricsFields);

                        if (storiesData && storiesData.length > 0) {
                            await this.cacheService.cacheSprintMetricsData(sprintId, boardId, storiesData);
                            metricsData = storiesData.map(story => ({
                            key: story.key,
                            summary: story.fields?.summary || '',
                            status: story.fields?.status?.name || 'Unknown',
                            statusCategory: story.fields?.status?.statusCategory?.name || 'Unknown',
                            assignee: story.fields?.assignee?.displayName || 'Unassigned',
                            issueType: story.fields?.issuetype?.name || 'Unknown',
                            priority: story.fields?.priority?.name || 'Unknown',
                            storyPoints: story.fields?.customfield_10058 || 0,
                            created: story.fields?.created,
                            updated: story.fields?.updated,
                            resolutiondate: story.fields?.resolutiondate,
                            labels: story.fields?.labels || [],
                            components: story.fields?.components?.map((c: any) => c.name) || [],
                            fixVersions: story.fields?.fixVersions?.map((v: any) => v.name) || []
                            }));
                        } else {
                            metricsData = [];
                        }
                        }

                        // Generate comprehensive metrics
                        const sprintMetrics = this.cacheService.generateSprintMetrics(metricsData);
                        
                        return { content: [{ type: "text", text: JSON.stringify(sprintMetrics, null, 2) }] };
                    }
                    case "get_github_info_for_story": {
                        if (!args.issueKey || typeof args.issueKey !== "string") {
                        throw new McpError(ErrorCode.InvalidParams, "issueKey is required and must be a string.");
                        }

                        if (!this.githubApi) {
                        throw new McpError(ErrorCode.InternalError, "GitHub service is not available. Please check GitHub configuration.");
                        }

                        const githubInfo = await this.githubApi.getGitHubInfoForIssue(args.issueKey);
                        return { content: [{ type: "text", text: JSON.stringify(githubInfo, null, 2) }] };
                    }
                    case "get_stories_for_sprint": {
                        if (!args.sprintName || typeof args.sprintName !== "string") {
                        throw new McpError(ErrorCode.InvalidParams, "sprintName is required and must be a string.");
                        }

                        const boardId = args.boardId || "5892";
                        if (typeof boardId !== "string") {
                        throw new McpError(ErrorCode.InvalidParams, "boardId must be a string if provided.");
                        }

                        const sprintStories = await this.storyManagementService.getStoriesForSprint(args.sprintName, boardId);
                        return { content: [{ type: "text", text: JSON.stringify(sprintStories, null, 2) }] };
                    }
                    case "get_stories_for_user": {
                        if (!args.userName || typeof args.userName !== "string") {
                        throw new McpError(ErrorCode.InvalidParams, "userName is required and must be a string.");
                        }

                        if (args.sprintName && typeof args.sprintName !== "string") {
                        throw new McpError(ErrorCode.InvalidParams, "sprintName must be a string if provided.");
                        }

                        const boardId = args.boardId || "5892";
                        if (typeof boardId !== "string") {
                        throw new McpError(ErrorCode.InvalidParams, "boardId must be a string if provided.");
                        }

                        const userStories = await this.storyManagementService.getStoriesForUser(
                        args.userName, 
                        args.sprintName, 
                        boardId
                        );
                        return { content: [{ type: "text", text: JSON.stringify(userStories, null, 2) }] };
                    }
                    default:
                        throw new McpError(
                            ErrorCode.MethodNotFound,
                            `Unknown tool: ${request.params.name}`
                        );
                }
            } catch (error) {
                if(error instanceof McpError) {
                    throw error;
                }
                throw new McpError(
                    ErrorCode.InternalError,
                    error instanceof Error ? error.message : "Unknown error occured"
                );
            }
        });
    };

    async run() {
        await this.cacheService.initializeCache()
        .then(() => {
            console.log("[JiraServer] Background cache initialization completed successfully.");
        })
        .catch(error => {
            console.error("[JiraServer] Background cache initialization failed:", error);
        });
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.log(`Github MCP server connected to transport`);
    }
}