(function(root) {
"use strict";
root.DaguanNewAI = { create({ window, document, fetch, location, AppState, StorageService, assetUrl, escapeHtml, renderMarkdown, toast, getAccess, getRenderer, getApp }) {
const AI_COMPOSE_PROMPTS = {
    brief: '请简短回答：先用一句话给出核心结论，再用 2～4 句话说明最关键的一步是怎么来的。只保留考研解题真正需要的内容，不展开完整推导、不重复题干；公式只留最关键的一个，较长公式单独成行。最后可以用一句话点出这道题在考研里属于哪类常考题型。',
    detailed: '请详细回答这道题，按考研复习的标准展开：## 答案、## 考研视角、## 详细推导、## 得分点与易错点。其中「考研视角」要说明这道题在考研大纲里对应什么知识点、要求到什么层次（了解／理解／掌握）、属于哪类常考题型、卷面上是选择/填空还是解答题以及大致分值。「详细推导」中每一步都要说明本步目标、知识点及其具体定义或公式、适用条件、从题干或前一步哪条信息想到该方法、推导过程与结果。清楚区分题干直接信息、前一步推出的结论和官方解析提供的信息，不能把题干没有给出的信息说成已知。数学公式使用 LaTeX，较长公式单独成行。',
    full: '请从考研复习的角度给出这道题的完整解答，按以下 Markdown 标题组织：## 答案、## 简短思路、## 详细推导、## 方法与易错点。先明确给出答案，再用简短段落说明解题路线，随后保留详细教学过程。每个关键步骤都应说明本步目标、知识点及其具体定义或公式、适用条件、从哪些题干或前一步信息想到该方法、推导过程与结果；把这些依据自然融入步骤，不机械重复七项标签，不把关键推理合并成一句话。清楚区分题干直接信息、前一步推出的结论和官方解析提供的信息，不能将题干没有给出的信息说成已知。最后总结识别这类题的信息、通用方法和必要的易错提醒，避免重复前文。选择题逐项解释关键判断理由。数学公式使用 LaTeX，较长公式单独成行。',
    hint: '先不要直接跳到结论，给我一个解题提示。',
    pitfall: '请指出这道题最容易犯的错误。'
};

class AIService {
    // SSE 跨块解析：不完整的行保留到下一块；返回 {events, rest}
    static parseSseChunk(buffer, text) {
        let working = String(buffer || '') + String(text || '');
        const events = [];
        const rows = working.split(/\r?\n/);
        const rest = rows.pop() || '';
        for (const row of rows) {
            if (!row.startsWith('data:')) continue;
            const data = row.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try { events.push(JSON.parse(data)); } catch { /* 忽略 keep-alive 碎片 */ }
        }
        return { events, rest };
    }

    static async loadProfiles() {
        try {
            const response = await fetch('./api/ai/profiles', { cache: 'no-store' });
            const data = await response.json();
            AppState.aiProfiles = Array.isArray(data.profiles) ? data.profiles : [];
        } catch {
            AppState.aiProfiles = [];
        }
        const preferred = StorageService.getAIPreferences().profileId;
        AppState.aiProfileId = AppState.aiProfiles.find(item => item.id === preferred)?.id
            || AppState.aiProfiles.find(item => item.active)?.id
            || AppState.aiProfiles[0]?.id
            || '';
        return AppState.aiProfiles;
    }

    static activeProfile() {
        return AppState.aiProfiles?.find(item => item.id === AppState.aiProfileId) || null;
    }

    static selectProfile(profileId) {
        AppState.aiProfileId = profileId || '';
        StorageService.saveAIPreference('profileId', AppState.aiProfileId);
    }

    // 服务端固定 system 指令负责数学教学约束；客户端只送 prompt + 题目载荷。
    static async chatStream({ question, prompt, includePrivate = false, images = [], signal }) {
        if (!AppState.aiProfileId) throw new Error('请先在设置中选择或配置 AI 服务');
        const response = await fetch('./api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                profileId: AppState.aiProfileId,
                question: this.questionPayload(question),
                prompt: String(prompt || ''),
                includePrivate: includePrivate === true,
                images: Array.isArray(images) ? images : [],
            }),
            signal,
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `AI 请求失败（HTTP ${response.status}）`);
        }
        return response;
    }

    static async stopRun(runId) {
        if (!runId) return;
        await fetch(`./api/ai/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' }).catch(() => {});
    }

    static questionPayload(q) {
        const progress = StorageService.getProgress().progress[String(q?.id)] || {};
        const annotation = StorageService.getAnnotation(q?.id).content || '';
        return {
            id: q?.id,
            category_path: q?.category_path || getRenderer().chapterLabel?.(q) || '',
            source: q?.source || '',
            type: q?.type || '',
            stem: q?.stem || q?.question || '',
            options: q?.options || [],
            answer: q?.answer || '',
            explanation: q?.explanation || '',
            userAnswer: AppState.answers?.[String(q?.id)] ? [...AppState.answers[String(q?.id)]].join(', ') : '',
            annotation,
            mastery: progress.mastery || 'not_started',
            errorProne: progress.error_prone === true,
            favorite: StorageService.isFavorite(q?.id),
        };
    }

    // 视觉档案才附带题目图片（≤4 张、每张 ≤2MB，dataURL）
    static async questionImages(q) {
        if (!q) return [];
        const source = `${q.stem || q.question || ''}\n${(q.options || []).map(o => o.content_md || '').join('\n')}\n${q.answer || ''}\n${q.explanation || ''}`;
        const refs = [...source.matchAll(/!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/gi)].map(m => m[1] || m[2]).filter(Boolean).slice(0, 4);
        const out = [];
        for (const ref of refs) {
            try {
                const response = await fetch(new URL(assetUrl(ref), location.href));
                if (!response.ok) continue;
                const blob = await response.blob();
                if (blob.size > 2 * 1024 * 1024) continue;
                const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => resolve(''); reader.readAsDataURL(blob); });
                if (data) out.push(data);
            } catch {}
        }
        return out;
    }

    // 按题隔离的聊天历史（保存在本地中控台，按 profile+question 分键）
    static async loadHistory(question) {
        if (!question || !AppState.aiProfileId) return [];
        try {
            const response = await fetch(`./api/ai/conversations/${encodeURIComponent(AppState.aiProfileId)}/${encodeURIComponent(String(question.id))}`, { cache: 'no-store' });
            if (!response.ok) return [];
            const data = await response.json();
            return Array.isArray(data.messages) ? data.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant')) : [];
        } catch { return []; }
    }
}


class AIViews {
    static captureAIPanel() {
        const panel = document.getElementById('ai-panel');
        return { panel, scrollTop: panel?.querySelector?.('#ai-messages')?.scrollTop || 0 };
    }

    static restoreAIPanel(snapshot, question) {
        const panel = snapshot.panel;
        if (!panel?.dataset?.questionId || panel.dataset.questionId !== String(question?.id)) return false;
        const placeholder = document.getElementById('ai-panel');
        if (!placeholder || placeholder === panel) return false;
        placeholder.replaceWith(panel);
        panel.classList.toggle('closed', !AppState.ui.aiPanelOpen);
        panel.querySelector('#ai-messages').scrollTop = snapshot.scrollTop;
        window.DaguanAIPanelLayout?.update();
        return true;
    }

    static renderAIPanel() {
        const panel = document.getElementById('ai-panel');
        if (!panel) return;
        if (AppState.ui.aiPanelOpen) panel.classList.remove('closed');

        const question = AppState.questions[AppState.currentQuestionIndex];
        panel.dataset.questionId = String(question?.id || '');
        const draft = question ? StorageService.getAIDraft(question.id) : '';
        const profiles = AppState.aiProfiles || [];
        const profileOptions = profiles.length
            ? profiles.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === AppState.aiProfileId ? 'selected' : ''}>${escapeHtml(item.name)}${item.model ? ` · ${escapeHtml(item.model)}` : ''}</option>`).join('')
            : '<option value="">未配置 AI</option>';

        panel.innerHTML = `
            <div class="ai-panel-resize" role="separator" tabindex="0" aria-label="调整 AI 面板宽度" aria-orientation="vertical"></div>
            <div class="ai-header">
                <h3>AI 辅助</h3>
                <div class="ai-header-actions">
                <button type="button" class="btn btn-text btn-sm" id="ai-expand-btn" aria-pressed="false">展开</button>
                <button type="button" class="btn btn-text btn-sm" id="ai-settings-btn" aria-expanded="false" aria-controls="ai-panel-settings">设置</button>
                <button class="btn btn-icon btn-text" onclick="App.toggleAI()" aria-label="关闭 AI 面板">
                    <svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
                </div>
            </div>
            <div class="ai-panel-settings" id="ai-panel-settings" hidden role="region" aria-label="AI 设置">
            <div class="ai-profile-row">
                <label for="ai-profile-select-new">服务</label>
                <select data-ai-service-control="true" id="ai-profile-select-new" onchange="App.selectAIProfile(this.value)">${profileOptions}</select>
                <button type="button" class="btn btn-text btn-sm" onclick="App.navigate('settings')">设置</button>
            </div>

            <label class="ai-streaming-control"><input type="checkbox" id="ai-streaming-new"> 流式回答</label>
            <label class="ai-privacy-check"><input type="checkbox" id="ai-include-private-new"> 包含我的批注与学习状态</label>
            </div>
            <p class="ai-private-status" id="ai-private-status" hidden>已包含批注与学习状态</p>
            <div class="ai-quick-prompts">
                <button class="quick-prompt-btn" onclick="App.sendAIPrompt(AI_COMPOSE_PROMPTS.brief)">简短回答</button>
                <button class="quick-prompt-btn" onclick="App.sendAIPrompt(AI_COMPOSE_PROMPTS.detailed)">详细回答</button>
                <button class="quick-prompt-btn" onclick="App.sendAIPrompt(AI_COMPOSE_PROMPTS.full)">完整解答</button>
                <button class="quick-prompt-btn" onclick="App.sendAIPrompt(AI_COMPOSE_PROMPTS.hint)">给我提示</button>
                <button class="quick-prompt-btn" onclick="App.sendAIPrompt(AI_COMPOSE_PROMPTS.pitfall)">易错点</button>
                <p class="ai-quick-hint">回答里的每一段都能点：点一下就能追问「这个是怎么来的 / 什么意思 / 什么知识点 / 你有什么想法」。</p>
            </div>

            <nav class="ai-section-nav" id="ai-section-nav" aria-label="回答段落跳转" hidden></nav>
            <div class="ai-messages" id="ai-messages"><div class="ai-empty"><strong>先问一个问题</strong><p>题目上下文已经准备好，选择上方提示或直接输入你的疑问。</p></div></div>
            <div class="ai-reading-actions"><button type="button" class="btn btn-secondary btn-sm" id="ai-latest-btn" hidden>回到最新内容</button></div>

            <div class="ai-input-area">
                <div class="ai-input-wrapper">
                    <textarea class="ai-input" id="ai-input"
                        placeholder="输入你的问题..."
                        rows="1">${escapeHtml(draft)}</textarea>
                    <div class="ai-input-actions">
                        <span class="ai-input-buttons">
                            <button type="button" class="btn btn-secondary btn-sm" id="ai-stop-btn" hidden onclick="App.stopAIStream()">停止</button>
                            <button class="btn btn-primary ai-send-btn" id="ai-send-btn" onclick="App.sendAIMessage()">发送</button>
                        </span>
                    </div>
                </div>
            </div>
        `;

        window.DaguanAIReading?.bind(panel);
        window.DaguanAIPanelLayout?.bind(panel);
        window.DaguanAISettings?.bindStreaming(document.getElementById('ai-streaming-new'), {
            profile: () => AIService.activeProfile(), busy: () => AppState.aiBusy,
            allowed: () => getAccess().privateAllowed(), error: message => toast(message),
            changed: profile => { Object.assign(AIService.activeProfile() || {}, profile); },
        });
        document.getElementById('ai-profile-select-new').disabled = AppState.aiBusy;
        const input = document.getElementById('ai-input');
        if (input) {
            input.addEventListener('input', () => {
                if (question) StorageService.saveAIDraft(question.id, input.value);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); getApp().sendAIMessage(); }
            });
        }
        getApp().aiBusyUi(AppState.aiBusy);
        if (question) this.renderAIHistory(question);
    }

    static async renderAIHistory(question) {
        const messagesEl = document.getElementById('ai-messages');
        if (!messagesEl || !question) return;
        const profileId = AppState.aiProfileId;
        const history = await AIService.loadHistory(question);
        // 用户可能已切题，历史回来时校验仍是当前题
        const current = AppState.questions[AppState.currentQuestionIndex];
        if (!current || String(current.id) !== String(question.id) || profileId !== AppState.aiProfileId ||
            messagesEl !== document.getElementById('ai-messages') || AppState.aiBusy) return;
        if (!history.length) return;
        messagesEl.innerHTML = '';
        for (const message of history) {
            const msg = document.createElement('div');
            msg.className = `ai-message ${message.role === 'user' ? 'user' : 'assistant'}`;
            msg.innerHTML = `<div class="ai-message-bubble">${message.role === 'user' ? escapeHtml(message.content) : renderMarkdown(message.content)}</div>`;
            messagesEl.appendChild(msg);
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
        window.DaguanAIReading?.refreshSections();
        window.DaguanAIReading?.toLatest();
    }

}
class AIController {
    static async sendAIPrompt(prompt) {
        const input = document.getElementById('ai-input');
        if (input) input.value = prompt;
        await this.sendAIMessage();
    }

