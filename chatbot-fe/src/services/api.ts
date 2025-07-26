
import type { BackendChatResponse, DisplayMessage } from '../types';

// const API_BASE_URL = 'https://gassist-dev.ncratleos.com/sdlc'; // Ensure this matches your backend port
const API_BASE_URL = 'http://localhost:3000';
const FIXED_SESSION_ID = "fixed-session-dev-001";

export const sendMessageToBackend = async (
    newMessageText: string,
): Promise<BackendChatResponse> => {
    // No longer sending conversationHistory from client, backend uses Redis
    const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: newMessageText,
            sessionId: FIXED_SESSION_ID, // Send fixed session ID
        }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Network response was not ok and error details could not be parsed.' }));
        console.error('Error from backend:', errorData);
        throw new Error(errorData.details || errorData.error || 'Network response was not ok');
    }

    const data: BackendChatResponse = await response.json();
    console.log("Response from backend (/chat): ", data); 
    
    // Validate the structure of the response
    if (!data || (data.assistantResponse === undefined && data.updatedConversation === undefined)) { // Allow null assistantResponse
        console.error("Invalid response structure from backend:", data);
        throw new Error("Invalid response structure from backend /chat.");
    }
    if (!Array.isArray(data.updatedConversation)) {
        console.error("Invalid updatedConversation structure from backend:", data.updatedConversation);
        throw new Error("Invalid updatedConversation structure from backend /chat, expected array.");
    }
    
    return data;
};

export const fetchChatHistory = async (): Promise<DisplayMessage[]> => {
    const response = await fetch(`${API_BASE_URL}/api/chat/history/${FIXED_SESSION_ID}`);
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Network response was not ok and error details could not be parsed.' }));
        console.error('Error fetching history from backend:', errorData);
        throw new Error(errorData.detail || errorData.error || '');
    }
    const historyData: DisplayMessage[] = await response.json();
    console.log("Fetched history from backend: ", historyData);
    if (!Array.isArray(historyData)) {
        console.error("Invalid history data structure from backend:", historyData);
        throw new Error("Invalid history data from backend, expected array.");
    }
    return historyData;
};