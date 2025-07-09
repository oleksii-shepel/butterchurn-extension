// content_script.ts (or .js)

import AudioProcessor from './audio'; // Assuming audio.ts/js is correctly handled by your build process

console.log('[Content Script] Loaded in YouTube iframe');

let video: HTMLVideoElement | null = null;
let player: HTMLElement | null = null;
let audioCtx: AudioContext | null = null;
let processor: AudioProcessor | null = null;
let sandboxIframe: HTMLIFrameElement | null = null;
let sandboxReady = false;

let currentMode: 'butterchurn' | 'bars' | 'off' = 'off';
let lastDataTime = 0;
const DATA_THROTTLE_MS = 16; // Approximately 60 FPS

// For optimized audio data sending
let animationFrameId: number | null = null;
let frequencyDataArray: Uint8Array | null = null; // Pre-allocated array for bars mode

// 👇 Only safe visual hiding styles
const hidePlayerStyles = {
    width: '1px',
    height: '1px',
    opacity: '0.01',
    pointerEvents: 'none',
    transform: 'none',
};
const showPlayerStyles = {
    width: '',
    height: '',
    opacity: '',
    pointerEvents: '',
    transform: '',
};

function initializeSandbox() {
    if (sandboxIframe) return;

    sandboxIframe = document.createElement('iframe');
    sandboxIframe.src = chrome.runtime.getURL('sandbox.html');

    Object.assign(sandboxIframe.style, {
        position: 'absolute',
        bottom: '0',
        left: '0',
        width: '100%',
        height: '100%',
        zIndex: '9999',
        border: 'none',
        pointerEvents: 'auto',
        background: 'rgba(0,0,0,0.2)',
        display: 'none' // Initially hidden
    });

    document.body.appendChild(sandboxIframe);

    sandboxIframe.onload = () => {
        console.log('[Content Script] Sandbox iframe loaded.');
        // Use requestAnimationFrame for safer DOM measurements after initial render
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!sandboxIframe?.contentWindow) return;
                const rect = sandboxIframe.getBoundingClientRect();

                sandboxIframe.contentWindow.postMessage({
                    type: 'INIT_BUTTERCHURN',
                    width: rect.width * devicePixelRatio,
                    height: rect.height * devicePixelRatio,
                    pixelRatio: devicePixelRatio
                }, '*');

                sandboxReady = true;
                // Once sandbox is ready, ensure audio data loop starts if needed
                startAudioDataLoop();
            });
        });
    };

    window.addEventListener('resize', () => {
        if (!sandboxIframe?.contentWindow || !sandboxReady) return;
        const rect = sandboxIframe.getBoundingClientRect();
        sandboxIframe.contentWindow.postMessage({
            type: 'RESIZE_BUTTERCHURN',
            width: rect.width * devicePixelRatio,
            height: rect.height * devicePixelRatio,
            pixelRatio: devicePixelRatio
        }, '*');
    });
}

/**
 * Updates frequency data from an AnalyserNode into a pre-allocated Uint8Array.
 * @param analyser The AnalyserNode to get data from.
 * @param freqData The Uint8Array to fill with frequency data.
 */
function updateFrequencyData(analyser: AnalyserNode, freqData: Uint8Array) {
    if (!analyser) return;

    // AudioContext state check is often redundant if you're already checking
    // audioCtx?.state === 'running' elsewhere or are resuming properly.
    // However, it's safer to ensure context is running for data acquisition.
    if (analyser.context.state === 'running') {
        analyser.getByteFrequencyData(freqData);
    } else {
        // If context is suspended/closed, fill with zeros to avoid stale data
        freqData.fill(0);
    }
}

/**
 * Initiates or ensures the audio data sending loop is running.
 * This function should be called when the visualizer should be active.
 */
function startAudioDataLoop() {
    if (animationFrameId === null) { // Only start if not already running
        console.log('[Content Script] Starting sendAudioDataLoop.');
        animationFrameId = requestAnimationFrame(sendAudioDataLoop);
    }
}

/**
 * Manages sending audio data to the sandbox iframe.
 * This loop is conditionally scheduled using requestAnimationFrame.
 */
