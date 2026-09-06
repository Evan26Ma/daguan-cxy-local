import 'package:flutter/material.dart';
import 'package:flutter_math_fork/flutter_math.dart';

class MathContent extends StatelessWidget {
  const MathContent(
    this.source, {
    super.key,
    this.baseStyle,
    this.scale = 1,
    this.selectable = true,
  });

  final String source;
  final TextStyle? baseStyle;
  final double scale;
  final bool selectable;

  @override
  Widget build(BuildContext context) {
    final style = (baseStyle ?? Theme.of(context).textTheme.bodyLarge!)
        .copyWith(fontSize: (baseStyle?.fontSize ?? 18) * scale, height: 1.75);
    final pieces = _splitMath(normalizeQuestionMarkup(source));
    final blocks = <Widget>[];
    final inlinePieces = <_Piece>[];

    void flushInlinePieces() {
      if (inlinePieces.isEmpty) return;
      blocks.add(_InlineMathText(pieces: List.of(inlinePieces), style: style));
      inlinePieces.clear();
    }

    for (final piece in pieces) {
      if (piece.imagePath != null) {
        flushInlinePieces();
        blocks.add(
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: _EmbeddedQuestionImage(
              path: piece.imagePath!,
              description: piece.text,
            ),
          ),
        );
        continue;
      }
      if (!piece.display) {
        inlinePieces.add(piece);
        continue;
      }
      flushInlinePieces();
      blocks.add(
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Align(
            alignment: Alignment.centerLeft,
            child: FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: _MathWidget(piece: piece, style: style),
            ),
          ),
        ),
      );
    }
    flushInlinePieces();

    final content = blocks.length == 1
        ? blocks.single
        : Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: blocks,
          );
    return selectable ? SelectionArea(child: content) : content;
  }
}

class _InlineMathText extends StatelessWidget {
  const _InlineMathText({required this.pieces, required this.style});

  final List<_Piece> pieces;
  final TextStyle style;

  @override
  Widget build(BuildContext context) => Text.rich(
        TextSpan(
          style: style,
          children: [
            for (final piece in pieces)
              if (piece.math)
                WidgetSpan(
                  alignment: PlaceholderAlignment.baseline,
                  baseline: TextBaseline.alphabetic,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: _MathWidget(piece: piece, style: style),
                    ),
                  ),
                )
              else
                TextSpan(text: _stripSimpleMarkdown(piece.text)),
          ],
        ),
      );
}

class _MathWidget extends StatelessWidget {
  const _MathWidget({required this.piece, required this.style});

  final _Piece piece;
  final TextStyle style;

  @override
  Widget build(BuildContext context) => Math.tex(
        normalizeMathExpression(piece.text.trim()),
        textStyle: style,
        mathStyle: piece.display ? MathStyle.display : MathStyle.text,
        onErrorFallback: (_) => Text(
          piece.text,
          style: style.copyWith(color: Theme.of(context).colorScheme.error),
        ),
      );
}

class _Piece {
  const _Piece(
    this.text, {
    required this.math,
    this.display = false,
    this.imagePath,
  });
  final String text;
  final bool math;
  final bool display;
  final String? imagePath;
}

List<_Piece> _splitMath(String source) {
  final result = <_Piece>[];
  final pattern = RegExp(
    r'(!\[[^\]]*\]\(asset://sha256/[a-f0-9]{64}\)|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(?<!\\)\$(?!\$)[\s\S]*?(?<!\\)\$)',
  );
  var cursor = 0;
  for (final match in pattern.allMatches(source)) {
    if (match.start > cursor) {
      result.add(_Piece(source.substring(cursor, match.start), math: false));
    }
    final raw = match.group(0)!;
    final image = RegExp(
      r'^!\[([^\]]*)\]\(asset://sha256/([a-f0-9]{64})\)$',
    ).firstMatch(raw);
    if (image != null) {
      result.add(
        _Piece(
          image.group(1)!.trim(),
          math: false,
          display: true,
          imagePath: 'assets/question_images/${image.group(2)!}.png',
        ),
      );
      cursor = match.end;
      continue;
    }
    final body = raw.startsWith(r'$$')
        ? raw.substring(2, raw.length - 2)
        : raw.startsWith(r'\[') || raw.startsWith(r'\(')
            ? raw.substring(2, raw.length - 2)
            : raw.substring(1, raw.length - 1);
    final display = raw.startsWith(r'$$') ||
        raw.startsWith(r'\[') ||
        _needsDisplayLayout(body);
    result.add(_Piece(body, math: true, display: display));
    cursor = match.end;
  }
  if (cursor < source.length) {
    result.add(_Piece(source.substring(cursor), math: false));
  }
  return result.isEmpty ? [_Piece(source, math: false)] : result;
}

bool _needsDisplayLayout(String expression) =>
    expression.length > 160 ||
    expression.contains('\n') ||
    RegExp(
      r'\\begin\{(?:align\*?|aligned|gathered|array|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix)\}',
    ).hasMatch(expression);

