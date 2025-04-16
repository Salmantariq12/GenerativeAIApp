/**
 * VoiceProcessor.js - Speech detection, recording, and processing
 */

// Helper functions
function applyHighPassFilter(audioContext, source) {
    const filter = audioContext.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 300; // Filter out low frequencies (e.g., mic taps, background hum)
    source.connect(filter);
    return filter; // Return the filtered audio stream
}

function setupAdvancedAudioProcessing(audioContext, source) {
    const highPassFilter = audioContext.createBiquadFilter();
    highPassFilter.type = "highpass";
    highPassFilter.frequency.value = 300;
    highPassFilter.Q.value = 0.7;  // Quality factor

    const lowPassFilter = audioContext.createBiquadFilter();
    lowPassFilter.type = "lowpass";
    lowPassFilter.frequency.value = 3000;  // Human speech is generally below 3kHz
    lowPassFilter.Q.value = 0.7;

    const notchFilter = audioContext.createBiquadFilter();
    notchFilter.type = "notch";
    notchFilter.frequency.value = 60;  // Common power line frequency
    notchFilter.Q.value = 10;  // Narrow band

    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;

    source.connect(highPassFilter);
    highPassFilter.connect(notchFilter);
    notchFilter.connect(lowPassFilter);
    lowPassFilter.connect(compressor);

    return compressor;
}

function calculateSpeechEnergy(analyser, frequencyData) {
    const sampleRate = analyser.context.sampleRate;
    const binSize = sampleRate / (analyser.frequencyBinCount * 2);
    const minBin = Math.floor(300 / binSize);  // ~300Hz
    const maxBin = Math.ceil(3000 / binSize);  // ~3000Hz

    let sum = 0;
    for (let i = minBin; i <= maxBin && i < frequencyData.length; i++) {
        sum += frequencyData[i] * frequencyData[i];
    }
    return Math.sqrt(sum / (maxBin - minBin + 1)) / 255;
}

// Calculate time domain energy
function calculateTimeEnergy(dataArray) {
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        let amplitude = (dataArray[i] - 128) / 128;
        sum += amplitude * amplitude;
    }
    return Math.sqrt(sum / dataArray.length);
}

// Calculate energy in noise frequency ranges
function calculateNoiseEnergy(analyser, frequencyData) {
    const sampleRate = analyser.context.sampleRate;
    const binSize = sampleRate / (analyser.frequencyBinCount * 2);
    const minSpeechBin = Math.floor(300 / binSize);
    const maxSpeechBin = Math.ceil(3000 / binSize);

    let sum = 0;
    let count = 0;

    // Energy below speech range
    for (let i = 0; i < minSpeechBin && i < frequencyData.length; i++) {
        sum += frequencyData[i] * frequencyData[i];
        count++;
    }

    // Energy above speech range
    for (let i = maxSpeechBin + 1; i < frequencyData.length; i++) {
        sum += frequencyData[i] * frequencyData[i];
        count++;
    }

    return count > 0 ? Math.sqrt(sum / count) / 255 : 0;
}

async function calibrateAmbientNoise(analyser, frequencyData) {
    return new Promise(resolve => {
        const calibrationSamples = [];
        const CALIBRATION_DURATION = 2000; // 2 seconds
        const startTime = performance.now();

        const calibrate = () => {
            analyser.getByteFrequencyData(frequencyData);

            const speechEnergy = calculateSpeechEnergy(analyser, frequencyData);
            calibrationSamples.push(speechEnergy);

            if (performance.now() - startTime < CALIBRATION_DURATION) {
                requestAnimationFrame(calibrate);
            } else {
                calibrationSamples.sort((a, b) => a - b);
                const ambientNoiseLevel = calibrationSamples[Math.floor(calibrationSamples.length / 2)];
                console.log("Ambient noise level calibrated:", ambientNoiseLevel);
                resolve(ambientNoiseLevel);
            }
        };

        calibrate();
    });
}