function sendAudioDataLoop() {
    if (!sandboxReady || !sandboxIframe?.contentWindow || !processor || !audioCtx) {
        animationFrameId = null; // Stop the loop if dependencies are missing
        return;
    }

    const now = performance.now();
    const throttle = currentMode === 'off' ? 250 : DATA_THROTTLE_MS; // Slower when off

    if (now - lastDataTime >= throttle) {
        if (currentMode !== 'off') {
            // Ensure audio context is running when visualizer is active
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(err => console.error('[Content Script] Failed to resume AudioContext during data loop:', err));
            }

            processor.sampleAudio(); // Perform audio sampling

            if (currentMode === 'butterchurn') {
                const params = processor.getRenderParams();
                sandboxIframe.contentWindow.postMessage({
                    type: 'AUDIO_DATA',
                    mode: currentMode,
                    params
                }, '*');
            } else if (currentMode === 'bars' && frequencyDataArray) {
                // Reuse the pre-allocated array
                // The testAnalyser must be connected and valid for this to work
                const testAnalyser = (processor as any).analyser; // Assuming processor has an analyser or create one if needed
                // If testAnalyser is only connected in setupAudio, ensure it's accessible or re-create carefully.
                // For simplicity here, let's assume `processor` or an accessible `testAnalyser` exists from setupAudio.
                // Re-connecting src to a new AnalyserNode here is inefficient.
                // It's better if `testAnalyser` is part of the `processor` or passed around.

                // Let's assume for this example, setupAudio's testAnalyser is still valid and accessible.
                // If not, you'd need a more robust way to get analyser data.
                // For a robust solution, processor should encapsulate the analyser.
                // For now, if the analyser from setupAudio is valid:
                updateFrequencyData(audioCtx.createAnalyser(), frequencyDataArray); // This is just a placeholder; you need the actual analyser.
                // Correction: `testAnalyser` from `setupAudio` should be available globally or passed.
                // Let's make `testAnalyser` a global variable for this scope.
                // Revert this if you only want `processor` to handle audio.
                // For `bars` mode, you'd need an `AnalyserNode` connected to your audio source.
                // If AudioProcessor handles it, expose it. If not, setup one alongside processor.

                // Re-think: The original code connected `testAnalyser` to `src` directly, not via `processor`.
                // This means `testAnalyser` should be stored and reused.
                // Let's declare `testAnalyser` globally as well.

                // For the purpose of this example, let's assume 'testAnalyser' is accessible
                // and correctly configured from `setupAudio`.
                if (testAnalyserGlobal) { // Referencing testAnalyserGlobal defined below
                    updateFrequencyData(testAnalyserGlobal, frequencyDataArray);
                    sandboxIframe.contentWindow.postMessage({
                        type: 'AUDIO_DATA',
                        mode: currentMode,
                        freqArray: frequencyDataArray
                    }, '*');
                } else {
                    console.warn('[Content Script] Analyser for bars mode not available.');
                }
            }
        }
        lastDataTime = now;
    }

    // Only schedule next frame if a visualizer mode is active
    if (currentMode === 'butterchurn' || currentMode === 'bars') {
        animationFrameId = requestAnimationFrame(sendAudioDataLoop);
    } else {
        // If mode is 'off', stop the rAF loop
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
            console.log('[Content Script] Stopped sendAudioDataLoop.');
        }
    }
}

// Ensure testAnalyser is globally accessible if needed outside setupAudio
let testAnalyserGlobal: AnalyserNode | null = null;


