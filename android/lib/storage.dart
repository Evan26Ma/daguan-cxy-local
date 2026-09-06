import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:flutter/services.dart';

import 'handwriting_eraser.dart';
import 'models.dart';
import 'handwriting_models.dart';

class LocalStorage {
  static const _channel = MethodChannel('daguan.local/storage');
  late final File _progressFile;
  late final File _writingToolsFile;
  late final Directory _handwritingDirectory;
  bool _initialized = false;

  bool get isInitialized => _initialized;

  Future<Map<String, dynamic>> loadProgress() async {
    final filesDir = await _channel.invokeMethod<String>('getFilesDir');
    if (filesDir == null) throw StateError('无法获取应用存储目录');
    _progressFile = File('$filesDir${Platform.pathSeparator}progress.json');
    _writingToolsFile = File(
      '$filesDir${Platform.pathSeparator}writing_tools.json',
    );
    _handwritingDirectory = Directory(
      '$filesDir${Platform.pathSeparator}handwriting',
    );
    if (!_handwritingDirectory.existsSync()) {
      await _handwritingDirectory.create(recursive: true);
    }
    _initialized = true;
    if (!_progressFile.existsSync()) {
      final initial = await rootBundle.loadString(
        'assets/initial_progress.json',
      );
      await _progressFile.writeAsString(initial, flush: true);
    }
    await _migrateLegacyHandwritingFiles();
    return decodeObject(await _progressFile.readAsString());
  }

  Future<void> save(Map<String, dynamic> value) async {
    _ensureInitialized();
    final temporary = File('${_progressFile.path}.tmp');
    await temporary.writeAsString(jsonEncode(value), flush: true);
    if (_progressFile.existsSync()) await _progressFile.delete();
    await temporary.rename(_progressFile.path);
  }

  Future<bool> export(Map<String, dynamic> value) async {
    final now = DateTime.now();
    final stamp =
        '${now.year}-${_two(now.month)}-${_two(now.day)}_${_two(now.hour)}-${_two(now.minute)}';
    final uri = await _channel.invokeMethod<String>('exportJson', {
      'name': '大观园题库进度_$stamp.json',
      'json': const JsonEncoder.withIndent('  ').convert(value),
    });
    return uri != null;
  }

  Future<String?> pickImportJson() =>
      _channel.invokeMethod<String>('importJson');

  Future<bool> exportCanvasImage(
    Uint8List pngBytes, {
    required String displayName,
    required bool pdf,
  }) async {
    _ensureInitialized();
    final now = DateTime.now();
    final stamp =
        '${now.year}-${_two(now.month)}-${_two(now.day)}_${_two(now.hour)}-${_two(now.minute)}';
    final extension = pdf ? 'pdf' : 'png';
    final uri = await _channel.invokeMethod<String>('exportCanvas', {
      'name': '${_safeName(displayName)}-$stamp.$extension',
      'png': pngBytes,
      'pdf': pdf,
    });
    return uri != null;
  }

  Future<Directory> createBatchExportStaging() async {
    _ensureInitialized();
    final directory = Directory(
      '${_progressFile.parent.path}${Platform.pathSeparator}batch_export',
    );
    if (directory.existsSync()) await directory.delete(recursive: true);
    await directory.create(recursive: true);
    return directory;
  }

  Future<String?> saveBatchExport({
    required String name,
    required String mode,
    required String format,
    required List<Map<String, String>> files,
  }) =>
      _channel.invokeMethod<String>('exportBatch', {
        'name': name,
        'mode': mode,
        'format': format,
        'files': files,
      });

  Future<void> cancelBatchExport() =>
      _channel.invokeMethod<void>('cancelBatchExport');

  Future<void> deleteBatchExportStaging() async {
    _ensureInitialized();
    final directory = Directory(
      '${_progressFile.parent.path}${Platform.pathSeparator}batch_export',
    );
    if (directory.existsSync()) await directory.delete(recursive: true);
  }

