// filepath: c:\Users\aj385009\Documents\Hackathon\WeatherMCP\jira-client\src\service\chatService.js
const { SYSTEM_PROMPT, apiKey, endpoint, modelName, deployment, apiVersion } = require("../utils/config");
const { AzureOpenAI } = require('openai');
const { client, functionDefinitions } = require("./server");
const redisClient = require('../utils/redisClient'); // Import Redis client

const FIXED_SESSION_ID = "fixed-session-dev-001"; // Fixed session ID

if (!apiKey || !endpoint || !modelName) {
  console.error('Missing Azure OpenAI configuration. Set AZURE_API_KEY, AZURE_ENDPOINT, and AZURE_MODEL (e.g., gpt-4o deployment name) environment variables.');
  process.exit(1);
}
const openai = new AzureOpenAI({ endpoint, apiKey, deployment, apiVersion });

const chatService = async (req, res) => {
  const { message: userMessage, sessionId: clientSessionId } = req.body; // Expect sessionId, though we'll use FIXED_SESSION_ID
  const currentSessionId = FIXED_SESSION_ID; // Override with fixed ID

  if (!userMessage) {
    return res.status(400).json({ error: 'User message content is required' });
  }

  let internalConversationMessages = [];
  let displayableConversation = [];

  try {
    // Ensure Redis client is connected (isOpen is for node-redis v4)
    if (!redisClient.isOpen) {
      console.error('Redis client is not connected. Attempting to connect...');
      try {
        await redisClient.connect(); // Try to connect if not open
        console.log('Reconnected to Redis successfully.');
      } catch (connectErr) {
        console.error('Failed to reconnect to Redis:', connectErr);
        // Handle the error appropriately - maybe return a 503 Service Unavailable
        return res.status(503).json({ error: 'Chat history service is temporarily unavailable.' });
      }
    }
    
    // Load displayable history from Redis
    const storedHistory = await redisClient.get(`session:${currentSessionId}:display`);
    if (storedHistory) {
      displayableConversation = JSON.parse(storedHistory);
    }

    // Reconstruct internal OpenAI messages from displayable history for context
    // This is a simplified reconstruction. For more complex scenarios, you might store more.
    internalConversationMessages = displayableConversation.map(msg => ({
        role: msg.role,
        content: msg.content
    }));

    // Add system prompt if it's the start of a new internal conversation or not present
    if (internalConversationMessages.length === 0 || internalConversationMessages[0]?.role !== 'system') {
      internalConversationMessages.unshift({ 
          role: 'system', 
          content: SYSTEM_PROMPT
      });
    }
  
    internalConversationMessages.push({ role: 'user', content: userMessage });

    let finalAssistantResponseText = null;
    let maxIterations = 3; 
    let iterations = 0;
    
    while (finalAssistantResponseText === null && iterations < maxIterations) {
      iterations++;
      const openaiResponse = await openai.chat.completions.create({
        model: modelName,
        messages: internalConversationMessages,
        tools: functionDefinitions.length > 0 ? functionDefinitions : undefined,
        tool_choice: functionDefinitions.length > 0 ? 'auto' : undefined,
      });

      const choice = openaiResponse.choices[0];
      
      if (choice.message.content) {
        internalConversationMessages.push({ role: 'assistant', content: choice.message.content });
      }

      if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
        internalConversationMessages.push(choice.message); // Add assistant message with tool_calls
        const toolCalls = choice.message.tool_calls;
        for (const toolCall of toolCalls) {
          const { name, arguments: argsString } = toolCall.function;
          let parsedArgs;
          try {
            parsedArgs = JSON.parse(argsString);
          } catch (e) {
            console.error(`Error parsing arguments for tool ${name}:`, argsString, e);
            internalConversationMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: name,
              content: JSON.stringify({ error: `Failed to parse arguments for tool ${name}: ${(e).message}` }),
            });
            continue; 
          }
          
          console.log(`[Jira Client] Preparing to call MCP tool: ${name} with arguments:`, JSON.stringify(parsedArgs));
          try {
            const toolResult = await client.callTool({
              name: name,
              arguments: parsedArgs,
            });
            
            console.log(`[Jira Client] Received response from MCP tool ${name}:`, JSON.stringify(toolResult, null, 2));
            internalConversationMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: name,
              content: typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content),
            });
          } catch (toolError) {
            console.error(`Tool call failed for ${name} with args ${JSON.stringify(parsedArgs)}:`, toolError);
            let errorMessage = `Tool ${name} execution failed.`;
            if (toolError instanceof Error) {
              errorMessage = toolError.message; 
            } else if (typeof toolError === 'string') {
              errorMessage = toolError;
            } else if (toolError && typeof toolError.message === 'string') { 
                errorMessage = toolError.message;
            }
            internalConversationMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: name,
              content: JSON.stringify({ error: errorMessage, details: toolError }), 
            });
          }
        }
      } else {
        finalAssistantResponseText = choice.message.content;
      }
    } 
    
    if (!finalAssistantResponseText && iterations >= maxIterations) {
      finalAssistantResponseText = "I seem to be having trouble completing your request after a few steps. Could you please try rephrasing or breaking it down?";
      if (internalConversationMessages[internalConversationMessages.length -1]?.role !== 'assistant') {
          internalConversationMessages.push({role: 'assistant', content: finalAssistantResponseText});
      }
    }

    // Update displayable conversation
    displayableConversation.push({ 
        id: `user-${Date.now()}`, 
        role: 'user', 
        content: userMessage, 
        timestamp: new Date().toISOString(),
        sessionId: currentSessionId 
    });
    if (finalAssistantResponseText) {
        displayableConversation.push({ 
            id: `assistant-${Date.now()}`, 
            role: 'assistant', 
            content: finalAssistantResponseText, 
            timestamp: new Date().toISOString(),
            sessionId: currentSessionId
        });
    }

   // Save updated displayable history to Redis
    const redisKey = `session:${currentSessionId}:display`;
    const redisValue = JSON.stringify(displayableConversation);

    // console.log(`Attempting to set Redis key: ${redisKey} with value: ${redisValue.substring(0, 200)}...`); // Log for debugging

    if (typeof redisKey !== 'string' || redisKey === '' || typeof redisValue !== 'string') {
      console.error('Invalid key or value for Redis set command.', { redisKey, typeOfValue: typeof redisValue });
      // Handle this critical error, as it would definitely cause issues with redisClient.set
    } else {
      await redisClient.set(redisKey, redisValue, {
        EX: 86400 // Expires in 1 day (24 * 60 * 60 seconds)
      });
      // console.log(`Successfully set Redis key: ${redisKey}`);
    }
    
    return res.json({ 
      assistantResponse: finalAssistantResponseText,
      updatedConversation: displayableConversation 
    });

  } catch (error) {
    console.error('Error processing chat:', error);
    let detailMessage = "An unexpected error occurred.";
    if (error instanceof Error) {
        detailMessage = error.message;
    } else if (typeof error === 'string') {
        detailMessage = error;
    }
    // Do not send internalMessages to client in error response for security/verbosity reasons
    res.status(500).json({ error: 'Internal server error', details: detailMessage });
  }
}

module.exports = {
  chatService,
};