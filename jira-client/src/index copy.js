import express, { Express, Request, Response, NextFunction } from 'express';
import { spawn } from 'child_process';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import OpenAI from 'openai';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const AZURE_API_KEY = process.env.AZURE_API_KEY || '';
const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT || '';
const AZURE_MODEL = process.env.AZURE_MODEL || 'gpt-35-turbo';
const JIRA_MCP_PATH = process.env.JIRA_MCP_PATH || path.join(__dirname, '..', '..', 'jira-mcp', 'build', 'index.js');
const PORT = parseInt(process.env.PORT || '3000');

// Initialize Azure OpenAI client
const openai = new OpenAI({
  apiKey: AZURE_API_KEY,
  baseURL: AZURE_ENDPOINT,
});

if (!AZURE_API_KEY || !AZURE_ENDPOINT) {
  console.error('Missing Azure OpenAI configuration. Set AZURE_API_KEY and AZURE_ENDPOINT environment variables.');
  process.exit(1);
}

// // Spawn the Jira MCP server as a subprocess
// const mcpServerProcess = spawn('bun', [path.normalize(JIRA_MCP_PATH)], {
//   stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr (inherit stderr for debugging)
//   env: {
//     ...process.env,
//   }
// });

// Handle server startup errors
// mcpServerProcess.on('error', (err) => {
//   console.error('Failed to start Jira MCP server:', err);
//   process.exit(1);
// });

const transportOptions = {
  command: 'bun', // Assuming 'bun' is required to run your JIRA_MCP_PATH script
  args: [path.normalize(JIRA_MCP_PATH)],
  // Pass environment variables. Check SDK if `env` is a supported option.
  // If not, the child process will inherit the parent's environment,
  // or you might need to set them globally before this script runs.
  options: { // This 'options' field is hypothetical for passing SpawnOptions like env or stdio
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'inherit'] as any, // To match your original spawn, if supported
  }
};

// Set up MCP client with stdio transport
const transport = new StdioClientTransport(transportOptions);
const client = new Client({ name: 'jira-client', version: '1.0.0' });

interface McpTool {
  name: string;
  description: string;
  parameters: any; // Refine this if you know the exact structure
}

// Interface for tools as returned by client.listTools() - expecting inputSchema
interface McpServerTool {
  name: string;
  description?: string; // Description might be optional
  inputSchema: any; // MCP tools typically use inputSchema for parameters
}

// Connect to the server and retrieve tools
let functionDefinitions: any[] = [];
(async () => {
  try {
    await client.connect(transport);
    console.log('Connected to Jira MCP server');

     const toolsResponse = await client.listTools();
    // Assuming toolsResponse.tools is an array of McpServerTool-like objects
    // The error message implies toolsResponse.tools is not directly McpTool[]
    // but an object that *contains* the tools, or the tools have 'inputSchema'
    
    let actualTools: McpServerTool[] = [];
    if (toolsResponse && Array.isArray(toolsResponse.tools)) {
        actualTools = toolsResponse.tools.map((t: any) => ({ // Use 'any' for now and map to known structure
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema, // Use inputSchema as per error
        }));
    } else {
        console.warn("toolsResponse.tools is not an array or is undefined:", toolsResponse);
    }

    // Map MCP tools to OpenAI function definitions
    functionDefinitions = actualTools.map((tool: McpServerTool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
    
    console.log('Retrieved tools:', actualTools.map((t: McpServerTool) => t.name));
  } catch (error) {
    console.error('Error connecting to MCP server or listing tools:', error);
    process.exit(1);
  }
})();

// Set up Express server
const app = express();

app.use(express.json() as express.RequestHandler);

// Store conversation history
let messages: any[] = [];

// Chat endpoint for Postman
app.post('/chat', async (req: Request, res: Response) => {
  const { message: userMessage } = req.body; // Renamed to avoid conflict
  if (!userMessage) {
    return res.status(400).json({ error: 'Message is required' });
  }

  messages.push({ role: 'user', content: userMessage });

  try {
    let finalResponse = null;
    let maxIterations = 5; 
    let iterations = 0;
    
    while (finalResponse === null && iterations < maxIterations) {
      iterations++;
      const response = await openai.chat.completions.create({
        model: AZURE_MODEL,
        messages: messages,
        tools: functionDefinitions.length > 0 ? functionDefinitions : undefined,
        tool_choice: functionDefinitions.length > 0 ? 'auto' : undefined,
      });

      const choice = response.choices[0];
      messages.push(choice.message); // Add assistant's response (or tool_calls) to messages

      if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
        const toolCalls = choice.message.tool_calls;
        for (const toolCall of toolCalls) {
          const { name, arguments: argsString } = toolCall.function;
          let parsedArgs: any;
          try {
            parsedArgs = JSON.parse(argsString);
          } catch (e) {
            console.error(`Error parsing arguments for tool ${name}:`, argsString, e);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: name,
              content: JSON.stringify({ error: `Failed to parse arguments: ${(e as Error).message}` }),
            });
            continue;
          }
          
          try {
            // Corrected client.callTool invocation
            const toolResult = await client.callTool({
              name: name,
              arguments: parsedArgs,
            });
            
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: name,
              // Assuming toolResult has a 'content' property, adjust if necessary
              content: typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content),
            });
          } catch (toolError) { // toolError is 'unknown' by default
            console.error(`Tool call failed for ${name}:`, toolError);
            let errorMessage = 'Tool execution failed';
            if (toolError instanceof Error) {
              errorMessage = toolError.message;
            } else if (typeof toolError === 'string') {
              errorMessage = toolError;
            }
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: name,
              content: JSON.stringify({ error: errorMessage }),
            });
          }
        }
      } else {
        finalResponse = choice.message.content;
      }
    }
    
    if (!finalResponse && iterations >= maxIterations) {
      finalResponse = "I reached the maximum number of tool calls without reaching a conclusion.";
      if(messages[messages.length -1].role !== 'assistant'){
          messages.push({role: 'assistant', content: finalResponse});
      }
    }
    
    return res.json({ 
      response: finalResponse,
      messages: messages 
    });
  } catch (error:any) { // Keep 'any' for the main catch block for now, or type check
    console.error('Error processing chat:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Cleanup on process exit
const cleanup = async () => {
    console.log('Shutting down...');
    if (client) {
        try {
            // Closing the client should also signal the transport to terminate 
            // the child process if the transport spawned it.
            await client.close(); 
            console.log('MCP client closed.');
        } catch (e) {
            console.error('Error closing MCP client:', e);
        }
    }
    process.exit(0); // Exit the main process
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);