  Future<HandwritingDocument> loadHandwriting(
    int questionId, {
    String fallbackTextNote = '',
  }) async {
    _ensureInitialized();
    final file = _handwritingFile(questionId);
    if (!file.existsSync()) {
      return HandwritingDocument.empty(questionId, textNote: fallbackTextNote);
    }
    try {
      final document = HandwritingDocument.fromJson(
        decodeObject(await file.readAsString()),
        questionId: questionId,
        fallbackTextNote: fallbackTextNote,
      );
      if (migrateLegacyEraseDocument(document)) {
        await saveHandwriting(document);
      }
      return document;
    } on FormatException {
      return HandwritingDocument.empty(questionId, textNote: fallbackTextNote);
    }
  }

  Future<void> _migrateLegacyHandwritingFiles() async {
    final marker = File(
      '${_handwritingDirectory.path}${Platform.pathSeparator}.eraser-v2-migrated',
    );
    if (marker.existsSync()) return;
    for (final questionId in handwritingQuestionIds()) {
      await loadHandwriting(questionId);
    }
    await marker.writeAsString('1', flush: true);
  }

  bool hasHandwriting(int questionId) {
    _ensureInitialized();
    return _handwritingFile(questionId).existsSync();
  }

  Set<int> handwritingQuestionIds() {
    _ensureInitialized();
    return {
      for (final entity in _handwritingDirectory.listSync())
        if (entity is File)
          if (int.tryParse(
            entity.path
                .split(Platform.pathSeparator)
                .last
                .replaceFirst(RegExp(r'\.json$'), ''),
          )
              case final questionId?)
            questionId,
    };
  }

  Future<void> saveHandwriting(HandwritingDocument document) async {
    _ensureInitialized();
    final file = _handwritingFile(document.questionId);
    final temporary = File('${file.path}.tmp');
    final useBackgroundEncoding =
        document.strokes.length >= 80 || document.undoHistory.length >= 40;
    if (!useBackgroundEncoding) {
      temporary.writeAsStringSync(jsonEncode(document.toJson()), flush: true);
      if (file.existsSync()) file.deleteSync();
      temporary.renameSync(file.path);
      return;
    }
    final encoded = await Isolate.run(() => jsonEncode(document.toJson()));
    await temporary.writeAsString(encoded, flush: true);
    if (file.existsSync()) await file.delete();
    await temporary.rename(file.path);
  }

  Future<void> deleteHandwriting(int questionId) async {
    _ensureInitialized();
    final file = _handwritingFile(questionId);
    if (file.existsSync()) file.deleteSync();
  }

  Future<WritingToolSettings> loadWritingToolSettings() async {
    _ensureInitialized();
    if (!_writingToolsFile.existsSync()) {
      return WritingToolSettings.defaults();
    }
    try {
      return WritingToolSettings.fromJson(
        decodeObject(await _writingToolsFile.readAsString()),
      );
    } on FormatException {
      return WritingToolSettings.defaults();
    }
  }

  Future<void> saveWritingToolSettings(WritingToolSettings settings) async {
    _ensureInitialized();
    final temporary = File('${_writingToolsFile.path}.tmp');
    temporary.writeAsStringSync(jsonEncode(settings.toJson()), flush: true);
    if (_writingToolsFile.existsSync()) _writingToolsFile.deleteSync();
    temporary.renameSync(_writingToolsFile.path);
  }

  Future<void> clearAllUserData() async {
    _ensureInitialized();
    if (_writingToolsFile.existsSync()) await _writingToolsFile.delete();
    if (_handwritingDirectory.existsSync()) {
      await _handwritingDirectory.delete(recursive: true);
    }
    await _handwritingDirectory.create(recursive: true);
    await save({
      'format': 'daguan-android-progress',
      'version': 2,
      'states': <String, dynamic>{},
      'events': <dynamic>[],
      'lastStudy': null,
    });
  }

  File _handwritingFile(int questionId) => File(
        '${_handwritingDirectory.path}${Platform.pathSeparator}$questionId.json',
      );

  void _ensureInitialized() {
    if (!_initialized) {
      throw StateError('LocalStorage.loadProgress 必须先完成');
    }
  }

  String _two(int value) => value.toString().padLeft(2, '0');

  String _safeName(String value) {
    final normalized = value
        .replaceAll(RegExp(r'[\\/:*?"<>|]'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    return normalized.isEmpty ? '来源未知' : normalized;
  }
}
