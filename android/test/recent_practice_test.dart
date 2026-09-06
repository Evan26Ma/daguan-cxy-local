import 'dart:convert';
import 'dart:io';

import 'package:daguan_math/main.dart';
import 'package:daguan_math/models.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

Question _question(int id) => Question.fromJson({
      'id': id,
      'serial': id,
      'categoryIds': <int>[],
      'stem': '题目 $id',
      'options': const ['A. 1', 'B. 2'],
      'answer': 'A',
      'explanation': '',
      'source': '',
      'type': 'single_choice',
    });

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('需练习重复标记会重置 48 小时并移到队尾', () {
    var now = DateTime(2026, 8, 13, 8);
    final controller = AppController(clock: () => now)..ready = true;
    final first = _question(1);
    final second = _question(2);
    controller.questions.addAll([first, second]);

    controller.setMastery(first, Mastery.needsPractice);
    now = now.add(const Duration(hours: 1));
    controller.setMastery(second, Mastery.needsPractice);
    expect(controller.recentPracticeQuestions, [first, second]);

    now = now.add(const Duration(hours: 1));
    controller.setMastery(first, Mastery.needsPractice);
    expect(controller.recentPracticeQuestions, [second, first]);
    expect(
      controller.stateOf(first.id).reviewAddedAt,
      now.add(AppController.recentPracticeDuration).toIso8601String(),
    );
    controller.dispose();
  });

  test('需练习到期进入复习本，再次做错后回到近期队尾', () {
    var now = DateTime(2026, 8, 13, 8);
    final controller = AppController(clock: () => now)..ready = true;
    final question = _question(1);
    controller.questions.add(question);

    controller.submitAnswer(question, {1});
    expect(controller.recentPracticeQuestions, [question]);
    expect(controller.reviewQuestions, isEmpty);

    now = now.add(const Duration(hours: 48));
    expect(controller.recentPracticeQuestions, isEmpty);
    expect(controller.reviewQuestions, [question]);

    controller.submitAnswer(question, {1});
    expect(controller.reviewQuestions, isEmpty);
    expect(controller.recentPracticeQuestions, [question]);
    controller.dispose();
  });

  test('完全不会直接进入复习本，答错后转入近期复习', () {
    final now = DateTime(2026, 8, 13, 8);
    final controller = AppController(clock: () => now)..ready = true;
    final question = _question(1);
    controller.questions.add(question);

    controller.setMastery(question, Mastery.notKnown);
    expect(controller.recentPracticeQuestions, isEmpty);
    expect(controller.reviewQuestions, [question]);
    expect(
      controller.stateOf(question.id).reviewAddedAt,
      now.toIso8601String(),
    );

    controller.submitAnswer(question, {1});
    expect(controller.stateOf(question.id).mastery, Mastery.needsPractice);
    expect(controller.recentPracticeQuestions, [question]);
    expect(controller.reviewQuestions, isEmpty);
    controller.dispose();
  });

  test('答对和清除状态会离开两个复习入口，清除状态不删除作答', () {
    final now = DateTime(2026, 8, 13, 8);
    final controller = AppController(clock: () => now)..ready = true;
    final question = _question(1);
    controller.questions.add(question);

    controller.submitAnswer(question, {1});
    controller.submitAnswer(question, {0});
    expect(controller.stateOf(question.id).mastery, Mastery.mastered);
    expect(controller.recentPracticeQuestions, isEmpty);
    expect(controller.reviewQuestions, isEmpty);

    controller.setMastery(question, Mastery.needsPractice);
    controller.clearMastery(question);
    final state = controller.stateOf(question.id);
    expect(state.mastery, Mastery.notStarted);
    expect(state.selectedOptions, ['A']);
    expect(state.lastCorrect, isTrue);
    expect(controller.recentPracticeQuestions, isEmpty);
    expect(controller.reviewQuestions, isEmpty);
    controller.dispose();
  });

  test('复习本按收录时间筛选并支持正倒序', () {
    var now = DateTime(2026, 8, 13, 8);
    final controller = AppController(clock: () => now)..ready = true;
    final first = _question(1);
    final second = _question(2);
    controller.questions.addAll([first, second]);

    controller.setMastery(first, Mastery.notKnown);
    now = now.add(const Duration(hours: 1));
    controller.setMastery(second, Mastery.notKnown);
    expect(controller.filteredReviewQuestions, [first, second]);

    controller.setReviewSort(ReviewSort.descending);
    expect(controller.filteredReviewQuestions, [second, first]);
    controller.setReviewFilter(ReviewFilter.needsPractice);
    expect(controller.filteredReviewQuestions, isEmpty);
    controller.setReviewFilter(ReviewFilter.notKnown);
    expect(controller.filteredReviewQuestions, [second, first]);
    controller.dispose();
  });

  test('题目状态完整保留近期复习时间字段', () {
    final state = QuestionState(
      mastery: Mastery.needsPractice,
      practiceQueuedAt: '2026-08-13T08:00:00.000',
      reviewAddedAt: '2026-08-15T08:00:00.000',
    );
    final restored = QuestionState.fromJson(state.toJson());
    expect(restored.practiceQueuedAt, state.practiceQueuedAt);
    expect(restored.reviewAddedAt, state.reviewAddedAt);
  });

  test('同步以可靠事件重建近期队列，无时间的需练习直接进入复习本', () async {
    final directory =
        await Directory.systemTemp.createTemp('daguan-recent-sync-test-');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('daguan.local/storage'),
      (call) async {
        if (call.method == 'getFilesDir') return directory.path;
        throw PlatformException(code: 'unknown_method');
      },
    );
    addTearDown(() async {
      messenger.setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      if (directory.existsSync()) await directory.delete(recursive: true);
    });

    final now = DateTime(2026, 8, 13, 12);
    final controller = AppController(clock: () => now)..ready = true;
    await controller.storage.loadProgress();
    final recent = _question(1);
    final expired = _question(2);
    controller.questions.addAll([recent, expired]);

    await controller.importSyncJson(
      jsonEncode({
        'format': 'daguan-user-data',
        'version': 1,
        'question_states': {
          'states': [
            {
              'question_id': recent.id,
              'user_state': {'mastery': 'needs_practice'},
            },
            {
              'question_id': expired.id,
              'user_state': {'mastery': 'needs_practice'},
            },
          ],
        },
        'practice_events': {
          'items': [
            {
              'id': 'recent-wrong',
              'question_id': recent.id,
              'category_id': null,
              'action': 'answer_wrong',
              'created_at': '2026-08-13T08:00:00.000',
              'category_name': '',
              'question_serial': recent.serial,
            },
          ],
        },
      }),
    );

    expect(controller.recentPracticeQuestions, [recent]);
    expect(controller.reviewQuestions, [expired]);
    controller.dispose();
  });
}
