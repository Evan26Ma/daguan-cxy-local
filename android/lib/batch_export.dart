import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'batch_export_models.dart';
import 'handwriting_canvas.dart';
import 'handwriting_models.dart';
import 'storage.dart';

class BatchExportPage extends StatefulWidget {
  const BatchExportPage({
    super.key,
    required this.storage,
    required this.title,
    required this.questions,
  });

  final LocalStorage storage;
  final String title;
  final List<BatchExportQuestion> questions;

  @override
  State<BatchExportPage> createState() => _BatchExportPageState();
}

class _BatchExportPageState extends State<BatchExportPage> {
  BatchExportFormat format = BatchExportFormat.png;
  BatchExportDestination destination = BatchExportDestination.archive;
  bool includeTextNote = true;
  bool handwritingOnly = false;
  bool loadingHandwriting = true;
  bool exporting = false;
  bool cancelRequested = false;
  bool savingFiles = false;
  int completed = 0;
  String currentLabel = '';
  final handwritingQuestionIds = <int>{};
  final selectedQuestionIds = <int>{};
  final failures = <String>[];

  @override
  void initState() {
    super.initState();
    selectedQuestionIds.addAll(
      widget.questions.map((item) => item.question.id),
    );
    _loadHandwritingIndex();
  }

  Future<void> _loadHandwritingIndex() async {
    final storedQuestionIds = widget.storage.handwritingQuestionIds();
    for (final item in widget.questions) {
      if (!storedQuestionIds.contains(item.question.id)) continue;
      try {
        final document = await widget.storage.loadHandwriting(
          item.question.id,
          fallbackTextNote: item.textNote,
        );
        if (documentHasVisibleInk(document)) {
          handwritingQuestionIds.add(item.question.id);
        }
      } catch (_) {
        // A damaged canvas is excluded from the handwriting-only filter.
      }
    }
    if (mounted) setState(() => loadingHandwriting = false);
  }

  List<BatchExportQuestion> get _eligibleQuestions => widget.questions
      .where(
        (item) =>
            !handwritingOnly ||
            handwritingQuestionIds.contains(item.question.id),
      )
      .toList(growable: false);

  List<BatchExportQuestion> get _selectedQuestions {
    final result = _eligibleQuestions
        .where((item) => selectedQuestionIds.contains(item.question.id))
        .toList(growable: false);
    result.sort((left, right) {
      final path = left.categoryPath.compareTo(right.categoryPath);
      if (path != 0) return path;
      return (left.position ?? 1 << 30).compareTo(right.position ?? 1 << 30);
    });
    return result;
  }

  void _setHandwritingOnly(bool value) {
    setState(() => handwritingOnly = value);
  }

  Future<void> _cancelExport() async {
    if (!exporting || cancelRequested) return;
    setState(() => cancelRequested = true);
    if (savingFiles) await widget.storage.cancelBatchExport();
  }