function monitorForSpeechEnhanced(analyser, dataArray, frequencyData, ambientNoiseLevel, speechThresholdMultiplier = 1.0) {
    analyser.getByteTimeDomainData(dataArray);
    analyser.getByteFrequencyData(frequencyData);

    // Calculate signal energy in time domain
    let timeEnergy = calculateTimeEnergy(dataArray);

    // Calculate energy in speech frequency range (300Hz - 3000Hz)
    let speechEnergy = calculateSpeechEnergy(analyser, frequencyData);

    // Calculate energy in noise frequency ranges (below 300Hz and above 3000Hz)
    let noiseEnergy = calculateNoiseEnergy(analyser, frequencyData);

    // Calculate signal-to-noise ratio
    let snr = noiseEnergy > 0 ? speechEnergy / noiseEnergy : speechEnergy;

    // Dynamic threshold based on ambient noise level
    const dynamicThreshold = ambientNoiseLevel * 1.5 * speechThresholdMultiplier;

    // Detect speech using multiple factors
    return {
        isSpeech: speechEnergy > dynamicThreshold && snr > 1.5 && timeEnergy > 0.05,
        metrics: {
            timeEnergy,
            speechEnergy,
            noiseEnergy,
            snr,
            threshold: dynamicThreshold
        }
    };
}

// SilenceDetector Class
class SilenceDetector {
    constructor(analyser, ambientNoiseLevel, silenceDurationRequired = 1500) {
        this.analyser = analyser;
        this.ambientNoiseLevel = ambientNoiseLevel;
        this.SILENCE_DURATION_REQUIRED = silenceDurationRequired;
        this.silenceTimeout = null;

        // Use a rolling window for more stable silence detection
        this.WINDOW_SIZE = 30;  // 30 frames, approximately 0.5 seconds at 60fps
        this.silenceBuffer = new Array(this.WINDOW_SIZE).fill(0);
        this.bufferIndex = 0;

        // Create frequency data array
        this.frequencyData = new Uint8Array(analyser.frequencyBinCount);
    }

    update() {
        this.analyser.getByteFrequencyData(this.frequencyData);

        // Calculate energy in speech range
        const speechEnergy = calculateSpeechEnergy(this.analyser, this.frequencyData);

        // Add to rolling buffer
        this.silenceBuffer[this.bufferIndex] = speechEnergy;
        this.bufferIndex = (this.bufferIndex + 1) % this.WINDOW_SIZE;

        // Calculate average energy in buffer
        const avgEnergy = this.silenceBuffer.reduce((sum, val) => sum + val, 0) / this.WINDOW_SIZE;

        // Dynamic silence threshold based on ambient noise
        const silenceThreshold = this.ambientNoiseLevel * 1.2;

        return avgEnergy < silenceThreshold;
    }

    startMonitoring(onSilenceDetected) {
        const checkSilence = () => {
            if (this.update()) {
                // Silence detected
                if (!this.silenceTimeout) {
                    this.silenceTimeout = setTimeout(() => {
                        onSilenceDetected();
                    }, this.SILENCE_DURATION_REQUIRED);
                }
            } else {
                // Not silent
                clearTimeout(this.silenceTimeout);
                this.silenceTimeout = null;
            }

            this.animationFrame = requestAnimationFrame(checkSilence);
        };

        checkSilence();
    }

    stopMonitoring() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        clearTimeout(this.silenceTimeout);
        this.silenceTimeout = null;
    }
}

// Main VoiceProcessor class
class VoiceProcessor {
    constructor(options = {}) {
        // Audio context and nodes
        this.audioContext = null;
        this.analyser = null;
        this.micStream = null;
        this.mediaRecorder = null;

        // State variables
        this.audioChunks = [];
        this.isRecording = false;
        this.playbackActive = false;
        this.speechDetected = false;
        this.speechStartTime = 0;
        this.ambientNoiseLevel = 0.02;  // Initial value
        this.speechThresholdMultiplier = 1.0;

        // API endpoint
        this.apiEndpoint = options.apiEndpoint || '/api/VoiceProcessor';

        // Use exact original configuration values
        this.automaticMode = options.automaticMode !== undefined ? options.automaticMode : true;
        this.SPEECH_DURATION_REQUIRED = 100;  // Faster response as in original
        this.SILENCE_DURATION_REQUIRED = 1500;  // 1.5 seconds of silence to stop
        this.RECORDING_COOLDOWN = 1000; // 1 second cooldown

        // Array buffers
        this.dataArray = null;
        this.frequencyData = null;

        // Silence detector
        this.silenceDetector = null;

        // Animation frames
        this.speechMonitoringFrame = null;

        // Callbacks
        this.onRecordingStart = null;
        this.onRecordingStop = null;
        this.onSpeechDetected = null;
        this.onSilenceDetected = null;
        this.onInterruption = null;
        this.onProcessingStart = null;
        this.onProcessingComplete = null;
        this.onError = null;

        // Cooldown to prevent rapid start/stop cycles
        this.lastRecordingEndTime = 0;
    }