function setupAudio(videoEl: HTMLVideoElement) {
    // Close existing audio context if re-initializing
    if (audioCtx) {
        audioCtx.close().catch(console.error);
        audioCtx = null;
        processor = null;
        testAnalyserGlobal = null;
        animationFrameId = null; // Ensure existing loop is stopped
    }

    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    processor = new AudioProcessor(audioCtx);

    const src = audioCtx.createMediaElementSource(videoEl);
    src.connect(audioCtx.destination); // Connect to speakers

    // Connect to processor for butterchurn
    processor.connectAudio(src);

    // Setup a dedicated analyser for bars mode, connecting it to the source
    testAnalyserGlobal = audioCtx.createAnalyser();
    src.connect(testAnalyserGlobal); // Connect source to analyser
    testAnalyserGlobal.fftSize = 1024; // Standard FFT size

    // Pre-allocate the frequency data array once
    frequencyDataArray = new Uint8Array(testAnalyserGlobal.frequencyBinCount);

    initializeSandbox(); // Initialize sandbox if not already

    // Initial call to start the loop. It will manage itself based on `currentMode`.
    startAudioDataLoop();

    const resumeAudio = () => {
        if (audioCtx?.state === 'suspended') {
            audioCtx.resume().then(() => {
                console.log('[Content Script] AudioContext resumed by user gesture.');
            }).catch(err => {
                console.error('[Content Script] Failed to resume AudioContext:', err);
            });
        }
    };

    // Add event listeners for user interaction to resume AudioContext
    window.addEventListener('click', resumeAudio, { once: true });
    window.addEventListener('keydown', resumeAudio, { once: true });
}

window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    // Security check: Only process messages from expected origins
    if (event.origin !== window.origin && !event.origin.startsWith('https://echoes-player-1bb88.web.app')) {
        return;
    }

    if (data.type === 'CONTROL') {
        const oldMode = currentMode;
        currentMode = data.mode;

        const showVisualizer = currentMode === 'butterchurn' || currentMode === 'bars';

        if (player?.style) {
            Object.assign(player.style, showVisualizer ? hidePlayerStyles : showPlayerStyles);
        }

        if (sandboxIframe?.style) {
            sandboxIframe.style.display = showVisualizer ? 'block' : 'none';
        }

        // Resume/suspend AudioContext based on visualizer state
        if (showVisualizer) {
            audioCtx?.resume().catch(err => console.error('[Content Script] Failed to resume AudioContext on CONTROL:', err));
        } else {
            audioCtx?.suspend().catch(err => console.error('[Content Script] Failed to suspend AudioContext on CONTROL:', err));
        }

        // Pass the control message to the sandbox for its own logic
        sandboxIframe?.contentWindow?.postMessage(data, '*');

        // Manage the audio data loop based on the new mode
        if (showVisualizer && animationFrameId === null) {
            startAudioDataLoop(); // Start if visualizer is on and loop isn't running
        } else if (!showVisualizer && animationFrameId !== null) {
            // sendAudioDataLoop itself will handle stopping the rAF loop
            // No need to cancelAnimationFrame here directly, as sendAudioDataLoop re-evaluates `currentMode`
            // and cancels itself if `currentMode` is 'off'.
            // This relies on the throttle still allowing one last check.
        }
    }
});


function waitForVideoElement(callback: (video: HTMLVideoElement, player: HTMLElement) => void) {
    const check = () => {
        const el = document.querySelector('video');
        const pl = document.querySelector('.html5-video-player');
        if (el instanceof HTMLVideoElement && pl instanceof HTMLElement) {
            console.log('[Content Script] Video element found');
            callback(el, pl);
            return true;
        }
        return false;
    };

    if (check()) return; // Check immediately in case it's already there

    const observer = new MutationObserver(() => {
        if (check()) observer.disconnect(); // Disconnect once found
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[Content Script] Waiting for video element...');
}

// 🚨 Watch for video node being replaced by YouTube
const observeVideoReplacement = () => {
    const observer = new MutationObserver(() => {
        const newVideo = document.querySelector('video');
        // Check if a new video element exists and is different from the current one
        if (newVideo instanceof HTMLVideoElement && newVideo !== video) {
            console.warn('[Content Script] Video element replaced. Reinitializing audio.');
            video = newVideo; // Update the global video reference
            setupAudio(video); // Reinitialize audio for the new video
            // The existing `player` reference should still be valid, or re-acquire if needed.
            // For now, assuming .html5-video-player remains the same wrapper.
        }
    });
    // Observe a common parent, e.g., document.body, for subtree changes
    observer.observe(document.body, { childList: true, subtree: true });
};

// Initial setup when the script loads
waitForVideoElement((vid, pl) => {
    video = vid;
    player = pl;
    setupAudio(video); // Setup audio for the found video
    observeVideoReplacement(); // Start observing for video replacements
});