  Future<void> _runExport() async {
    final items = _selectedQuestions;
    if (items.isEmpty || exporting) return;
    setState(() {
      exporting = true;
      cancelRequested = false;
      savingFiles = false;
      completed = 0;
      failures.clear();
      currentLabel = '';
    });
    Directory? staging;
    try {
      staging = await widget.storage.createBatchExportStaging();
      final stagedFiles = <Map<String, String>>[];
      final usedPaths = <String, int>{};
      for (var index = 0; index < items.length; index++) {
        if (cancelRequested) break;
        final item = items[index];
        setState(() {
          currentLabel =
              '${positionLabel(item.position)} · ${questionDisplayName(item.question)}';
          completed = index;
        });
        try {
          final document = await widget.storage.loadHandwriting(
            item.question.id,
            fallbackTextNote: item.textNote,
          );
          document.textNote = item.textNote;
          if (!mounted) throw StateError('导出页面已经关闭');
          final png = await renderHandwritingExportPng(
            context,
            document: document,
            question: item.question,
            analysisVisible: document.analysisVisible,
            includeTextNote: includeTextNote,
          );
          final stagedFile = File(
            '${staging.path}${Platform.pathSeparator}${index.toString().padLeft(6, '0')}.png',
          );
          await stagedFile.writeAsBytes(png, flush: true);
          final relativePath = _uniquePath(
            item.relativePath(format.extension),
            usedPaths,
          );
          stagedFiles.add({
            'relativePath': relativePath,
            'filePath': stagedFile.path,
          });
        } catch (_) {
          failures.add(
            '${positionLabel(item.position)} · ${questionDisplayName(item.question)}',
          );
        }
        if (mounted) setState(() => completed = index + 1);
      }
      if (cancelRequested) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('已取消导出')),
          );
        }
        return;
      }
      if (stagedFiles.isEmpty) throw StateError('没有成功生成任何题目');
      final rootName = _rootName();
      final mode = format == BatchExportFormat.mergedPdf
          ? 'mergedPdf'
          : destination == BatchExportDestination.folder
              ? 'folder'
              : 'zip';
      final saveFiles = mode == 'zip'
          ? [
              for (final item in stagedFiles)
                {
                  ...item,
                  'relativePath': '$rootName/${item['relativePath']}',
                },
            ]
          : stagedFiles;
      setState(() {
        savingFiles = true;
        currentLabel = mode == 'zip'
            ? '正在创建 ZIP 压缩包'
            : mode == 'mergedPdf'
                ? '正在合并 PDF'
                : '正在写入所选文件夹';
      });
      final saved = await widget.storage.saveBatchExport(
        name: switch (mode) {
          'zip' => '$rootName.zip',
          'mergedPdf' => '$rootName.pdf',
          _ => rootName,
        },
        mode: mode,
        format: format.extension,
        files: saveFiles,
      );
      if (!mounted) return;
      if (saved == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('已取消导出')),
        );
      } else {
        await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('批量导出完成'),
            content: Text(
              '成功 ${stagedFiles.length} 道，失败 ${failures.length} 道。'
              '${failures.isEmpty ? '' : '\n\n失败题目：\n${failures.take(8).join('\n')}'
                  '${failures.length > 8 ? '\n……' : ''}'}',
            ),
            actions: [
              FilledButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('完成'),
              ),
            ],
          ),
        );
      }
    } catch (error) {
      if (mounted && !cancelRequested) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('批量导出失败：$error')),
        );
      }
    } finally {
      await widget.storage.deleteBatchExportStaging();
      if (mounted) {
        setState(() {
          exporting = false;
          savingFiles = false;
          currentLabel = '';
        });
      }
    }
  }

  String _rootName() {
    final now = DateTime.now();
    String two(int value) => value.toString().padLeft(2, '0');
    return '大观园数学题库导出_'
        '${now.year}-${two(now.month)}-${two(now.day)}_'
        '${two(now.hour)}${two(now.minute)}';
  }

  String _uniquePath(String path, Map<String, int> usedPaths) {
    final count = (usedPaths[path] ?? 0) + 1;
    usedPaths[path] = count;
    if (count == 1) return path;
    final dot = path.lastIndexOf('.');
    if (dot < 0) return '$path（$count）';
    return '${path.substring(0, dot)}（$count）${path.substring(dot)}';
  }

  @override
  Widget build(BuildContext context) => PopScope(
        canPop: !exporting,
        child: Scaffold(
          appBar: AppBar(title: Text('${widget.title} · 批量导出')),
          body: exporting ? _buildProgress() : _buildOptions(),
        ),
      );

  Widget _buildProgress() {
    final total = _selectedQuestions.length;
    final value = savingFiles || total == 0 ? null : completed / total;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                savingFiles ? Icons.inventory_2_outlined : Icons.draw_outlined,
                size: 48,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(height: 20),
              Text(
                savingFiles ? currentLabel : '正在生成 $completed / $total',
                style:
                    const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              Text(
                savingFiles ? '请勿关闭应用' : currentLabel,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 22),
              LinearProgressIndicator(value: value),
              const SizedBox(height: 24),
              OutlinedButton.icon(
                onPressed: cancelRequested ? null : _cancelExport,
                icon: const Icon(Icons.close),
                label: Text(cancelRequested ? '正在取消…' : '取消导出'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildOptions() {
    final eligible = _eligibleQuestions;
    final selected = _selectedQuestions.length;
    final tree = _ExportTreeNode.fromQuestions(eligible);
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              _OptionCard(
                title: '导出格式',
                child: Column(
                  children: [
                    for (final value in BatchExportFormat.values)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: ChoiceChip(
                          selected: format == value,
                          label: SizedBox(
                            width: double.infinity,
                            child: Text(value.label),
                          ),
                          onSelected: (_) => setState(() => format = value),
                        ),
                      ),
                  ],
                ),
              ),
              if (format != BatchExportFormat.mergedPdf)
                _OptionCard(
                  title: '保存方式',
                  child: SegmentedButton<BatchExportDestination>(
                    segments: [
                      for (final value in BatchExportDestination.values)
                        ButtonSegment(value: value, label: Text(value.label)),
                    ],
                    selected: {destination},
                    onSelectionChanged: (values) =>
                        setState(() => destination = values.first),
                  ),
                ),
              _OptionCard(
                title: '题目筛选与内容',
                child: Column(
                  children: [
                    SegmentedButton<bool>(
                      segments: const [
                        ButtonSegment(value: false, label: Text('全部题目')),
                        ButtonSegment(value: true, label: Text('仅有手写')),
                      ],
                      selected: {handwritingOnly},
                      onSelectionChanged: loadingHandwriting
                          ? null
                          : (values) => _setHandwritingOnly(values.first),
                    ),
                    if (loadingHandwriting) ...[
                      const SizedBox(height: 10),
                      const LinearProgressIndicator(),
                    ],
                    SwitchListTile(
                      value: includeTextNote,
                      contentPadding: EdgeInsets.zero,
                      title: const Text('包含文字笔记'),
                      subtitle: const Text('解析按照每道题画布最后保存的显示状态导出'),
                      onChanged: (value) =>
                          setState(() => includeTextNote = value),
                    ),
                  ],
                ),
              ),
              _OptionCard(
                title: '选择题目',
                child: eligible.isEmpty
                    ? const Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('当前筛选条件下没有可导出的题目'),
                      )
                    : _ExportTree(
                        root: tree,
                        selectedIds: selectedQuestionIds,
                        onChanged: () => setState(() {}),
                      ),
              ),
            ],
          ),
        ),
        SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              border: Border(
                top: BorderSide(color: Theme.of(context).dividerColor),
              ),
            ),
            child: Row(
              children: [
                Expanded(child: Text('已选择 $selected 道题')),
                FilledButton.icon(
                  key: const ValueKey('start-batch-export'),
                  onPressed: selected == 0 ? null : _runExport,
                  icon: const Icon(Icons.file_download_outlined),
                  label: const Text('开始导出'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _OptionCard extends StatelessWidget {
  const _OptionCard({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: 14),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style:
                    const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 10),
              child,
            ],
          ),
        ),
      );
}

