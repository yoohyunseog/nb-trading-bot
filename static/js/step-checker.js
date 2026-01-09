// Step Checker Module

(function() {
  const TOTAL = 10;
  const stepsEl = document.getElementById('steps');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const nextBtn = document.getElementById('nextBtn');
  const prevBtn = document.getElementById('prevBtn');
  const speedRange = document.getElementById('speedRange');
  const speedLabel = document.getElementById('speedLabel');
  const loopToggle = document.getElementById('loopToggle');
  const status = document.getElementById('status');

  let current = 0; // 0 = none selected, 1..TOTAL are steps
  let intervalId = null;
  let running = false;

  // 생성
  for (let i = 1; i <= TOTAL; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'step';
    wrapper.id = 'step-' + i;
    wrapper.innerHTML = `<input type="checkbox" id="cb-${i}" aria-label="단계 ${i} 체크"><label for="cb-${i}">Step ${i}</label>`;
    stepsEl.appendChild(wrapper);
  }

  function updateUI() {
    for (let i = 1; i <= TOTAL; i++) {
      const el = document.getElementById('step-' + i);
      const cb = document.getElementById('cb-' + i);
      el.classList.toggle('current', i === current);
      // 체크박스 checked 상태는 실제 체크 여부를 그대로 사용
      // current 기준으로 시각 강조만 함
    }
    status.textContent = `현재: ${current} / ${TOTAL}`;
    speedLabel.textContent = speedRange.value + 'ms';
  }

  function stepTo(n, { check = true } = {}) {
    if (n < 1 || n > TOTAL) {
      return;
    }
    current = n;
    if (check) {
      // 체크하고 시각 표시
      const cb = document.getElementById('cb-' + n);
      cb.checked = true;
    }
    updateUI();
  }

  function stepNext() {
    if (current >= TOTAL) {
      if (loopToggle.checked) {
        current = 0; // will become 1 below
      } else {
        stop();
        return;
      }
    }
    stepTo(current + 1, { check: true });
  }

  function stepPrev() {
    if (current <= 1) {
      // do nothing or wrap if loop
      if (loopToggle.checked) {
        current = TOTAL + 1; // will become TOTAL below
      } else {
        stepTo(0, { check: false });
        return;
      }
    }
    const target = current - 1;
    if (target >= 1) {
      stepTo(target, { check: true });
    } else {
      // uncheck all if moving to 0
      resetChecks();
      current = 0;
      updateUI();
    }
  }

  function start() {
    if (running) return;
    running = true;
    intervalId = setInterval(stepNext, Number(speedRange.value));
    updateUI();
  }

  function stop() {
    running = false;
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    updateUI();
  }

  function resetChecks() {
    for (let i = 1; i <= TOTAL; i++) {
      document.getElementById('cb-' + i).checked = false;
    }
    current = 0;
    updateUI();
  }

  // 이벤트 핸들러
  startBtn.addEventListener('click', () => {
    // If nothing selected, start from 1
    if (current === 0) current = 1;
    // ensure current is checked
    document.getElementById('cb-' + current).checked = true;
    start();
  });
  pauseBtn.addEventListener('click', () => {
    stop();
  });
  resetBtn.addEventListener('click', () => {
    stop();
    resetChecks();
  });
  nextBtn.addEventListener('click', () => {
    stop();
    stepNext();
  });
  prevBtn.addEventListener('click', () => {
    stop();
    stepPrev();
  });

  speedRange.addEventListener('input', () => {
    speedLabel.textContent = speedRange.value + 'ms';
    if (running) {
      // 재시작하여 새로운 속도 적용
      stop();
      start();
    }
  });

  // 키보드 단축 (Space: 토글, ←/→)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (running) stop();
      else start();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      stop();
      stepNext();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      stop();
      stepPrev();
    }
  });

  // 초기 UI 렌더
  updateUI();

  // 접근성 향상: 각 체크박스 클릭 시 현재 인덱스 업데이트
  for (let i = 1; i <= TOTAL; i++) {
    document.getElementById('cb-' + i).addEventListener('change', (ev) => {
      if (ev.target.checked) current = i;
      updateUI();
    });
  }

  // 페이지 숨김/표시에 따른 자동 일시정지 (visibility API)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) {
      // 자동으로 일시정지 (원하면 주석 제거하여 계속 실행 가능)
      stop();
    }
  });
})();
