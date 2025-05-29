import { useRef, useState } from 'react';
import type { InputAreaProps } from '../types';

const InputArea: React.FC<InputAreaProps> = ({ onSendMessage }) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (input.trim()) {
      onSendMessage(input);
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'; // Reset height after sending
      }
    }
  };

  const handleInput = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto'; // Reset height to recalculate
      textarea.style.height = `${textarea.scrollHeight}px`; // Set to content height
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // Prevent new line on Enter
      handleSend();
    }
  };

  return (
    <div className="flex items-center p-1 bg-lime-100 rounded-xl shadow-lg border-lime-950"> {/* Adjusted rounded */}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onInput={handleInput}
        onKeyDown={handleKeyPress}
        className="flex-1 px-3 py-1.5 rounded-lg bg-lime-950 text-sm text-white focus:outline-none resize-none max-h-20 overflow-y-auto mr-1.5" // Changed: text-sm, px, py, max-h, mr
        placeholder="Type your message..."
        ref={textareaRef}
        rows={1} // Added for better initial sizing
      />
      <button
        onClick={handleSend}
        className="p-2 bg-white text-gray-900 rounded-full hover:bg-gray-200 transition-colors" // Adjusted padding
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          className="w-4 h-4" // Adjusted icon size
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
          />
        </svg>
      </button>
    </div>
  );
};

export default InputArea;