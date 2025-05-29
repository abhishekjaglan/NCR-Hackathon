
import React from 'react';
import ReactMarkdown from 'react-markdown';

interface FormattedChatMessageProps {
  content: string;
}

const UniqueFormattedChatMessage: React.FC<FormattedChatMessageProps> = ({ content }) => {
  const customRenderers = {
    p: (paragraph: any) => {
      const { node } = paragraph;
      if (node.children[0] && node.children[0].tagName === "img") {
        const image = node.children[0];
        return (
          <div className="image-container my-1.5"> {/* Adjusted my */}
            <img src={image.properties.src} alt={image.properties.alt || 'image'} className="max-w-full h-auto rounded" />
          </div>
        );
      }
      return <p className="mb-1.5 text-sm leading-normal">{paragraph.children}</p>; // Changed: text-sm, mb, leading
    },
    a: (anchor: any) => (
      <a href={anchor.href} target="_blank" rel="noopener noreferrer" className="text-sky-500 hover:text-sky-400 underline text-sm"> {/* Changed: text-sky, text-sm */}
        {anchor.children}
      </a>
    ),
    ul: (list: any) => <ul className="list-disc list-inside pl-3 my-1.5 text-sm">{list.children}</ul>, // Changed: pl, my, text-sm
    ol: (list: any) => <ol className="list-decimal list-inside pl-3 my-1.5 text-sm">{list.children}</ol>, // Changed: pl, my, text-sm
    li: (listItem: any) => <li className="mb-0.5 text-sm">{listItem.children}</li>, // Changed: mb, text-sm
    code: (codeBlock: any) => {
        const { inline, className, children } = codeBlock;
        const match = /language-(\w+)/.exec(className || '');
        if (inline) {
            return <code className="bg-neutral-700 text-amber-400 px-1 py-0.5 rounded text-xs">{children}</code>; // Changed: text-amber, text-xs
        }
        return (
            <pre className="bg-neutral-800 p-2.5 rounded-md overflow-x-auto my-1.5"> {/* Adjusted p, my */}
                <code className={`language-${match ? match[1] : 'text'} text-xs`}>{children}</code> {/* Changed: text-xs */}
            </pre>
        );
    },
    strong: (strong: any) => <strong className="font-semibold text-sm">{strong.children}</strong>, // Changed: text-sm
    em: (emphasis: any) => <em className="italic text-sm">{emphasis.children}</em>, // Changed: text-sm
  };

  return (
    <div className="formatted-chat-message-wrapper">
      <ReactMarkdown components={customRenderers}>
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default UniqueFormattedChatMessage;