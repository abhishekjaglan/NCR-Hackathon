
export interface InputAreaProps {
    onSendMessage: (message: string) => void;
}

export interface FrontendMessageType {
    text: string;
    isUser: boolean;
    role?: 'user' | 'assistant' | 'tool'; // Keep role for clarity or future styling
}

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string; // ISO string
  sessionId: string;
}

export interface MessageProps {
    message: DisplayMessage; 
}

export interface BackendChatResponse {
    assistantResponse: string | null; // The latest textual response from the bot
    updatedConversation: DisplayMessage[]; // The full updated displayable conversation history
}
