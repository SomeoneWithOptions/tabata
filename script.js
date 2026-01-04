const fields = {
    warmup: document.getElementById('warmup'),
    work: document.getElementById('work'),
    rest: document.getElementById('rest'),
    intervals: document.getElementById('intervals'),
};
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const phaseLabel = document.getElementById('phaseLabel');
const workPhase = document.getElementById('workPhase');
const restPhase = document.getElementById('restPhase');
const phaseSeparator = document.getElementById('phaseSeparator');
const timeDisplay = document.getElementById('timeDisplay');
const progressBar = document.getElementById('progressBar');
const totalTimeText = document.getElementById('totalTimeText');
const remainingTimeText = document.getElementById('remainingTimeText');
const phaseList = document.getElementById('phaseList');
const soundToggleBtn = document.getElementById('soundToggleBtn');

const sound = (() => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    let ctx = null;
    let enabled = true;

    function ensureContext() {
        if (!enabled || !AudioContextCtor) return null;
        if (!ctx) {
            ctx = new AudioContextCtor();
        }
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        return ctx;
    }

    function playTone(frequency, duration = 0.2, volume = 0.35, type = 'sine') {
        const audioCtx = ensureContext();
        if (!audioCtx) return;
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.type = type;
        oscillator.frequency.value = frequency;
        gainNode.gain.value = 0.0001;
        oscillator.connect(gainNode).connect(audioCtx.destination);
        const now = audioCtx.currentTime;
        gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
        gainNode.gain.linearRampToValueAtTime(0.0001, now + duration);
        oscillator.start(now);
        oscillator.stop(now + duration + 0.05);
    }

    return {
        setEnabled(value) {
            enabled = Boolean(value);
            if (!enabled && ctx && ctx.state === 'running') {
                ctx.suspend();
            }
        },
        prime() {
            ensureContext();
        },
        countdown(second) {
            if (second < 0 || second > 2) return;
            const freq = 520 + (2 - second) * 70;
            playTone(freq, 0.18, 0.35, 'triangle');
        },
        intervalStart() {
            playTone(780, 0.28, 0.4, 'square');
        },
    };
})();

function updateSoundButton(isOn) {
    if (!soundToggleBtn) return;
    soundToggleBtn.textContent = isOn ? 'Sound On' : 'Sound Off';
    soundToggleBtn.classList.toggle('sound-btn--on', isOn);
    soundToggleBtn.classList.toggle('sound-btn--off', !isOn);
}

let phases = [];
let currentPhaseIndex = 0;
let remainingSeconds = 0;
let timerId = null;
let status = 'idle';
let soundOn = true;
let lastWorkPhaseIndex = -1;
let completionCueTimers = [];
let completionCueScheduled = false;
let totalWorkoutSeconds = 0;
let sessionCompleted = false;
let wakeLock = null;
let completedWorkSegments = 0;
let completedRestSegments = 0;

sound.setEnabled(soundOn);
updateSoundButton(soundOn);
if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
        soundOn = !soundOn;
        sound.setEnabled(soundOn);
        updateSoundButton(soundOn);
        if (soundOn) {
            sound.prime();
        }
    });
}

function toSeconds(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function getConfig() {
    return {
        warmup: toSeconds(fields.warmup.value),
        work: Math.max(1, toSeconds(fields.work.value)),
        rest: toSeconds(fields.rest.value),
        intervals: Math.max(1, Math.min(20, toSeconds(fields.intervals.value))),
    };
}

function createSchedule(config) {
    const sequence = [];
    if (config.warmup > 0) {
        sequence.push({ key: 'warmup', label: 'Warm-up', seconds: config.warmup });
    }
    const totalIntervals = config.intervals;
    const totalRests = Math.max(0, totalIntervals - 1);
    let restCount = 1;
    for (let i = 1; i <= totalIntervals; i += 1) {
        sequence.push({ key: 'work', label: `Work ${i}/${totalIntervals}`, seconds: config.work });
        if (i < totalIntervals && config.rest > 0) {
            sequence.push({ key: 'rest', label: `Rest ${restCount}/${totalRests}`, seconds: config.rest });
            restCount++;
        }
    }
    return sequence;
}

function findLastWorkIndex(list = []) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].key === 'work') {
            return i;
        }
    }
    return -1;
}

function clearCompletionCueTimers() {
    completionCueTimers.forEach((timeoutId) => clearTimeout(timeoutId));
    completionCueTimers = [];
}

function resetCompletionCueState() {
    clearCompletionCueTimers();
    completionCueScheduled = false;
}

function playCompletionCue() {
    if (completionCueScheduled || lastWorkPhaseIndex === -1) return;
    completionCueScheduled = true;
    clearCompletionCueTimers();
    sound.prime();
    for (let i = 0; i < 3; i += 1) {
        const timeoutId = setTimeout(() => {
            sound.intervalStart();
        }, i * 1000);
        completionCueTimers.push(timeoutId);
    }
}

