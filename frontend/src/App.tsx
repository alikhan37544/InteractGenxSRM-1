import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWebSocket } from './hooks/useWebSocket';
import { GhostCursor } from './components/GhostCursor';
import { ClickRipple } from './components/ClickRipple';
import { ThinkingOverlay } from './components/ThinkingOverlay';
import { VideoStream } from './components/VideoStream';
import { VoiceInput } from './components/VoiceInput';

// WebSocket URL - adjust if your backend is on a different port
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws';

function App() {
    const { isConnected, lastMessage, sendMessage } = useWebSocket(WS_URL);

    const [screenshot, setScreenshot] = useState<string | null>(null);
    const [cursorPos, setCursorPos] = useState({ x: 100, y: 100 });
    const [isThinking, setIsThinking] = useState(false);
    const [status, setStatus] = useState('Ready');
    const [currentObjective, setCurrentObjective] = useState('');
    const [clickRipple, setClickRipple] = useState<{ x: number, y: number, timestamp: number } | null>(null);

    // Handle incoming WebSocket messages
    useEffect(() => {
        if (!lastMessage) return;

        switch (lastMessage.type) {
            case 'screenshot':
                if (lastMessage.screenshot) {
                    setScreenshot(lastMessage.screenshot);
                }
                break;

            case 'cursor_move':
                if (lastMessage.x !== undefined && lastMessage.y !== undefined) {
                    setCursorPos({ x: lastMessage.x, y: lastMessage.y });
                }
                break;

            case 'action':
                if (lastMessage.action_type === 'click' && lastMessage.x !== undefined && lastMessage.y !== undefined) {
                    setClickRipple({ x: lastMessage.x, y: lastMessage.y, timestamp: Date.now() });
                }
                if (lastMessage.data?.message) {
                    setStatus(lastMessage.data.message);
                }
                break;

            case 'thinking':
                setIsThinking(lastMessage.thinking || false);
                break;

            case 'status':
                if (lastMessage.message) {
                    setStatus(lastMessage.message);
                }
                break;

            case 'complete':
                setIsThinking(false);
                setStatus('Mission complete! 🎉');
                break;

            case 'error':
                setIsThinking(false);
                if (lastMessage.error) {
                    setStatus(`Error: ${lastMessage.error}`);
                }
                break;
        }
    }, [lastMessage]);

    const handleVoiceCommand = (transcript: string) => {
        console.log('📝 Voice command:', transcript);
        setCurrentObjective(transcript);
        setStatus(`Starting mission: ${transcript}`);

        sendMessage({
            type: 'start_mission',
            objective: transcript,
            url: 'https://www.google.com' // Default starting URL
        });
    };

    return (
        <div className="min-h-screen bg-ghost-bg text-white overflow-hidden">
            {/* Background gradient */}
            <div className="fixed inset-0 bg-gradient-to-br from-ghost-bg via-ghost-surface/20 to-ghost-bg pointer-events-none" />

            {/* Main container */}
            <div className="relative z-10 h-screen flex flex-col">
                {/* Header */}
                <header className="glass-strong border-b border-ghost-border/50 p-4">
                    <div className="max-w-7xl mx-auto flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <motion.div
                                className="w-12 h-12 rounded-lg bg-gradient-to-br from-ghost-primary to-ghost-secondary flex items-center justify-center"
                                animate={{
                                    boxShadow: [
                                        '0 0 20px rgba(0,217,255,0.3)',
                                        '0 0 30px rgba(0,217,255,0.5)',
                                        '0 0 20px rgba(0,217,255,0.3)'
                                    ]
                                }}
                                transition={{ duration: 2, repeat: Infinity }}
                            >
                                <span className="text-2xl">👻</span>
                            </motion.div>
                            <div>
                                <h1 className="text-2xl font-bold text-gradient">Ghost Pilot</h1>
                                <p className="text-sm text-gray-400 font-mono">Autonomous Browser Agent</p>
                            </div>
                        </div>

                        {/* Connection status */}
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <motion.div
                                    className={`w-3 h-3 rounded-full ${isConnected ? 'bg-ghost-success' : 'bg-ghost-danger'
                                        }`}
                                    animate={{
                                        scale: isConnected ? [1, 1.2, 1] : 1,
                                    }}
                                    transition={{
                                        duration: 2,
                                        repeat: Infinity,
                                    }}
                                />
                                <span className="text-sm font-medium">
                                    {isConnected ? 'Connected' : 'Disconnected'}
                                </span>
                            </div>
                        </div>
                    </div>
                </header>

                {/* Main content */}
                <main className="flex-1 flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
                    {/* Left: Browser viewport */}
                    <div className="flex-1 flex flex-col gap-4 min-h-0">
                        {/* Current objective */}
                        <AnimatePresence>
                            {currentObjective && (
                                <motion.div
                                    className="glass-strong p-4 rounded-lg"
                                    initial={{ opacity: 0, y: -20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                >
                                    <p className="text-sm text-gray-300 mb-1 font-mono">MISSION OBJECTIVE:</p>
                                    <p className="text-lg font-semibold text-ghost-primary">"{currentObjective}"</p>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Video stream */}
                        <div className="flex-1 relative min-h-0 group">
                            <VideoStream screenshot={screenshot} className="h-full" />

                            {/* Overlay layer for cursor and effects */}
                            <div className="absolute inset-0 pointer-events-none">
                                <GhostCursor x={cursorPos.x} y={cursorPos.y} isThinking={isThinking} />
                                {clickRipple && (
                                    <ClickRipple
                                        x={clickRipple.x}
                                        y={clickRipple.y}
                                        timestamp={clickRipple.timestamp}
                                    />
                                )}
                            </div>
                        </div>

                        {/* Status bar */}
                        <div className="glass px-4 py-3 rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className={`w-2 h-2 rounded-full ${isThinking ? 'bg-ghost-primary animate-pulse' : 'bg-ghost-success'}`} />
                                <p className="text-sm font-mono flex-1">{status}</p>
                                {isThinking && (
                                    <div className="flex gap-1">
                                        {[0, 1, 2].map((i) => (
                                            <motion.div
                                                key={i}
                                                className="w-1.5 h-1.5 rounded-full bg-ghost-primary"
                                                animate={{
                                                    scale: [1, 1.5, 1],
                                                    opacity: [1, 0.5, 1],
                                                }}
                                                transition={{
                                                    duration: 1,
                                                    repeat: Infinity,
                                                    delay: i * 0.2,
                                                }}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right: Control panel */}
                    <div className="lg:w-96 flex flex-col gap-4">
                        <VoiceInput onTranscript={handleVoiceCommand} isConnected={isConnected} />

                        {/* Info panel */}
                        <div className="glass-strong p-4 rounded-lg flex-1">
                            <h3 className="text-sm font-bold text-ghost-primary mb-3 uppercase tracking-wide">
                                How It Works
                            </h3>
                            <div className="space-y-3 text-sm text-gray-300">
                                <div className="flex gap-3">
                                    <span className="text-xl">🎤</span>
                                    <p>Speak or type your command</p>
                                </div>
                                <div className="flex gap-3">
                                    <span className="text-xl">👁️</span>
                                    <p>GPT-4o Vision analyzes the page</p>
                                </div>
                                <div className="flex gap-3">
                                    <span className="text-xl">🏷️</span>
                                    <p>Set-of-Marks identifies elements</p>
                                </div>
                                <div className="flex gap-3">
                                    <span className="text-xl">🤖</span>
                                    <p>AI autonomously navigates</p>
                                </div>
                            </div>

                            <div className="mt-6 pt-4 border-t border-ghost-border/30">
                                <p className="text-xs text-gray-500 font-mono">
                                    Powered by GPT-4o • Playwright • React
                                </p>
                            </div>
                        </div>
                    </div>
                </main>
            </div>

            {/* Thinking overlay */}
            <ThinkingOverlay isThinking={isThinking} message="Analyzing page..." />
        </div>
    );
}

export default App;
