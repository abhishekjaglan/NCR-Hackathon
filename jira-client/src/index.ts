import express from 'express';
import { Request, Response } from 'express-serve-static-core';
import { spawn } from 'child_process';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import OpenAI from 'openai';

// Initialize Azure OpenAI client
const openai = new OpenAI({
  apiKey: 'your-azure-openai-api-key',
  baseURL: 'https://your-azure-endpoint.openai.azure.com/',
});

// Spawn the Jira MCP server as a subprocess
const mcpServerProcess = spawn('node', ['path/to/jira-mcp/dist/index.js', '--config', 'config.json'], {
  stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr (inherit stderr for debugging)
});

// Handle server startup errors
mcpServerProcess.on('error', (err) => {
  console.error('Failed to start Jira MCP server:', err)
});

// Set up MCP client with stdio transport
const transport = new StdioClientTransport({
  stdin: mcpServerProcess.stdin!,
  stdout: mcpServerProcess.stdout!,
});
const client = new Client({ name: 'jira-client', version: '1.0.0' });

interface McpTool {
  name: string;
  description: string;
  parameters: any; // Refine this if you know the exact structure
}

// Connect to the server and retrieve tools
let functionDefinitions: any[] = [];
(async () => {
  try {
    await client.connect(transport);
    console.log('Connected to Jira MCP server');
    const tools = (await client.listTools()) as McpTool[];
    functionDefinitions = tools.map((tool: McpTool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    console.log('Retrieved tools:', tools.map((t: McpTool) => t.name));
  } catch (error) {
    console.error('Error connecting to MCP server or listing tools:', error);
    process.exit(1);
  }
})();

// Set up Express server
const app = express();
app.use(express.json());

// Store conversation history
let messages: any[] = [];

// Chat endpoint for Postman
app.post('/chat', async (req: Request, res: Response) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Add user message to conversation
  messages.push({ role: 'user', content: message });

  try {
    // Process conversation with Azure OpenAI
    while (true) {
      const response = await openai.chat.completions.create({
        model: 'your-deployed-model-name', // e.g., gpt-35-turbo
        messages,
        tools: functionDefinitions,
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      if (choice.finish_reason === 'tool_calls') {
        const toolCall = choice.message.tool_calls![0];
        const { name, arguments: args } = toolCall.function;
        const toolResult = await client.callTool(name, JSON.parse(args));
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name,
          content: JSON.stringify(toolResult),
        });
      } else {
        const assistantMessage = choice.message.content;
        messages.push({ role: 'assistant', content: assistantMessage });
        return res.json({ response: assistantMessage });
      }
    }
  } catch (error) {
    console.error('Error processing chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Cleanup on process exit
process.on('SIGINT', () => {
  mcpServerProcess.kill();
  process.exit();
});
