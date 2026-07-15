// Habits view (PRD-habit-ui): one-tap logging + GitHub-style coloring heatmaps.
// Storage stays markdown tables in the vault; this UI only appends rows via IPC.
'use strict';

const HEATMAP_WEEKS = 16;

// exercise = blue scale, study = green ("coloring") — 0..4 intensity levels
const SCALES = {
  exercise: ['rgba(122,162,247,0.10)', '#2c3f6e', '#3d5aa8', '#5a7fd6', '#7aa2f7'],
  study: ['rgba(158,206,106,0.10)', '#33502a', '#4a7539', '#6ba24f', '#9ece6a'],
};

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Monday of the week containing dateStr (local)
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  return addDays(dateStr, -dow);
}

function level(minutes) {
  if (!minutes) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}

const habitState = {
  exercise: { selectedType: null },
  study: { selectedType: null },
};

async function renderHabits() {
  await Promise.all([renderHabitSection('exercise'), renderHabitSection('study')]);
}

async function renderHabitSection(habit) {
  const root = document.getElementById('habit-' + habit);
  const today = localToday();
  const from = addDays(mondayOf(today), -(HEATMAP_WEEKS - 1) * 7);
  const data = await window.api.habitData(habit, from, today);

  // --- progress bar (this ISO week) ---
  const weekStart = mondayOf(today);
  let done = 0;
  for (let i = 0; i < 7; i++) {
    const rows = data.byDay[addDays(weekStart, i)] || [];
    if (habit === 'exercise') done += rows.length;
    else done += rows.reduce((s, r) => s + r.minutes, 0) / 60;
  }
  const target = data.targetThisWeek;
  const pct = Math.min(100, Math.round((done / target) * 100)) || 0;
  root.querySelector('.hp-fill').style.width = pct + '%';
  root.querySelector('.hp-fill').style.background = SCALES[habit][4];
  root.querySelector('.hp-label').textContent = habit === 'exercise'
    ? `이번 주 ${done}/${target}회`
    : `이번 주 ${Math.round(done * 10) / 10}/${target}시간`;

  // --- heatmap: columns = weeks, rows = Mon..Sun ---
  const grid = root.querySelector('.habit-heatmap');
  grid.innerHTML = '';
  const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
  for (let row = 0; row < 7; row++) {
    const tr = document.createElement('div');
    tr.className = 'hm-row';
    const lab = document.createElement('span');
    lab.className = 'hm-daylabel';
    lab.textContent = row % 2 === 0 ? dayNames[row] : '';
    tr.appendChild(lab);
    for (let col = 0; col < HEATMAP_WEEKS; col++) {
      const date = addDays(from, col * 7 + row);
      const cell = document.createElement('div');
      cell.className = 'hm-cell';
      if (date > today) {
        cell.classList.add('hm-future');
      } else {
        const rows = data.byDay[date] || [];
        const min = rows.reduce((s, r) => s + r.minutes, 0);
        cell.style.background = SCALES[habit][level(min)];
        if (date === today) cell.classList.add('hm-today');
        cell.title = rows.length
          ? `${date} · ${min}분\n` + rows.map((r) => `${r.type} ${r.minutes}분`).join('\n')
          : `${date} — 기록 없음 (클릭해서 기록)`;
        cell.onclick = () => {
          root.querySelector('.hf-date').value = date;
          root.querySelector('.hf-minutes').focus();
        };
      }
      tr.appendChild(cell);
    }
    grid.appendChild(tr);
  }

  // --- type/area chips ---
  const chipBox = root.querySelector('.hf-chips');
  chipBox.innerHTML = '';
  const options = habit === 'exercise' ? data.exerciseTypes : data.areas;
  const st = habitState[habit];
  if (!options.length && habit === 'study') {
    chipBox.innerHTML = '<span class="hf-hint">분야를 아래 입력칸에 적으면 다음부터 버튼으로 나와요</span>';
  }
  for (const t of options) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'habit-chip' + (st.selectedType === t ? ' sel' : '');
    chip.textContent = t;
    chip.onclick = () => {
      st.selectedType = st.selectedType === t ? null : t;
      if (habit === 'study') root.querySelector('.hf-area').value = st.selectedType || '';
      for (const c of chipBox.children) c.classList.toggle('sel', c.textContent === st.selectedType);
    };
    chipBox.appendChild(chip);
  }

  // --- form (bind once) ---
  const form = root.querySelector('.habit-form');
  const dateInput = root.querySelector('.hf-date');
  if (!dateInput.value) dateInput.value = today;
  dateInput.max = today;
  if (!form.dataset.bound) {
    form.dataset.bound = '1';
    form.onsubmit = async (e) => {
      e.preventDefault();
      const minutes = Number(root.querySelector('.hf-minutes').value);
      if (!minutes) return;
      const entry = { date: dateInput.value || localToday(), minutes };
      if (habit === 'exercise') {
        entry.type = habitState.exercise.selectedType || 'Other';
        entry.intensity = root.querySelector('.hf-intensity').value;
        entry.feel = root.querySelector('.hf-feel').value;
        entry.detail = root.querySelector('.hf-detail').value;
        entry.notes = '';
      } else {
        entry.area = root.querySelector('.hf-area').value.trim() || habitState.study.selectedType || 'General';
        entry.depth = root.querySelector('.hf-depth').value;
        entry.output = root.querySelector('.hf-output').checked;
        entry.what = root.querySelector('.hf-detail').value;
      }
      const res = await window.api.habitLog(habit, entry);
      if (!res.ok) { alert('기록 실패: ' + res.error); return; }
      root.querySelector('.hf-minutes').value = '';
      root.querySelector('.hf-detail').value = '';
      if (habit === 'study') root.querySelector('.hf-output').checked = false;
      await renderHabitSection(habit); // re-color immediately
    };
  }
}

window.renderHabits = renderHabits;
