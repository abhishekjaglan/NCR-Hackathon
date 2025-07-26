import path from "path";
import { JIRA_MCP_PATH } from "../utils/config";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { time } from "console";

export class MCPClient {
  private jiraMcpPath: string = JIRA_MCP_PATH;
  public functionDefinitions: Array<{
    type: string;
    function: {
      name: string;
      description: string | undefined;
      parameters: any;
    };
  }> = [];
  private transport: StdioClientTransport;
  public client: Client;

  constructor() {
    const transportOptions = {
      command: 'node',
      args: [path.normalize(this.jiraMcpPath)],
      env: Object.fromEntries(Object.entries(process.env).filter(([_, value]) => value !== undefined)) as Record<string, string>, // Pass environment variables from parent to child MCP process
      stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr (inherit stderr for debugging MCP)
      timeout: 300000, // Set a timeout for the transport to avoid hanging indefinitely
      requestTimeout: 300000,
      responseTimeout: 300000
    };

    this.transport = new StdioClientTransport(transportOptions);
    this.client = new Client(
      { 
        name: 'github-client-cli', 
        version: '1.0.0' 
      },
    );
  }

  async functionDefinitionsFunction () {
    try {
      await this.client.connect(this.transport);
      console.log('Connected to Jira MCP server');

      // Explicitly set timeout for the listTools call
      const toolsResponse = await this.client.listTools(undefined, { timeout: 300000 }); // 300,000 ms = 5 minutes
      let actualTools = [];
      if (toolsResponse && Array.isArray(toolsResponse.tools)) {
        actualTools = toolsResponse.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
      } else {
        console.warn("toolsResponse.tools is not an array or is undefined:", toolsResponse);
        // Ensure functionDefinitions remains empty or is explicitly cleared if no tools are found
        this.functionDefinitions.length = 0;
        return; // Exit if no tools are found or response is invalid
      }

      // Clear the existing array contents without creating a new reference
      this.functionDefinitions.length = 0;
      
      // Populate the array with new definitions
      const newDefinitions = actualTools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema || { type: 'object', properties: {} }, // Fallback for parameters
        },
      }));
      this.functionDefinitions.push(...newDefinitions); // Add items from newDefinitions to the existing array reference
      
      console.log('Retrieved tools:', actualTools.map((t) => t.name));
      return this.functionDefinitions; // Return the updated function definitions
    } catch (error) {
      console.error('Error connecting to MCP server or listing tools:', error);
      // Clear functionDefinitions in case of an error to prevent using stale/partial data
      this.functionDefinitions.length = 0;
      process.exit(1);
    }
  };

  async cleanup () {
    console.log('Shutting down...');
    if (this.client) {
        try {
            await this.client.close(); 
            console.log('MCP client closed.');
        } catch (e) {
            console.error('Error closing MCP client:', e);
        }
    }
    process.exit(0);
  };

}

export const mcpClient = new MCPClient();