String normalizeMathExpression(String source) {
  const circledDigits = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
  return source
      .replaceAll(r'\begin{align*}', r'\begin{aligned}')
      .replaceAll(r'\end{align*}', r'\end{aligned}')
      .replaceAll(r'\begin{gathered}', r'\begin{aligned}')
      .replaceAll(r'\end{gathered}', r'\end{aligned}')
      .replaceAllMapped(
        RegExp(r'\\operatorname\*?\{([^{}]+)\}'),
        (match) => '\\mathop{\\mathrm{${match.group(1)!}}}',
      )
      .replaceAll(r'\limsup', r'\mathop{\mathrm{lim\,sup}}')
      .replaceAll(r'\liminf', r'\mathop{\mathrm{lim\,inf}}')
      .replaceAllMapped(
        RegExp(r'\\textcircled\{([0-9])\}'),
        (match) => '\\text{${circledDigits[int.parse(match.group(1)!)]}}',
      );
}

String normalizeQuestionMarkup(String value) {
  final withBreaks = value.replaceAll(
    RegExp(r'<br\s*/?>', caseSensitive: false),
    '\n',
  );
  final normalized = <String>[];
  final tableSeparator = RegExp(
    r'^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$',
  );
  for (final rawLine in withBreaks.split('\n')) {
    var line = rawLine;
    if (tableSeparator.hasMatch(line) ||
        RegExp(r'^\s*(?:-{3,}|\*{3,})\s*$').hasMatch(line)) {
      normalized.add('');
      continue;
    }
    line = line
        .replaceFirst(RegExp(r'^\s{0,3}#{1,6}\s+'), '')
        .replaceFirst(RegExp(r'^\s*>\s?'), '')
        .replaceFirst(RegExp(r'^\s*[*+-]\s+'), '• ');
    final trimmed = line.trim();
    if (trimmed.startsWith('|') &&
        trimmed.endsWith('|') &&
        '|'.allMatches(trimmed).length >= 2) {
      line = trimmed.substring(1, trimmed.length - 1).trim();
    }
    normalized.add(line);
  }
  return _stripMarkdownEmphasis(
    normalized.join('\n').replaceAll(RegExp(r'\n{3,}'), '\n\n'),
  );
}

String _stripSimpleMarkdown(String value) {
  var result = _stripMarkdownEmphasis(value);
  result = result.replaceAllMapped(
    RegExp(r'!\[([^\]]*)\]\([^)]+\)'),
    (match) => '${match.group(1)!}〔题图未包含在当前离线数据中〕',
  );
  result = result.replaceAllMapped(
    RegExp(r'\[([^\]]+)\]\([^)]+\)'),
    (match) => match.group(1)!,
  );
  return result.replaceAll(RegExp(r'<[^>]+>'), '');
}

String _stripMarkdownEmphasis(String value) {
  var result = value;
  for (final pattern in [
    RegExp(r'\*\*([\s\S]*?)\*\*'),
    RegExp(r'`([^`]*)`'),
  ]) {
    result = result.replaceAllMapped(pattern, (match) => match.group(1)!);
  }
  return result;
}

class _EmbeddedQuestionImage extends StatelessWidget {
  const _EmbeddedQuestionImage({required this.path, required this.description});

  final String path;
  final String description;

  Widget _image(BuildContext context) => Image.asset(
        path,
        fit: BoxFit.contain,
        errorBuilder: (context, error, stackTrace) => Container(
          padding: const EdgeInsets.all(16),
          alignment: Alignment.center,
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.broken_image_outlined),
              SizedBox(width: 10),
              Flexible(child: Text('题图文件损坏或缺失')),
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => Semantics(
        label: description.isEmpty ? '题图，支持双指缩放' : description,
        child: Container(
          height: 300,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerLowest,
            border: Border.all(color: Theme.of(context).dividerColor),
            borderRadius: BorderRadius.circular(12),
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            children: [
              Positioned.fill(
                child: InteractiveViewer(
                  minScale: 1,
                  maxScale: 6,
                  boundaryMargin: const EdgeInsets.all(80),
                  child: Center(child: _image(context)),
                ),
              ),
              Positioned(
                right: 8,
                top: 8,
                child: IconButton.filledTonal(
                  tooltip: '全屏查看题图',
                  icon: const Icon(Icons.fullscreen),
                  onPressed: () => showDialog<void>(
                    context: context,
                    useSafeArea: false,
                    builder: (context) => Dialog.fullscreen(
                      backgroundColor: Colors.black,
                      child: Stack(
                        children: [
                          Positioned.fill(
                            child: InteractiveViewer(
                              minScale: .5,
                              maxScale: 8,
                              boundaryMargin: const EdgeInsets.all(160),
                              child: Center(child: _image(context)),
                            ),
                          ),
                          Positioned(
                            left: 12,
                            top: 12,
                            child: SafeArea(
                              child: IconButton.filled(
                                tooltip: '关闭',
                                onPressed: () => Navigator.pop(context),
                                icon: const Icon(Icons.close),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
}
