import ChatWindow from '../components/ChatWindow';

const Home: React.FC = () => {
  return (
    <div className="h-screen bg-gradient-to-br from-lime-700 to-neutral-800 flex flex-col overflow-hidden">
      <header className="p-4 bg-lime-950 shadow-md flex-shrink-0"> 
        <div className="flex items-center justify-between">
          <img 
            src="/NATL_BIG.D-deeb1d36.png" 
            alt="NCR Atleos Logo" 
            className="h-8 w-auto"
          />
          <h1 className="text-2xl font-bold text-neutral-100 absolute left-1/2 transform -translate-x-1/2">
            G-ASSIST
          </h1>
          <div className="w-8"></div> {/* Spacer to balance the layout */}
        </div>
      </header>
      <main className="flex-grow overflow-hidden">
        <ChatWindow />
      </main>
    </div>
  );
};

export default Home;