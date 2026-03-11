const STORAGE_KEY = 'tabata-settings';
const DEFAULTS = { warmup: 30, work: 20, rest: 10, intervals: 8, soundOn: true };

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
const navActions = document.getElementById('navActions');
const prevBtn = document.getElementById('prevBtn');
const skipBtn = document.getElementById('skipBtn');
const MAX_VISIBLE_PHASES = 5;

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
        saveSettings();
        if (soundOn) {
            sound.prime();
        }
    });
}

function toSeconds(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function isValidNumber(val, min = 0, max = Infinity) {
    return typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max;
}

function saveSettings() {
    const settings = {
        warmup: toSeconds(fields.warmup.value),
        work: toSeconds(fields.work.value),
        rest: toSeconds(fields.rest.value),
        intervals: toSeconds(fields.intervals.value),
        soundOn: soundOn,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        // localStorage might be full or disabled — silently ignore
    }
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);

        fields.warmup.value = isValidNumber(saved.warmup, 0) ? saved.warmup : DEFAULTS.warmup;
        fields.work.value = isValidNumber(saved.work, 1) ? saved.work : DEFAULTS.work;
        fields.rest.value = isValidNumber(saved.rest, 0) ? saved.rest : DEFAULTS.rest;
        fields.intervals.value = isValidNumber(saved.intervals, 1, 20) ? saved.intervals : DEFAULTS.intervals;

        if (typeof saved.soundOn === 'boolean') {
            soundOn = saved.soundOn;
            sound.setEnabled(soundOn);
            updateSoundButton(soundOn);
        }
    } catch (e) {
        // Corrupted data — ignore, use HTML defaults
    }
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

function isSessionActive() {
    return status === 'running' || status === 'paused';
}

function renderPhaseListMessage(title, description) {
    phaseList.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'phase-item phase-item--empty';

    const strong = document.createElement('strong');
    strong.textContent = title;

    const span = document.createElement('span');
    span.textContent = description;

    li.append(strong, span);
    phaseList.appendChild(li);
}

function updatePhaseList(list = phases, highlightIndex = -1) {
    if (!list.length) {
        if (sessionCompleted) {
            renderPhaseListMessage('Workout complete', 'Reset or start again.');
        } else {
            renderPhaseListMessage('Waiting', 'Press start to build the flow.');
        }
        return;
    }

    phaseList.innerHTML = '';

    const activeIndex = isSessionActive() && highlightIndex >= 0 && highlightIndex < list.length
        ? highlightIndex
        : -1;
    const startIndex = activeIndex === -1 ? 0 : activeIndex;
    const visiblePhases = list.slice(startIndex, startIndex + MAX_VISIBLE_PHASES);

    visiblePhases.forEach((phase, idx) => {
        const phaseIndex = startIndex + idx;
        const isActivePhase = phaseIndex === activeIndex;
        const li = document.createElement('li');
        li.className = 'phase-item';
        if (isActivePhase) {
            li.classList.add('is-active');
            li.setAttribute('aria-current', 'step');
        }

        const strong = document.createElement('strong');
        strong.textContent = phase.label;

        const span = document.createElement('span');
        span.textContent = `${phase.seconds} s`;

        li.append(strong, span);
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

    // Calculate current work and rest interval numbers (1-based)
    // Count how many work/rest phases exist up to and including the current phase
    let currentWorkNumber = 0;
    let currentRestNumber = 0;
    for (let i = 0; i <= currentPhaseIndex; i++) {
        if (phases[i].key === 'work') {
            currentWorkNumber++;
        } else if (phases[i].key === 'rest') {
            currentRestNumber++;
        }
    }

    const totalWork = phases.filter(p => p.key === 'work').length;
    const totalRest = phases.filter(p => p.key === 'rest').length;

    // Display "Warm Up" during warm-up phase, otherwise show work/rest counters
    if (phase.key === 'warmup') {
        workPhase.textContent = 'Warm Up';
        phaseSeparator.textContent = '';
        restPhase.textContent = '';
    } else {
        workPhase.textContent = `Work ${currentWorkNumber}/${totalWork}`;
        phaseSeparator.textContent = ' - ';
        restPhase.textContent = `Rest ${currentRestNumber}/${totalRest}`;
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

function updateNavButtons() {
    const active = status === 'running' || status === 'paused';
    navActions.classList.toggle('visible', active);
    prevBtn.disabled = !active || currentPhaseIndex === 0;
    skipBtn.disabled = !active || currentPhaseIndex >= phases.length - 1;
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
    updateNavButtons();
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
    updateNavButtons();
    updateWorkoutSummaryText();
    updatePhaseList([]);
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
    updateNavButtons();
    updateWorkoutSummaryText();
}

function navigatePhase(targetIndex) {
    if (targetIndex < 0 || targetIndex >= phases.length) return;

    const skippedPhase = phases[currentPhaseIndex];
    clearTimer();

    if (targetIndex > currentPhaseIndex && skippedPhase) {
        if (skippedPhase.key === 'work') completedWorkSegments++;
        else if (skippedPhase.key === 'rest') completedRestSegments++;
    }

    if (targetIndex < currentPhaseIndex) {
        const prevPhase = phases[targetIndex];
        if (prevPhase) {
            if (prevPhase.key === 'work' && completedWorkSegments > 0) completedWorkSegments--;
            else if (prevPhase.key === 'rest' && completedRestSegments > 0) completedRestSegments--;
        }
    }

    currentPhaseIndex = targetIndex;
    remainingSeconds = phases[targetIndex].seconds;
    sound.intervalStart();
    updateTimerDisplay();
    updateNavButtons();

    if (status === 'running') {
        startTicking();
    }
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

prevBtn.addEventListener('click', () => {
    navigatePhase(currentPhaseIndex - 1);
});

skipBtn.addEventListener('click', () => {
    navigatePhase(currentPhaseIndex + 1);
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
        saveSettings();
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

loadSettings();
resetSession();
setupWakeLockListeners();

window.addEventListener('beforeunload', cleanupWakeLock);
