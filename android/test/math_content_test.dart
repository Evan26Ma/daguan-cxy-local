import 'dart:convert';
import 'dart:io';

import 'package:daguan_math/math_content.dart';
import 'package:flutter/material.dart';
import 'package:flutter_math_fork/flutter_math.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('题库中的全部 LaTeX 公式均可解析', () {
    final root = jsonDecode(File('assets/questions.json').readAsStringSync())
        as Map<String, dynamic>;
    final failures = <String>[];
    final errorsByMessage = <String, int>{};
    final firstFailureByMessage = <String, String>{};
    var formulaCount = 0;

    for (final rawQuestion in root['items'] as List<dynamic>) {
      final question = rawQuestion as Map<String, dynamic>;
      final fields = <MapEntry<String, String>>[
        MapEntry('stem', question['stem'] as String? ?? ''),
        for (var index = 0;
            index < (question['options'] as List<dynamic>? ?? const []).length;
            index++)
          MapEntry(
            'options[$index]',
            (question['options'] as List<dynamic>)[index] as String,
          ),
        MapEntry('answer', question['answer'] as String? ?? ''),
        MapEntry('explanation', question['explanation'] as String? ?? ''),
      ];

      for (final field in fields) {
        for (final formula in _extractMath(field.value)) {
          formulaCount++;
          final widget = Math.tex(normalizeMathExpression(formula));
          if (widget.parseError != null) {
            errorsByMessage.update(
              widget.parseError!.message,
              (count) => count + 1,
              ifAbsent: () => 1,
            );
            failures.add(
              '题目 ${question['id']} ${field.key}: '
              '${widget.parseError!.message}\n$formula',
            );
            firstFailureByMessage.putIfAbsent(
              widget.parseError!.message,
              () => failures.last,
            );
          }
        }
      }
    }

    expect(formulaCount, greaterThan(80000));
    expect(
      failures,
      isEmpty,
      reason: '共 ${failures.length} 个失败：\n'
          '${errorsByMessage.entries.map((entry) => '${entry.value} × ${entry.key}').join('\n')}\n\n'
          '${firstFailureByMessage.values.join('\n\n')}',
    );
  });

  test('题库中的数学分隔符完整且不混用 Markdown 代码标记', () {
    final root = jsonDecode(File('assets/questions.json').readAsStringSync())
        as Map<String, dynamic>;
    final failures = <String>[];

    for (final rawQuestion in root['items'] as List<dynamic>) {
      final question = rawQuestion as Map<String, dynamic>;
      final fields = <MapEntry<String, String>>[
        MapEntry('stem', question['stem'] as String? ?? ''),
        for (var index = 0;
            index < (question['options'] as List<dynamic>? ?? const []).length;
            index++)
          MapEntry(
            'options[$index]',
            (question['options'] as List<dynamic>)[index] as String,
          ),
        MapEntry('answer', question['answer'] as String? ?? ''),
        MapEntry('explanation', question['explanation'] as String? ?? ''),
      ];
      for (final field in fields) {
        final remainder = field.value.replaceAll(_mathPattern, '');
        if (RegExp(r'(?<!\\)\$|\\[\[(]').hasMatch(remainder) ||
            field.value.contains(r'\$') ||
            RegExp(r'`\s*\$|\$\s*`').hasMatch(field.value)) {
          failures.add('题目 ${question['id']} ${field.key}');
        }
      }
    }

    expect(failures, isEmpty, reason: failures.join('\n'));
  });

  test('全题库标准化后不残留会扰乱排版的 Markdown 块标记', () {
    final root = jsonDecode(File('assets/questions.json').readAsStringSync())
        as Map<String, dynamic>;
    final failures = <String>[];

    for (final rawQuestion in root['items'] as List<dynamic>) {
      final question = rawQuestion as Map<String, dynamic>;
      final fields = <MapEntry<String, String>>[
        MapEntry('stem', question['stem'] as String? ?? ''),
        for (var index = 0;
            index < (question['options'] as List<dynamic>? ?? const []).length;
            index++)
          MapEntry(
            'options[$index]',
            (question['options'] as List<dynamic>)[index] as String,
          ),
        MapEntry('answer', question['answer'] as String? ?? ''),
        MapEntry('explanation', question['explanation'] as String? ?? ''),
      ];
      for (final field in fields) {
        final normalized = normalizeQuestionMarkup(field.value);
        final plain = normalized
            .replaceAll(_mathPattern, '')
            .replaceAll(_assetImagePattern, '');
        if (plain.contains('**') ||
            RegExp(r'^\s{0,3}#{1,6}\s+', multiLine: true).hasMatch(plain) ||
            RegExp(r'^\s*[*+-]\s+', multiLine: true).hasMatch(plain) ||
            RegExp(
              r'^\s*(?:-{3,}|\*{3,})\s*$',
              multiLine: true,
            ).hasMatch(plain) ||
            RegExp(r'^\s*>\s?', multiLine: true).hasMatch(plain)) {
          failures.add('题目 ${question['id']} ${field.key}');
        }
        for (final formula in _extractMath(normalized)) {
          final math = Math.tex(normalizeMathExpression(formula));
          if (math.parseError != null) {
            failures.add(
              '题目 ${question['id']} ${field.key}: '
              '${math.parseError!.message}',
            );
          }
        }
      }
    }

    expect(normalizeQuestionMarkup('填空 ______'), '填空 ______');
    expect(failures, isEmpty, reason: failures.join('\n'));
  });

  test('全部本地题图都能在所属题干、选项、答案或解析中找到', () {
    final root = jsonDecode(File('assets/questions.json').readAsStringSync())
        as Map<String, dynamic>;
    final failures = <String>[];

    for (final rawQuestion in root['items'] as List<dynamic>) {
      final question = rawQuestion as Map<String, dynamic>;
      final fields = <String>[
        question['stem'] as String? ?? '',
        ...(question['options'] as List<dynamic>? ?? const []).cast<String>(),
        question['answer'] as String? ?? '',
        question['explanation'] as String? ?? '',
      ];
      final embedded = <String>{};
      for (final field in fields) {
        for (final match in _assetImagePattern.allMatches(field)) {
          final hash = match.group(1)!;
          embedded.add('asset://sha256/$hash');
          if (!File('assets/question_images/$hash.png').existsSync()) {
            failures.add('题目 ${question['id']} 缺少图片文件 $hash');
          }
        }
      }
      final declared = (question['assets'] as List<dynamic>? ?? const [])
          .cast<String>()
          .toSet();
      if (embedded.length != declared.length ||
          !embedded.containsAll(declared) ||
          !declared.containsAll(embedded)) {
        failures.add('题目 ${question['id']} 图片字段与正文不一致');
      }
    }

    expect(failures, isEmpty, reason: failures.join('\n'));
  });

  testWidgets('行内公式与正文使用同一段落的基线排版', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 220,
            child: MathContent(r'较长的中文正文 $x^2+1$ 继续在同一段落中换行。'),
          ),
        ),
      ),
    );

    expect(find.byType(Wrap), findsNothing);
    final richText = tester
        .widgetList<Text>(
          find.descendant(
            of: find.byType(MathContent),
            matching: find.byType(Text),
          ),
        )
        .firstWhere((widget) => widget.textSpan != null);
    final formulaSpan = (richText.textSpan! as TextSpan)
        .children!
        .whereType<WidgetSpan>()
        .single;
    expect(formulaSpan.alignment, PlaceholderAlignment.baseline);
    expect(formulaSpan.baseline, TextBaseline.alphabetic);
    expect(tester.takeException(), isNull);
  });

  testWidgets('块级公式保持独立显示', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: MathContent('计算如下：\n\$\$x^2+1\$\$\n所以结论成立。')),
      ),
    );

    final math = tester.widget<Math>(find.byType(Math));
    expect(math.mathStyle, MathStyle.display);
    expect(find.byType(Column), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('示例题解析中的 Markdown 外壳不会参与排版', (tester) async {
    final root = jsonDecode(File('assets/questions.json').readAsStringSync())
        as Map<String, dynamic>;
    final question = (root['items'] as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .singleWhere((item) => item['id'] == 1396);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(
              width: 360,
              child: MathContent(question['explanation'] as String),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    final plainText = tester
        .widgetList<Text>(find.byType(Text))
        .map((widget) => widget.textSpan?.toPlainText() ?? widget.data ?? '')
        .join('\n');
    expect(plainText, isNot(contains('###')));
    expect(plainText, isNot(contains('**')));
    expect(plainText, isNot(contains('---')));
    expect(plainText, contains('• 函数值：'));
    expect(plainText, contains('因此该函数在'));
    expect(plainText.trim(), endsWith('处不可导。'));
    expect(tester.getSize(find.byType(MathContent)).height, greaterThan(1200));
    expect(tester.takeException(), isNull);
  });

  testWidgets('第 1412 题的超长解析在普通题卡中完整保留末尾内容', (tester) async {
    final root = jsonDecode(File('assets/questions.json').readAsStringSync())
        as Map<String, dynamic>;
    final question = (root['items'] as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .singleWhere((item) => item['id'] == 1412);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(
              width: 360,
              child: MathContent(question['explanation'] as String),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    final plainText = tester
        .widgetList<Text>(find.byType(Text))
        .map((widget) => widget.textSpan?.toPlainText() ?? widget.data ?? '')
        .join('\n');
    expect(plainText, contains('综上所述'));
    expect(plainText.trim(), endsWith('应选 A.'));
    expect(tester.getSize(find.byType(MathContent)).height, greaterThan(700));
    expect(tester.takeException(), isNull);
  });

  testWidgets('答案和解析中的本地题图在原位置完整显示', (tester) async {
    const hash =
        '559717ebb643394dbaf92bc60f22fa25d623402ee4daa26222a43bca7785b3ba';
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 360,
            child: MathContent('![2015 数一 第9题答案](asset://sha256/$hash)'),
          ),
        ),
      ),
    );
    await tester.pump();

    final image = tester.widget<Image>(find.byType(Image));
    expect(
      (image.image as AssetImage).assetName,
      'assets/question_images/$hash.png',
    );
    expect(find.textContaining('题图未包含'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('超宽公式缩放到卡片宽度内而不被裁切', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 220,
            child: MathContent(
              r'$$\begin{aligned}f(x)&=x+x^2+x^3+x^4+x^5+x^6+x^7+x^8\\&\quad+x^9+x^{10}+x^{11}+x^{12}\end{aligned}$$',
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    final fitted = find.descendant(
      of: find.byType(MathContent),
      matching: find.byType(FittedBox),
    );
    expect(fitted, findsOneWidget);
    expect(tester.getSize(fitted).width, lessThanOrEqualTo(220));
    expect(tester.takeException(), isNull);
  });
}

final _mathPattern = RegExp(
  r'(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(?<!\\)\$(?!\$)[\s\S]*?(?<!\\)\$)',
);

final _assetImagePattern = RegExp(
  r'!\[[^\]]*\]\(asset://sha256/([a-f0-9]{64})\)',
);

Iterable<String> _extractMath(String source) sync* {
  for (final match in _mathPattern.allMatches(source)) {
    final raw = match.group(0)!;
    yield (raw.startsWith(r'$$') ||
            raw.startsWith(r'\[') ||
            raw.startsWith(r'\('))
        ? raw.substring(2, raw.length - 2).trim()
        : raw.substring(1, raw.length - 1).trim();
  }
}
