import { useRef, useCallback } from 'react';

export function useSpeechSynthesis() {
    const synthRef = useRef<SpeechSynthesis | null>(null);
    const utteranceQueueRef = useRef<string[]>([]);
    const isSpeakingRef = useRef(false);

    // Initialize speech synthesis
    if (typeof window !== 'undefined' && !synthRef.current) {
        synthRef.current = window.speechSynthesis;
    }

    const processQueue = useCallback(() => {
        if (!synthRef.current || utteranceQueueRef.current.length === 0 || isSpeakingRef.current) {
            return;
        }

        const text = utteranceQueueRef.current.shift();
        if (!text) return;

        const utterance = new SpeechSynthesisUtterance(text);

        // Configure voice settings
        utterance.rate = 1.1;  // Slightly faster than default
        utterance.pitch = 1.0;
        utterance.volume = 0.9;

        // Try to use a female voice (more pleasant for assistant)
        const voices = synthRef.current.getVoices();
        const femaleVoice = voices.find(voice =>
            voice.name.toLowerCase().includes('female') ||
            voice.name.toLowerCase().includes('samantha') ||
            voice.name.toLowerCase().includes('google us english')
        );
        if (femaleVoice) {
            utterance.voice = femaleVoice;
        }

        utterance.onend = () => {
            isSpeakingRef.current = false;
            // Process next item in queue
            setTimeout(processQueue, 100);
        };

        utterance.onerror = (error) => {
            console.error('Speech synthesis error:', error);
            isSpeakingRef.current = false;
            processQueue();
        };

        isSpeakingRef.current = true;
        synthRef.current.speak(utterance);
    }, []);

    const speak = useCallback((text: string, immediate: boolean = false) => {
        if (!synthRef.current) return;

        if (immediate) {
            // Cancel current speech and clear queue
            synthRef.current.cancel();
            utteranceQueueRef.current = [];
            isSpeakingRef.current = false;
        }

        utteranceQueueRef.current.push(text);
        processQueue();
    }, [processQueue]);

    const cancel = useCallback(() => {
        if (synthRef.current) {
            synthRef.current.cancel();
            utteranceQueueRef.current = [];
            isSpeakingRef.current = false;
        }
    }, []);

    return { speak, cancel };
}