function formatTime(value) {
    const minutes = String(Math.floor(value / 60)).padStart(2, '0');
    const seconds = String(value % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function calculateTotalDuration(list = []) {
    return list.reduce((sum, phase) => sum + Math.max(0, phase.seconds || 0), 0);
}

function getRemainingWorkoutSeconds() {
    if (!phases.length) return 0;
    const upcoming = phases.slice(currentPhaseIndex + 1).reduce((sum, phase) => sum + phase.seconds, 0);
    return remainingSeconds + upcoming;
}

function updateWorkoutSummaryText() {
    if (!totalTimeText || !remainingTimeText) return;
    totalTimeText.textContent = `Total workout: ${formatTime(totalWorkoutSeconds)}`;
    const remaining = sessionCompleted
        ? 0
        : status === 'running' || status === 'paused'
            ? getRemainingWorkoutSeconds()
            : totalWorkoutSeconds;
    remainingTimeText.textContent = `Time left in workout: ${formatTime(Math.max(remaining, 0))}`;
}

function updatePhaseList(list = phases, highlightIndex = -1) {
    phaseList.innerHTML = '';
    if (!list.length) {
        phaseList.innerHTML = '<li class="phase-item"><strong>Waiting</strong><span>Press start to build the flow.</span></li>';
        return;
    }

    list.forEach((phase, idx) => {
        const li = document.createElement('li');
        li.className = 'phase-item';
        li.innerHTML = `<strong>${phase.label}</strong><span>${phase.seconds} s</span>`;
        if (idx === highlightIndex) {
            li.style.background = 'var(--accent-3)';
        }
        phaseList.appendChild(li);
    });
}


function handleCountdownAlerts() {
    if (remainingSeconds >= 0 && remainingSeconds <= 2) {
        sound.countdown(remainingSeconds);
    }
}

function updateTimerDisplay() {
    if (!phases[currentPhaseIndex]) return;
    const phase = phases[currentPhaseIndex];

    // Use the tracked completed segments for display
    let completedWork = completedWorkSegments;
    let completedRest = completedRestSegments;

    // Note: completedSegments are incremented when a segment finishes.
    // So during a segment, the display should show the previous count.
    // Since we want to show "Work 1/X" when starting the 1st work, and it goes to "Work 1/X" when finishing it (and next starts),
    // let's verify the logic:
    // startSession -> beginPhase(0) -> Work 1 starts.
    // completedWorkSegments is 0.
    // We want "Work 0/X - Rest 0/Y" or "Work 1/X - Rest 0/Y"?
    // Requirement says: "Counters start at 'Work 0/X - Rest 0/Y' when workout begins"
    // Requirement says: "Work counter increments when a work segment completes"
    // So "Work 1" starts at 0. It becomes "Work 1" when it finishes.
    // This matches the current logic of completedWorkSegments.

    const totalWork = phases.filter(p => p.key === 'work').length;
    const totalRest = phases.filter(p => p.key === 'rest').length;

    // Display "Warm Up" during warm-up phase, otherwise show work/rest counters
    if (phase.key === 'warmup') {
        workPhase.textContent = 'Warm Up';
        phaseSeparator.textContent = '';
        restPhase.textContent = '';
    } else {
        workPhase.textContent = `Work ${completedWork}/${totalWork}`;
        phaseSeparator.textContent = ' - ';
        restPhase.textContent = `Rest ${completedRest}/${totalRest}`;
    }

    workPhase.classList.toggle('active', phase.key === 'work' || phase.key === 'warmup');
    restPhase.classList.toggle('active', phase.key === 'rest');
    timeDisplay.textContent = formatTime(remainingSeconds);
    const percent = phase.seconds === 0 ? 100 : ((phase.seconds - remainingSeconds) / phase.seconds) * 100;
    progressBar.style.width = `${Math.min(Math.max(percent, 0), 100)}%`;
    updatePhaseList(phases, currentPhaseIndex);
    updateWorkoutSummaryText();
}

function clearTimer() {
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
    }
}

function startTicking() {
    clearTimer();
    timerId = setInterval(() => {
        if (remainingSeconds <= 0) {
            const finishedPhase = phases[currentPhaseIndex];
            clearTimer();
            if (finishedPhase?.key === 'work') {
                completedWorkSegments++;
            } else if (finishedPhase?.key === 'rest') {
                completedRestSegments++;
            }
            if (finishedPhase?.key === 'work' && currentPhaseIndex === lastWorkPhaseIndex) {
                playCompletionCue();
            }
            beginPhase(currentPhaseIndex + 1);
            return;
        }
        remainingSeconds -= 1;
        updateTimerDisplay();
        handleCountdownAlerts();
    }, 1000);
}

function beginPhase(index) {
    if (index >= phases.length) {
        finishSession();
        return;
    }
    currentPhaseIndex = index;
    remainingSeconds = phases[index].seconds;
    sound.intervalStart();
    updateTimerDisplay();
    startTicking();
}

function finishSession() {
    clearTimer();
    playCompletionCue();
    status = 'idle';
    sessionCompleted = true;
    pauseBtn.disabled = true;
    resetBtn.disabled = false;
    pauseBtn.textContent = 'Pause';
    workPhase.textContent = 'Completed';
    phaseSeparator.textContent = '';
    restPhase.textContent = '';
    workPhase.classList.remove('active');
    restPhase.classList.remove('active');
    remainingSeconds = 0;
    timeDisplay.textContent = '00:00';
    progressBar.style.width = '100%';
    releaseWakeLock();
    updateWorkoutSummaryText();
}

function startSession() {
    const config = getConfig();
    phases = createSchedule(config);
    totalWorkoutSeconds = calculateTotalDuration(phases);
    lastWorkPhaseIndex = findLastWorkIndex(phases);
    sessionCompleted = false;
    resetCompletionCueState();
    completedWorkSegments = 0;
    completedRestSegments = 0;
    if (!phases.length) {
        return;
    }
    status = 'running';
    pauseBtn.disabled = false;
    resetBtn.disabled = false;
    pauseBtn.textContent = 'Pause';
    startBtn.textContent = 'Restart Session';
    updatePhaseList(phases, 0);
    requestWakeLock();
    beginPhase(0);
}

function pauseSession() {
    if (status !== 'running') return;
    status = 'paused';
    clearTimer();
    releaseWakeLock();
    pauseBtn.textContent = 'Resume';
}

function resumeSession() {
    if (status !== 'paused') return;
    status = 'running';
    pauseBtn.textContent = 'Pause';
    sound.prime();
    requestWakeLock();
    startTicking();
}

function resetSession() {
    clearTimer();
    resetCompletionCueState();
    status = 'idle';
    phases = createSchedule(getConfig());
    lastWorkPhaseIndex = findLastWorkIndex(phases);
    currentPhaseIndex = 0;
    remainingSeconds = phases[0]?.seconds ?? 0;
    completedWorkSegments = 0;
    completedRestSegments = 0;
    workPhase.textContent = 'Ready';
    phaseSeparator.textContent = '';
    restPhase.textContent = '';
    workPhase.classList.remove('active');
    restPhase.classList.remove('active');
    timeDisplay.textContent = '00:00';
    progressBar.style.width = '0%';
    startBtn.textContent = 'Start Session';
    pauseBtn.textContent = 'Pause';
    pauseBtn.disabled = true;
    resetBtn.disabled = true;
    sessionCompleted = false;
    releaseWakeLock();
    totalWorkoutSeconds = calculateTotalDuration(phases);
    updatePhaseList(phases);
    updateWorkoutSummaryText();
}

startBtn.addEventListener('click', () => {
    sound.prime();
    startSession();
});

pauseBtn.addEventListener('click', () => {
    if (status === 'running') {
        pauseSession();
    } else if (status === 'paused') {
        resumeSession();
    }
});

resetBtn.addEventListener('click', () => {
    resetSession();
});

Object.values(fields).forEach((input) => {
    input.addEventListener('input', () => {
        if (status === 'idle') {
            phases = createSchedule(getConfig());
            lastWorkPhaseIndex = findLastWorkIndex(phases);
            totalWorkoutSeconds = calculateTotalDuration(phases);
            updatePhaseList(phases);
            updateWorkoutSummaryText();
        }
    });
});

function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            navigator.wakeLock.request('screen')
                .then((lock) => {
                    wakeLock = lock;
                    console.log('Screen wake lock acquired');
                })
                .catch((err) => {
                    console.warn('Failed to acquire wake lock:', err);
                });
        }
    } catch (err) {
        console.warn('Wake Lock API not supported:', err);
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release()
            .then(() => {
                wakeLock = null;
                console.log('Screen wake lock released');
            })
            .catch((err) => {
                console.warn('Failed to release wake lock:', err);
            });
    }
}

function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
        if (status === 'running' && !wakeLock) {
            requestWakeLock();
        }
    }
}

function setupWakeLockListeners() {
    if ('wakeLock' in navigator) {
        document.addEventListener('visibilitychange', handleVisibilityChange);
    }
}

function cleanupWakeLock() {
    releaseWakeLock();
    if ('wakeLock' in navigator) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
}

resetSession();
setupWakeLockListeners();

window.addEventListener('beforeunload', cleanupWakeLock);
