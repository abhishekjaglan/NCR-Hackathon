import React from 'react';
import type { DisplayMessage } from "../types";
import UniqueFormattedChatMessage from "./FormattedChatMessage";

interface ChatMessageDisplayProps {
  message: DisplayMessage;
}

const ChatMessageDisplay: React.FC<ChatMessageDisplayProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 mx-2`}>
      <div 
        className={`rounded-lg px-3 py-1.5 ${
          isUser 
            ? 'bg-sky-700 text-neutral-100 ml-auto max-w-lg lg:max-w-xl xl:max-w-2xl' 
            : 'bg-opacity-0 text-neutral-100 w-3/4 max-w-none'
        }`}
      >
        {isUser ? (
          <p className="text-sm">{message.content}</p>
        ) : (
          <UniqueFormattedChatMessage content={message.content} /> 
        )}
      </div>
    </div>
  );
};

export default ChatMessageDisplay;