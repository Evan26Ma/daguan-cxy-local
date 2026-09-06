import 'models.dart';

enum BatchExportFormat {
  png('PNG 文件树', 'png'),
  separatePdf('每题一个 PDF', 'pdf'),
  mergedPdf('合并成一个 PDF', 'pdf');

  const BatchExportFormat(this.label, this.extension);
  final String label;
  final String extension;
}

enum BatchExportDestination {
  archive('ZIP 压缩包'),
  folder('直接保存到文件夹');

  const BatchExportDestination(this.label);
  final String label;
}

class BatchExportQuestion {
  const BatchExportQuestion({
    required this.question,
    required this.categoryPath,
    required this.position,
    required this.textNote,
  });

  final Question question;
  final String categoryPath;
  final int? position;
  final String textNote;

  List<String> get pathSegments {
    final parts = categoryPath
        .split(RegExp(r'\s*/\s*'))
        .map((part) => part.trim())
        .where((part) => part.isNotEmpty)
        .toList(growable: false);
    return parts.isEmpty ? const ['来源位置未知'] : parts;
  }

  String fileName(String extension) =>
      '${positionLabel(position)} - ${questionDisplayName(question)}.$extension';

  String relativePath(String extension) => [
        ...pathSegments.map(safeFileName),
        '${safeFileName(
          '${positionLabel(position)} - ${questionDisplayName(question)}',
        )}.$extension',
      ].join('/');
}

String questionDisplayName(Question question) {
  final normalized = question.source
      .replaceAll(RegExp(r'^[（(]\s*'), '')
      .replaceAll(RegExp(r'\s*[）)]$'), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return normalized.isEmpty ? '来源未知' : normalized;
}

String positionLabel(int? position) => position == null
    ? '位置未知'
    : '第${position.clamp(0, 999999).toString().padLeft(3, '0')}题';

String safeFileName(String value) {
  final sanitized = value
      .replaceAll(RegExp(r'[\\/:*?"<>|]'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .replaceAll(RegExp(r'[. ]+$'), '')
      .trim();
  if (sanitized.isEmpty) return '未命名';
  final shortened =
      sanitized.length <= 100 ? sanitized : sanitized.substring(0, 100);
  if (RegExp(
    r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])$',
    caseSensitive: false,
  ).hasMatch(shortened)) {
    return '_$shortened';
  }
  return shortened;
}
