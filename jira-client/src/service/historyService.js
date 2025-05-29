const redisClient = require("../utils/redisClient");

const getChatHistory = async (req, res) => {
    const { sessionId } = req.params;
    // For now, we enforce the fixed session ID regardless of the param for simplicity with current fixed ID logic
    const currentSessionId = "fixed-session-dev-001"; 

    if (!currentSessionId) { // This check is more for future when sessionId param is used
        return res.status(400).json({ error: 'Session ID is required.' });
    }
    try {
        const storedHistory = await redisClient.get(`session:${currentSessionId}:display`);
        if (storedHistory) {
            res.json(JSON.parse(storedHistory));
        } else {
            res.json([]); // Return empty array if no history found
        }
    } catch (error) {
        console.error('Error fetching history from Redis:', error);
        res.status(500).json({ error: 'Failed to fetch chat history.' });
    }
}

module.exports = getChatHistory;