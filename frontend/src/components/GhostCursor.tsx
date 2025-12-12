import { motion, useAnimation } from 'framer-motion';
import { useEffect } from 'react';

interface GhostCursorProps {
    x: number;
    y: number;
    isThinking?: boolean;
}

export function GhostCursor({ x, y, isThinking = false }: GhostCursorProps) {
    const controls = useAnimation();

    useEffect(() => {
        controls.start({
            x: x,
            y: y,
            transition: {
                type: 'spring',
                damping: 25,
                stiffness: 200,
                mass: 0.5,
                duration: 0.6
            }
        });
    }, [x, y, controls]);

    return (
        <motion.div
            className="absolute pointer-events-none z-[9999]"
            style={{ left: -12, top: -12 }} // Offset for cursor tip
            animate={controls}
        >
            {/* Main cursor */}
            <svg
                width="32"
                height="32"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="filter drop-shadow-[0_0_8px_rgba(0,217,255,0.6)]"
            >
                {/* Cursor pointer */}
                <path
                    d="M4 4L18 16L12 16.5L9 26L7 25.5L10 15.5L4 12L4 4Z"
                    fill="#00d9ff"
                    stroke="#0a0a0f"
                    strokeWidth="1"
                />

                {/* Glow effect */}
                <motion.path
                    d="M4 4L18 16L12 16.5L9 26L7 25.5L10 15.5L4 12L4 4Z"
                    fill="none"
                    stroke="#00d9ff"
                    strokeWidth="2"
                    opacity={isThinking ? 0.8 : 0.3}
                    animate={{
                        opacity: isThinking ? [0.3, 0.8, 0.3] : 0.3,
                    }}
                    transition={{
                        duration: 1.5,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                />
            </svg>

            {/* Thinking indicator - pulsing ring */}
            {isThinking && (
                <motion.div
                    className="absolute top-0 left-0 w-8 h-8 rounded-full border-2 border-ghost-primary"
                    animate={{
                        scale: [1, 1.8, 1],
                        opacity: [0.8, 0, 0.8],
                    }}
                    transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeOut"
                    }}
                />
            )}

            {/* Trail effect */}
            <motion.div
                className="absolute top-2 left-2 w-2 h-2 rounded-full bg-ghost-primary"
                animate={{
                    opacity: [0.6, 0, 0.6],
                    scale: [1, 0.5, 1],
                }}
                transition={{
                    duration: 1,
                    repeat: Infinity,
                }}
            />
        </motion.div>
    );
}
