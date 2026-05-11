import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Send, Terminal, Globe, Code, Zap, Loader2, User, Bot, RefreshCw, FileText, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

const socket = io('http://127.0.0.1:5000');

function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [view, setView] = useState('preview'); // 'preview' or 'code'
  const [currentCode, setCurrentCode] = useState({ path: '', content: '// No code yet' });
  const [projectName, setProjectName] = useState(null);
  const [projectFiles, setProjectFiles] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    socket.on('project-ready', (name) => {
      setProjectName(name);
      setProjectFiles([]);
      setIsGenerating(true);
    });

    socket.on('ai-message', (text) => {
      setMessages(prev => [...prev, { role: 'ai', content: text }]);
      setStatus(null);
      setIsGenerating(false);
      setRefreshKey(k => k + 1); // Refresh preview when AI finishes
    });

    socket.on('code-update', (data) => {
      setCurrentCode(data);
    });

    socket.on('project-files', (files) => {
      setProjectFiles(files);
    });

    socket.on('ai-status', (data) => {
      setStatus(data);
      if (data.type === 'tool-call') {
        setIsGenerating(true);
      }
      if (data.type === 'tool-result') {
        setRefreshKey(k => k + 1); // Refresh preview on file changes
      }
    });

    socket.on('error', (err) => {
      setMessages(prev => [...prev, { role: 'error', content: err }]);
      setStatus(null);
    });

    return () => {
      socket.off('ai-message');
      socket.off('ai-status');
      socket.off('error');
      socket.off('code-update');
      socket.off('project-files');
      socket.off('project-ready');
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    setMessages(prev => [...prev, { role: 'user', content: input }]);
    socket.emit('chat-message', input);
    setInput('');
  };

  const handleFileClick = (file) => {
    const fullPath = `projects/${projectName}/${file}`;
    socket.emit('get-file-content', fullPath);
  };

  return (
    <div className="flex h-screen bg-[#0a0a0c] text-white overflow-hidden font-sans">
      {/* Left Sidebar - Chat */}
      <div className="w-1/3 border-r border-[#2d2d35] flex flex-col glass z-10">
        <div className="p-4 border-b border-[#2d2d35] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-1.5 rounded-lg">
              <Zap className="text-white" size={18} fill="currentColor" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">WEBBUILD.AI</h1>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
            <span className="text-[10px] font-bold text-green-500 uppercase tracking-wider">Live</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
          {messages.length === 0 && !status && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-center space-y-4 px-8">
              <div className="w-16 h-16 rounded-3xl bg-[#1c1c22] border border-[#2d2d35] flex items-center justify-center mb-2">
                <Bot size={32} className="opacity-20" />
              </div>
              <h2 className="text-white font-medium">Welcome to WEBBUILD.AI</h2>
              <p className="text-sm">I can help you build and preview web applications in real-time. Try asking me to build a calculator or a weather app!</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={i}
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
            >
              {msg.role !== 'user' && (
                <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/20">
                  <Bot size={16} />
                </div>
              )}
              <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm ${msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-tr-none'
                  : msg.role === 'error'
                    ? 'bg-red-900/30 text-red-200 border border-red-800'
                    : 'bg-[#1c1c22] border border-[#2d2d35] rounded-tl-none'
                }`}>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-xl bg-slate-700 flex items-center justify-center flex-shrink-0">
                  <User size={16} />
                </div>
              )}
            </motion.div>
          ))}

          {status && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-3"
            >
              <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center">
                <Loader2 className="animate-spin" size={16} />
              </div>
              <div className="flex-1 bg-[#1c1c22] border border-[#2d2d35] rounded-2xl rounded-tl-none p-3 overflow-hidden">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
                  <Terminal size={12} className="text-indigo-500" />
                  <span>{status.type === 'tool-call' ? 'Executing Command' : 'Command Result'}</span>
                </div>
                <code className="text-xs text-indigo-300 block bg-black/40 p-3 rounded-xl border border-white/5 overflow-x-auto font-mono leading-relaxed">
                  {status.command || status.result}
                </code>
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-[#0a0a0c]">
          <form onSubmit={handleSubmit} className="relative group">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message WEBBUILD.AI..."
              className="w-full bg-[#141418] border border-[#2d2d35] rounded-2xl py-4 px-5 pr-14 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all text-sm placeholder:text-slate-600 shadow-inner"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
            >
              <Send size={18} />
            </button>
          </form>
          <p className="text-[10px] text-center text-slate-600 mt-3 font-medium tracking-wide">PRESS ENTER TO SEND</p>
        </div>
      </div>

      {/* Right Content - Preview/Code */}
      <div className="flex-1 flex flex-col bg-[#050507]">
        <div className="h-14 border-b border-[#2d2d35] flex items-center px-6 justify-between bg-[#0a0a0c]/80 backdrop-blur-md">
          <div className="flex gap-1.5 p-1 bg-[#141418] rounded-xl border border-[#2d2d35]">
            <button
              onClick={() => setView('preview')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${view === 'preview' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
            >
              <Globe size={14} /> PREVIEW
            </button>
            <button
              onClick={() => setView('code')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${view === 'code' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
            >
              <Code size={14} /> CODE
            </button>
          </div>

          <div className="flex items-center gap-4">
            {projectName && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#141418] border border-[#2d2d35] rounded-lg">
                <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                <span className="text-[10px] font-mono text-slate-400">{projectName}</span>
              </div>
            )}
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="p-2 hover:bg-[#1c1c22] rounded-xl text-slate-400 transition-all active:rotate-180 duration-500"
              title="Refresh Preview"
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 relative overflow-hidden">
          <AnimatePresence mode="wait">
            {view === 'preview' ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                className="w-full h-full bg-[#0a0a0c] flex items-center justify-center p-4"
              >
                {projectName ? (
                  (!projectFiles.includes('index.html') && !projectFiles.some(f => f.endsWith('index.html'))) ? (
                    <div className="flex flex-col items-center justify-center h-full text-indigo-400">
                      <div className="relative mb-6">
                        <Loader2 className="animate-spin text-indigo-500" size={64} strokeWidth={1} />
                        <Zap className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-500" size={24} />
                      </div>
                      <p className="text-xl font-bold tracking-tight mb-2">
                        {isGenerating ? 'Building your workspace' : 'Preparing preview'}
                      </p>
                      <p className="text-sm text-slate-500 font-medium text-center px-8">
                        {projectFiles.length > 0 ? 'Setting up index.html...' : 'Waiting for AI to generate project files...'}
                      </p>
                    </div>
                  ) : (
                    <div className="w-full h-full rounded-2xl overflow-hidden border border-[#2d2d35] shadow-2xl bg-white relative group">
                      <div className="absolute top-0 left-0 right-0 h-8 bg-[#f1f1f1] border-b border-gray-200 flex items-center px-3 gap-1.5 z-10">
                        <div className="w-3 h-3 rounded-full bg-[#ff5f57]"></div>
                        <div className="w-3 h-3 rounded-full bg-[#febc2e]"></div>
                        <div className="w-3 h-3 rounded-full bg-[#28c840]"></div>
                        <div className="ml-4 flex-1 bg-white rounded-md h-5 border border-gray-300 px-3 flex items-center">
                          <span className="text-[10px] text-gray-400 truncate">http://localhost:5000/preview/{projectName}/index.html</span>
                        </div>
                      </div>
                      <iframe
                        key={refreshKey}
                        src={`http://127.0.0.1:5000/preview/${projectName}/${projectFiles.find(f => f.endsWith('index.html')) || 'index.html'}`}
                        className="w-full h-full border-none pt-8"
                        title="Preview"
                      />
                    </div>
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-[#0a0a0c] space-y-6 max-w-md text-center">
                    <div className="relative">
                      <Globe size={80} className="opacity-5 animate-pulse" />
                      <Code size={40} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-10" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-white text-lg font-bold">Ready to build?</h3>
                      <p className="text-sm leading-relaxed">Type a request in the chat to start generating your website. You'll see the live preview and code right here.</p>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="code"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full h-full flex bg-[#0a0a0c]"
              >
                {/* File Explorer */}
                <div className="w-64 border-r border-[#2d2d35] bg-[#0d0d11] flex flex-col">
                  <div className="p-4 border-b border-[#2d2d35] flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Explorer</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                    {projectFiles.length > 0 ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 px-2 py-1.5 text-slate-400">
                          <ChevronRight size={14} className="rotate-90" />
                          <span className="text-xs font-medium truncate">{projectName}</span>
                        </div>
                        <div className="pl-4 space-y-1">
                          {projectFiles.map((file, i) => (
                            <button
                              key={i}
                              onClick={() => handleFileClick(file)}
                              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${currentCode.path.includes(file)
                                  ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20'
                                  : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
                                }`}
                            >
                              <FileText size={14} className={currentCode.path.includes(file) ? 'text-indigo-400' : 'text-slate-600'} />
                              <span className="truncate">{file}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 text-center text-[10px] text-slate-600 font-medium">
                        No files generated yet
                      </div>
                    )}
                  </div>
                </div>

                {/* Editor Area */}
                <div className="flex-1 flex flex-col overflow-hidden relative">
                  <div className="h-10 border-b border-[#2d2d35] flex items-center px-4 bg-[#0d0d11]">
                    <div className="flex items-center gap-2">
                      <FileText size={12} className="text-indigo-500" />
                      <span className="text-[10px] font-mono text-slate-400 truncate max-w-xs">{currentCode.path || 'No file selected'}</span>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar p-6">
                    <SyntaxHighlighter
                      language={currentCode.path?.endsWith('.css') ? 'css' : currentCode.path?.endsWith('.html') ? 'html' : 'javascript'}
                      style={atomDark}
                      customStyle={{
                        background: 'transparent',
                        padding: 0,
                        fontSize: '13px',
                        lineHeight: '1.6',
                        fontFamily: 'JetBrains Mono, Fira Code, monospace'
                      }}
                      showLineNumbers={true}
                      lineNumberStyle={{ minWidth: '3em', paddingRight: '1em', color: '#333' }}
                    >
                      {currentCode.content}
                    </SyntaxHighlighter>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #2d2d35;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3d3d45;
        }
        .glass {
          background: rgba(10, 10, 12, 0.8);
          backdrop-filter: blur(20px);
        }
      `}} />
    </div>
  );
}

export default App;
