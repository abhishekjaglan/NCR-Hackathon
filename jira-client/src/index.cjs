const express = require('express');
const cors = require('cors');
const { PORT } = require('./utils/config');
const { chatService } = require('./service/chatService');
const { cleanup, functionDefinitionsFunction, functionDefinitions } = require('./service/server');
const  getChatHistory = require('./service/historyService');

const app = express();
app.use(express.json());
app.use(cors());

app.post('/chat', chatService);

app.get('/api/chat/history/:sessionId', getChatHistory);

app.listen(PORT, async() => {
  console.log(`Server running on http://localhost:${PORT}`);
  await functionDefinitionsFunction();
  console.log("Available function definitions for OpenAI:", functionDefinitions.map(f => f.function.name));
});

process.on('SIGINT', async () => {
    await cleanup();
    if (redisClient.isOpen) {
        await redisClient.quit();
        console.log('Redis client disconnected.');
    }
    process.exit(0);
});
process.on('SIGTERM', async () => {
    await cleanup();
    if (redisClient.isOpen) {
        await redisClient.quit();
        console.log('Redis client disconnected.');
    }
    process.exit(0);
});