    static selectAIProfile(profileId) {
        if (AppState.aiBusy) return;
        AIService.selectProfile(profileId);
        const stream = document.getElementById('ai-streaming-new');
        if (stream) stream.checked = AIService.activeProfile()?.streaming !== false;
        const question = AppState.questions[AppState.currentQuestionIndex];
        if (question) getRenderer().renderAIHistory(question);
    }

    static aiBusyUi(busy) {
        AppState.aiBusy = busy;
        document.querySelectorAll('[data-ai-service-control]').forEach(el => { el.disabled = busy; });
        document.getElementById('ai-services-settings')?.aiSettings?.syncBusy();
        const stop = document.getElementById('ai-stop-btn');
        const send = document.getElementById('ai-send-btn');
        if (stop) stop.hidden = !busy;
        if (send) send.disabled = busy;
        window.DaguanAIReading?.fitInput();
    }

    static async stopAIStream() {
        const controller = AppState.aiAbort;
        if (controller) { try { controller.abort(); } catch {} }
        if (AppState.aiRunId) await AIService.stopRun(AppState.aiRunId);
    }

    static abortAIStream() {
        // 切题/退出时的静默中止：保留草稿，不弹确认
        const controller = AppState.aiAbort;
        if (controller) { try { controller.abort(); } catch {} }
        if (AppState.aiRunId) AIService.stopRun(AppState.aiRunId);
        AppState.aiAbort = null;
        AppState.aiRunId = '';
        AppState.aiBusy = false;
    }