class _ExportTreeNode {
  _ExportTreeNode(this.name);

  factory _ExportTreeNode.fromQuestions(List<BatchExportQuestion> questions) {
    final root = _ExportTreeNode('root');
    for (final item in questions) {
      var node = root;
      for (final segment in item.pathSegments) {
        node = node.children.putIfAbsent(
          segment,
          () => _ExportTreeNode(segment),
        );
      }
      node.questions.add(item);
    }
    return root;
  }

  final String name;
  final Map<String, _ExportTreeNode> children = {};
  final List<BatchExportQuestion> questions = [];

  Iterable<int> get descendantIds sync* {
    for (final question in questions) {
      yield question.question.id;
    }
    for (final child in children.values) {
      yield* child.descendantIds;
    }
  }
}

class _ExportTree extends StatelessWidget {
  const _ExportTree({
    required this.root,
    required this.selectedIds,
    required this.onChanged,
  });

  final _ExportTreeNode root;
  final Set<int> selectedIds;
  final VoidCallback onChanged;

  bool? _valueFor(Iterable<int> ids) {
    final values = ids.toList(growable: false);
    final selected = values.where(selectedIds.contains).length;
    if (selected == 0) return false;
    if (selected == values.length) return true;
    return null;
  }

  void _toggle(Iterable<int> ids, bool? value) {
    final values = ids.toSet();
    if (value ?? false) {
      selectedIds.addAll(values);
    } else {
      selectedIds.removeAll(values);
    }
    onChanged();
  }

