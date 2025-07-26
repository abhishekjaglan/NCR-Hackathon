import express from 'express';
import cors from 'cors';
import { PORT } from './utils/config';
import { mcpClient } from './server/server';
import { chatService } from './service/ChatService';
import { redisClient } from './utils/redisClient';

const app = express();
app.use(express.json());
app.use(cors());

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'client-api'
  });
});

app.post('/chat', async (req, res) => {
  try {
    await chatService.chat(req, res);
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/chat/history/:sessionId',  async (req, res) => {
  try {
    await chatService.getChatHistory(req, res);
  } catch (error) {
    console.error('Error in get chat history endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add this new endpoint after your existing endpoints
app.delete('/api/chat/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const currentSessionId = "fixed-session-dev-001"; // Use your fixed session ID
    
    // Ensure Redis connection
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    
    const key = `session:${currentSessionId}:display`;
    const result = await redisClient.del(key);
    
    console.log(`Deleted chat history for session: ${currentSessionId}`);
    res.json({ 
      success: true, 
      message: `Chat history cleared for session: ${currentSessionId}`,
      keysDeleted: result
    });
  } catch (error) {
    console.error('Error clearing chat history:', error);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

app.listen(PORT, async() => {
  console.log(`Server running on http://localhost:${PORT}`);
  const functionDefinitions = await mcpClient.functionDefinitionsFunction();
  console.log("Available function definitions for OpenAI:", functionDefinitions?.map(f => f.function.name));
});

process.on('SIGINT', async () => {
    await mcpClient.cleanup();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    await mcpClient.cleanup();
    process.exit(0);
});