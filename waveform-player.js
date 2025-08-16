// Waveform Audio Player Component
class WaveformPlayer {
    constructor(container) {
        this.container = container;
        this.audioContext = null;
        this.audioBuffer = null;
        this.source = null;
        this.startTime = 0;
        this.pauseTime = 0;
        this.isPlaying = false;
        this.duration = 0;
        this.peaks = [];
        
        this.createPlayer();
        this.attachEventListeners();
    }

    createPlayer() {
        this.container.innerHTML = `
            <div class="waveform-player">
                <div class="player-controls">
                    <button class="play-pause-btn" aria-label="Play">
                        <svg class="play-icon" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                        <svg class="pause-icon" style="display:none" viewBox="0 0 24 24">
                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                        </svg>
                    </button>
                    <div class="time-display">
                        <span class="current-time">0:00</span>
                        <span class="separator">/</span>
                        <span class="total-time">0:00</span>
                    </div>
                </div>
                
                <div class="waveform-container">
                    <canvas class="waveform-canvas"></canvas>
                    <canvas class="progress-canvas"></canvas>
                    <div class="hover-time" style="display:none"></div>
                </div>
                
                <div class="player-footer">
                    <div class="volume-control">
                        <svg viewBox="0 0 24 24">
                            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                        </svg>
                        <input type="range" class="volume-slider" min="0" max="100" value="100">
                        <span class="volume-value">100%</span>
                    </div>
                    
                    <div class="playback-rate">
                        <label>Speed:</label>
                        <select class="rate-selector">
                            <option value="0.5">0.5x</option>
                            <option value="0.75">0.75x</option>
                            <option value="1" selected>1x</option>
                            <option value="1.25">1.25x</option>
                            <option value="1.5">1.5x</option>
                            <option value="2">2x</option>
                        </select>
                    </div>
                    
                    <button class="loop-btn" aria-label="Loop">
                        <svg viewBox="0 0 24 24">
                            <path d="M17 17H7v-3l-4 4 4 4v-3h12v-6h-2v4M7 7h10v3l4-4-4-4v3H5v6h2V7z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
        
        // Get elements
        this.playPauseBtn = this.container.querySelector('.play-pause-btn');
        this.playIcon = this.container.querySelector('.play-icon');
        this.pauseIcon = this.container.querySelector('.pause-icon');
        this.currentTimeEl = this.container.querySelector('.current-time');
        this.totalTimeEl = this.container.querySelector('.total-time');
        this.waveformCanvas = this.container.querySelector('.waveform-canvas');
        this.progressCanvas = this.container.querySelector('.progress-canvas');
        this.hoverTime = this.container.querySelector('.hover-time');
        this.volumeSlider = this.container.querySelector('.volume-slider');
        this.volumeValue = this.container.querySelector('.volume-value');
        this.rateSelector = this.container.querySelector('.rate-selector');
        this.loopBtn = this.container.querySelector('.loop-btn');
        
        this.waveformCtx = this.waveformCanvas.getContext('2d');
        this.progressCtx = this.progressCanvas.getContext('2d');
        
        this.isLooping = false;
        this.gainNode = null;
    }

    attachEventListeners() {
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        
        this.volumeSlider.addEventListener('input', (e) => {
            const volume = e.target.value;
            this.volumeValue.textContent = volume + '%';
            if (this.gainNode) {
                this.gainNode.gain.value = volume / 100;
            }
        });
        
        this.rateSelector.addEventListener('change', (e) => {
            if (this.source) {
                this.source.playbackRate.value = parseFloat(e.target.value);
            }
        });
        
        this.loopBtn.addEventListener('click', () => {
            this.isLooping = !this.isLooping;
            this.loopBtn.classList.toggle('active', this.isLooping);
            if (this.source) {
                this.source.loop = this.isLooping;
            }
        });
        
        // Waveform interaction
        this.progressCanvas.addEventListener('click', (e) => {
            const rect = this.progressCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const clickPosition = x / rect.width;
            this.seek(clickPosition * this.duration);
        });
        
        this.progressCanvas.addEventListener('mousemove', (e) => {
            const rect = this.progressCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const hoverPosition = x / rect.width;
            const hoverTimeSeconds = hoverPosition * this.duration;
            
            this.hoverTime.style.display = 'block';
            this.hoverTime.style.left = x + 'px';
            this.hoverTime.textContent = this.formatTime(hoverTimeSeconds);
        });
        
        this.progressCanvas.addEventListener('mouseleave', () => {
            this.hoverTime.style.display = 'none';
        });
        
        // Resize handling
        window.addEventListener('resize', () => this.resizeCanvases());
    }

    async loadAudio(audioData) {
        try {
            // Initialize audio context if needed
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                
                // Create gain node for volume control
                this.gainNode = this.audioContext.createGain();
                this.gainNode.connect(this.audioContext.destination);
            }
            
            // Decode audio data
            if (audioData instanceof ArrayBuffer) {
                this.audioBuffer = await this.audioContext.decodeAudioData(audioData.slice(0));
            } else if (audioData instanceof Blob) {
                const arrayBuffer = await audioData.arrayBuffer();
                this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            } else if (audioData instanceof AudioBuffer) {
                this.audioBuffer = audioData;
            }
            
            this.duration = this.audioBuffer.duration;
            this.totalTimeEl.textContent = this.formatTime(this.duration);
            
            // Generate waveform
            this.generateWaveform();
            this.drawWaveform();
            
            // Enable play button
            this.playPauseBtn.disabled = false;
            
        } catch (error) {
            console.error('Error loading audio:', error);
        }
    }

    generateWaveform() {
        const channelData = this.audioBuffer.getChannelData(0);
        const samplesPerPeak = Math.floor(channelData.length / this.waveformCanvas.width);
        
        this.peaks = [];
        
        for (let i = 0; i < this.waveformCanvas.width; i++) {
            let min = 1.0;
            let max = -1.0;
            
            for (let j = 0; j < samplesPerPeak; j++) {
                const value = channelData[(i * samplesPerPeak) + j];
                if (value > max) max = value;
                if (value < min) min = value;
            }
            
            this.peaks.push({ min, max });
        }
    }

    drawWaveform() {
        const width = this.waveformCanvas.width;
        const height = this.waveformCanvas.height;
        const centerY = height / 2;
        
        // Clear canvas
        this.waveformCtx.clearRect(0, 0, width, height);
        
        // Set up gradient
        const gradient = this.waveformCtx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(100, 108, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(100, 108, 255, 1)');
        gradient.addColorStop(1, 'rgba(100, 108, 255, 0.8)');
        
        this.waveformCtx.fillStyle = gradient;
        
        // Draw waveform
        for (let i = 0; i < this.peaks.length; i++) {
            const peak = this.peaks[i];
            const x = i;
            const minY = centerY + (peak.min * centerY * 0.8);
            const maxY = centerY + (peak.max * centerY * 0.8);
            const peakHeight = maxY - minY;
            
            this.waveformCtx.fillRect(x, minY, 1, peakHeight || 1);
        }
    }

    drawProgress() {
        if (!this.isPlaying) return;
        
        const width = this.progressCanvas.width;
        const height = this.progressCanvas.height;
        
        // Clear canvas
        this.progressCtx.clearRect(0, 0, width, height);
        
        // Calculate progress
        const currentTime = this.getCurrentTime();
        const progress = currentTime / this.duration;
        const progressWidth = width * progress;
        
        // Draw progress overlay
        this.progressCtx.fillStyle = 'rgba(116, 123, 255, 0.3)';
        this.progressCtx.fillRect(0, 0, progressWidth, height);
        
        // Draw playhead
        this.progressCtx.strokeStyle = '#747bff';
        this.progressCtx.lineWidth = 2;
        this.progressCtx.beginPath();
        this.progressCtx.moveTo(progressWidth, 0);
        this.progressCtx.lineTo(progressWidth, height);
        this.progressCtx.stroke();
        
        // Update time display
        this.currentTimeEl.textContent = this.formatTime(currentTime);
        
        // Continue animation
        if (this.isPlaying) {
            requestAnimationFrame(() => this.drawProgress());
        }
    }

    togglePlayPause() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    play() {
        if (!this.audioBuffer) return;
        
        // Resume audio context if suspended
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        
        // Create new source
        this.source = this.audioContext.createBufferSource();
        this.source.buffer = this.audioBuffer;
        this.source.connect(this.gainNode);
        this.source.loop = this.isLooping;
        this.source.playbackRate.value = parseFloat(this.rateSelector.value);
        
        // Set up ended handler
        this.source.onended = () => {
            if (!this.isLooping) {
                this.stop();
            }
        };
        
        // Start playing
        const offset = this.pauseTime;
        this.source.start(0, offset);
        this.startTime = this.audioContext.currentTime - offset;
        
        this.isPlaying = true;
        this.playIcon.style.display = 'none';
        this.pauseIcon.style.display = 'block';
        
        // Start progress animation
        this.drawProgress();
    }

    pause() {
        if (!this.source) return;
        
        this.pauseTime = this.getCurrentTime();
        this.source.stop();
        this.source = null;
        
        this.isPlaying = false;
        this.playIcon.style.display = 'block';
        this.pauseIcon.style.display = 'none';
    }

    stop() {
        if (this.source) {
            this.source.stop();
            this.source = null;
        }
        
        this.isPlaying = false;
        this.pauseTime = 0;
        this.startTime = 0;
        
        this.playIcon.style.display = 'block';
        this.pauseIcon.style.display = 'none';
        this.currentTimeEl.textContent = '0:00';
        
        // Clear progress
        this.progressCtx.clearRect(0, 0, this.progressCanvas.width, this.progressCanvas.height);
    }

    seek(time) {
        const wasPlaying = this.isPlaying;
        
        if (this.isPlaying) {
            this.pause();
        }
        
        this.pauseTime = Math.max(0, Math.min(time, this.duration));
        
        if (wasPlaying) {
            this.play();
        }
        
        // Update display
        this.currentTimeEl.textContent = this.formatTime(this.pauseTime);
        this.drawProgress();
    }

    getCurrentTime() {
        if (!this.isPlaying) {
            return this.pauseTime;
        }
        
        const elapsed = this.audioContext.currentTime - this.startTime;
        return Math.min(elapsed, this.duration);
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    resizeCanvases() {
        const container = this.container.querySelector('.waveform-container');
        const rect = container.getBoundingClientRect();
        
        this.waveformCanvas.width = rect.width;
        this.waveformCanvas.height = rect.height;
        this.progressCanvas.width = rect.width;
        this.progressCanvas.height = rect.height;
        
        if (this.audioBuffer) {
            this.generateWaveform();
            this.drawWaveform();
        }
    }

    destroy() {
        this.stop();
        if (this.audioContext) {
            this.audioContext.close();
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WaveformPlayer;
}

// Make available globally
window.WaveformPlayer = WaveformPlayer;