  Widget _node(_ExportTreeNode node, String path, int depth) {
    final ids = node.descendantIds.toList(growable: false);
    final selected = ids.where(selectedIds.contains).length;
    return ExpansionTile(
      key: PageStorageKey(path),
      initiallyExpanded: depth < 2,
      controlAffinity: ListTileControlAffinity.trailing,
      leading: Checkbox(
        tristate: true,
        value: _valueFor(ids),
        onChanged: (value) => _toggle(ids, value),
      ),
      title: Text(node.name),
      subtitle: Text('已选 $selected / 共 ${ids.length}'),
      childrenPadding: const EdgeInsets.only(left: 18),
      children: [
        for (final child in node.children.values)
          _node(child, '$path/${child.name}', depth + 1),
        for (final item in node.questions)
          CheckboxListTile(
            dense: true,
            controlAffinity: ListTileControlAffinity.leading,
            value: selectedIds.contains(item.question.id),
            title: Text(
              '${positionLabel(item.position)} · '
              '${questionDisplayName(item.question)}',
            ),
            onChanged: (value) {
              if (value ?? false) {
                selectedIds.add(item.question.id);
              } else {
                selectedIds.remove(item.question.id);
              }
              onChanged();
            },
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) => Column(
        children: [
          for (final child in root.children.values) _node(child, child.name, 0),
        ],
      );
}

bool documentHasVisibleInk(HandwritingDocument document) {
  for (var index = 0; index < document.strokes.length; index++) {
    final stroke = document.strokes[index];
    if (stroke.erase || stroke.points.isEmpty) continue;
    final samples = <Offset>[];
    if (stroke.points.length == 1) {
      samples.add(stroke.points.single.offset);
    } else {
      for (var pointIndex = 1;
          pointIndex < stroke.points.length;
          pointIndex++) {
        final start = stroke.points[pointIndex - 1].offset;
        final end = stroke.points[pointIndex].offset;
        final distance = (end - start).distance;
        final steps = math.max(1, (distance / 4).ceil());
        for (var step = 0; step <= steps; step++) {
          samples.add(Offset.lerp(start, end, step / steps)!);
        }
      }
    }
    final laterErasers = document.strokes
        .skip(index + 1)
        .where((candidate) => candidate.erase && candidate.points.isNotEmpty);
    for (final sample in samples) {
      var fullyErased = false;
      for (final eraser in laterErasers) {
        final coverage = eraser.width / 2 - stroke.width / 2;
        if (coverage <= 0) continue;
        if (_distanceToStroke(sample, eraser) <= coverage) {
          fullyErased = true;
          break;
        }
      }
      if (!fullyErased) return true;
    }
  }
  return false;
}

double _distanceToStroke(Offset point, InkStroke stroke) {
  if (stroke.points.length == 1) {
    return (point - stroke.points.single.offset).distance;
  }
  var minimum = double.infinity;
  for (var index = 1; index < stroke.points.length; index++) {
    final start = stroke.points[index - 1].offset;
    final end = stroke.points[index].offset;
    final segment = end - start;
    final lengthSquared = segment.dx * segment.dx + segment.dy * segment.dy;
    final t = lengthSquared == 0
        ? 0.0
        : (((point - start).dx * segment.dx + (point - start).dy * segment.dy) /
                lengthSquared)
            .clamp(0.0, 1.0);
    final projection = start + segment * t;
    minimum = math.min(minimum, (point - projection).distance);
  }
  return minimum;
}
