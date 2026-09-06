import 'dart:convert';
import 'dart:io';

import 'package:daguan_math/handwriting_models.dart';
import 'package:daguan_math/main.dart';
import 'package:daguan_math/models.dart';
import 'package:daguan_math/storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

bool _previewFontLoaded = false;

Future<void> _loadPreviewFont() async {
  if (_previewFontLoaded) return;
  final loader = FontLoader('PreviewChinese')
    ..addFont(rootBundle.load('test/preview_font.ttf'));
  await loader.load();
  await (FontLoader('MaterialIcons')
        ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf')))
      .load();
  const mathFonts = {
    'packages/flutter_math_fork/KaTeX_Main': 'KaTeX_Main-Regular.ttf',
    'packages/flutter_math_fork/KaTeX_Math': 'KaTeX_Math-Italic.ttf',
    'packages/flutter_math_fork/KaTeX_AMS': 'KaTeX_AMS-Regular.ttf',
    'packages/flutter_math_fork/KaTeX_Size1': 'KaTeX_Size1-Regular.ttf',
    'packages/flutter_math_fork/KaTeX_Size2': 'KaTeX_Size2-Regular.ttf',
    'packages/flutter_math_fork/KaTeX_Size3': 'KaTeX_Size3-Regular.ttf',
    'packages/flutter_math_fork/KaTeX_Size4': 'KaTeX_Size4-Regular.ttf',
  };
  await Future.wait([
    for (final entry in mathFonts.entries)
      (FontLoader(entry.key)
            ..addFont(
              rootBundle.load(
                'packages/flutter_math_fork/lib/katex_fonts/fonts/${entry.value}',
              ),
            ))
          .load(),
  ]);
  _previewFontLoaded = true;
}

Future<AppController> _loadCatalogController() async {
  final controller = AppController()..ready = true;
  final questionData = decodeObject(
    await rootBundle.loadString('assets/questions.json'),
  );
  final categoryData = decodeObject(
    await rootBundle.loadString('assets/categories.json'),
  );
  controller.questions.addAll(
    (questionData['items'] as List)
        .map((item) => Question.fromJson(item as Map<String, dynamic>)),
  );
  controller.categories.addAll(
    (categoryData['items'] as List)
        .map((item) => Category.fromJson(item as Map<String, dynamic>)),
  );
  for (final category in controller.categories) {
    controller.categoryById[category.id] = category;
    controller.childrenByParent
        .putIfAbsent(category.parentId, () => [])
        .add(category);
  }
  for (final question in controller.questions) {
    for (final categoryId in question.categoryIds) {
      controller.questionsByCategory
          .putIfAbsent(categoryId, () => [])
          .add(question);
    }
  }
  return controller;
}

Future<AppController> _loadVisualController() async {
  final controller = AppController()..ready = true;
  controller.categories.addAll([
    for (final data in const [
      {
        'id': 223,
        'parentId': null,
        'name': '高等数学',
        'path': '高等数学',
        'directCount': 0,
        'totalCount': 3707,
      },
      {
        'id': 1,
        'parentId': null,
        'name': '线性代数',
        'path': '线性代数',
        'directCount': 0,
        'totalCount': 959,
      },
      {
        'id': 601,
        'parentId': null,
        'name': '概率统计',
        'path': '概率统计',
        'directCount': 0,
        'totalCount': 317,
      },
      {
        'id': 836,
        'parentId': null,
        'name': '历年真题',
        'path': '历年真题',
        'directCount': 0,
        'totalCount': 1106,
      },
      {
        'id': 321,
        'parentId': 223,
        'name': '极限',
        'path': '高等数学 / 极限',
        'directCount': 0,
        'totalCount': 899,
      },
      {
        'id': 327,
        'parentId': 321,
        'name': '函数',
        'path': '高等数学 / 极限 / 函数',
        'directCount': 0,
        'totalCount': 56,
      },
      {
        'id': 330,
        'parentId': 327,
        'name': '函数性质考察',
        'path': '高等数学 / 极限 / 函数 / 函数性质考察',
        'directCount': 0,
        'totalCount': 45,
      },
      {
        'id': 329,
        'parentId': 321,
        'name': '极限',
        'path': '高等数学 / 极限 / 极限',
        'directCount': 0,
        'totalCount': 776,
      },
      {
        'id': 328,
        'parentId': 321,
        'name': '连续',
        'path': '高等数学 / 极限 / 连续',
        'directCount': 0,
        'totalCount': 67,
      },
      {
        'id': 332,
        'parentId': 329,
        'name': '函数极限概念题',
        'path': '高等数学 / 极限 / 极限 / 函数极限概念题',
        'directCount': 3,
        'totalCount': 3,
      },
      {
        'id': 333,
        'parentId': 329,
        'name': '极限计算',
        'path': '高等数学 / 极限 / 极限 / 极限计算',
        'directCount': 0,
        'totalCount': 434,
      },
      {
        'id': 349,
        'parentId': 333,
        'name': '函数极限',
        'path': '高等数学 / 极限 / 极限 / 极限计算 / 函数极限',
        'directCount': 0,
        'totalCount': 301,
      },
      {
        'id': 331,
        'parentId': 327,
        'name': '求函数表达式',
        'path': '高等数学 / 极限 / 函数 / 求函数表达式',
        'directCount': 11,
        'totalCount': 11,
      },
      {
        'id': 704,
        'parentId': 349,
        'name': '0/0',
        'path': '高等数学 / 极限 / 极限计算 / 函数极限 / 0/0',
        'directCount': 57,
        'totalCount': 57,
      },
    ])
      Category.fromJson(Map<String, dynamic>.from(data)),
  ]);
  for (final category in controller.categories) {
    controller.categoryById[category.id] = category;
    controller.childrenByParent
        .putIfAbsent(category.parentId, () => [])
        .add(category);
  }

  var nextId = 1;
  void addQuestion({
    required List<int> categoryIds,
    String stem = '题目内容预览',
    List<String> options = const [],
    String answer = '答案',
    String explanation = '这里显示完整答案与解析。',
    String source = '',
    String type = 'subjective',
  }) {
    final question = Question.fromJson({
      'id': nextId,
      'serial': nextId,
      'categoryIds': categoryIds,
      'stem': stem,
      'options': options,
      'answer': answer,
      'explanation': explanation,
      'source': source,
      'type': type,
      'core': nextId <= 1000,
      'assets': <String>[],
    });
    nextId += 1;
    controller.questions.add(question);
    for (final categoryId in categoryIds) {
      controller.questionsByCategory
          .putIfAbsent(categoryId, () => [])
          .add(question);
    }
  }

  addQuestion(
    categoryIds: const [331],
    stem:
        r'已知 $f(x)=e^{x^2}$，$f(\varphi(x))=1-x$，且 $\varphi(x)\ge0$，求 $\varphi(x)$ 并写出它的定义域。',
    answer: r'$\varphi(x)=\sqrt{\ln(1-x)}$，定义域为 $(-\infty,0]$。',
    explanation: '由复合函数关系和非负条件确定算术平方根，再结合对数真数条件得到定义域。',
    source: '1988 数一二',
  );
  for (var index = 1; index < 11; index++) {
    addQuestion(
      categoryIds: const [331],
      stem: '根据已知函数关系求函数表达式及定义域。',
      source: '${1990 + index} 数一',
    );
  }

  addQuestion(
    categoryIds: const [704],
    stem:
        r'计算极限 $\displaystyle\lim_{x\to0}\frac{\ln(1+x)-\sin x}{\sqrt[3]{1-x^2}-1}$。',
    options: const [
      r'$-\frac{3}{2}$',
      r'$-\frac{1}{2}$',
      r'$\frac{3}{2}$',
      r'$\frac{1}{2}$',
    ],
    answer: 'C',
    explanation: '分别展开分子与分母的最低阶非零项，再约去同阶因子。',
    source: '26版660 数一二三 第140题',
    type: 'single_choice',
  );
  for (var index = 1; index < 57; index++) {
    addQuestion(
      categoryIds: const [704],
      stem: '计算给定函数在指定点处的极限。',
      source: '${1990 + index} 数二',
    );
  }

  return controller;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('内置题库与原站四个一级分类及数量一致', () async {
    final controller = await _loadCatalogController();
    expect(controller.questions.length, 5952);
    expect(controller.questions.map((question) => question.id).toSet().length,
        5952);
    expect(
      {
        for (final category in controller.rootCategories)
          category.name: category.totalCount,
      },
      {
        '高等数学': 3707,
        '线性代数': 959,
        '概率统计': 317,
        '历年真题': 1106,
      },
    );
    for (final entry in const {
      223: 3707,
      1: 959,
      601: 317,
      836: 1106,
    }.entries) {
      controller.chooseCategory(entry.key);
      expect(controller.visibleQuestions.length, entry.value);
    }
  });

  test('章节目录使用学科、大章节、小章节三层结构', () async {
    final controller = await _loadCatalogController();
    final limits = controller
        .childCategoriesOf(223)
        .singleWhere((category) => category.name == '极限');
    expect(
      controller.childCategoriesOf(limits.id).map((category) => category.name),
      containsAllInOrder(['函数', '极限', '连续']),
    );
    expect(controller.categoryContains(limits.id, 704), isTrue);
    expect(controller.parentCategoryIdOf(329), limits.id);
    expect(controller.smallChapterIdOf(331), 327);
    expect(controller.smallChapterIdOf(704), 329);
  });

  testWidgets('返回手势依次返回题单和上级章节', (tester) async {
    final controller = await _loadVisualController();
    controller
      ..selectedCategoryId = 331
      ..selectedQuestionId = controller.questions.first.id;
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: AnimatedBuilder(
          animation: controller,
          builder: (context, _) => AppShell(controller: controller),
        ),
      ),
    );

    await tester.binding.handlePopRoute();
    await tester.pump();
    expect(controller.selectedQuestionId, isNull);
    expect(controller.selectedCategoryId, 331);

    for (final expectedCategoryId in <int?>[327, 321, 223, null]) {
      await tester.binding.handlePopRoute();
      await tester.pump();
      expect(controller.selectedCategoryId, expectedCategoryId);
    }
  });

  testWidgets('选择小章节后可在中间选择具体内容', (tester) async {
    final controller = await _loadVisualController()
      ..selectedCategoryId = 329;
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 360,
            child: QuestionList(
              controller: controller,
              showCategoryButton: true,
            ),
          ),
        ),
      ),
    );

    expect(find.text('选择具体内容'), findsOneWidget);
    await tester.tap(find.text('选择具体内容'));
    await tester.pumpAndSettle();
    expect(find.text('函数极限概念题'), findsOneWidget);
    expect(find.text('极限计算'), findsOneWidget);
    await tester.tap(find.text('极限计算'));
    await tester.pumpAndSettle();
    expect(controller.selectedCategoryId, 333);
  });

  testWidgets('具体章节弹窗只显示当前小章节分支', (tester) async {
    final controller = await _loadVisualController()
      ..selectedCategoryId = 331;
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 360,
            child: QuestionList(
              controller: controller,
              showCategoryButton: true,
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('求函数表达式'));
    await tester.pumpAndSettle();
    expect(find.text('函数 · 选择具体章节'), findsOneWidget);
    expect(find.text('函数性质考察'), findsWidgets);
    expect(find.text('极限计算'), findsNothing);
    expect(find.text('连续'), findsNothing);
  });

  test('收藏本只看星标，复习本只看需练习和完全不会', () async {
    final controller = await _loadVisualController();
    final question = controller.questions.first;
    controller.setMastery(question, Mastery.notKnown);
    expect(controller.reviewQuestions, contains(question));
    expect(controller.favoriteQuestions, isNot(contains(question)));
    expect(controller.stateOf(question.id).inWrongBook, isFalse);

    controller.toggleFavorite(question);
    expect(controller.favoriteQuestions, contains(question));
    expect(controller.reviewQuestions, contains(question));
    controller.dispose();
  });

  test('收藏本和复习本分别记录收录位置并在跨本时继承', () async {
    final controller = await _loadVisualController();
    final question = controller.questions[4];
    controller
      ..chooseCategory(331)
      ..chooseQuestion(question.id);
    final expectedPosition = controller.visibleQuestions
            .indexWhere((item) => item.id == question.id) +
        1;

    controller.toggleFavorite(question);
    final favoriteOrigin = controller.stateOf(question.id).favoriteOrigin;
    expect(favoriteOrigin?.categoryId, 331);
    expect(favoriteOrigin?.categoryPath, '高等数学 / 极限 / 函数 / 求函数表达式');
    expect(favoriteOrigin?.position, expectedPosition);

    controller.openQuestion(
      question,
      navigationQuestions: controller.favoriteQuestions,
      navigationTitle: '收藏题目',
      navigationBook: QuestionBook.favorite,
    );
    controller.setMastery(question, Mastery.needsPractice);
    expect(
      controller.stateOf(question.id).reviewOrigin?.toJson(),
      favoriteOrigin?.toJson(),
    );

    controller.toggleFavorite(question);
    expect(controller.stateOf(question.id).favoriteOrigin, isNull);
    controller.setMastery(question, Mastery.needsPractice);
    expect(controller.stateOf(question.id).mastery, Mastery.needsPractice);
    expect(controller.recentPracticeQuestions, contains(question));
    expect(controller.stateOf(question.id).reviewOrigin, isNotNull);
    controller.dispose();
  });

  test('收藏本和复习本各自使用独立的上一题下一题顺序', () async {
    final controller = await _loadVisualController();
    final first = controller.questions[0];
    final second = controller.questions[1];
    final third = controller.questions[2];
    final fourth = controller.questions[3];
    controller.states[first.id] = QuestionState(favorite: true);
    controller.states[third.id] = QuestionState(favorite: true);
    controller.states[second.id] = QuestionState(
      mastery: Mastery.needsPractice,
    );
    controller.states[fourth.id] = QuestionState(
      mastery: Mastery.notKnown,
    );

    controller.openQuestion(
      first,
      navigationQuestions: controller.favoriteQuestions,
    );
    controller.selectAdjacent(1);
    expect(controller.selectedQuestionId, third.id);

    controller.openQuestion(
      second,
      navigationQuestions: controller.reviewQuestions,
    );
    controller.selectAdjacent(1);
    expect(controller.selectedQuestionId, fourth.id);
    controller.dispose();
  });

  test('复习分类约束数量和导航，题目移出后连续选择相邻题', () async {
    final controller = await _loadVisualController();
    final first = controller.questions[0];
    final second = controller.questions[1];
    controller.states[first.id] = QuestionState(
      mastery: Mastery.needsPractice,
    );
    controller.states[second.id] = QuestionState(
      mastery: Mastery.notKnown,
    );

    expect(controller.reviewCount(ReviewFilter.all), 2);
    expect(controller.reviewCount(ReviewFilter.needsPractice), 1);
    expect(controller.reviewCount(ReviewFilter.notKnown), 1);
    controller.openQuestion(
      first,
      navigationQuestions: controller.filteredReviewQuestions,
      navigationTitle: '复习题目',
      navigationBook: QuestionBook.review,
    );
    controller.setMastery(first, Mastery.needsPractice);
    expect(controller.selectedQuestionId, second.id);

    controller.setReviewFilter(ReviewFilter.notKnown);
    expect(controller.filteredReviewQuestions, [second]);
    expect(controller.currentQuestionSequence, [second]);
    controller.dispose();
  });

  testWidgets('从收藏本进入题目后下一题仍留在收藏队列', (tester) async {
    final controller = await _loadVisualController();
    final first = controller.questions[0];
    final third = controller.questions[2];
    controller.states[first.id] = QuestionState(favorite: true);
    controller.states[third.id] = QuestionState(favorite: true);

    tester.view
      ..physicalSize = const Size(1280, 800)
      ..devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: AnimatedBuilder(
          animation: controller,
          builder: (context, _) => AppShell(controller: controller),
        ),
      ),
    );
    await tester.tap(find.text('收藏本'));
    await tester.pump();
    await tester.tap(find.text('1988 数一二'));
    await tester.pump();

    expect(controller.selectedQuestionId, first.id);
    expect(find.text('收藏本'), findsWidgets);
    expect(find.byType(QuestionList), findsOneWidget);
    expect(find.byType(QuestionDetail), findsOneWidget);
    await tester.tap(
      find.widgetWithText(OutlinedButton, '下一题').first,
    );
    await tester.pump();
    expect(controller.selectedQuestionId, third.id);

    await tester.binding.handlePopRoute();
    await tester.pump();
    expect(controller.selectedQuestionId, isNull);
    expect(find.text('收藏题目'), findsOneWidget);
    controller.dispose();
  });

  testWidgets('近期复习入口显示数量、倒计时并按独立题单打开', (tester) async {
    final controller = await _loadVisualController();
    final question = controller.questions.first;
    controller.setMastery(question, Mastery.needsPractice);

    tester.view
      ..physicalSize = const Size(1280, 800)
      ..devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
      controller.dispose();
    });
    await tester.pumpWidget(
      MaterialApp(home: AppShell(controller: controller)),
    );
    await tester.pumpAndSettle();
    expect(find.text('近期复习'), findsOneWidget);
    expect(find.text('1'), findsWidgets);

    await tester.tap(find.text('近期复习'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(ValueKey('canvas-question-choice-${question.id}')),
      findsNothing,
    );
    expect(find.textContaining('后移入复习本'), findsOneWidget);
    await tester.tap(find.textContaining('1988 数一二').first);
    await tester.pumpAndSettle();
    expect(controller.navigationBook, QuestionBook.recentPractice);
    expect(controller.currentQuestionSequence, [question]);
  });

  testWidgets('平板自适应导航不显示题库总数', (tester) async {
    final controller = AppController()..ready = true;
    controller.questions.addAll(
      List.generate(
        5952,
        (index) => Question.fromJson({
          'id': index + 1,
          'serial': index + 1,
          'categoryIds': <int>[],
          'stem': '测试题 ${index + 1}',
          'options': <String>[],
          'answer': '',
          'explanation': '',
          'source': '',
          'type': 'subjective',
          'core': false,
          'assets': <String>[],
        }),
      ),
    );
    for (var index = 0; index < 151; index++) {
      final mastery = index < 106
          ? Mastery.mastered
          : index < 140
              ? Mastery.needsPractice
              : Mastery.notKnown;
      controller.states[index + 1] = QuestionState(
        mastery: mastery,
        favorite: index < 41,
      );
    }

    tester.view
      ..physicalSize = const Size(1280, 800)
      ..devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      MaterialApp(home: AppShell(controller: controller)),
    );

    expect(find.textContaining('5952'), findsNothing);
    expect(find.text('题库'), findsWidgets);
    expect(find.text('收藏本'), findsWidgets);
    expect(find.text('复习本'), findsWidgets);
    expect(find.text('学习记录'), findsWidgets);

    await tester.tap(find.text('数据备份'));
    await tester.pump();
    expect(find.text('本地学习数据'), findsOneWidget);
    expect(find.text('106'), findsOneWidget);
    expect(find.text('34'), findsOneWidget);
    expect(find.text('11'), findsOneWidget);
    expect(find.text('41'), findsOneWidget);
    expect(find.text('45'), findsOneWidget);
  });

  testWidgets('内置题图可以显示并进入全屏缩放', (tester) async {
    tester.view
      ..physicalSize = const Size(800, 1200)
      ..devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: QuestionImageGallery(
            assetReferences: [
              'asset://sha256/0b56a8ce62774a3fcdeb42495a665a7e5aa301a7104db69ecd156bb78363b236',
            ],
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.byType(Image), findsOneWidget);
    expect(find.byType(InteractiveViewer), findsOneWidget);
    expect(find.text('题图文件损坏或缺失'), findsNothing);

    await tester.tap(find.byTooltip('全屏查看题图'));
    await tester.pumpAndSettle();
    expect(find.byType(Dialog), findsOneWidget);
    expect(find.byType(InteractiveViewer), findsNWidgets(2));
  });

  testWidgets('横竖屏切换会在三栏和单栏之间自适应', (tester) async {
    final controller = AppController()..ready = true;
    controller.questions.add(
      Question.fromJson({
        'id': 1,
        'serial': 1,
        'categoryIds': <int>[],
        'stem': '自适应测试题',
        'options': <String>[],
        'answer': '',
        'explanation': '',
        'source': '',
        'type': 'subjective',
        'core': false,
        'assets': <String>[],
      }),
    );
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    tester.view.devicePixelRatio = 1;

    tester.view.physicalSize = const Size(1280, 800);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LibraryPage(
            controller: controller,
            categoryInSidebar: true,
          ),
        ),
      ),
    );
    expect(find.byType(QuestionList), findsOneWidget);
    expect(find.byType(QuestionDetail), findsOneWidget);

    tester.view.physicalSize = const Size(600, 900);
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: LibraryPage(controller: controller))),
    );
    expect(find.byType(QuestionList), findsOneWidget);
    expect(find.byType(QuestionDetail), findsNothing);

    controller.selectedQuestionId = 1;
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: LibraryPage(controller: controller))),
    );
    expect(find.byType(QuestionList), findsNothing);
    expect(find.byType(QuestionDetail), findsOneWidget);
  });

  test('选择题只保留当前结果并由最新作答更新掌握状态', () async {
    final directory =
        await Directory.systemTemp.createTemp('daguan-answer-test-');
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
      if (directory.existsSync()) {
        for (var attempt = 0; attempt < 6; attempt++) {
          try {
            await directory.delete(recursive: true);
            break;
          } on PathAccessException {
            await Future<void>.delayed(const Duration(milliseconds: 100));
          }
        }
      }
    });
    final controller = AppController()..ready = true;
    await controller.storage.loadProgress();
    final question = Question.fromJson({
      'id': 99,
      'serial': 1,
      'categoryIds': <int>[],
      'stem': '测试选择题',
      'options': <String>['选项一', '选项二', '选项三', '选项四'],
      'answer': 'B',
      'explanation': '解析',
      'source': '1988 数二',
      'type': 'single_choice',
      'core': true,
      'assets': <String>[],
    });
    controller.questions.add(question);

    controller.submitAnswer(question, {0});
    expect(controller.stateOf(question.id).lastCorrect, isFalse);
    expect(controller.stateOf(question.id).mastery, Mastery.needsPractice);
    expect(controller.recentPracticeQuestions, contains(question));
    expect(controller.reviewQuestions, isNot(contains(question)));
    expect(controller.stateOf(question.id).inWrongBook, isFalse);
    expect(controller.stateOf(question.id).wrongCount, 1);

    controller.clearAnswer(question);
    expect(controller.stateOf(question.id).lastCorrect, isNull);
    expect(controller.stateOf(question.id).wrongCount, 0);
    expect(controller.stateOf(question.id).mastery, Mastery.needsPractice);
    controller.submitAnswer(question, {1});
    expect(controller.stateOf(question.id).lastCorrect, isTrue);
    expect(controller.stateOf(question.id).mastery, Mastery.mastered);
    expect(controller.reviewQuestions, isNot(contains(question)));
    expect(controller.stateOf(question.id).wrongCount, 0);
    await Future<void>.delayed(const Duration(milliseconds: 450));
    controller.dispose();
  });

  testWidgets('选择题允许带轻微移动的单次触控', (tester) async {
    final directory =
        Directory.systemTemp.createTempSync('daguan-choice-ui-test-');
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
    final controller = await _loadVisualController();
    await tester.runAsync(controller.storage.loadProgress);
    final question = controller.questions[11];
    controller
      ..selectedCategoryId = 704
      ..selectedQuestionId = question.id;

    tester.view
      ..physicalSize = const Size(800, 1100)
      ..devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AnimatedBuilder(
            animation: controller,
            builder: (context, _) => QuestionDetail(controller: controller),
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 300));

    final option = find.byKey(const ValueKey('question-option-2'));
    expect(option, findsOneWidget);
    await tester.ensureVisible(option);
    await tester.pump(const Duration(milliseconds: 300));
    final gesture = await tester.startGesture(tester.getCenter(option));
    await gesture.moveBy(const Offset(2, 1));
    await gesture.up();
    await tester.pump(const Duration(milliseconds: 300));

    expect(controller.stateOf(question.id).lastCorrect, isTrue);
    await tester.tap(option);
    await tester.pump(const Duration(milliseconds: 300));
    expect(controller.stateOf(question.id).lastCorrect, isNull);
    expect(controller.stateOf(question.id).selectedOptions, isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    controller.dispose();
  });

  testWidgets('文字笔记预览会渲染公式内容', (tester) async {
    final controller = await _loadVisualController();
    final question = controller.questions[11];
    controller
      ..selectedCategoryId = 704
      ..selectedQuestionId = question.id
      ..states[question.id] = QuestionState(
        note: r'利用 $\sin x\sim x$，结果为 $\frac{3}{2}$。',
      );

    tester.view
      ..physicalSize = const Size(800, 1100)
      ..devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: QuestionDetail(controller: controller),
        ),
      ),
    );
    await tester.pump();
    await tester.ensureVisible(find.text('预览'));
    await tester.tap(find.text('预览'));
    await tester.pump();

    expect(
      find.byKey(const ValueKey('text-note-preview')),
      findsOneWidget,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('网页风格平板横屏布局视觉基准', (tester) async {
    await _loadPreviewFont();
    final controller = await _loadVisualController();
    final firstQuestion = controller.questions.first;
    controller
      ..selectedCategoryId = 331
      ..selectedQuestionId = firstQuestion.id
      ..states[firstQuestion.id] = QuestionState(
        mastery: Mastery.needsPractice,
        favorite: true,
      );

    tester.view
      ..physicalSize = const Size(1280, 800)
      ..devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: AppColors.primary,
            surface: AppColors.surface,
          ),
          scaffoldBackgroundColor: AppColors.canvas,
          dividerColor: AppColors.border,
          fontFamily: 'PreviewChinese',
        ),
        home: AnimatedBuilder(
          animation: controller,
          builder: (context, _) => AppShell(controller: controller),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(AppShell),
      matchesGoldenFile('goldens/web_style_landscape.png'),
    );

    final choiceQuestion = controller.questions[11];
    controller
      ..selectedCategoryId = 704
      ..selectedQuestionId = choiceQuestion.id
      ..states[choiceQuestion.id] = QuestionState(
        mastery: Mastery.needsPractice,
        favorite: true,
        selectedOptions: const ['A'],
        lastCorrect: false,
        wrongCount: 1,
        inWrongBook: true,
      );
    controller.notifyListeners();
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(AppShell),
      matchesGoldenFile('goldens/choice_wrong_landscape.png'),
    );

    await tester.tap(find.byTooltip('收起主导航'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('收起题单'));
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(AppShell),
      matchesGoldenFile('goldens/collapsed_landscape.png'),
    );

    tester.view.physicalSize = const Size(800, 1280);
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(AppShell),
      matchesGoldenFile('goldens/web_style_portrait.png'),
    );

    await tester.tap(find.byTooltip('打开主导航'));
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(AppShell),
      matchesGoldenFile('goldens/portrait_navigation_drawer.png'),
    );
    await tester.tapAt(const Offset(760, 640));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('打开题单'));
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(AppShell),
      matchesGoldenFile('goldens/portrait_question_drawer.png'),
    );
  });

  testWidgets('三层章节导航与具体内容入口视觉基准', (tester) async {
    await _loadPreviewFont();
    final controller = await _loadVisualController()
      ..selectedCategoryId = 329;
    addTearDown(controller.dispose);

    tester.view
      ..physicalSize = const Size(1280, 800)
      ..devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: AppColors.primary,
            surface: AppColors.surface,
          ),
          scaffoldBackgroundColor: AppColors.canvas,
          dividerColor: AppColors.border,
          fontFamily: 'PreviewChinese',
        ),
        home: AnimatedBuilder(
          animation: controller,
          builder: (context, _) => AppShell(controller: controller),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(AppShell),
      matchesGoldenFile('goldens/chapter_navigation_landscape.png'),
    );
  });

  testWidgets('书写画布导航按学科到具体内容筛选当前小章节题目', (tester) async {
    final directory =
        Directory.systemTemp.createTempSync('daguan-canvas-nav-test-');
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
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      messenger.setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      if (directory.existsSync()) {
        for (var attempt = 0; attempt < 6; attempt++) {
          try {
            await directory.delete(recursive: true);
            break;
          } on PathAccessException {
            await Future<void>.delayed(const Duration(milliseconds: 100));
          }
        }
      }
    });
    final controller = await _loadVisualController();
    final firstDetail = Category.fromJson({
      'id': 9001,
      'parentId': 331,
      'name': '第一层细分',
      'path': '高等数学 / 极限 / 函数 / 求函数表达式 / 第一层细分',
      'directCount': 0,
      'totalCount': 1,
    });
    final secondDetail = Category.fromJson({
      'id': 9002,
      'parentId': 9001,
      'name': '第二层细分',
      'path': '高等数学 / 极限 / 函数 / 求函数表达式 / 第一层细分 / 第二层细分',
      'directCount': 1,
      'totalCount': 1,
    });
    controller.categories.addAll([firstDetail, secondDetail]);
    controller.categoryById
      ..[firstDetail.id] = firstDetail
      ..[secondDetail.id] = secondDetail;
    controller.childrenByParent
      ..putIfAbsent(firstDetail.parentId, () => []).add(firstDetail)
      ..putIfAbsent(secondDetail.parentId, () => []).add(secondDetail);
    final deepQuestion = Question.fromJson({
      'id': 99901,
      'serial': 99,
      'categoryIds': [9002],
      'stem': '深层分类测试题',
      'options': <String>[],
      'answer': '1',
      'explanation': '',
      'source': '深层测试题',
    });
    controller.questions.add(deepQuestion);
    await tester.runAsync(controller.storage.loadProgress);
    controller.chooseCategory(331);
    controller.chooseQuestion(controller.questions.first.id);

    tester.view
      ..physicalSize = const Size(1280, 800)
      ..devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(seedColor: AppColors.primary),
        ),
        home: Scaffold(body: QuestionDetail(controller: controller)),
      ),
    );
    await tester.tap(
      find.byKey(const ValueKey('open-handwriting-canvas')),
    );
    await tester.pump();
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 200)),
    );
    await tester.pump(const Duration(milliseconds: 400));

    final openNavigator = tester
        .widget<IconButton>(
          find.byKey(const ValueKey('canvas-open-question-navigator')),
        )
        .onPressed!;
    await tester.runAsync(() async {
      openNavigator();
      await Future<void>.delayed(const Duration(milliseconds: 200));
    });
    await tester.pumpAndSettle();

    expect(find.text('学科'), findsOneWidget);
    expect(find.text('大章节'), findsOneWidget);
    expect(find.text('小章节'), findsOneWidget);
    expect(find.text('具体内容'), findsOneWidget);
    expect(find.text('细分类 1'), findsOneWidget);
    final firstQuestionLabel = tester.widget<Text>(
      find.byKey(const ValueKey('canvas-question-choice-1')),
    );
    expect(firstQuestionLabel.data, '#1 · 1988 数一二');
    expect(find.text('题号 #1'), findsNothing);
    expect(
      find.text(
        r'已知 $f(x)=e^{x^2}$，$f(\varphi(x))=1-x$，且 $\varphi(x)\ge0$，求 $\varphi(x)$ 并写出它的定义域。',
      ),
      findsNothing,
    );
    expect(find.text('题号 #12'), findsNothing);

    await tester.tap(
      find.byKey(const ValueKey('细分类 1-331-1')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('第一层细分').last);
    await tester.pumpAndSettle();
    expect(find.text('细分类 2'), findsOneWidget);
    final secondDetailDropdown = find.byKey(const ValueKey('细分类 2-9001-1'));
    await tester.ensureVisible(secondDetailDropdown);
    await tester.pumpAndSettle();
    await tester.tap(secondDetailDropdown);
    await tester.pumpAndSettle();
    await tester.tap(find.text('第二层细分').last);
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('canvas-question-choice-99901')),
      findsOneWidget,
    );
    expect(
        find.byKey(const ValueKey('canvas-question-choice-1')), findsNothing);
    controller.dispose();
  });

  testWidgets('收藏本双栏工作区视觉基准', (tester) async {
    await _loadPreviewFont();
    final controller = await _loadVisualController();
    controller.states[controller.questions[0].id] = QuestionState(
      favorite: true,
    );
    controller.states[controller.questions[2].id] = QuestionState(
      favorite: true,
    );

    tester.view
      ..physicalSize = const Size(1280, 800)
      ..devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: AppColors.primary,
            surface: AppColors.surface,
          ),
          scaffoldBackgroundColor: AppColors.canvas,
          dividerColor: AppColors.border,
          fontFamily: 'PreviewChinese',
        ),
        home: AnimatedBuilder(
          animation: controller,
          builder: (context, _) => AppShell(controller: controller),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.text('收藏本'));
    await tester.pump();
    await tester.tap(find.text('1988 数一二'));
    await tester.pump();

    await expectLater(
      find.byType(AppShell),
      matchesGoldenFile('goldens/favorite_workspace_landscape.png'),
    );
    controller.dispose();
  });

  test('进度可以写入私有目录、重新读取并导出 JSON', () async {
    final directory =
        await Directory.systemTemp.createTemp('daguan-storage-test-');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    Map<String, dynamic>? exportedArguments;
    messenger.setMockMethodCallHandler(
      const MethodChannel('daguan.local/storage'),
      (call) async {
        if (call.method == 'getFilesDir') return directory.path;
        if (call.method == 'exportJson') {
          exportedArguments = Map<String, dynamic>.from(call.arguments as Map);
          return 'content://daguan-test/progress.json';
        }
        throw PlatformException(code: 'unknown_method');
      },
    );
    addTearDown(() async {
      messenger.setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      if (directory.existsSync()) {
        await directory.delete(recursive: true);
      }
    });

    final firstStorage = LocalStorage();
    final progress = await firstStorage.loadProgress();
    (progress['states'] as Map<String, dynamic>)['999'] = {
      'mastery': 'needs_practice',
      'favorite': true,
      'note': '本地测试备注',
      'updatedAt': '2026-07-28T23:00:00.000',
      'selectedOptions': ['A'],
      'lastCorrect': false,
      'wrongCount': 2,
      'inWrongBook': true,
      'lastAttemptAt': '2026-07-29T12:00:00.000',
    };
    await firstStorage.save(progress);

    final secondStorage = LocalStorage();
    final reloaded = await secondStorage.loadProgress();
    expect(
      (reloaded['states'] as Map<String, dynamic>)['999']['note'],
      '本地测试备注',
    );
    expect(
      (reloaded['states'] as Map<String, dynamic>)['999']['inWrongBook'],
      isTrue,
    );
    expect(await secondStorage.export(reloaded), isTrue);
    expect(exportedArguments, isNotNull);
    expect(exportedArguments!['name'], contains('大观园题库进度_'));
    final exportedJson = jsonDecode(exportedArguments!['json'] as String)
        as Map<String, dynamic>;
    expect(
      (exportedJson['states'] as Map<String, dynamic>)['999']['favorite'],
      isTrue,
    );
  });

  test('完全重置清除进度、全部画布和书写工具设置', () async {
    final directory =
        await Directory.systemTemp.createTemp('daguan-reset-test-');
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

    final storage = LocalStorage();
    final progress = await storage.loadProgress();
    (progress['states'] as Map<String, dynamic>)['52'] = {
      'mastery': 'not_known',
      'favorite': true,
      'note': '应被清除',
    };
    await storage.save(progress);
    final document = HandwritingDocument.empty(52)
      ..apply(
        CanvasOperation(
          added: [
            InkStroke(
              id: 'reset-stroke',
              points: const [InkPoint(1, 1, 1), InkPoint(2, 2, 1)],
              color: 0xff111827,
              width: 3,
              pressureStrength: .7,
            ),
          ],
          removed: const [],
        ),
      );
    await storage.saveHandwriting(document);
    await storage.saveWritingToolSettings(
      WritingToolSettings.defaults()..eraserWidth = 96,
    );

    await storage.clearAllUserData();

    final reopenedStorage = LocalStorage();
    final blank = await reopenedStorage.loadProgress();
    expect(blank['states'], isEmpty);
    expect(blank['events'], isEmpty);
    expect((await reopenedStorage.loadHandwriting(52)).strokes, isEmpty);
    expect((await reopenedStorage.loadWritingToolSettings()).eraserWidth, 24);
  });

  test('旧版需练习只清理一次并保留收藏、笔记、记录和画布位置', () async {
    final directory =
        await Directory.systemTemp.createTemp('daguan-resume-test-');
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

    final questionData =
        decodeObject(await rootBundle.loadString('assets/questions.json'));
    final rawQuestion =
        Map<String, dynamic>.from((questionData['items'] as List).first as Map);
    final questionId = rawQuestion['id'] as int;
    final categoryId = (rawQuestion['categoryIds'] as List).first as int;
    await File(
      '${directory.path}${Platform.pathSeparator}progress.json',
    ).writeAsString(
      jsonEncode({
        'states': {
          '$questionId': {
            'mastery': 'needs_practice',
            'favorite': true,
            'note': '迁移后保留',
            'selectedOptions': <String>['A'],
            'lastCorrect': false,
            'wrongCount': 3,
            'lastAttemptAt': '2026-08-01T08:00:00.000',
            'reviewOrigin': {
              'categoryId': categoryId,
              'categoryPath': '旧来源',
              'position': 1,
            },
          },
        },
        'events': [
          {
            'id': 'keep-event',
            'questionId': questionId,
            'categoryId': categoryId,
            'action': 'answer_wrong',
            'createdAt': '2026-08-01T08:00:00.000',
            'categoryName': '旧来源',
            'serial': 1,
          },
        ],
        'lastStudy': {
          'category_id': categoryId,
          'last_question_id': questionId,
          'workspace_page': 2,
          'review_filter': 'needsPractice',
          'canvas_open': true,
        },
      }),
    );

    final controller = AppController();
    await controller.load();
    expect(controller.workspacePage, 0);
    expect(controller.reviewFilter, ReviewFilter.needsPractice);
    expect(controller.selectedQuestionId, questionId);
    expect(controller.navigationBook, isNull);
    final migrated = controller.stateOf(questionId);
    expect(migrated.mastery, Mastery.notStarted);
    expect(migrated.favorite, isTrue);
    expect(migrated.note, '迁移后保留');
    expect(migrated.selectedOptions, isEmpty);
    expect(migrated.lastCorrect, isNull);
    expect(migrated.wrongCount, 0);
    expect(migrated.lastAttemptAt, isNull);
    expect(migrated.reviewOrigin, isNull);
    expect(controller.events.single.id, 'keep-event');
    expect(controller.takeResumeCanvasRequest(), isTrue);
    expect(controller.takeResumeCanvasRequest(), isFalse);
    final saved = decodeObject(
      await File(
        '${directory.path}${Platform.pathSeparator}progress.json',
      ).readAsString(),
    );
    expect(saved['version'], AppController.progressVersion);
    controller.dispose();
  });

  test('源站同步导入按题号合并，并保留文字笔记和手写文件', () async {
    final directory =
        await Directory.systemTemp.createTemp('daguan-import-test-');
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

    final controller = AppController();
    await controller.storage.loadProgress();
    final question = Question.fromJson({
      'id': 52,
      'serial': 52,
      'categoryIds': <int>[],
      'stem': '测试题',
      'options': <String>[],
      'answer': '1',
      'explanation': '',
      'source': '',
    });
    controller.questions.add(question);
    controller.states[52] = QuestionState(
      note: '必须保留的本地文字笔记',
      selectedOptions: const ['A'],
      lastCorrect: false,
      wrongCount: 2,
    );
    final handwriting = HandwritingDocument.empty(52);
    handwriting.apply(
      CanvasOperation(
        added: [
          InkStroke(
            id: 'keep-stroke',
            points: const [InkPoint(1, 1, 1), InkPoint(2, 2, 1)],
            color: 0xff111827,
            width: 3,
            pressureStrength: .7,
          ),
        ],
        removed: const [],
      ),
    );
    await controller.storage.saveHandwriting(handwriting);

    final result = await controller.importSyncJson(
      jsonEncode({
        'format': 'daguan-user-data',
        'version': 1,
        'question_states': {
          'states': [
            {
              'question_id': 52,
              'user_state': {
                'mastery': 'not_known',
                'favorited_at': '2026-07-30T12:00:00Z',
                'note': '远端笔记不得覆盖本地',
                'updated_at': '2026-07-30T12:00:00Z',
              },
            },
            {
              'question_id': 999999,
              'user_state': {
                'mastery': 'mastered',
                'favorited_at': null,
              },
            },
          ],
        },
        'practice_events': {
          'items': [
            {
              'id': 'source-event-1',
              'question_id': 52,
              'category_id': null,
              'action': 'needs_practice_mark',
              'created_at': '2026-07-30T12:00:00Z',
              'category_name': '',
              'question_serial': 52,
            },
          ],
        },
      }),
    );

    expect(result.updatedQuestions, 1);
    expect(result.importedEvents, 1);
    expect(result.ignoredQuestionIds, 1);
    expect(controller.states[52]!.mastery, Mastery.notKnown);
    expect(controller.states[52]!.favorite, isTrue);
    expect(controller.states[52]!.note, '必须保留的本地文字笔记');
    expect(controller.states[52]!.selectedOptions, const ['A']);
    expect(controller.states[52]!.wrongCount, 2);
    expect(controller.events.single.id, 'source-event-1');
    expect(
      (await controller.storage.loadHandwriting(52)).strokes.single.id,
      'keep-stroke',
    );

    final progressFile = File(
      '${directory.path}${Platform.pathSeparator}progress.json',
    );
    final beforeInvalidImport = await progressFile.readAsString();
    await expectLater(
      controller.importSyncJson(
        '{"question_states":{"states":[{"question_id":52,'
        '"user_state":{"mastery":"invalid"}}]}}',
      ),
      throwsFormatException,
    );
    expect(await progressFile.readAsString(), beforeInvalidImport);
    expect(controller.states[52]!.mastery, Mastery.notKnown);
  });
}
