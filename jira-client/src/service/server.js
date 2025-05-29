const { JIRA_MCP_PATH } = require("../utils/config");
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const path = require('path');

const transportOptions = {
  command: 'bun',
  args: [path.normalize(JIRA_MCP_PATH)],
  env: { ...process.env }, // Pass environment variables from parent to child MCP process
  stdio: ['pipe', 'pipe', 'inherit'] // stdin, stdout, stderr (inherit stderr for debugging MCP)
};

const transport = new StdioClientTransport(transportOptions);
const client = new Client(
  { name: 'jira-client-cli', version: '1.0.0' }, 
  { defaultRequestTimeout: 300000 } // 300,000 ms = 5 minutes
);

let functionDefinitions = [];
const functionDefinitionsFunction = async () => {
  try {
    await client.connect(transport);
    console.log('Connected to Jira MCP server');

     // Explicitly set timeout for the listTools call
    const toolsResponse = await client.listTools(undefined, { timeout: 300000 }); // 300,000 ms = 5 minutes
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
      functionDefinitions.length = 0;
      return; // Exit if no tools are found or response is invalid
    }

    // Clear the existing array contents without creating a new reference
    functionDefinitions.length = 0; 
    
    // Populate the array with new definitions
    const newDefinitions = actualTools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || { type: 'object', properties: {} }, // Fallback for parameters
      },
    }));
    functionDefinitions.push(...newDefinitions); // Add items from newDefinitions to the existing array reference
    
    console.log('Retrieved tools:', actualTools.map((t) => t.name));
  } catch (error) {
    console.error('Error connecting to MCP server or listing tools:', error);
    // Clear functionDefinitions in case of an error to prevent using stale/partial data
    functionDefinitions.length = 0; 
    process.exit(1);
  }
};

const cleanup = async () => {
    console.log('Shutting down...');
    if (client) {
        try {
            await client.close(); 
            console.log('MCP client closed.');
        } catch (e) {
            console.error('Error closing MCP client:', e);
        }
    }
    process.exit(0);
};

module.exports = {
  functionDefinitionsFunction,
  functionDefinitions,
  transport,
  client,
  cleanup
};