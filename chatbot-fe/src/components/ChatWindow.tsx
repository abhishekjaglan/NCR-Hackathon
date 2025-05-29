
import { useEffect, useRef, useState } from 'react';
import ChatMessageDisplay from './Message'; // Updated import name
import InputArea from './InputArea';
import Spinner from './Spinner';
import { sendMessageToBackend, fetchChatHistory } from '../services/api';
import type { DisplayMessage } from '../types';

// Removed transformBackendMessagesToFrontend as backend now sends DisplayMessage[]

const FIXED_SESSION_ID = "fixed-session-dev-001";

const ChatWindow: React.FC = () => {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch initial chat history
    const loadHistory = async () => {
      setIsLoading(true);
      try {
        const history = await fetchChatHistory();
        setMessages(history);
      } catch (error) {
        console.error('Failed to load chat history:', error);
        // Optionally, display an error message in the chat UI
        setMessages(prev => [...prev, { 
            id: `error-${Date.now()}`, 
            role: 'assistant', 
            content: `Error loading history: ${error instanceof Error ? error.message : 'Unknown error'}`, 
            timestamp: new Date().toISOString(),
            sessionId: FIXED_SESSION_ID 
        }]);
      } finally {
        setIsLoading(false);
      }
    };
    loadHistory();
  }, []);

  const handleSendMessage = async (newMessageText: string) => {
    const userDisplayMessage: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: newMessageText,
      timestamp: new Date().toISOString(),
      sessionId: FIXED_SESSION_ID,
    };
    
    setMessages(prevMessages => [...prevMessages, userDisplayMessage]);
    setIsLoading(true);

    try {
      // Backend now manages history persistence via Redis.
      // It returns the assistant's response and the full updated displayable conversation.
      const backendResponse = await sendMessageToBackend(newMessageText);

      if (backendResponse.updatedConversation) {
        setMessages(backendResponse.updatedConversation);
      } else if (backendResponse.assistantResponse) {
        // Fallback if updatedConversation isn't there but assistantResponse is (should not happen with current backend logic)
         const assistantDisplayMessage: DisplayMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: backendResponse.assistantResponse,
            timestamp: new Date().toISOString(),
            sessionId: FIXED_SESSION_ID,
        };
        setMessages(prevMessages => [...prevMessages, assistantDisplayMessage]);
      }

    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessageText = error instanceof Error ? error.message : 'Sorry, an unexpected issue occurred.';
      const errorDisplayMessage: DisplayMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: errorMessageText,
        timestamp: new Date().toISOString(),
        sessionId: FIXED_SESSION_ID,
      };
      setMessages(prevMessages => [...prevMessages, errorDisplayMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full "> {/* Removed shadow and border, h-full is key */}
      <div className="flex-grow overflow-y-auto p-4 space-y-2 scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800"> {/* Changed: flex-grow for scrollable area */}
        {messages.map((msg) => (
          <ChatMessageDisplay key={msg.id} message={msg} />
        ))}
        {isLoading && <Spinner />}
        <div ref={messagesEndRef} />
      </div>
      <div className="flex justify-center pt-2 pb-1 flex-shrink-0"> {/* Added flex container to center the input */}
        <div className="w-5/8 max-w-5xl p-1 border rounded-xl border-lime-950 bg-lime-950"> {/* Centered input area with 5/8 width */}
          <InputArea onSendMessage={handleSendMessage} />
        </div>
      </div>
    </div>
  );
};

export default ChatWindow;