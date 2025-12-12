import { motion, AnimatePresence } from 'framer-motion';

interface ThinkingOverlayProps {
    isThinking: boolean;
    message?: string;
}

export function ThinkingOverlay({ isThinking, message = 'Analyzing...' }: ThinkingOverlayProps) {
    return (
        <AnimatePresence>
            {isThinking && (
                <motion.div
                    className="fixed inset-0 z-[9997] flex items-center justify-center bg-ghost-bg/40 backdrop-blur-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                >
                    <div className="flex flex-col items-center gap-6">
                        {/* Radar animation */}
                        <div className="relative w-32 h-32">
                            {/* Center dot */}
                            <div className="absolute top-1/2 left-1/2 w-4 h-4 -mt-2 -ml-2 rounded-full bg-ghost-primary" />

                            {/* Pulsing rings */}
                            {[0, 1, 2].map((i) => (
                                <motion.div
                                    key={i}
                                    className="absolute inset-0 rounded-full border-2 border-ghost-primary"
                                    initial={{ scale: 0, opacity: 0 }}
                                    animate={{
                                        scale: [0, 2],
                                        opacity: [1, 0],
                                    }}
                                    transition={{
                                        duration: 2,
                                        repeat: Infinity,
                                        delay: i * 0.4,
                                        ease: "easeOut"
                                    }}
                                />
                            ))}

                            {/* Rotating scanner line */}
                            <motion.div
                                className="absolute top-1/2 left-1/2 w-16 h-0.5 bg-gradient-to-r from-transparent via-ghost-primary to-transparent origin-left"
                                style={{ transformOrigin: '0 0' }}
                                animate={{ rotate: 360 }}
                                transition={{
                                    duration: 2,
                                    repeat: Infinity,
                                    ease: "linear"
                                }}
                            />
                        </div>

                        {/* Message */}
                        <motion.div
                            className="glass-strong px-6 py-3 rounded-lg"
                            animate={{
                                opacity: [0.8, 1, 0.8],
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                            }}
                        >
                            <p className="text-ghost-primary font-mono text-sm font-medium">
                                {message}
                            </p>
                        </motion.div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