    async initialize() {
        try {
            // Request microphone access with noise suppression
            this.micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    noiseSuppression: true,
                    echoCancellation: true,
                    autoGainControl: true
                }
            });

            // Set up audio context and analyser
            this.audioContext = new AudioContext();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;  // More detailed frequency analysis
            this.analyser.smoothingTimeConstant = 0.5; // Add smoothing to make detection more stable

            // Create arrays for time and frequency domain data
            this.dataArray = new Uint8Array(this.analyser.fftSize);
            this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);

            // Create media stream source
            const source = this.audioContext.createMediaStreamSource(this.micStream);

            // Set up advanced audio processing chain - using exact original function
            const processedSource = setupAdvancedAudioProcessing(this.audioContext, source);

            // Connect to analyser for monitoring
            processedSource.connect(this.analyser);

            // Calibrate ambient noise level - using exact original function
            this.ambientNoiseLevel = await calibrateAmbientNoise(this.analyser, this.frequencyData);
            console.log("Calibrated ambient noise level:", this.ambientNoiseLevel);

            // Initialize silence detector - using exact original parameters
            this.silenceDetector = new SilenceDetector(
                this.analyser,
                this.ambientNoiseLevel,
                this.SILENCE_DURATION_REQUIRED
            );

            // Start monitoring for speech (automatic mode)
            if (this.automaticMode) {
                this.startSpeechMonitoring();
            }

            return true;
        } catch (error) {
            console.error("Error initializing voice processor:", error);
            if (this.onError) {
                this.onError("Failed to access microphone: " + error.message);
            }
            return false;
        }
    }

    startSpeechMonitoring() {
        if (this.isRecording) return;

        // Check for cooldown period
        if (performance.now() - this.lastRecordingEndTime < this.RECORDING_COOLDOWN) {
            // Schedule retry after cooldown period
            setTimeout(() => this.startSpeechMonitoring(),
                this.RECORDING_COOLDOWN - (performance.now() - this.lastRecordingEndTime));
            return;
        }

        // Clear any existing animation frame
        if (this.speechMonitoringFrame) {
            cancelAnimationFrame(this.speechMonitoringFrame);
        }

        const monitorSpeech = () => {
            if (this.isRecording) return;

            // Using original monitor function
            const result = monitorForSpeechEnhanced(
                this.analyser,
                this.dataArray,
                this.frequencyData,
                this.ambientNoiseLevel,
                this.speechThresholdMultiplier
            );

            if (result.isSpeech) {
                if (!this.speechDetected) {
                    this.speechDetected = true;
                    this.speechStartTime = performance.now();
                    if (this.onSpeechDetected) this.onSpeechDetected();
                } else if (this.automaticMode && (performance.now() - this.speechStartTime > this.SPEECH_DURATION_REQUIRED)) {
                    // Check if we're during playback - if so, trigger interruption
                    if (this.playbackActive) {
                        if (this.onInterruption) this.onInterruption();
                    } else {
                        this.startRecording();
                    }
                    return;
                }
            } else {
                this.speechDetected = false;
            }

            this.speechMonitoringFrame = requestAnimationFrame(monitorSpeech);
        };

        monitorSpeech();
    }

    startRecording(isInterruption = false) {
        if (this.isRecording) return;

        // Stop speech monitoring
        if (this.speechMonitoringFrame) {
            cancelAnimationFrame(this.speechMonitoringFrame);
            this.speechMonitoringFrame = null;
        }

        this.mediaRecorder = new MediaRecorder(this.micStream, { mimeType: "audio/webm" });
        this.audioChunks = [];
        this.isRecording = true;

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.audioChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            this.isRecording = false;
            this.lastRecordingEndTime = performance.now();

            if (this.onRecordingStop) {
                const audioBlob = new Blob(this.audioChunks, { type: "audio/webm" });
                this.onRecordingStop(audioBlob, isInterruption);
            }

            // Resume speech monitoring after a short delay
            setTimeout(() => {
                if (!this.playbackActive) {
                    this.startSpeechMonitoring();
                }
            }, 500);
        };

        this.mediaRecorder.start();

        // Start silence detection
        this.silenceDetector.startMonitoring(() => {
            if (this.isRecording) {
                this.stopRecording();
                if (this.onSilenceDetected) this.onSilenceDetected();
            }
        });

        if (this.onRecordingStart) this.onRecordingStart(isInterruption);
    }

    stopRecording() {
        if (!this.isRecording) return;

        // Stop silence detection
        this.silenceDetector.stopMonitoring();

        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
            this.mediaRecorder.stop();
        }

        this.isRecording = false;
    }

    setPlaybackState(isPlaying) {
        this.playbackActive = isPlaying;
        // Using original multiplier value 3.0
        this.speechThresholdMultiplier = isPlaying ? 3.0 : 1.0;

        // Always maintain speech monitoring
        if (!this.speechMonitoringFrame && !this.isRecording) {
            this.startSpeechMonitoring();
        }
    }

    /**
     * Process an audio recording with the backend API
     * @param {Blob} audioBlob - The recorded audio blob
     * @returns {Promise<{audioElement: HTMLAudioElement, audioUrl: string}>} - The audio response
     */
    async processAudio(audioBlob) {
        if (this.onProcessingStart) {
            this.onProcessingStart();
        }

        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");

        try {
            const response = await fetch(this.apiEndpoint, {
                method: "POST",
                body: formData
            });

            if (response.ok) {
                const audioBlob = await response.blob();
                const audioUrl = URL.createObjectURL(audioBlob);

                // Create audio element for playback
                const audioElement = new Audio(audioUrl);

                // Set up the interruption detection exactly as original code
                this.enableInterruptionDetection(audioElement);

                if (this.onProcessingComplete) {
                    this.onProcessingComplete(audioElement, audioUrl);
                }

                return { audioElement, audioUrl };
            } else {
                const errorMessage = await response.text();
                console.error("API Error:", errorMessage);

                if (this.onError) {
                    this.onError("Error processing request: " + errorMessage);
                }

                throw new Error(errorMessage);
            }
        } catch (error) {
            console.error("Network Error:", error);

            if (this.onError) {
                this.onError("Network error: " + error.message);
            }

            throw error;
        }
    }

    /**
     * Enable interruption detection on an audio element using exact original implementation
     */
    enableInterruptionDetection(audioElement) {
        if (!audioElement) return;

        // Original interruption detection implementation preserved exactly
        audioElement.onplay = () => {
            this.setPlaybackState(true);

            console.log("Starting interruption monitor");

            // Direct interruption checker using intervals - exact copy from original code
            let directInterruptionChecker = setInterval(() => {
                // Skip check if already paused
                if (audioElement.paused) {
                    clearInterval(directInterruptionChecker);
                    return;
                }

                // Get current speech energy directly
                this.analyser.getByteFrequencyData(this.frequencyData);
                const speechEnergy = calculateSpeechEnergy(
                    this.analyser,
                    this.frequencyData
                );

                // Use a simpler, more aggressive threshold for interruption - original value 2.0
                const threshold = this.ambientNoiseLevel * 2.0;

                // Log for debugging - kept from original
                console.log(`Speech energy: ${speechEnergy}, Threshold: ${threshold}`);

                if (speechEnergy > threshold) {
                    console.log("INTERRUPTION DETECTED - STOPPING PLAYBACK");

                    // Immediately clear this interval
                    clearInterval(directInterruptionChecker);

                    // Force stop playback
                    audioElement.pause();

                    // Start recording immediately - exact timing from original (100ms)
                    setTimeout(() => {
                        this.startRecording(true);
                    }, 100);

                    if (this.onInterruption) {
                        this.onInterruption();
                    }
                }
            }, 100); // Check every 100ms - exact interval from original

            // Store reference to clear on pause/end - exact property name from original
            audioElement.directInterruptionChecker = directInterruptionChecker;
        };

        audioElement.onpause = () => {
            // Clear the interval - exact property name from original
            if (audioElement.directInterruptionChecker) {
                clearInterval(audioElement.directInterruptionChecker);
                audioElement.directInterruptionChecker = null;
            }

            this.setPlaybackState(false);
        };

        audioElement.onended = () => {
            // Clear the interval - exact property name from original
            if (audioElement.directInterruptionChecker) {
                clearInterval(audioElement.directInterruptionChecker);
                audioElement.directInterruptionChecker = null;
            }

            this.setPlaybackState(false);

            // Add a slight delay before reactivating speech monitoring - original 300ms
            setTimeout(() => {
                this.startSpeechMonitoring();
            }, 300);
        };
    }

    /**
     * Clean up resources
     */
    dispose() {
        this.stopRecording();

        if (this.speechMonitoringFrame) {
            cancelAnimationFrame(this.speechMonitoringFrame);
        }

        if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop());
        }

        if (this.audioContext && this.audioContext.state !== "closed") {
            this.audioContext.close();
        }
    }
}

// Make VoiceProcessor available globally
window.VoiceProcessor = VoiceProcessor;