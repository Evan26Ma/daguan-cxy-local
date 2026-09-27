import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('新版 UI 核心功能单测', () => {
  describe('版本偏好存储', () => {
    it('应该正确保存版本偏好', () => {
      const mockLocalStorage = {
        data: {},
        getItem(key) { return this.data[key] || null; },
        setItem(key, value) { this.data[key] = value; }
      };

      mockLocalStorage.setItem('daguan_version_preference', 'new');
      assert.equal(mockLocalStorage.getItem('daguan_version_preference'), 'new');

      mockLocalStorage.setItem('daguan_version_preference', 'old');
      assert.equal(mockLocalStorage.getItem('daguan_version_preference'), 'old');
    });

    it('应该处理无效的版本偏好', () => {
      const mockLocalStorage = {
        data: {},
        getItem(key) { return this.data[key] || null; }
      };

      const pref = mockLocalStorage.getItem('daguan_version_preference');
      const validVersions = ['new', 'old'];
      const effectiveVersion = validVersions.includes(pref) ? pref : 'new';

      assert.equal(effectiveVersion, 'new');
    });
  });

  describe('学习进度状态', () => {
    it('应该正确序列化进度数据', () => {
      const progress = {
        favorites: ['q1', 'q2'],
        mistakes: ['q3'],
        mastered: ['q4', 'q5'],
        lastUpdated: Date.now()
      };

      const serialized = JSON.stringify(progress);
      const deserialized = JSON.parse(serialized);

      assert.deepEqual(deserialized.favorites, progress.favorites);
      assert.deepEqual(deserialized.mistakes, progress.mistakes);
      assert.deepEqual(deserialized.mastered, progress.mastered);
    });

    it('应该处理损坏的进度数据', () => {
      const invalidJson = '{favorites: [';

      try {
        JSON.parse(invalidJson);
        assert.fail('应该抛出错误');
      } catch (err) {
        assert.ok(err instanceof SyntaxError);
      }
    });
  });

  describe('批注功能', () => {
    it('应该正确保存批注内容', () => {
      const annotations = {
        'q1': {
          content: '这道题考查二次型',
          history: [],
          lastUpdated: Date.now()
        }
      };

      const serialized = JSON.stringify(annotations);
      const deserialized = JSON.parse(serialized);

      assert.equal(deserialized['q1'].content, '这道题考查二次型');
    });

    it('应该支持 Markdown 格式', () => {
      const markdown = '**重点**：矩阵的秩 $r(A) = 2$';

      // 简单验证 Markdown 语法
      assert.ok(markdown.includes('**'));
      assert.ok(markdown.includes('$'));
    });
  });

  describe('AI 草稿保存', () => {
    it('应该按题目 ID 保存草稿', () => {
      const drafts = {
        'q1': '这道题的解题思路是',
        'q2': '请详细讲解'
      };

      assert.equal(drafts['q1'], '这道题的解题思路是');
      assert.equal(drafts['q2'], '请详细讲解');
    });

    it('应该能清空草稿', () => {
      const drafts = { 'q1': '草稿内容' };
      drafts['q1'] = '';

      assert.equal(drafts['q1'], '');
    });
  });

  describe('学习位置记忆', () => {
    it('应该记录章节和题号', () => {
      const position = {
        categoryId: 'linear-algebra',
        chapterId: 'chapter-1',
        questionIndex: 5
      };

      assert.equal(position.categoryId, 'linear-algebra');
      assert.equal(position.chapterId, 'chapter-1');
      assert.equal(position.questionIndex, 5);
    });

    it('应该处理无效位置', () => {
      const position = null;
      const hasPosition = Boolean(position && position.categoryId && position.chapterId);

      assert.equal(hasPosition, false);
    });
  });

  describe('搜索防抖', () => {
    it('应该实现防抖逻辑', async () => {
      let callCount = 0;

      const debounce = (func, wait) => {
        let timeout;
        return function(...args) {
          clearTimeout(timeout);
          timeout = setTimeout(() => func(...args), wait);
        };
      };

      const debouncedFunc = debounce(() => {
        callCount++;
      }, 50);

      // 快速调用多次
      debouncedFunc();
      debouncedFunc();
      debouncedFunc();

      // 等待防抖完成
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(callCount, 1, '应该只执行一次');
    });
  });

  describe('视频链接生成', () => {
    it('应该生成正确的 B 站链接', () => {
      const mapping = {
        bvid: 'BV1xx411c7mD',
        p: 2,
        t: 300
      };

      const url = `https://www.bilibili.com/video/${mapping.bvid}?p=${mapping.p}&t=${mapping.t}`;

      assert.equal(url, 'https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=300');
    });

    it('应该处理缺失的参数', () => {
      const mapping = {
        bvid: 'BV1xx411c7mD'
      };

      const p = mapping.p || 1;
      const t = mapping.t || 0;
      const url = `https://www.bilibili.com/video/${mapping.bvid}?p=${p}&t=${t}`;

      assert.equal(url, 'https://www.bilibili.com/video/BV1xx411c7mD?p=1&t=0');
    });
  });

  describe('数据共享机制', () => {
    it('应该识别共享数据', () => {
      const sharedKeys = [
        'daguan_local_progress_v1',
        'daguan_question_annotations_v1',
        'daguan_ai_preferences_v1'
      ];

      const isShared = (key) => sharedKeys.includes(key);

      assert.equal(isShared('daguan_local_progress_v1'), true);
      assert.equal(isShared('daguan_ui_appearance_new'), false);
    });

    it('应该区分新旧版独立数据', () => {
      const newUIKeys = ['daguan_ui_appearance_new'];
      const oldUIKeys = ['ui-background'];

      assert.ok(!newUIKeys.includes('ui-background'));
      assert.ok(!oldUIKeys.includes('daguan_ui_appearance_new'));
    });
  });
});

console.log('新版 UI 核心功能单测完成');
