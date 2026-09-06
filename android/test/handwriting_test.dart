import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:daguan_math/handwriting_canvas.dart';
import 'package:daguan_math/handwriting_eraser.dart';
import 'package:daguan_math/handwriting_models.dart';
import 'package:daguan_math/models.dart';
import 'package:daguan_math/storage.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('矢量笔迹可以序列化，并保留跨退出撤销记录', () {
    final document = HandwritingDocument.empty(52, textNote: '极限易错点');
    final stroke = InkStroke(
      id: 'stroke-1',
      points: const [
        InkPoint(10, 20, .3),
        InkPoint(30, 40, .9),
      ],
      color: 0xff2563eb,
      width: 4,
      pressureStrength: .7,
    );
    document.apply(CanvasOperation(added: [stroke], removed: []));

    final restored = HandwritingDocument.fromJson(
      jsonDecode(jsonEncode(document.toJson())) as Map<String, dynamic>,
      questionId: 52,
    );

    expect(restored.textNote, '极限易错点');
    expect(restored.strokes.single.points.last.pressure, .9);
    expect(restored.undoHistory, hasLength(1));
    expect(restored.undo(), isTrue);
    expect(restored.strokes, isEmpty);
    expect(restored.redo(), isTrue);
    expect(restored.strokes.single.id, 'stroke-1');
  });

  test('橡皮真正切掉笔迹，移动后不会还原被擦部分', () {
    final document = HandwritingDocument.empty(52);
    final ink = InkStroke(
      id: 'ink',
      points: [
        for (var x = 0; x <= 100; x += 10) InkPoint(x.toDouble(), 0, 1),
      ],
      color: 0xff111827,
      width: 4,
      pressureStrength: 0,
    );
    document.apply(CanvasOperation(added: [ink], removed: const []));
    final eraser = InkStroke(
      id: 'eraser',
      points: const [
        InkPoint(50, -20, 1),
        InkPoint(50, 20, 1),
      ],
      color: 0,
      width: 16,
      pressureStrength: 0,
      erase: true,
    );
    var nextId = 0;

    final operation = buildDestructiveEraseOperation(
      existingStrokes: document.strokes,
      completedStrokes: [eraser],
      nextStrokeId: () => 'fragment-${nextId++}',
    );
    document.apply(operation);

    expect(operation.removed, [ink]);
    expect(document.strokes, hasLength(2));
    expect(document.strokes.every((stroke) => !stroke.erase), isTrue);
    expect(
      document.strokes.any(
        (stroke) => stroke.points.first.x < 50 && stroke.points.last.x > 50,
      ),
      isFalse,
    );

    final moved = [
      for (final stroke in document.strokes)
        stroke.translated(const Offset(0, 40)),
    ];
    expect(
      moved.any(
        (stroke) => stroke.points.first.x < 50 && stroke.points.last.x > 50,
      ),
      isFalse,
    );
    expect(document.undo(), isTrue);
    expect(document.strokes.single.id, 'ink');
    expect(document.redo(), isTrue);
    expect(document.strokes, hasLength(2));
  });

  test('旧遮罩按绘制顺序转为真实擦除并彻底移除历史', () {
    InkStroke line(String id, double y) => InkStroke(
          id: id,
          points: [
            for (var x = 0; x <= 100; x += 10) InkPoint(x.toDouble(), y, 1),
          ],
          color: 0xff111827,
          width: 4,
          pressureStrength: 0,
        );

    final beforeErase = line('before', 0);
    final eraser = InkStroke(
      id: 'legacy-eraser',
      points: const [InkPoint(50, -20, 1), InkPoint(50, 20, 1)],
      color: 0,
      width: 16,
      pressureStrength: 0,
      erase: true,
    );
    final afterErase = line('after', 0);
    final document = HandwritingDocument.empty(52)
      ..strokes.addAll([beforeErase, eraser, afterErase])
      ..undoHistory.add(
        CanvasOperation(added: [eraser], removed: const []),
      )
      ..redoHistory.add(
        CanvasOperation(added: const [], removed: [eraser]),
      );

    expect(migrateLegacyEraseDocument(document), isTrue);

    expect(document.strokes.every((stroke) => !stroke.erase), isTrue);
    expect(
        document.strokes.where((stroke) => stroke.id == 'after'), [afterErase]);
    expect(
      document.strokes.where((stroke) => stroke.id != 'after').any(
            (stroke) => stroke.points.first.x < 50 && stroke.points.last.x > 50,
          ),
      isFalse,
    );
    expect(document.undoHistory, isEmpty);
    expect(document.redoHistory, isEmpty);
    expect(migrateLegacyEraseDocument(document), isFalse);
  });

  test('启动时会迁移并回写所有旧遮罩画布', () async {
    final directory =
        await Directory.systemTemp.createTemp('daguan-eraser-migration-');
    final handwritingDirectory = Directory(
      '${directory.path}${Platform.pathSeparator}handwriting',
    );
    await handwritingDirectory.create();
    final progressFile = File(
      '${directory.path}${Platform.pathSeparator}progress.json',
    );
    await progressFile.writeAsString('{"states":{},"events":[]}');
    final oldDocument = HandwritingDocument.empty(52);
    final ink = InkStroke(
      id: 'old-ink',
      points: [
        for (var x = 0; x <= 100; x += 10) InkPoint(x.toDouble(), 0, 1),
      ],
      color: 0xff111827,
      width: 4,
      pressureStrength: 0,
    );
    final eraser = InkStroke(
      id: 'old-eraser',
      points: const [InkPoint(50, -20, 1), InkPoint(50, 20, 1)],
      color: 0,
      width: 16,
      pressureStrength: 0,
      erase: true,
    );
    oldDocument
      ..strokes.addAll([ink, eraser])
      ..undoHistory.add(
        CanvasOperation(added: [eraser], removed: const []),
      );
    final handwritingFile = File(
      '${handwritingDirectory.path}${Platform.pathSeparator}52.json',
    );
    await handwritingFile.writeAsString(jsonEncode(oldDocument.toJson()));
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('daguan.local/storage'),
      (call) async {
        if (call.method == 'getFilesDir') return directory.path;
        throw PlatformException(code: 'unknown_method');
      },
    );

    try {
      final storage = LocalStorage();
      await storage.loadProgress();
      final restored = await storage.loadHandwriting(52);
      final saved = await handwritingFile.readAsString();

      expect(restored.strokes, hasLength(2));
      expect(restored.strokes.every((stroke) => !stroke.erase), isTrue);
      expect(restored.undoHistory, isEmpty);
      expect(restored.redoHistory, isEmpty);
      expect(saved, isNot(contains('"erase":true')));
    } finally {
      messenger.setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      if (directory.existsSync()) await directory.delete(recursive: true);
    }
  });

  test('每题只保留最近 50 次撤销操作', () {
    final document = HandwritingDocument.empty(1);
    for (var index = 0; index < 55; index++) {
      document.apply(
        CanvasOperation(
          added: [
            InkStroke(
              id: '$index',
              points: [
                InkPoint(index.toDouble(), 0, 1),
                InkPoint(index.toDouble() + 1, 1, 1),
              ],
              color: 0xff111827,
              width: 3,
              pressureStrength: .5,
            ),
          ],
          removed: [],
        ),
      );
    }
    expect(document.undoHistory, hasLength(50));
    for (var index = 0; index < 50; index++) {
      expect(document.undo(), isTrue);
    }
    expect(document.undo(), isFalse);
    expect(
        document.strokes.map((stroke) => stroke.id), ['0', '1', '2', '3', '4']);
  });

  test('书写工具设置使用独立格式并保留全部参数', () {
    final settings = WritingToolSettings.defaults()
      ..penPresets[1] = const PenPreset(
        color: 0xff16a34a,
        width: 8,
        pressureStrength: .25,
      )
      ..activePen = 1
      ..eraserWidth = 64
      ..eraserPressureStrength = .8
      ..pressureEraseEnabled = true
      ..pressureEraseThreshold = .82;

    final restored = WritingToolSettings.fromJson(
      jsonDecode(jsonEncode(settings.toJson())) as Map<String, dynamic>,
    );

    expect(restored.penPresets[1].color, 0xff16a34a);
    expect(restored.penPresets[1].width, 8);
    expect(restored.penPresets[1].pressureStrength, .25);
    expect(restored.activePen, 1);
    expect(restored.eraserWidth, 64);
    expect(restored.eraserPressureStrength, .8);
    expect(restored.pressureEraseEnabled, isTrue);
    expect(restored.pressureEraseThreshold, .82);
  });

  test('矢量卡片副本可以独立保存并撤销', () {
    final document = HandwritingDocument.empty(52);
    const copy = CanvasCardCopy(
      id: 'card-copy-1',
      source: 'question',
      state: CanvasCardState(x: 160, y: 180, width: 640),
    );
    document.apply(
      CanvasOperation(
        added: const [],
        removed: const [],
        addedCards: const [copy],
      ),
    );

    final restored = HandwritingDocument.fromJson(
      jsonDecode(jsonEncode(document.toJson())) as Map<String, dynamic>,
      questionId: 52,
    );

    expect(restored.cardCopies.single.source, 'question');
    expect(restored.toJson(), isNot(contains('penPresets')));
    expect(restored.toJson(), isNot(contains('pressureEraseEnabled')));
    expect(restored.undo(), isTrue);
    expect(restored.cardCopies, isEmpty);
    expect(restored.redo(), isTrue);
    expect(restored.cardCopies.single.id, 'card-copy-1');
  });

  test('基础卡片的移动与双轴缩放可以保存、撤销和重做', () {
    final document = HandwritingDocument.empty(52);
    final before = document.questionCard;
    const after = CanvasCardState(
      x: 180,
      y: 220,
      width: 720,
      scaleX: 1.4,
      scaleY: .8,
    );
    document.questionCard = after;
    document.recordApplied(
      CanvasOperation(
        added: const [],
        removed: const [],
        beforeBaseCards: {'question': before},
        afterBaseCards: const {'question': after},
      ),
    );

    final restored = HandwritingDocument.fromJson(
      jsonDecode(jsonEncode(document.toJson())) as Map<String, dynamic>,
      questionId: 52,
    );

    expect(restored.questionCard.scaleX, 1.4);
    expect(restored.questionCard.scaleY, .8);
    expect(restored.undo(), isTrue);
    expect(restored.questionCard.x, before.x);
    expect(restored.questionCard.scaleX, 1);
    expect(restored.redo(), isTrue);
    expect(restored.questionCard.x, 180);
    expect(restored.questionCard.scaleY, .8);
  });

  test('书写文件按题号独立保存，不会改写题库进度文件', () async {
    final directory =
        await Directory.systemTemp.createTemp('daguan-handwriting-store-');
    final progressFile = File(
      '${directory.path}${Platform.pathSeparator}progress.json',
    );
    await progressFile.writeAsString('{"states":{},"events":[]}');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('daguan.local/storage'),
      (call) async {
        if (call.method == 'getFilesDir') return directory.path;
        throw PlatformException(code: 'unknown_method');
      },
    );
    try {
      final storage = LocalStorage();
      await storage.loadProgress();
      final document = HandwritingDocument.empty(52);
      document.apply(
        CanvasOperation(
          added: [
            InkStroke(
              id: 'saved-stroke',
              points: const [
                InkPoint(1, 2, .4),
                InkPoint(3, 4, .8),
              ],
              color: 0xff111827,
              width: 3,
              pressureStrength: .7,
            ),
          ],
          removed: [],
        ),
      );
      await storage.saveHandwriting(document);
      final settings = WritingToolSettings.defaults()
        ..eraserWidth = 72
        ..pressureEraseEnabled = true;
      await storage.saveWritingToolSettings(settings);

      final reopenedStorage = LocalStorage();
      await reopenedStorage.loadProgress();
      final restored = await storage.loadHandwriting(52);
      final restoredSettings = await reopenedStorage.loadWritingToolSettings();
      expect(restored.strokes.single.id, 'saved-stroke');
      expect(restoredSettings.eraserWidth, 72);
      expect(restoredSettings.pressureEraseEnabled, isTrue);
      expect(progressFile.readAsStringSync(), '{"states":{},"events":[]}');
    } finally {
      messenger.setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      if (directory.existsSync()) await directory.delete(recursive: true);
    }
  });

  testWidgets('画布默认隐藏解析并接收手写笔矢量笔迹', (tester) async {
    final directory =
        Directory.systemTemp.createTempSync('daguan-handwriting-test-');
    final progressFile = File(
      '${directory.path}${Platform.pathSeparator}progress.json',
    );
    progressFile.writeAsStringSync('{"states":{},"events":[]}');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('daguan.local/storage'),
      (call) async {
        if (call.method == 'getFilesDir') return directory.path;
        throw PlatformException(code: 'unknown_method');
      },
    );

    try {
      final storage = LocalStorage();
      await tester.runAsync(storage.loadProgress);
      final question = Question.fromJson({
        'id': 52,
        'serial': 52,
        'categoryIds': [1],
        'stem': r'求极限 $\lim_{x\to0}\frac{\sin x}{x}$',
        'options': <String>[],
        'answer': '1',
        'explanation': '利用重要极限。',
        'source': '测试题',
      });

      await tester.pumpWidget(
        MaterialApp(
          home: HandwritingCanvasSession(
            storage: storage,
            initialContext: HandwritingQuestionContext(
              question: question,
              categoryPath: '高等数学 / 极限',
              textNote: '',
              displayPosition: 1,
              index: 0,
              total: 1,
              state: QuestionState(),
              correctOptionIndexes: const {},
            ),
            onNavigate: (_) => null,
            onOpenNavigator: (_) => null,
            onTextNoteChanged: (_, __) {},
            onToggleFavorite: (_) {},
            onSetMastery: (_, __) {},
            onSubmitAnswer: (_, __) {},
            onClearAnswer: (_) {},
          ),
        ),
      );
      await tester.pump();
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 300)),
      );
      await tester.pump(const Duration(milliseconds: 200));

      expect(find.text('利用重要极限。'), findsNothing);
      tester
          .widget<IconButton>(
            find.widgetWithIcon(
              IconButton,
              Icons.lightbulb_outline_rounded,
            ),
          )
          .onPressed!();
      await tester.pump();
      expect(find.text('利用重要极限。'), findsOneWidget);
      expect(
        tester.getTopLeft(find.text('利用重要极限。')).dy,
        lessThan(tester.view.physicalSize.height),
      );

      final gesture = await tester.createGesture(
        kind: PointerDeviceKind.stylus,
      );
      await gesture.down(const Offset(380, 310));
      await gesture.moveTo(const Offset(450, 360));
      await gesture.up();
      await tester.pump();
      final inkLayer = tester.widget<CustomPaint>(
        find.byKey(const ValueKey('handwriting-ink-layer')),
      );
      final dynamic inkPainter = inkLayer.painter;
      expect((inkPainter.strokes as List), hasLength(1));
      expect(progressFile.readAsStringSync(), '{"states":{},"events":[]}');

      final buttonGesture = await tester.createGesture(
        kind: PointerDeviceKind.stylus,
        buttons: kPrimaryButton | kPrimaryStylusButton,
      );
      await buttonGesture.down(const Offset(470, 330));
      await buttonGesture.moveTo(const Offset(520, 370));
      await tester.pump();
      final liveEraseLayer = tester.widget<CustomPaint>(
        find.byKey(const ValueKey('handwriting-ink-layer')),
      );
      final dynamic liveErasePainter = liveEraseLayer.painter;
      expect((liveErasePainter.strokes as List), hasLength(1));
      expect((liveErasePainter.overlayStrokes as List), hasLength(1));
      expect((liveErasePainter.overlayStrokes as List).last.erase, isTrue);
      await buttonGesture.up();
      await tester.pump();
      final buttonInkLayer = tester.widget<CustomPaint>(
        find.byKey(const ValueKey('handwriting-ink-layer')),
      );
      final dynamic buttonInkPainter = buttonInkLayer.painter;
      expect((buttonInkPainter.strokes as List), hasLength(1));
      expect(
        (buttonInkPainter.strokes as List).every((stroke) => !stroke.erase),
        isTrue,
      );

      await tester.tap(find.byTooltip('套索'));
      await tester.pump();
      final titleRect = tester.getRect(find.text('题目'));
      final lasso = await tester.createGesture(
        kind: PointerDeviceKind.stylus,
      );
      await lasso.down(titleRect.topLeft - const Offset(8, 8));
      await lasso.moveTo(titleRect.topRight + const Offset(8, -8));
      await lasso.moveTo(titleRect.bottomRight + const Offset(8, 8));
      await lasso.moveTo(titleRect.bottomLeft + const Offset(-8, 8));
      await lasso.moveTo(titleRect.topLeft - const Offset(8, 8));
      await lasso.up();
      await tester.pump();
      expect(
        find.byIcon(Icons.control_point_duplicate_rounded),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.copy_rounded), findsNothing);

      await tester.tap(find.byIcon(Icons.control_point_duplicate_rounded));
      await tester.pumpAndSettle();
      expect(find.text('题目'), findsNWidgets(2));

      final canvasRect = tester.getRect(
        find.byKey(const ValueKey('handwriting-ink-layer')),
      );
      final blankTap = await tester.createGesture(
        kind: PointerDeviceKind.stylus,
      );
      await blankTap.down(
        Offset(canvasRect.right - 24, canvasRect.bottom - 100),
      );
      await blankTap.up();
      await tester.pumpAndSettle();
      expect(find.text('粘贴'), findsNothing);
      expect(
        find.byIcon(Icons.control_point_duplicate_rounded),
        findsNothing,
      );

      final penAfterBlankTap = await tester.createGesture(
        kind: PointerDeviceKind.stylus,
      );
      await penAfterBlankTap.down(const Offset(600, 430));
      await penAfterBlankTap.moveTo(const Offset(650, 460));
      await penAfterBlankTap.up();
      await tester.pump();
      final finalInkLayer = tester.widget<CustomPaint>(
        find.byKey(const ValueKey('handwriting-ink-layer')),
      );
      final dynamic finalInkPainter = finalInkLayer.painter;
      expect((finalInkPainter.strokes as List), hasLength(2));
      expect((finalInkPainter.strokes as List).last.erase, isFalse);
      final stateBeforeRestart = tester.state(
        find.byType(HandwritingCanvasPage),
      );
      final offsetBeforeRestart = finalInkPainter.offset as Offset;
      final scaleBeforeRestart = finalInkPainter.scale as double;
      final firstRecorder = ui.PictureRecorder();
      finalInkPainter.paint(
        Canvas(firstRecorder),
        const Size(800, 600),
      );
      firstRecorder.endRecording().dispose();
      final cacheBuildCount = finalInkPainter.cacheBuildCount as int;
      final secondRecorder = ui.PictureRecorder();
      finalInkPainter.paint(
        Canvas(secondRecorder),
        const Size(800, 600),
      );
      secondRecorder.endRecording().dispose();
      expect(finalInkPainter.cacheBuildCount, cacheBuildCount);

      final reloadCanvas = tester
          .widget<IconButton>(find.byKey(const ValueKey('canvas-reload')))
          .onPressed!;
      reloadCanvas();
      State? stateAfterRestart;
      for (var attempt = 0; attempt < 20; attempt++) {
        await tester.pump(const Duration(milliseconds: 50));
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        final canvasPage = find.byType(HandwritingCanvasPage);
        if (canvasPage.evaluate().isEmpty ||
            find
                .byKey(const ValueKey('handwriting-ink-layer'))
                .evaluate()
                .isEmpty) {
          continue;
        }
        final candidate = tester.state(canvasPage);
        if (!identical(candidate, stateBeforeRestart)) {
          stateAfterRestart = candidate;
          break;
        }
      }
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(
        find.text('画布已重新启动，当前位置和书写内容完整保留'),
        findsOneWidget,
      );
      expect(stateAfterRestart, isNotNull);
      expect(identical(stateAfterRestart, stateBeforeRestart), isFalse);
      final reloadedInkLayer = tester.widget<CustomPaint>(
        find.byKey(const ValueKey('handwriting-ink-layer')),
      );
      final dynamic reloadedInkPainter = reloadedInkLayer.painter;
      expect((reloadedInkPainter.strokes as List), hasLength(2));
      expect(reloadedInkPainter.offset, offsetBeforeRestart);
      expect(reloadedInkPainter.scale, scaleBeforeRestart);

      await tester.tap(find.byKey(const ValueKey('canvas-reset-current')));
      await tester.pumpAndSettle();
      expect(find.text('重置当前书写画布？'), findsOneWidget);
      await tester.tap(find.text('确认重置'));
      await tester.pumpAndSettle();
      final resetInkLayer = tester.widget<CustomPaint>(
        find.byKey(const ValueKey('handwriting-ink-layer')),
      );
      final dynamic resetInkPainter = resetInkLayer.painter;
      expect((resetInkPainter.strokes as List), isEmpty);
      expect(find.text('题目'), findsOneWidget);
      expect(find.text('利用重要极限。'), findsNothing);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    } finally {
      messenger.setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      if (directory.existsSync()) {
        await tester.runAsync(() async {
          for (var attempt = 0; attempt < 6; attempt++) {
            try {
              await directory.delete(recursive: true);
              return;
            } on PathAccessException {
              await Future<void>.delayed(const Duration(milliseconds: 100));
            }
          }
        });
      }
    }
  });

  testWidgets('显示屏外解析时保持缩放并平滑定位且不改旧卡片位置', (tester) async {
    final directory =
        Directory.systemTemp.createTempSync('daguan-analysis-pan-test-');
    File(
      '${directory.path}${Platform.pathSeparator}progress.json',
    ).writeAsStringSync('{"states":{},"events":[]}');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('daguan.local/storage'),
      (call) async {
        if (call.method == 'getFilesDir') return directory.path;
        throw PlatformException(code: 'unknown_method');
      },
    );

    try {
      final storage = LocalStorage();
      await tester.runAsync(storage.loadProgress);
      final saved = HandwritingDocument.empty(62)
        ..analysisCard = const CanvasCardState(x: 240, y: 1400, width: 720)
        ..viewOffset = const Offset(18, 20)
        ..viewScale = .75;
      await tester.runAsync(() => storage.saveHandwriting(saved));
      final question = Question.fromJson({
        'id': 62,
        'serial': 62,
        'categoryIds': [1],
        'stem': '计算给定极限。',
        'options': <String>[],
        'answer': '1',
        'explanation': '这是需要自动定位到的解析内容。',
        'source': '测试题',
      });

      tester.view
        ..physicalSize = const Size(800, 600)
        ..devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      await tester.pumpWidget(
        MaterialApp(
          home: HandwritingCanvasPage(
            storage: storage,
            initialContext: HandwritingQuestionContext(
              question: question,
              categoryPath: '高等数学 / 极限',
              textNote: '',
              displayPosition: 1,
              index: 0,
              total: 1,
              state: QuestionState(),
              correctOptionIndexes: const {},
            ),
            onNavigate: (_) => null,
            onOpenNavigator: (_) => null,
            onTextNoteChanged: (_, __) {},
            onToggleFavorite: (_) {},
            onSetMastery: (_, __) {},
            onSubmitAnswer: (_, __) {},
            onClearAnswer: (_) {},
          ),
        ),
      );
      await tester.pump();
      for (var attempt = 0; attempt < 10; attempt++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 80)),
        );
        await tester.pump();
        if (find.byType(CircularProgressIndicator).evaluate().isEmpty) break;
      }
      expect(find.byType(CircularProgressIndicator), findsNothing);

      tester
          .widget<IconButton>(
            find.widgetWithIcon(
              IconButton,
              Icons.lightbulb_outline_rounded,
            ),
          )
          .onPressed!();
      await tester.pump();
      final explanation = find.text('这是需要自动定位到的解析内容。');
      expect(explanation, findsOneWidget);
      final beforePan = tester.getRect(explanation);
      await tester.pump(const Duration(milliseconds: 320));
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pump(const Duration(milliseconds: 600));
      final afterPan = tester.getRect(explanation);
      expect(afterPan.top, lessThan(beforePan.top));
      expect(afterPan.top, lessThan(600));
      expect(afterPan.size, beforePan.size);
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      final restored = await tester.runAsync(
        () => storage.loadHandwriting(question.id),
      );

      expect(restored!.analysisCard.x, 240);
      expect(restored.analysisCard.y, 1400);
      expect(restored.viewScale, .75);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    } finally {
      messenger.setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      if (directory.existsSync()) {
        await tester.runAsync(() async {
          for (var attempt = 0; attempt < 6; attempt++) {
            try {
              await directory.delete(recursive: true);
              return;
            } on PathAccessException {
              await Future<void>.delayed(const Duration(milliseconds: 100));
            }
          }
        });
      }
    }
  });

  test('超长解析的导出边界不受固定高度上限截断并优先采用实测高度', () {
    final question = Question.fromJson({
      'id': 1412,
      'serial': 1023,
      'categoryIds': [406],
      'stem': '测试题干',
      'options': <String>[],
      'answer': 'A',
      'explanation': List.filled(1300, '长').join(),
      'source': '测试题',
    });
    final document = HandwritingDocument.empty(question.id);

    final estimated = handwritingExportContentBounds(
      document,
      question,
      analysisVisible: true,
      includeTextNote: false,
    );
    final measured = handwritingExportContentBounds(
      document,
      question,
      analysisVisible: true,
      includeTextNote: false,
      cardHeights: const {'analysis': 2400},
    );

    expect(estimated.bottom, greaterThan(2800));
    expect(measured.bottom, 3208);
  });

  testWidgets('打开超长解析时按真实卡片高度缩小并完整聚焦', (tester) async {
    final directory =
        Directory.systemTemp.createTempSync('daguan-long-analysis-test-');
    File(
      '${directory.path}${Platform.pathSeparator}progress.json',
    ).writeAsStringSync('{"states":{},"events":[]}');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('daguan.local/storage'),
      (call) async {
        if (call.method == 'getFilesDir') return directory.path;
        throw PlatformException(code: 'unknown_method');
      },
    );

    try {
      final storage = LocalStorage();
      await tester.runAsync(storage.loadProgress);
      final root = jsonDecode(File('assets/questions.json').readAsStringSync())
          as Map<String, dynamic>;
      final rawQuestion = (root['items'] as List<dynamic>)
          .cast<Map<String, dynamic>>()
          .singleWhere((item) => item['id'] == 1412);
      final question = Question.fromJson(rawQuestion);
      final saved = HandwritingDocument.empty(question.id)
        ..analysisCard = const CanvasCardState(x: 240, y: 1400, width: 720)
        ..viewOffset = const Offset(18, 20)
        ..viewScale = .75;
      await tester.runAsync(() => storage.saveHandwriting(saved));

      tester.view
        ..physicalSize = const Size(800, 600)
        ..devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      await tester.pumpWidget(
        MaterialApp(
          home: HandwritingCanvasPage(
            storage: storage,
            initialContext: HandwritingQuestionContext(
              question: question,
              categoryPath: '高等数学 / 一元微分',
              textNote: '',
              displayPosition: 13,
              index: 12,
              total: 23,
              state: QuestionState(),
              correctOptionIndexes: const {0},
            ),
            onNavigate: (_) => null,
            onOpenNavigator: (_) => null,
            onTextNoteChanged: (_, __) {},
            onToggleFavorite: (_) {},
            onSetMastery: (_, __) {},
            onSubmitAnswer: (_, __) {},
            onClearAnswer: (_) {},
          ),
        ),
      );
      await tester.pump();
      for (var attempt = 0; attempt < 10; attempt++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 80)),
        );
        await tester.pump();
        if (find.byType(CircularProgressIndicator).evaluate().isEmpty) break;
      }

      tester
          .widget<IconButton>(
            find.widgetWithIcon(
              IconButton,
              Icons.lightbulb_outline_rounded,
            ),
          )
          .onPressed!();
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));

      final analysisCard = find
          .ancestor(
            of: find.text('答案与解析'),
            matching: find.byType(Container),
          )
          .first;
      final cardBox = tester.renderObject<RenderBox>(analysisCard);
      final cardRect = Rect.fromPoints(
        cardBox.localToGlobal(Offset.zero),
        cardBox.localToGlobal(cardBox.size.bottomRight(Offset.zero)),
      );
      expect(cardRect.top, greaterThanOrEqualTo(0));
      expect(cardRect.bottom, lessThanOrEqualTo(600));

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    } finally {
      messenger.setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      if (directory.existsSync()) {
        await tester.runAsync(() async {
          for (var attempt = 0; attempt < 6; attempt++) {
            try {
              await directory.delete(recursive: true);
              return;
            } on PathAccessException {
              await Future<void>.delayed(const Duration(milliseconds: 100));
            }
          }
        });
      }
    }
  });

  testWidgets('双击切换保留重压擦除设置，触发后保持橡皮直到提笔', (tester) async {
    final directory =
        Directory.systemTemp.createTempSync('daguan-pressure-eraser-test-');
    final progressFile = File(
      '${directory.path}${Platform.pathSeparator}progress.json',
    );
    progressFile.writeAsStringSync('{"states":{},"events":[]}');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('daguan.local/storage'),
      (call) async {
        if (call.method == 'getFilesDir') return directory.path;
        throw PlatformException(code: 'unknown_method');
      },
    );

    try {
      final storage = LocalStorage();
      await tester.runAsync(storage.loadProgress);
      final question = Question.fromJson({
        'id': 52,
        'serial': 52,
        'categoryIds': [1],
        'stem': '压感擦除测试题',
        'options': <String>[],
        'answer': '1',
        'explanation': '',
        'source': '测试题',
      });

      await tester.pumpWidget(
        MaterialApp(
          home: HandwritingCanvasPage(
            storage: storage,
            initialContext: HandwritingQuestionContext(
              question: question,
              categoryPath: '高等数学 / 极限',
              textNote: '',
              displayPosition: 1,
              index: 0,
              total: 1,
              state: QuestionState(),
              correctOptionIndexes: const {},
            ),
            onNavigate: (_) => null,
            onOpenNavigator: (_) => null,
            onTextNoteChanged: (_, __) {},
            onToggleFavorite: (_) {},
            onSetMastery: (_, __) {},
            onSubmitAnswer: (_, __) {},
            onClearAnswer: (_) {},
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 120));

      await tester.tap(find.byIcon(Icons.auto_fix_normal_rounded));
      await tester.pump();
      await tester.tap(find.byIcon(Icons.auto_fix_normal_rounded));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byType(SwitchListTile));
      await tester.pump();
      await tester.tap(find.byType(SwitchListTile));
      await tester.pump();
      expect(
        tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
        isTrue,
      );
      Navigator.of(tester.element(find.text('像素橡皮'))).pop();
      await tester.pumpAndSettle();

      for (var index = 0; index < 2; index++) {
        await messenger.handlePlatformMessage(
          'daguan.local/storage',
          const StandardMethodCodec().encodeMethodCall(
            MethodCall('pencilDoubleClick'),
          ),
          null,
        );
        await tester.pump();
      }
      await tester.tap(find.byIcon(Icons.auto_fix_normal_rounded));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byType(SwitchListTile));
      await tester.pump();
      final pressureSwitch =
          tester.widget<SwitchListTile>(find.byType(SwitchListTile));
      expect(pressureSwitch.value, isTrue);
      Navigator.of(tester.element(find.text('像素橡皮'))).pop();
      await tester.pumpAndSettle();

      await messenger.handlePlatformMessage(
        'daguan.local/storage',
        const StandardMethodCodec().encodeMethodCall(
          MethodCall('pencilDoubleClick'),
        ),
        null,
      );
      await tester.pump();

      const pointer = 73;
      await tester.sendEventToBinding(
        const PointerDownEvent(
          pointer: pointer,
          position: Offset(360, 300),
          kind: PointerDeviceKind.stylus,
          buttons: kPrimaryButton,
          pressure: .2,
          pressureMin: 0,
          pressureMax: 1,
        ),
      );
      await tester.sendEventToBinding(
        const PointerMoveEvent(
          pointer: pointer,
          position: Offset(410, 330),
          delta: Offset(50, 30),
          kind: PointerDeviceKind.stylus,
          buttons: kPrimaryButton,
          pressure: .9,
          pressureMin: 0,
          pressureMax: 1,
        ),
      );
      await tester.sendEventToBinding(
        const PointerMoveEvent(
          pointer: pointer,
          position: Offset(455, 355),
          delta: Offset(45, 25),
          kind: PointerDeviceKind.stylus,
          buttons: kPrimaryButton,
          pressure: .2,
          pressureMin: 0,
          pressureMax: 1,
        ),
      );
      await tester.pump();
      final activeInkLayer = tester.widget<CustomPaint>(
        find.byKey(const ValueKey('handwriting-ink-layer')),
      );
      final dynamic activeInkPainter = activeInkLayer.painter;
      expect((activeInkPainter.overlayStrokes as List).last.erase, isTrue);
      await tester.sendEventToBinding(
        const PointerUpEvent(
          pointer: pointer,
          position: Offset(455, 355),
          kind: PointerDeviceKind.stylus,
          pressure: 0,
          pressureMin: 0,
          pressureMax: 1,
        ),
      );
      await tester.pump();

      final inkLayer = tester.widget<CustomPaint>(
        find.byKey(const ValueKey('handwriting-ink-layer')),
      );
      final dynamic inkPainter = inkLayer.painter;
      final strokes = inkPainter.strokes as List;
      expect(strokes, isEmpty);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      messenger.setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      if (directory.existsSync()) {
        await tester.runAsync(() async {
          for (var attempt = 0; attempt < 6; attempt++) {
            try {
              await directory.delete(recursive: true);
              return;
            } on PathAccessException {
              await Future<void>.delayed(const Duration(milliseconds: 100));
            }
          }
        });
      }
    }
  });

  testWidgets('画布导航、收藏标记和卡片答题复用同一题目状态', (tester) async {
    final directory =
        Directory.systemTemp.createTempSync('daguan-canvas-actions-test-');
    File(
      '${directory.path}${Platform.pathSeparator}progress.json',
    ).writeAsStringSync('{"states":{},"events":[]}');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('daguan.local/storage'),
      (call) async {
        if (call.method == 'getFilesDir') return directory.path;
        throw PlatformException(code: 'unknown_method');
      },
    );
    try {
      final storage = LocalStorage();
      await tester.runAsync(storage.loadProgress);
      final first = Question.fromJson({
        'id': 52,
        'serial': 52,
        'categoryIds': [1],
        'stem': '选择正确答案',
        'options': ['选项一', '选项二'],
        'answer': 'B',
        'explanation': '第二项正确。',
        'source': '测试题',
        'type': 'single_choice',
      });
      final second = Question.fromJson({
        'id': 53,
        'serial': 53,
        'categoryIds': [1],
        'stem': '下一道题',
        'options': <String>[],
        'answer': '1',
        'explanation': '',
        'source': '测试题',
      });
      final firstState = QuestionState(note: '外部自动保存的文字笔记');
      final secondState = QuestionState();
      await tester.runAsync(
        () => storage.saveHandwriting(
          HandwritingDocument.empty(
            first.id,
            textNote: '画布里的旧文字笔记',
          ),
        ),
      );
      var navigatorOpened = false;
      HandwritingQuestionContext contextFor(
        Question question,
        QuestionState state,
        int index,
      ) =>
          HandwritingQuestionContext(
            question: question,
            categoryPath: '高等数学 / 极限',
            textNote: state.note,
            displayPosition: index + 1,
            index: index,
            total: 2,
            state: state,
            correctOptionIndexes: question.id == 52 ? const {1} : const {},
          );

      tester.view
        ..physicalSize = const Size(1800, 900)
        ..devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      await tester.pumpWidget(
        MaterialApp(
          home: HandwritingCanvasPage(
            storage: storage,
            initialContext: contextFor(first, firstState, 0),
            onNavigate: (_) => contextFor(second, secondState, 1),
            onOpenNavigator: (_) {
              navigatorOpened = true;
              return contextFor(second, secondState, 1);
            },
            onTextNoteChanged: (_, note) {
              firstState.note = note;
            },
            onToggleFavorite: (_) {
              firstState.favorite = !firstState.favorite;
            },
            onSetMastery: (_, mastery) {
              firstState.mastery = mastery;
            },
            onSubmitAnswer: (_, selected) {
              firstState
                ..selectedOptions = selected
                    .map((index) => String.fromCharCode(65 + index))
                    .toList()
                ..lastCorrect = selected.length == 1 && selected.contains(1);
              if (firstState.lastCorrect == false) {
                firstState.mastery = Mastery.needsPractice;
              }
            },
            onClearAnswer: (_) {
              firstState
                ..selectedOptions = []
                ..lastCorrect = null;
            },
          ),
        ),
      );
      await tester.pump();
      for (var attempt = 0; attempt < 10; attempt++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 80)),
        );
        await tester.pump();
        if (find.byType(CircularProgressIndicator).evaluate().isEmpty) break;
      }
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(
        find.byKey(const ValueKey('canvas-text-note-content')),
        findsOneWidget,
      );
      expect(find.text('外部自动保存的文字笔记'), findsOneWidget);
      expect(find.text('画布里的旧文字笔记'), findsNothing);

      await tester.tap(find.byTooltip('套索'));
      await tester.pump();
      final noteCenter = tester.getCenter(
        find.byKey(const ValueKey('canvas-text-note-content')),
      );
      await tester.sendEventToBinding(
        PointerDownEvent(
          pointer: 88,
          position: noteCenter,
          kind: PointerDeviceKind.touch,
        ),
      );
      await tester.sendEventToBinding(
        PointerUpEvent(
          pointer: 88,
          position: noteCenter,
          kind: PointerDeviceKind.touch,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('完成'), findsOneWidget);
      await tester.enterText(
        find.byType(TextField),
        '画布内输入后立即同步的文字笔记',
      );
      await tester.pump();
      expect(firstState.note, '画布内输入后立即同步的文字笔记');
      await tester.tap(find.text('完成'));
      await tester.pumpAndSettle();
      expect(find.text('画布内输入后立即同步的文字笔记'), findsOneWidget);
      await tester.tap(find.byTooltip('画笔 1；再次点击打开设置'));
      await tester.pump();

      await tester.tap(find.byKey(const ValueKey('canvas-favorite-toggle')));
      await tester.pump();
      expect(firstState.favorite, isTrue);

      await tester.tap(
        find.byKey(const ValueKey('canvas-question-state-menu')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('需练习'));
      await tester.pumpAndSettle();
      expect(firstState.mastery, Mastery.needsPractice);

      final optionCenter = tester.getCenter(find.text('A'));
      await tester.sendEventToBinding(
        PointerDownEvent(
          pointer: 91,
          position: optionCenter,
          kind: PointerDeviceKind.stylus,
          pressure: .5,
          pressureMin: 0,
          pressureMax: 1,
        ),
      );
      await tester.sendEventToBinding(
        PointerUpEvent(
          pointer: 91,
          position: optionCenter,
          kind: PointerDeviceKind.stylus,
          pressure: 0,
          pressureMin: 0,
          pressureMax: 1,
        ),
      );
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 200)),
      );
      await tester.pump();
      expect(firstState.lastCorrect, isNull);

      await tester.sendEventToBinding(
        PointerDownEvent(
          pointer: 92,
          position: optionCenter,
          kind: PointerDeviceKind.touch,
        ),
      );
      await tester.sendEventToBinding(
        PointerUpEvent(
          pointer: 92,
          position: optionCenter,
          kind: PointerDeviceKind.touch,
        ),
      );
      await tester.pump();
      expect(firstState.lastCorrect, isFalse);
      expect(find.text('回答错误，已标记为需练习'), findsOneWidget);

      await tester.sendEventToBinding(
        PointerDownEvent(
          pointer: 93,
          position: optionCenter,
          kind: PointerDeviceKind.touch,
        ),
      );
      await tester.sendEventToBinding(
        PointerUpEvent(
          pointer: 93,
          position: optionCenter,
          kind: PointerDeviceKind.touch,
        ),
      );
      await tester.pump();
      expect(firstState.lastCorrect, isNull);
      expect(firstState.selectedOptions, isEmpty);

      final openNavigator = tester
          .widget<IconButton>(
            find.byKey(const ValueKey('canvas-open-question-navigator')),
          )
          .onPressed!;
      await tester.runAsync(
        () async {
          openNavigator();
          await Future<void>.delayed(const Duration(milliseconds: 800));
        },
      );
      await tester.pump(const Duration(seconds: 1));
      expect(navigatorOpened, isTrue);
      expect(find.text('#2 · 测试题'), findsOneWidget);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      messenger.setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      if (directory.existsSync()) {
        await tester.runAsync(() async {
          for (var attempt = 0; attempt < 6; attempt++) {
            try {
              await directory.delete(recursive: true);
              return;
            } on PathAccessException {
              await Future<void>.delayed(const Duration(milliseconds: 100));
            }
          }
        });
      }
    }
  });

  testWidgets('画布多选题允许勾选多个选项后明确提交', (tester) async {
    final directory =
        Directory.systemTemp.createTempSync('daguan-canvas-multi-test-');
    File(
      '${directory.path}${Platform.pathSeparator}progress.json',
    ).writeAsStringSync('{"states":{},"events":[]}');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('daguan.local/storage'),
      (call) async {
        if (call.method == 'getFilesDir') return directory.path;
        throw PlatformException(code: 'unknown_method');
      },
    );
    try {
      final storage = LocalStorage();
      await tester.runAsync(storage.loadProgress);
      final question = Question.fromJson({
        'id': 54,
        'serial': 54,
        'categoryIds': [1],
        'stem': '选择所有正确答案',
        'options': ['选项一', '选项二', '选项三'],
        'answer': 'AC',
        'explanation': '',
        'source': '测试题',
        'type': 'multiple_choice',
      });
      final state = QuestionState();
      Set<int>? submitted;
      await tester.pumpWidget(
        MaterialApp(
          home: HandwritingCanvasPage(
            storage: storage,
            initialContext: HandwritingQuestionContext(
              question: question,
              categoryPath: '高等数学 / 极限',
              textNote: '',
              displayPosition: 1,
              index: 0,
              total: 1,
              state: state,
              correctOptionIndexes: const {0, 2},
            ),
            onNavigate: (_) => null,
            onOpenNavigator: (_) => null,
            onTextNoteChanged: (_, __) {},
            onToggleFavorite: (_) {},
            onSetMastery: (_, __) {},
            onSubmitAnswer: (_, selected) {
              submitted = Set<int>.from(selected);
              state
                ..selectedOptions = selected
                    .map((index) => String.fromCharCode(65 + index))
                    .toList()
                ..lastCorrect =
                    selected.length == 2 && selected.containsAll({0, 2});
            },
            onClearAnswer: (_) {
              state
                ..selectedOptions = []
                ..lastCorrect = null;
            },
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));

      Future<void> touch(Offset position, int pointer) async {
        await tester.sendEventToBinding(
          PointerDownEvent(
            pointer: pointer,
            position: position,
            kind: PointerDeviceKind.touch,
          ),
        );
        await tester.sendEventToBinding(
          PointerUpEvent(
            pointer: pointer,
            position: position,
            kind: PointerDeviceKind.touch,
          ),
        );
        await tester.pump();
      }

      await touch(tester.getCenter(find.text('A')), 101);
      await touch(tester.getCenter(find.text('C')), 102);
      expect(submitted, isNull);
      await touch(tester.getCenter(find.text('提交答案')), 103);
      expect(submitted, {0, 2});
      expect(state.lastCorrect, isTrue);
      expect(find.text('回答正确，已标记为已掌握'), findsOneWidget);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      messenger.setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      if (directory.existsSync()) {
        await tester.runAsync(() async {
          for (var attempt = 0; attempt < 6; attempt++) {
            try {
              await directory.delete(recursive: true);
              return;
            } on PathAccessException {
              await Future<void>.delayed(const Duration(milliseconds: 100));
            }
          }
        });
      }
    }
  });
}
