(function (root) {
  'use strict';
  let days = 1, expanded = false, token = 0;
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const date = value => new Date(value).toLocaleDateString();
  function feedback(m) {
    if (!m.learned) return '还没有有效学习记录。完成一次作答，或标记学习状态，就从这里开始积累。';
    if (m.conquered) return `练了 ${m.learned} 题，攻克 ${m.conquered} 道旧错题。以前卡住的地方，这次走通了。`;
    if (m.firstPass) return `练了 ${m.learned} 题，${m.firstPass} 题独立一遍过。每一次认真作答，都留下了一点进步。`;
    return `练了 ${m.learned} 题，其中 ${m.newQuestions} 道新题、${m.reviewed} 道复习题。今天的积累已经记下了。`;
  }
  function details(data) {
    const a = data.achievements, m = data.metrics, max = Math.max(1, ...data.daily.map(d => d.count));
    const trend = data.daily.map(d => `<span class="study-bar-column" title="${d.day}：${d.count} 题"><span class="study-bar" style="height:${Math.max(2, d.count / max * 100)}%"></span></span>`).join('');
    const heat = data.daily.map(d => `<span class="study-heat level-${Math.min(4, Math.ceil(d.count / 5))}" title="${d.day}：${d.count} 题" aria-label="${d.day}：${d.count} 题"></span>`).join('');
    const chapters = data.chapters.map(c => `<li><div><strong>${esc(c.name)}</strong><span>${c.correct}/${c.sample} 首答正确 · ${Math.round(c.rate * 100)}%${c.sample < 5 ? ' · 样本不足5题' : c.weak ? ' · 值得多练' : ''}</span></div><meter min="0" max="1" value="${c.rate}" aria-label="${esc(c.name)} 首答正确率">${Math.round(c.rate * 100)}%</meter></li>`).join('');
    const milestones = (items, label) => items.map(b => `<span class="study-milestone ${b.reached ? 'reached' : ''}">${b.reached ? '✓ ' : ''}${label} ${b.target}</span>`).join('');
    return `<div class="study-report-details" id="study-report-details">
      <div class="study-detail-grid"><section><h3>每日学习轨迹</h3><div class="study-trend" role="img" aria-label="${data.start} 至 ${data.today} 每日题数">${trend}</div><p class="study-chart-caption">${data.start} — ${data.today} · 每日不同题数</p><div class="study-heatmap">${heat}</div><p class="study-chart-caption">颜色越深，学得越多；空白表示没有记录。</p></section>
      <section><h3>新题与复习</h3><div class="study-ratio" role="img" aria-label="新题 ${m.newQuestions}，复习 ${m.reviewed}"><span style="width:${m.learned ? m.newQuestions / m.learned * 100 : 0}%"></span></div><p>新题 ${m.newQuestions} · 复习 ${m.reviewed}</p><h3>收藏来源</h3><p>手动 ${data.favoriteSources.manual} · 自动 ${data.favoriteSources.automatic} · 两者都有 ${data.favoriteSources.both}</p><p class="text-helper">答错自动收藏也计入新增收藏，取消不抹掉历史。</p></section></div>
      <section><h3>章节表现</h3><p class="text-helper">只统计未提前看答案的可靠单选首次作答；不代表其他题型的掌握程度。至少 5 题且首答正确率低于 60% 时提示值得多练。</p>${chapters ? `<ul class="study-chapters">${chapters}</ul>` : '<p class="text-helper">还没有可比较的首次作答样本，先从一道题开始。</p>'}</section>
      <section><h3>积累与成就</h3><div class="study-personal-bests"><span>当前连续 <strong>${a.currentStreak}</strong> 天</span><span>最长连续 <strong>${a.longestStreak}</strong> 天</span><span>累计活跃 <strong>${a.activeDays}</strong> 天</span><span>单日最多 <strong>${a.bestDay}</strong> 题</span></div><p class="text-helper">成就按启用后不同题目累计，重复练习不会反复点亮。</p><div class="study-milestones">${milestones(a.newMilestones, '新题')}${milestones(a.conqueredMilestones, '攻克')}</div></section>
      <p class="text-helper">一遍过：首次学习时未看答案、首答正确的可靠单选。已有学习痕迹的旧题首次结果未知。统计从 ${esc(date(data.started_at))} 开始；之前的日期不补填历史。</p>
    </div>`;
  }
  async function refresh() {
    const host = document.getElementById('study-report');
    if (!host) return;
    const current = ++token;
    try {
      const data = await root.DaguanStudyActivity.summary(days);
      if (current !== token || !host.isConnected) return;
      const m = data.metrics;
      const metrics = [['学习题数', m.learned], ['新题', m.newQuestions], ['一遍过', m.firstPass], ['新增收藏', m.favorites], ['攻克错题', m.conquered]];
      const content = host.querySelector('.study-report-content');
      content.innerHTML = `<p class="study-feedback">${esc(feedback(m))}</p><div class="study-report-metrics">${metrics.map(([label, count]) => `<div><strong>${count}</strong><span>${label}</span></div>`).join('')}</div><p class="study-period-note">${data.start} — ${data.today} · 每天 04:00 开始 · ${root.DaguanStudyActivity.pendingCount() ? '有离线记录待同步，当前数字可能尚未包含' : '按不同题号统计'} · 自 ${esc(date(data.started_at))} 开始记录</p>${expanded ? details(data) : '<div id="study-report-details" hidden></div>'}`;
      host.querySelector('#study-details-toggle').setAttribute('aria-expanded', String(expanded));
      host.querySelector('#study-details-toggle').textContent = expanded ? '收起详情' : '展开详情';
    } catch (error) {
      if (current !== token || !host.isConnected) return;
      host.querySelector('.study-report-content').innerHTML = `<p class="text-helper" role="status">${esc(error.message)}。返回首页或联网后自动重试。</p>`;
    }
  }
  root.DaguanStudyReport = {
    mount(after) {
      if (!after) return;
      const host = document.createElement('section'); host.id = 'study-report'; host.className = 'card study-report';
      host.setAttribute('aria-labelledby', 'study-report-title');
      host.innerHTML = `<header class="study-report-header"><div><p class="guide-kicker">一点一滴，都算数</p><h2 id="study-report-title">学习战报</h2></div><div class="study-range-tabs" role="group" aria-label="学习统计范围">${[1, 3, 7, 30, 365].map(n => `<button type="button" data-study-days="${n}" aria-pressed="${days === n}">${n === 1 ? '今天' : '最近' + n + '天'}</button>`).join('')}</div></header><div class="study-report-content"><p class="text-helper">正在读取本机学习记录…</p></div><button type="button" class="btn btn-text" id="study-details-toggle" aria-expanded="${expanded}" aria-controls="study-report-details">${expanded ? '收起详情' : '展开详情'}</button>`;
      after.insertAdjacentElement('afterend', host);
      host.querySelectorAll('[data-study-days]').forEach(button => button.addEventListener('click', () => {
        days = Number(button.dataset.studyDays);
        host.querySelectorAll('[data-study-days]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        void refresh();
      }));
      host.querySelector('#study-details-toggle').addEventListener('click', () => { expanded = !expanded; void refresh(); });
      void refresh();
    }, refresh,
  };
  root.addEventListener('daguan:study-activity', () => { void refresh(); });
})(window);
