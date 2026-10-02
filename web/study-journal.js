(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shift = (day, offset) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
  const label = day => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8))} 日`;
  const weekday = day => '日一二三四五六'[new Date(day + 'T12:00:00Z').getUTCDay()];

  root.DaguanStudyJournal = { create({ activity, openQuestion, locateQuestion, getQuestion, renderMarkdown, showHistory, showLibrary }) {
    let host, data, selected, end = '', tab = 'journal', token = 0, busy = false, signature = '';
    let groupsVisible = 20;
    const opened = new Set();
    const notice = message => { if (host?.isConnected) host.querySelector('.journal-status').textContent = message; };
    function tabSelect(next) {
      tab = next;
      for (const b of host.querySelectorAll('[data-journal-tab]')) {
        const active = b.dataset.journalTab === tab;
        b.setAttribute('aria-selected', String(active));
        host.querySelector('#' + b.getAttribute('aria-controls')).hidden = !active;
      }
    }
    function badgeMarkup(badge) {
      return `<article class="journal-badge ${badge.earnedOn ? 'earned' : 'locked'}"><div class="journal-seal" aria-hidden="true">${esc(badge.name.slice(0, 2))}<br>${esc(badge.name.slice(2))}</div><div><h3>${esc(badge.name)}</h3><p>${esc(badge.description)}</p>${badge.earnedOn ? `<p class="journal-earned">${esc(label(badge.earnedOn))}获得 · ${esc(badge.earnedOn.slice(0, 4))}</p>` : `<progress value="${Math.min(badge.value, badge.target)}" max="${badge.target}" aria-label="${esc(badge.name)}进度"></progress><p>已完成 ${badge.value} / ${badge.target}</p>`}</div></article>`;
    }
    function paint() {
      const day = data.daily.find(d => d.day === selected) || data.daily.at(-1);
      selected = day.day;
      host.querySelector('.journal-range-title').textContent = `${data.start.slice(0, 4)} 年 · ${label(data.start)} — ${label(data.end)}`;
      const picker = host.querySelector('[data-journal-date]');
      picker.value = selected; picker.max = data.today; picker.min = data.earliest;
      host.querySelector('[data-journal-prev]').disabled = data.start <= data.earliest;
      host.querySelector('[data-journal-next]').disabled = data.end >= data.today;
      host.querySelector('.journal-week').innerHTML = data.daily.map(d => `<button type="button" class="journal-day" data-journal-day="${d.day}" aria-pressed="${d.day === selected}" aria-label="${esc(label(d.day))}，${d.count} 道练习题"><span>周${weekday(d.day)}</span><strong>${Number(d.day.slice(8))}</strong><small>${d.count ? d.count + ' 题' : '—'}</small>${d.day === data.today ? '<span class="journal-today">今天</span>' : ''}</button>`).join('');
      host.querySelector('.journal-story-title').textContent = day.conquered ? '有些难题，第二次就走通了。' : day.count ? '这一天的积累，也算数。' : '留白的一天，也有下一页。';
      host.querySelector('.journal-story-copy').textContent = day.conquered ? `这天独立重做答对了 ${day.conquered} 道旧错题。` : day.count ? '每一道认真练习的题，都留下了痕迹。' : '这一天还没有有效练习记录。已获得的印章会一直保留。';
      host.querySelector('.journal-metrics').innerHTML = [['练习题目', day.count], ['新题', day.newQuestions], ['复习题', day.reviewed]].map(([name, count]) => `<div><strong>${count}</strong><span>${name}</span></div>`).join('');
      host.querySelector('.journal-day-heading').textContent = `${label(selected)}的足迹`;
      paintGroups(day);
      const earned = data.badges.filter(b => b.earnedOn).sort((a, b) => b.earnedOn.localeCompare(a.earnedOn));
      const next = data.badges.find(b => b.kind === 'new' && !b.earnedOn);
      host.querySelector('.journal-side').innerHTML = `<section><h3>最近获得</h3>${earned.length ? badgeMarkup(earned[0]) : '<p>完成第一次作答或标记学习状态，点亮「提笔出发」。</p>'}</section><section><h3>${next ? '离下一枚印章更近了' : '每一份积累，都已留下'}</h3>${next ? `<p>${esc(next.description)}</p><progress value="${Math.min(next.value, next.target)}" max="${next.target}" aria-label="${esc(next.name)}进度"></progress><p>${next.value} / ${next.target} · ${esc(next.name)}</p>` : '<p>新题印章已全部点亮，继续按自己的节奏学习。</p>'}<p class="journal-rhythm">这七天练习了 ${data.daily.filter(d => d.count).length} 天。<br>休息一天，积累也不会消失。</p></section>`;
      host.querySelector('.journal-badge-count').textContent = `已获得 ${earned.length} / ${data.badges.length} 枚`;
      host.querySelector('.journal-badges').innerHTML = data.badges.map(badgeMarkup).join('');
      host.querySelector('.journal-personal').textContent = `累计练习 ${data.achievements.activeDays} 天 · 最长连续 ${data.achievements.longestStreak} 天 · 单日最多 ${data.achievements.bestDay} 道不同题目`;
      host.querySelector('.journal-footnote').textContent = `每天 04:00 开始一个学习日（${data.timeZone}）。有效练习包含作答与学习状态标记，按当天不同题号统计；片段间可能包含同一道题。统计自 ${data.started_at.slice(0, 10)} 开始，旧进度不补填历史。正确性印章仅使用可判定、未参考答案的作答。`;
      tabSelect(tab);
    }
    function paintGroups(day) {
      const container = host.querySelector('.journal-logs');
      const time = at => new Date(at).toLocaleTimeString('zh-CN', { timeZone: data.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      container.innerHTML = day.groups.slice(0, groupsVisible).map((group, index) => `<details class="journal-log" data-journal-group="${index}"${opened.has(`${day.day}:${index}`) ? ' open' : ''}><summary><time datetime="${esc(group.at)}">${esc(time(group.at))}</time><span>${esc(group.chapter_name || '未分类练习')}</span><small>${group.questions.length} 题</small></summary><div class="journal-questions"></div></details>`).join('');
      if (!day.groups.length) {
        container.innerHTML = '<div class="journal-empty"><p>完成一次作答，或标记一道题的学习状态，足迹就会出现在这里。</p><button type="button" class="btn btn-primary" data-journal-library>去题库刷题</button></div>';
      }
      if (day.groups.length > groupsVisible) container.insertAdjacentHTML('beforeend', '<button class="btn btn-secondary" type="button" data-journal-more>查看更多练习片段</button>');
      for (const detail of container.querySelectorAll('details')) {
        const index = Number(detail.dataset.journalGroup), key = `${day.day}:${index}`;
        const fill = () => {
          if (detail.open) { opened.add(key); if (!detail.querySelector('.journal-questions').childElementCount) questionRows(detail.querySelector('.journal-questions'), day.groups[index], 0); }
          else opened.delete(key);
        };
        detail.addEventListener('toggle', fill);
        if (detail.open) fill();
      }
    }
    function questionRows(container, group, start) {
      for (const q of group.questions.slice(start, start + 30)) {
        const location = locateQuestion(q.question_id, group.chapter_id);
        const row = document.createElement('article'); row.className = 'journal-question';
        row.innerHTML = `<div class="journal-question-heading"><strong>题号 ${esc(q.question_id)}</strong><span>${q.isNew ? '新题' : '复习'} · ${esc(q.result)}${q.conquered ? ' · 重做答对' : ''}</span></div><details class="journal-preview"><summary>查看题干</summary><div class="journal-stem text-helper">正在读取题干…</div></details><button type="button" class="btn btn-text btn-sm"${location ? '' : ' disabled'}>${location ? '回到这题' : '当前题库未收录'}</button>`;
        row.querySelector('button').addEventListener('click', async event => {
          const button = event.currentTarget; button.disabled = true;
          try { await openQuestion(q.question_id, group.chapter_id); } catch { notice('暂时无法打开这道题，请稍后重试'); }
          finally { if (button.isConnected) button.disabled = !location; }
        });
        let loaded = false;
        row.querySelector('.journal-preview').addEventListener('toggle', async event => {
          if (!event.currentTarget.open || loaded) return;
          loaded = true;
          const target = row.querySelector('.journal-stem');
          try {
            const question = await getQuestion(q.question_id);
            if (!target.isConnected) return;
            if (question) { target.classList.remove('text-helper'); target.innerHTML = renderMarkdown(question.stem || question.question || '暂无题干'); }
            else { target.textContent = '暂时无法读取题干，收起后展开可重试。'; loaded = false; }
          } catch { target.textContent = '题干读取失败，收起后展开可重试。'; loaded = false; }
        });
        container.append(row);
      }
      if (group.questions.length > start + 30) {
        const more = document.createElement('button'); more.className = 'btn btn-text'; more.type = 'button'; more.textContent = '显示更多题目';
        more.addEventListener('click', () => { more.remove(); questionRows(container, group, start + 30); }); container.append(more);
      }
    }
    async function refresh(requestedEnd = end, force = false, requestedDay) {
      if (!host?.isConnected || (busy && !force)) return;
      const current = ++token, target = host;
      busy = true; target.setAttribute('aria-busy', 'true'); notice('正在读取学习记录…');
      try {
        const result = await activity.journal(requestedEnd);
        if (current !== token || target !== host || !target.isConnected) return;
        const changed = signature !== JSON.stringify(result);
        if (requestedDay !== undefined) selected = requestedDay;
        if (!requestedEnd && selected === data?.today) selected = result.today;
        end = requestedEnd;
        data = result; signature = JSON.stringify(result);
        if (!data.daily.some(d => d.day === selected)) { selected = data.end; groupsVisible = 20; }
        if (changed || force) paint();
        notice(activity.pendingCount() ? '有离线练习待同步，当前统计可能尚未包含；记录仍保存在本机。' : '');
      } catch (error) {
        if (current === token && target === host && target.isConnected) {
          notice(`${error.message || '学习记录读取失败'}。${data ? '已保留上次显示的记录。' : ''}可点「刷新」重试。`);
          if (!data) host.querySelector('.journal-story-copy').textContent = '记录暂时无法读取，恢复连接后可刷新重试。';
        }
      } finally {
        if (current === token) { busy = false; if (target.isConnected) target.setAttribute('aria-busy', 'false'); }
      }
    }
    function mount(main) {
      if (host?.isConnected && main.contains(host)) { void refresh(); return; }
      token++; busy = false; signature = '';
      main.innerHTML = `<div class="home-content study-journal"><header class="journal-heading"><div><h1 class="text-page-title">学习记录</h1><p class="text-meta">一点一滴，写成自己的学习手账。</p></div><button class="btn btn-secondary" type="button" data-journal-history>浏览记录</button></header><div class="journal-tabs" role="tablist" aria-label="学习记录视图"><button type="button" id="journal-tab" role="tab" aria-selected="true" aria-controls="journal-panel" data-journal-tab="journal">我的学习手账</button><button type="button" id="badges-tab" role="tab" aria-selected="false" aria-controls="badges-panel" data-journal-tab="badges">成长印章</button></div><div class="journal-status-row"><p class="journal-status text-helper" role="status"></p><button type="button" class="btn btn-text btn-sm" data-journal-refresh>刷新</button></div><section id="journal-panel" role="tabpanel" aria-labelledby="journal-tab"><div class="journal-range"><h2 class="journal-range-title">最近七天</h2><div class="journal-range-actions"><button type="button" class="btn btn-secondary btn-sm" data-journal-prev disabled aria-label="前七天">上一周</button><button type="button" class="btn btn-secondary btn-sm" data-journal-today>最近七天</button><button type="button" class="btn btn-secondary btn-sm" data-journal-next disabled aria-label="后七天">下一周</button><label>跳至日期<input type="date" data-journal-date></label></div></div><div class="journal-week" aria-label="选择学习日"></div><div class="journal-layout"><section><div class="journal-story"><h2 class="journal-story-title">每一次练习，都值得记下。</h2><p class="journal-story-copy">正在读取学习足迹…</p></div><div class="journal-metrics" aria-label="所选日期的学习量"></div><h2 class="journal-day-heading">每日足迹</h2><div class="journal-logs"></div></section><aside class="journal-side" aria-label="成长进度"></aside></div></section><section id="badges-panel" role="tabpanel" aria-labelledby="badges-tab" hidden><div class="journal-badges-heading"><h2>每一枚印章，都有一段经历</h2><span class="journal-badge-count text-meta"></span></div><p class="journal-personal text-meta"></p><div class="journal-badges"></div></section><p class="journal-footnote text-helper"></p></div>`;
      host = main.querySelector('.study-journal');
      host.addEventListener('click', event => {
        const button = event.target.closest('button'); if (!button) return;
        if (button.hasAttribute('data-journal-tab')) tabSelect(button.dataset.journalTab);
        if (button.hasAttribute('data-journal-day')) { selected = button.dataset.journalDay; groupsVisible = 20; paint(); host.querySelector(`[data-journal-day="${selected}"]`)?.focus(); }
        if (button.hasAttribute('data-journal-prev') && data) void refresh(shift(data.end, -7), true);
        if (button.hasAttribute('data-journal-next') && data) void refresh(shift(data.end, 7) >= data.today ? '' : shift(data.end, 7), true);
        if (button.hasAttribute('data-journal-today')) void refresh('', true, null);
        if (button.hasAttribute('data-journal-refresh')) void refresh(end, true);
        if (button.hasAttribute('data-journal-history')) void showHistory();
        if (button.hasAttribute('data-journal-library')) void showLibrary();
        if (button.hasAttribute('data-journal-more')) { groupsVisible += 20; paintGroups(data.daily.find(d => d.day === selected)); }
      });
      host.querySelector('[data-journal-date]').addEventListener('change', event => {
        const input = event.target;
        if (!input.value || !input.checkValidity()) return;
        void refresh(input.value, true, input.value);
      });
      host.querySelector('.journal-tabs').addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); tabSelect(event.key === 'Home' ? 'journal' : event.key === 'End' ? 'badges' : tab === 'journal' ? 'badges' : 'journal');
        host.querySelector(`[data-journal-tab="${tab}"]`).focus();
      });
      if (data) paint(); else tabSelect(tab);
      void refresh(end, true);
    }
    root.addEventListener('daguan:study-activity', () => { void refresh(); });
    return { mount, refresh };
  } };
})(window);
