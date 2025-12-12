import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

interface VoiceInputProps {
    onTranscript: (text: string) => void;
    isConnected: boolean;
}

const DEEPGRAM_API_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY;

export function VoiceInput({ onTranscript, isConnected }: VoiceInputProps) {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [manualInput, setManualInput] = useState('');
    const { speak } = useSpeechSynthesis();

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const deepgramRef = useRef<any>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const transcriptTimeoutRef = useRef<any>(null);

    const hasDeepgramKey = !!DEEPGRAM_API_KEY && DEEPGRAM_API_KEY !== 'your_deepgram_api_key_here';

    useEffect(() => {
        return () => {
            // Cleanup on unmount
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
            if (deepgramRef.current) {
                deepgramRef.current.finish();
            }
        };
    }, []);

    const startListening = async () => {
        if (!hasDeepgramKey) {
            alert('Deepgram API key not configured. Please add VITE_DEEPGRAM_API_KEY to your .env file');
            return;
        }

        try {
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Create Deepgram client
            const deepgram = createClient(DEEPGRAM_API_KEY);

            // Create live transcription connection
            const connection = deepgram.listen.live({
                model: 'nova-2',
                language: 'en-US',
                smart_format: true,
                interim_results: true,
                punctuate: true,
            });

            deepgramRef.current = connection;

            // Handle transcription results
            connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
                const transcriptText = data.channel?.alternatives?.[0]?.transcript;

                if (transcriptText && transcriptText.trim()) {
                    setTranscript(transcriptText);

                    // If this is a final transcript, set a timeout to finalize
                    if (data.is_final) {
                        if (transcriptTimeoutRef.current) {
                            clearTimeout(transcriptTimeoutRef.current);
                        }

                        transcriptTimeoutRef.current = setTimeout(() => {
                            if (transcriptText.trim()) {
                                stopListening(transcriptText);
                            }
                        }, 1500); // Finalize after 1.5s of no new final transcripts
                    }
                }
            });

            connection.on(LiveTranscriptionEvents.Error, (error: any) => {
                console.error('Deepgram error:', error);
                speak('Sorry, there was an error with voice recognition');
                stopListening();
            });

            // Open the connection
            connection.on(LiveTranscriptionEvents.Open, () => {
                console.log('Deepgram connection opened');
                setIsListening(true);
                speak('Listening', true);

                // Create MediaRecorder to send audio to Deepgram
                const mediaRecorder = new MediaRecorder(stream, {
                    mimeType: 'audio/webm',
                });

                mediaRecorderRef.current = mediaRecorder;

                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0 && connection.getReadyState() === 1) {
                        connection.send(event.data);
                    }
                };

                mediaRecorder.start(250); // Send data every 250ms
            });

            connection.on(LiveTranscriptionEvents.Close, () => {
                console.log('Deepgram connection closed');
                setIsListening(false);
            });

        } catch (error: any) {
            console.error('Error starting voice input:', error);
            if (error.name === 'NotAllowedError') {
                speak('Please allow microphone access to use voice input');
            } else {
                speak('Sorry, could not access microphone');
            }
            setIsListening(false);
        }
    };

    const stopListening = (finalTranscript?: string) => {
        // Stop media recorder
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }

        // Stop media stream
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        // Close Deepgram connection
        if (deepgramRef.current) {
            deepgramRef.current.finish();
            deepgramRef.current = null;
        }

        setIsListening(false);

        // Process transcript
        const textToSend = finalTranscript || transcript;
        if (textToSend.trim()) {
            speak(`I heard: ${textToSend}`);
            onTranscript(textToSend);
            setTranscript('');
        }

        if (transcriptTimeoutRef.current) {
            clearTimeout(transcriptTimeoutRef.current);
        }
    };

    const toggleListening = () => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
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
                {hasDeepgramKey ? (
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

                        <p className="text-sm font-medium text-gray-400">
                            {!isConnected
                                ? 'Connecting to backend...'
                                : isListening
                                    ? 'Listening... (Click to stop)'
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
                    <div className="text-center">
                        <p className="text-ghost-danger text-sm mb-2">⚠️ Deepgram API key not configured</p>
                        <p className="text-gray-400 text-xs">
                            Add VITE_DEEPGRAM_API_KEY to your .env file
                        </p>
                    </div>
                )}

                {/* Divider */}
                <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-ghost-border/30" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                        <span className="px-2 bg-ghost-surface text-gray-400">OR</span>
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
              text-white placeholder-gray-500 focus:outline-none focus:border-ghost-primary
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