    static async sendAIMessage() {
        if (!getAccess().privateAllowed()) return;
        const input = document.getElementById('ai-input');
        const messagesEl = document.getElementById('ai-messages');
        if (!input || !messagesEl || AppState.aiBusy) return;

        const question = AppState.questions[AppState.currentQuestionIndex];
        const content = input.value.trim();
        if (!question || !content) return;
        if (!AppState.aiProfileId) await AIService.loadProfiles();
        if (!AppState.aiProfileId) {
            toast('请先在设置中选择或配置 AI 服务');
            this.navigate('settings');
            return;
        }

        messagesEl.querySelector('.ai-empty')?.remove();
        const userMsg = document.createElement('div');
        userMsg.className = 'ai-message user';
        userMsg.innerHTML = `<div class="ai-message-bubble">${escapeHtml(content)}</div>`;
        messagesEl.appendChild(userMsg);

        const aiMsg = document.createElement('div');
        aiMsg.className = 'ai-message assistant';
        aiMsg.innerHTML = '<div class="ai-message-bubble" id="ai-current-response">正在思考…</div>';
        messagesEl.appendChild(aiMsg);
        const responseEl = document.getElementById('ai-current-response');
        messagesEl.scrollTop = messagesEl.scrollHeight;

        input.value = '';
        window.DaguanAIReading?.fitInput();
        window.DaguanAIReading?.toLatest();
        window.DaguanAIReading?.refreshSections();
        StorageService.saveAIDraft(question.id, '');
        const questionId = String(question.id);

        const controller = new AbortController();
        AppState.aiAbort = controller;
        AppState.aiRunId = '';
        this.aiBusyUi(true);
        let answer = '';
        let paintTimer = 0;
        try {
            const includePrivate = document.getElementById('ai-include-private-new')?.checked === true;
            const profile = AIService.activeProfile();
            const images = profile?.capabilities?.vision === 'passed' ? await AIService.questionImages(question) : [];
            const response = await AIService.chatStream({ question, prompt: content, includePrivate, images, signal: controller.signal });
            AppState.aiRunId = response.headers.get('X-Daguan-Run-Id') || '';
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const paint = () => {
                paintTimer = 0;
                if (!responseEl || !responseEl.isConnected) return;
                const paintContent = () => { responseEl.textContent = answer || '正在思考…'; };
                if (window.DaguanAIReading) window.DaguanAIReading.paintMessages(responseEl.closest('.ai-panel'), paintContent);
                else paintContent();
            };
            while (reader) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parsed = AIService.parseSseChunk('', buffer);
                buffer = parsed.rest;
                for (const evt of parsed.events) {
                    if (evt.type === 'started' && evt.runId) AppState.aiRunId = evt.runId;
                    if (evt.type === 'delta') { answer += evt.content || ''; if (!paintTimer) paintTimer = setTimeout(paint, 120); }
                    if (evt.type === 'error') throw new Error(evt.error || 'AI 生成失败');
                }
            }
            if (paintTimer) clearTimeout(paintTimer);
            if (String(AppState.questions[AppState.currentQuestionIndex]?.id) !== questionId) return;
            if (responseEl) {
                responseEl.removeAttribute('id');
                const finish = () => { responseEl.innerHTML = renderMarkdown(answer); };
                if (window.DaguanAIReading) window.DaguanAIReading.paintMessages(responseEl.closest('.ai-panel'), finish);
                else finish();
                window.DaguanAIReading?.refreshSections();
            }
        } catch (error) {
            if (paintTimer) clearTimeout(paintTimer);
            if (String(AppState.questions[AppState.currentQuestionIndex]?.id) !== questionId) return;
            const aborted = error?.name === 'AbortError';
            if (responseEl) {
                responseEl.removeAttribute('id');
                responseEl.innerHTML = aborted
                    ? `<div class="ai-error">已停止生成。${answer ? '<div class="ai-partial">' + renderMarkdown(answer) + '</div>' : ''}</div>`
                    : `<div class="ai-error"><div>AI 暂时没有完成回答：${escapeHtml(error.message || String(error))}</div><button class="ai-retry-btn" onclick="App.retryAIMessage()">${aborted ? '' : '重试'}</button></div>`;
                if (!aborted) {
                    const retryBtn = responseEl.querySelector('.ai-retry-btn');
                    if (retryBtn) retryBtn.addEventListener('click', () => {
                        input.value = content;
                        StorageService.saveAIDraft(question.id, content);
                        this.sendAIMessage();
                    });
                }
            }
        } finally {
            if (paintTimer) clearTimeout(paintTimer);
            window.DaguanAIReading?.refreshSections();
            if (AppState.aiAbort === controller) {
                AppState.aiAbort = null;
                AppState.aiRunId = '';
                this.aiBusyUi(false);
            }
        }
    }

    static retryAIMessage() {
        const input = document.getElementById('ai-input');
        if (input && input.value.trim()) this.sendAIMessage();
    }

}

return { AIService, AI_COMPOSE_PROMPTS, AIViews, AIController };
} };
})(window);
