import 'dart:io';

import 'package:daguan_math/batch_export.dart';
import 'package:daguan_math/batch_export_models.dart';
import 'package:daguan_math/handwriting_models.dart';
import 'package:daguan_math/models.dart';
import 'package:daguan_math/storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Question question({String source = '(1988 数一)'}) => Question.fromJson({
        'id': 52,
        'serial': 986,
        'categoryIds': [331],
        'stem': '测试题',
        'options': <String>[],
        'answer': '',
        'explanation': '',
        'source': source,
      });

  test('批量导出使用用户可读名称、原题单序号和安全文件树', () {
    final item = BatchExportQuestion(
      question: question(),
      categoryPath: '高等数学 / 一元微分 / 导数:计算 / 乘积求导',
      position: 2,
      textNote: '',
    );

    expect(questionDisplayName(item.question), '1988 数一');
    expect(
      item.relativePath('png'),
      '高等数学/一元微分/导数 计算/乘积求导/第002题 - 1988 数一.png',
    );
    expect(item.relativePath('png'), isNot(contains('#986')));
  });

  test('旧收藏缺少位置时不猜测原题单序号', () {
    final item = BatchExportQuestion(
      question: question(source: ''),
      categoryPath: '',
      position: null,
      textNote: '',
    );

    expect(item.pathSegments, ['来源位置未知']);
    expect(item.fileName('pdf'), '位置未知 - 来源未知.pdf');
  });

  test('仅有手写筛选依据最终仍可见的笔迹', () {
    InkStroke stroke(String id, double width, {bool erase = false}) =>
        InkStroke(
          id: id,
          points: const [
            InkPoint(10, 10, 1),
            InkPoint(50, 10, 1),
          ],
          color: 0xff111827,
          width: width,
          pressureStrength: .7,
          erase: erase,
        );

    final visible = HandwritingDocument.empty(52)
      ..strokes.add(stroke('ink', 4));
    expect(documentHasVisibleInk(visible), isTrue);

    final erased = HandwritingDocument.empty(52)
      ..strokes.addAll([
        stroke('ink', 4),
        stroke('eraser', 20, erase: true),
      ]);
    expect(documentHasVisibleInk(erased), isFalse);

    final redrawn = HandwritingDocument.empty(52)
      ..strokes.addAll([
        stroke('eraser', 20, erase: true),
        stroke('ink', 4),
      ]);
    expect(documentHasVisibleInk(redrawn), isTrue);
  });

  test('解析显示状态随画布保存且旧数据默认隐藏', () {
    final document = HandwritingDocument.empty(52)..analysisVisible = true;
    final restored = HandwritingDocument.fromJson(
      document.toJson(),
      questionId: 52,
    );
    final legacy = HandwritingDocument.fromJson(
      {'strokes': <dynamic>[]},
      questionId: 52,
    );

    expect(restored.analysisVisible, isTrue);
    expect(legacy.analysisVisible, isFalse);
  });

  test('单题导出文件名不再包含内部题号或井号', () async {
    final temporary = await Directory.systemTemp.createTemp('daguan-export-');
    addTearDown(() async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      await temporary.delete(recursive: true);
    });
    String? exportedName;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('daguan.local/storage'),
      (call) async {
        if (call.method == 'getFilesDir') return temporary.path;
        if (call.method == 'exportCanvas') {
          exportedName = (call.arguments as Map)['name'] as String;
          return 'content://exported';
        }
        return null;
      },
    );
    final storage = LocalStorage();
    await storage.loadProgress();

    final saved = await storage.exportCanvasImage(
      Uint8List.fromList([1, 2, 3]),
      displayName: '1988 数一',
      pdf: false,
    );

    expect(saved, isTrue);
    expect(exportedName, startsWith('1988 数一-'));
    expect(exportedName, isNot(contains('题号')));
    expect(exportedName, isNot(contains('#')));
  });

  testWidgets('批量导出页面按树选择并显示逐题进度', (tester) async {
    final temporary = Directory.systemTemp.createTempSync('daguan-batch-');
    addTearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
        const MethodChannel('daguan.local/storage'),
        null,
      );
      if (temporary.existsSync()) temporary.deleteSync(recursive: true);
    });
    Map<dynamic, dynamic>? exportedArguments;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('daguan.local/storage'),
      (call) async {
        if (call.method == 'getFilesDir') return temporary.path;
        if (call.method == 'exportBatch') {
          exportedArguments = call.arguments as Map<dynamic, dynamic>;
          return 'content://batch-exported';
        }
        return null;
      },
    );
    final storage = LocalStorage();
    await tester.runAsync(storage.loadProgress);
    final item = BatchExportQuestion(
      question: question(),
      categoryPath: '高等数学 / 极限 / 函数连续',
      position: 2,
      textNote: '文字笔记',
    );
    tester.view
      ..physicalSize = const Size(1200, 1400)
      ..devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: BatchExportPage(
          storage: storage,
          title: '当前题单',
          questions: [item],
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('高等数学'), findsOneWidget);
    expect(find.text('已选择 1 道题'), findsOneWidget);
    await tester.ensureVisible(find.text('函数连续'));
    await tester.tap(find.text('函数连续'));
    await tester.pumpAndSettle();
    expect(find.text('第002题 · 1988 数一'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('start-batch-export')));
    for (var attempt = 0; attempt < 30; attempt++) {
      await tester.pump(const Duration(milliseconds: 80));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      if (find.text('批量导出完成').evaluate().isNotEmpty) break;
    }
    expect(find.text('批量导出完成'), findsOneWidget);
    expect(exportedArguments?['mode'], 'zip');
    expect(exportedArguments?['format'], 'png');
    final files = exportedArguments?['files'] as List<dynamic>;
    expect(files, hasLength(1));
    expect(
      (files.single as Map<dynamic, dynamic>)['relativePath'],
      contains('高等数学/极限/函数连续/第002题 - 1988 数一.png'),
    );
  });
}
