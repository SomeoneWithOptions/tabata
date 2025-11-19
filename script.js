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
      const timeDisplay = document.getElementById('timeDisplay');
      const progressBar = document.getElementById('progressBar');
      const statusText = document.getElementById('statusText');
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
          work: Math.max(5, toSeconds(fields.work.value)),
          rest: toSeconds(fields.rest.value),
          intervals: Math.max(1, Math.min(20, toSeconds(fields.intervals.value))),
        };
      }

      function createSchedule(config) {
        const sequence = [];
        if (config.warmup > 0) {
          sequence.push({ key: 'warmup', label: 'Warm-up', seconds: config.warmup });
        }
        for (let i = 1; i <= config.intervals; i += 1) {
          sequence.push({ key: 'work', label: `Work #${i}`, seconds: config.work });
          const needsRest = i !== config.intervals && config.rest > 0;
          if (needsRest) {
            sequence.push({ key: 'rest', label: 'Rest', seconds: config.rest });
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

      function setStatusText(text) {
        statusText.textContent = text;
      }

      function handleCountdownAlerts() {
        if (remainingSeconds >= 0 && remainingSeconds <= 2) {
          sound.countdown(remainingSeconds);
        }
      }

      function updateTimerDisplay() {
        if (!phases[currentPhaseIndex]) return;
        const phase = phases[currentPhaseIndex];
        phaseLabel.textContent = phase.label;
        timeDisplay.textContent = formatTime(remainingSeconds);
        const percent = phase.seconds === 0 ? 100 : ((phase.seconds - remainingSeconds) / phase.seconds) * 100;
        progressBar.style.width = `${Math.min(Math.max(percent, 0), 100)}%`;
        updatePhaseList(phases, currentPhaseIndex);
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
        pauseBtn.disabled = true;
        resetBtn.disabled = false;
        pauseBtn.textContent = 'Pause';
        phaseLabel.textContent = 'Completed';
        timeDisplay.textContent = '00:00';
        progressBar.style.width = '100%';
        setStatusText('Nice! Session completed. Hit start for another round.');
      }

      function startSession() {
        const config = getConfig();
        phases = createSchedule(config);
        lastWorkPhaseIndex = findLastWorkIndex(phases);
        resetCompletionCueState();
        if (!phases.length) {
          setStatusText('Please set at least one active block.');
          return;
        }
        status = 'running';
        pauseBtn.disabled = false;
        resetBtn.disabled = false;
        pauseBtn.textContent = 'Pause';
        startBtn.textContent = 'Restart Session';
        updatePhaseList(phases, 0);
        setStatusText('In session — keep breathing!');
        beginPhase(0);
      }

      function pauseSession() {
        if (status !== 'running') return;
        status = 'paused';
        clearTimer();
        pauseBtn.textContent = 'Resume';
        setStatusText('Paused — tap resume when you are ready.');
      }

      function resumeSession() {
        if (status !== 'paused') return;
        status = 'running';
        pauseBtn.textContent = 'Pause';
        setStatusText('Back at it!');
        sound.prime();
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
        phaseLabel.textContent = 'Ready';
        timeDisplay.textContent = '00:00';
        progressBar.style.width = '0%';
        startBtn.textContent = 'Start Session';
        pauseBtn.textContent = 'Pause';
        pauseBtn.disabled = true;
        resetBtn.disabled = true;
        setStatusText('Configure your flow and press start.');
        updatePhaseList(phases);
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
            updatePhaseList(phases);
          }
        });
      });

      resetSession();
