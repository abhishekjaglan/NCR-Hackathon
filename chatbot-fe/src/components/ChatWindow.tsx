import { useEffect, useRef, useState } from 'react';
import ChatMessageDisplay from './Message';
import InputArea from './InputArea';
import Spinner from './Spinner';
import { sendMessageToBackend } from '../services/api'; // Removed fetchChatHistory import
import type { DisplayMessage } from '../types';

const FIXED_SESSION_ID = "fixed-session-dev-001";

const ChatWindow: React.FC = () => {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Completely removed the useEffect for loading chat history

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
      // Backend manages history persistence via Redis, but frontend starts fresh each session
      const backendResponse = await sendMessageToBackend(newMessageText);

      if (backendResponse.updatedConversation) {
        // Use only the new assistant response, not the full conversation history
        const assistantMessage = backendResponse.updatedConversation
          .filter(msg => msg.role === 'assistant')
          .pop(); // Get the latest assistant message

        if (assistantMessage) {
          const assistantDisplayMessage: DisplayMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: assistantMessage.content,
            timestamp: new Date().toISOString(),
            sessionId: FIXED_SESSION_ID,
          };
          setMessages(prevMessages => [...prevMessages, assistantDisplayMessage]);
        }
      } else if (backendResponse.assistantResponse) {
        // Fallback for direct assistant response
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
    <div className="flex flex-col h-full ">
      <div className="flex-grow overflow-y-auto p-4 space-y-2 scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800">
        {messages.map((msg) => (
          <ChatMessageDisplay key={msg.id} message={msg} />
        ))}
        {isLoading && <Spinner />}
        <div ref={messagesEndRef} />
      </div>
      <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
        <div className="w-5/8 max-w-5xl p-1 border rounded-xl border-lime-950 bg-lime-950">
          <InputArea onSendMessage={handleSendMessage} />
        </div>
      </div>
    </div>
  );
};

export default ChatWindow;