import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface VoiceInputProps {
    onTranscript: (text: string) => void;
    isConnected: boolean;
}

// Check if Web Speech API is available
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export function VoiceInput({ onTranscript, isConnected }: VoiceInputProps) {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [manualInput, setManualInput] = useState('');
    const recognitionRef = useRef<any>(null);

    const hasVoiceSupport = !!SpeechRecognition;

    useEffect(() => {
        if (!hasVoiceSupport) return;

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcriptPiece = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcriptPiece + ' ';
                } else {
                    interimTranscript += transcriptPiece;
                }
            }

            const currentTranscript = finalTranscript || interimTranscript;
            setTranscript(currentTranscript.trim());
        };

        recognition.onend = () => {
            setIsListening(false);
            if (transcript) {
                onTranscript(transcript);
                setTranscript('');
            }
        };

        recognition.onerror = (event: any) => {
            console.error('Speech recognition error:', event.error);
            setIsListening(false);
        };

        recognitionRef.current = recognition;

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
        };
    }, [hasVoiceSupport, transcript, onTranscript]);

    const toggleListening = () => {
        if (!recognitionRef.current) return;

        if (isListening) {
            recognitionRef.current.stop();
        } else {
            setTranscript('');
            recognitionRef.current.start();
            setIsListening(true);
        }
    };

    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (manualInput.trim()) {
            onTranscript(manualInput.trim());
            setManualInput('');
        }
    };

    return (
        <div className="glass-strong rounded-2xl p-6">
            <div className="flex flex-col gap-4">
                {/* Voice Input */}
                {hasVoiceSupport ? (
                    <div className="flex flex-col items-center gap-4">
                        <motion.button
                            onClick={toggleListening}
                            disabled={!isConnected}
                            className={`
                relative w-20 h-20 rounded-full flex items-center justify-center
                transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed
                ${isListening
                                    ? 'bg-ghost-danger shadow-[0_0_30px_rgba(239,68,68,0.5)]'
                                    : 'bg-gradient-to-br from-ghost-primary to-ghost-secondary shadow-[0_0_20px_rgba(0,217,255,0.3)]'
                                }
              `}
                            whileHover={{ scale: isConnected ? 1.05 : 1 }}
                            whileTap={{ scale: isConnected ? 0.95 : 1 }}
                        >
                            {/* Pulsing rings when listening */}
                            {isListening && (
                                <>
                                    <motion.div
                                        className="absolute inset-0 rounded-full border-4 border-ghost-danger"
                                        animate={{
                                            scale: [1, 1.5],
                                            opacity: [0.8, 0],
                                        }}
                                        transition={{
                                            duration: 1.5,
                                            repeat: Infinity,
                                            ease: "easeOut"
                                        }}
                                    />
                                    <motion.div
                                        className="absolute inset-0 rounded-full border-4 border-ghost-danger"
                                        animate={{
                                            scale: [1, 1.5],
                                            opacity: [0.8, 0],
                                        }}
                                        transition={{
                                            duration: 1.5,
                                            repeat: Infinity,
                                            ease: "easeOut",
                                            delay: 0.5
                                        }}
                                    />
                                </>
                            )}

                            {/* Microphone Icon */}
                            <svg
                                className="w-10 h-10 text-white relative z-10"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                                />
                            </svg>
                        </motion.button>

                        <p className="text-sm font-medium text-ghost-border">
                            {!isConnected
                                ? 'Connecting to backend...'
                                : isListening
                                    ? 'Listening...'
                                    : 'Click to speak'
                            }
                        </p>

                        {/* Live Transcript */}
                        {transcript && (
                            <motion.div
                                className="glass px-4 py-2 rounded-lg max-w-md"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                <p className="text-ghost-primary text-sm font-mono">
                                    "{transcript}"
                                </p>
                            </motion.div>
                        )}
                    </div>
                ) : (
                    <p className="text-center text-ghost-border text-sm">
                        Voice input not supported in this browser
                    </p>
                )}

                {/* Divider */}
                <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-ghost-border/30" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                        <span className="px-2 bg-ghost-surface text-ghost-border">OR</span>
                    </div>
                </div>

                {/* Manual Text Input */}
                <form onSubmit={handleManualSubmit} className="flex gap-2">
                    <input
                        type="text"
                        value={manualInput}
                        onChange={(e) => setManualInput(e.target.value)}
                        placeholder="Type your command..."
                        disabled={!isConnected}
                        className="
              flex-1 px-4 py-3 rounded-lg bg-ghost-surface border border-ghost-border
              text-white placeholder-ghost-border/50 focus:outline-none focus:border-ghost-primary
              transition-colors disabled:opacity-50 disabled:cursor-not-allowed
            "
                    />
                    <motion.button
                        type="submit"
                        disabled={!isConnected || !manualInput.trim()}
                        className="
              px-6 py-3 rounded-lg bg-gradient-to-r from-ghost-primary to-ghost-secondary
              text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed
              transition-opacity
            "
                        whileHover={{ scale: isConnected ? 1.02 : 1 }}
                        whileTap={{ scale: isConnected ? 0.98 : 1 }}
                    >
                        Send
                    </motion.button>
                </form>
            </div>
        </div>
    );
}
