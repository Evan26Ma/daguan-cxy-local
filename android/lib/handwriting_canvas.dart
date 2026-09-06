import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

import 'batch_export_models.dart';
import 'handwriting_eraser.dart';
import 'handwriting_models.dart';
import 'math_content.dart';
import 'models.dart';
import 'storage.dart';

const _primary = Color(0xff2563eb);
const _ink = Color(0xff0f172a);
const _text = Color(0xff334155);
const _muted = Color(0xff64748b);
const _border = Color(0xffe2e8f0);
const _canvas = Color(0xfff8fafc);

double _pressureScale(double pressure, double strength) =>
    ui.lerpDouble(1, .28 + pressure * .92, strength)!;

final _embeddedAssetImagePattern = RegExp(
  r'!\[[^\]]*\]\(asset://sha256/[a-f0-9]{64}\)',
);

int _embeddedImageCount(Iterable<String> fields) => fields.fold(
      0,
      (count, field) =>
          count + _embeddedAssetImagePattern.allMatches(field).length,
    );

double _estimatedQuestionCardHeight(Question question) {
  final textWeight =
      question.stem.length + question.options.fold(0, (a, b) => a + b.length);
  final imageCount = _embeddedImageCount([question.stem, ...question.options]);
  return math.max(420, 300 + textWeight * 1.35 + imageCount * 320);
}

double _estimatedAnalysisCardHeight(Question question) {
  final imageCount = _embeddedImageCount([
    question.answer,
    question.explanation,
  ]);
  return math.max(
    420,
    330 +
        (question.answer.length + question.explanation.length) * 1.3 +
        imageCount * 320,
  );
}

double _estimatedNoteCardHeight(String text) =>
    math.max(260, 230 + text.length * 1.2);

Rect handwritingExportContentBounds(
  HandwritingDocument document,
  Question question, {
  required bool analysisVisible,
  required bool includeTextNote,
  Map<String, double> cardHeights = const {},
}) {
  Rect cardBounds(String id, CanvasCardState state, String source) {
    final height = cardHeights[id] ??
        switch (source) {
          'question' => _estimatedQuestionCardHeight(question),
          'analysis' => _estimatedAnalysisCardHeight(question),
          _ => _estimatedNoteCardHeight(document.textNote),
        };
    return Rect.fromLTWH(
      state.x,
      state.y,
      state.width * state.scaleX,
      height * state.scaleY,
    );
  }

  var bounds = cardBounds('question', document.questionCard, 'question');
  if (analysisVisible) {
    bounds = bounds.expandToInclude(
      cardBounds('analysis', document.analysisCard, 'analysis'),
    );
  }
  if (includeTextNote) {
    bounds = bounds.expandToInclude(
      cardBounds('note', document.noteCard, 'note'),
    );
  }
  for (final copy in document.cardCopies) {
    if (copy.source == 'analysis' && !analysisVisible) continue;
    if (copy.source == 'note' && !includeTextNote) continue;
    bounds = bounds.expandToInclude(
      cardBounds(copy.id, copy.state, copy.source),
    );
  }
  for (final stroke in document.strokes) {
    if (!stroke.erase && !stroke.bounds.isEmpty) {
      bounds = bounds.expandToInclude(stroke.bounds);
    }
  }
  return bounds.inflate(48);
}

Future<Uint8List> renderHandwritingExportPng(
  BuildContext context, {
  required HandwritingDocument document,
  required Question question,
  required bool analysisVisible,
  required bool includeTextNote,
}) async {
  final boundaryKey = GlobalKey();
  final cardKeys = <String, GlobalKey>{
    'question': GlobalKey(debugLabel: 'export-card-question'),
    if (analysisVisible)
      'analysis': GlobalKey(debugLabel: 'export-card-analysis'),
    if (includeTextNote) 'note': GlobalKey(debugLabel: 'export-card-note'),
    for (final copy in document.cardCopies)
      if ((copy.source != 'analysis' || analysisVisible) &&
          (copy.source != 'note' || includeTextNote))
        copy.id: GlobalKey(debugLabel: 'export-card-${copy.id}'),
  };
  late Rect bounds;
  late double exportScale;
  late Size surfaceSize;
  late Offset exportOffset;

  void updateGeometry([Map<String, double> cardHeights = const {}]) {
    bounds = handwritingExportContentBounds(
      document,
      question,
      analysisVisible: analysisVisible,
      includeTextNote: includeTextNote,
      cardHeights: cardHeights,
    );
    final largest = math.max(bounds.width, bounds.height);
    exportScale = largest <= 3600 ? 1.0 : 3600 / largest;
    surfaceSize = Size(
      math.max(1, bounds.width * exportScale),
      math.max(1, bounds.height * exportScale),
    );
    exportOffset = -bounds.topLeft * exportScale;
  }

  updateGeometry();
  final overlay = Overlay.of(context);
  late final OverlayEntry entry;
  entry = OverlayEntry(
    builder: (context) => IgnorePointer(
      child: Center(
        child: Opacity(
          opacity: .01,
          child: FittedBox(
            fit: BoxFit.contain,
            child: RepaintBoundary(
              key: boundaryKey,
              child: HandwritingExportSurface(
                size: surfaceSize,
                document: document,
                question: question,
                analysisVisible: analysisVisible,
                includeTextNote: includeTextNote,
                offset: exportOffset,
                scale: exportScale,
                cardKeys: cardKeys,
              ),
            ),
          ),
        ),
      ),
    ),
  );
  overlay.insert(entry);
  try {
    await WidgetsBinding.instance.endOfFrame;
    await Future<void>.delayed(const Duration(milliseconds: 24));
    final measuredHeights = <String, double>{};
    for (final entry in cardKeys.entries) {
      final height = entry.value.currentContext?.size?.height;
      if (height != null && height > 0) measuredHeights[entry.key] = height;
    }
    if (measuredHeights.isNotEmpty) {
      updateGeometry(measuredHeights);
      entry.markNeedsBuild();
      await WidgetsBinding.instance.endOfFrame;
      await Future<void>.delayed(const Duration(milliseconds: 24));
    }
    final boundary = boundaryKey.currentContext?.findRenderObject()
        as RenderRepaintBoundary?;
    if (boundary == null) throw StateError('画布尚未完成布局');
    final image = await boundary.toImage(pixelRatio: 1);
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    if (byteData == null) throw StateError('无法生成画布图像');
    return byteData.buffer.asUint8List();
  } finally {
    if (entry.mounted) entry.remove();
  }
}

enum CanvasTool { pen, eraser, hand, lasso }

class HandwritingQuestionContext {
  const HandwritingQuestionContext({
    required this.question,
    required this.categoryPath,
    required this.textNote,
    required this.displayPosition,
    required this.index,
    required this.total,
    required this.state,
    required this.correctOptionIndexes,
    this.canEnterSequence = false,
  });

  final Question question;
  final String categoryPath;
  final String textNote;
  final int? displayPosition;
  final int index;
  final int total;
  final QuestionState state;
  final Set<int> correctOptionIndexes;
  final bool canEnterSequence;

  bool get canGoBack => index > 0;
  bool get canGoForward =>
      canEnterSequence || (index >= 0 && index < total - 1);
}

typedef NavigateCanvasQuestion = FutureOr<HandwritingQuestionContext?> Function(
    int offset);
typedef OpenCanvasNavigator = FutureOr<HandwritingQuestionContext?> Function(
    BuildContext context);
typedef CanvasTextNoteChanged = void Function(Question question, String note);
typedef CanvasQuestionChanged = void Function(Question question);
typedef CanvasMasteryChanged = void Function(
    Question question, Mastery mastery);
typedef CanvasAnswerSubmitted = void Function(
    Question question, Set<int> selectedIndexes);
typedef CanvasAnswerCleared = void Function(Question question);
typedef CanvasRestartRequested = Future<void> Function(
    HandwritingQuestionContext context);

class _ClipboardCard {
  const _ClipboardCard({required this.source, required this.state});

  final String source;
  final CanvasCardState state;
}

class _CanvasClipboard {
  const _CanvasClipboard({
    required this.bounds,
    required this.strokes,
    required this.cards,
  });

  final Rect bounds;
  final List<InkStroke> strokes;
  final List<_ClipboardCard> cards;
}

class HandwritingCanvasSession extends StatefulWidget {
  const HandwritingCanvasSession({
    super.key,
    required this.storage,
    required this.initialContext,
    required this.onNavigate,
    required this.onOpenNavigator,
    required this.onTextNoteChanged,
    required this.onToggleFavorite,
    required this.onSetMastery,
    required this.onSubmitAnswer,
    required this.onClearAnswer,
  });

  final LocalStorage storage;
  final HandwritingQuestionContext initialContext;
  final NavigateCanvasQuestion onNavigate;
  final OpenCanvasNavigator onOpenNavigator;
  final CanvasTextNoteChanged onTextNoteChanged;
  final CanvasQuestionChanged onToggleFavorite;
  final CanvasMasteryChanged onSetMastery;
  final CanvasAnswerSubmitted onSubmitAnswer;
  final CanvasAnswerCleared onClearAnswer;

  @override
  State<HandwritingCanvasSession> createState() =>
      _HandwritingCanvasSessionState();
}

class _HandwritingCanvasSessionState extends State<HandwritingCanvasSession> {
  late HandwritingQuestionContext currentContext;
  var generation = 0;
  var restarting = false;
  var showRestartMessage = false;

  @override
  void initState() {
    super.initState();
    currentContext = widget.initialContext;
  }

  Future<void> _restart(HandwritingQuestionContext context) async {
    if (restarting) return;
    setState(() {
      currentContext = context;
      restarting = true;
    });
    await WidgetsBinding.instance.endOfFrame;
    PaintingBinding.instance.imageCache
      ..clear()
      ..clearLiveImages();
    await Future<void>.delayed(const Duration(milliseconds: 160));
    if (!mounted) return;
    setState(() {
      generation += 1;
      restarting = false;
      showRestartMessage = true;
    });
  }

  void _canvasLoaded() {
    if (!showRestartMessage) return;
    showRestartMessage = false;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('画布已重新启动，当前位置和书写内容完整保留')));
    });
  }

  @override
  Widget build(BuildContext context) {
    if (restarting) {
      return const Scaffold(
        backgroundColor: _canvas,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('正在恢复画布…'),
            ],
          ),
        ),
      );
    }
    return HandwritingCanvasPage(
      key: ValueKey(generation),
      storage: widget.storage,
      initialContext: currentContext,
      preserveLoadedViewport: generation > 0,
      onRestart: _restart,
      onLoaded: _canvasLoaded,
      onNavigate: widget.onNavigate,
      onOpenNavigator: widget.onOpenNavigator,
      onTextNoteChanged: widget.onTextNoteChanged,
      onToggleFavorite: widget.onToggleFavorite,
      onSetMastery: widget.onSetMastery,
      onSubmitAnswer: widget.onSubmitAnswer,
      onClearAnswer: widget.onClearAnswer,
    );
  }
}

class HandwritingCanvasPage extends StatefulWidget {
  const HandwritingCanvasPage({
    super.key,
    required this.storage,
    required this.initialContext,
    required this.onNavigate,
    required this.onOpenNavigator,
    required this.onTextNoteChanged,
    required this.onToggleFavorite,
    required this.onSetMastery,
    required this.onSubmitAnswer,
    required this.onClearAnswer,
    this.preserveLoadedViewport = false,
    this.onRestart,
    this.onLoaded,
  });

  final LocalStorage storage;
  final HandwritingQuestionContext initialContext;
  final NavigateCanvasQuestion onNavigate;
  final OpenCanvasNavigator onOpenNavigator;
  final CanvasTextNoteChanged onTextNoteChanged;
  final CanvasQuestionChanged onToggleFavorite;
  final CanvasMasteryChanged onSetMastery;
  final CanvasAnswerSubmitted onSubmitAnswer;
  final CanvasAnswerCleared onClearAnswer;
  final bool preserveLoadedViewport;
  final CanvasRestartRequested? onRestart;
  final VoidCallback? onLoaded;

  @override
  State<HandwritingCanvasPage> createState() => _HandwritingCanvasPageState();
}

class _HandwritingCanvasPageState extends State<HandwritingCanvasPage>
    with SingleTickerProviderStateMixin {
  static const _nativeChannel = MethodChannel('daguan.local/storage');

  HandwritingDocument? document;
  WritingToolSettings? toolSettings;
  late HandwritingQuestionContext questionContext;
  CanvasTool tool = CanvasTool.pen;
  bool analysisVisible = false;
  bool loading = true;
  bool saveFailed = false;
  bool allowPop = false;
  bool exporting = false;
  bool fitAfterMeasure = false;
  bool positionAnalysisAfterMeasure = false;
  Size viewport = Size.zero;
  Timer? saveTimer;
  Future<void>? saveInProgress;
  bool savePending = false;
  late final AnimationController viewPanController;
  Offset viewPanStart = Offset.zero;
  Offset viewPanEnd = Offset.zero;
  double viewScaleStart = 1;
  double viewScaleEnd = 1;

  final cardKeys = <String, GlobalKey>{};
  final cardHeights = <String, double>{};
  List<GlobalKey> questionOptionKeys = [];
  GlobalKey questionSubmitKey = GlobalKey(debugLabel: 'canvas-answer-submit');
  GlobalKey questionRetryKey = GlobalKey(debugLabel: 'canvas-answer-retry');
  Set<int> pendingOptions = {};
  final activePointers = <int, Offset>{};
  final pointerOrigins = <int, Offset>{};
  final ignoredTouchPointers = <int>{};
  int? drawingPointer;
  InkStroke? activeStroke;
  final activeGestureStrokes = <InkStroke>[];
  bool stylusActive = false;
  DateTime touchBlockedUntil = DateTime.fromMillisecondsSinceEpoch(0);
  bool pressureEraserActive = false;
  Offset? stylusCursor;
  double stylusPressure = 1;

  double? pinchStartDistance;
  double? pinchStartScale;
  Offset? pinchAnchorWorld;

  List<Offset> lassoPoints = [];
  final selectedStrokeIds = <String>{};
  final selectedCards = <String>{};
  bool movingSelection = false;
  Offset? selectionMoveOrigin;
  List<InkStroke> selectionOriginalStrokes = [];
  Map<String, CanvasCardState> selectionOriginalCards = {};
  Rect? selectionResizeBounds;
  Offset selectionResizeDelta = Offset.zero;
  _ResizeHandle? selectionResizeHandle;
  _CanvasClipboard? canvasClipboard;

  bool primaryStylusButtonWasPressed = false;
  bool secondaryStylusButtonWasPressed = false;
  Timer? secondaryStylusButtonTimer;
  int strokeSerial = 0;
  int cardSerial = 0;
  int inkRevision = 0;
  final inkPictureCache = _InkPictureCache();

  HandwritingDocument get doc => document!;
  WritingToolSettings get writingTools => toolSettings!;

  @override
  void initState() {
    super.initState();
    questionContext = widget.initialContext;
    viewPanController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 280),
    )..addListener(() {
        if (!mounted || document == null) return;
        setState(() {
          final progress = Curves.easeOutCubic.transform(
            viewPanController.value,
          );
          doc.viewOffset = Offset.lerp(viewPanStart, viewPanEnd, progress)!;
          doc.viewScale = ui.lerpDouble(
            viewScaleStart,
            viewScaleEnd,
            progress,
          )!;
        });
      });
    viewPanController.addStatusListener((status) {
      if (status == AnimationStatus.completed) _scheduleSave();
    });
    _nativeChannel.setMethodCallHandler(_handleNativeCall);
    _loadQuestion(preserveViewport: widget.preserveLoadedViewport);
  }

  @override
  void dispose() {
    saveTimer?.cancel();
    secondaryStylusButtonTimer?.cancel();
    viewPanController.dispose();
    inkPictureCache.dispose();
    _nativeChannel.setMethodCallHandler(null);
    super.dispose();
  }

  Future<void> _handleNativeCall(MethodCall call) async {
    if (call.method != 'pencilDoubleClick' || !mounted || loading) return;
    _togglePenEraser();
  }

  void _togglePenEraser() {
    setState(() {
      tool = tool == CanvasTool.eraser ? CanvasTool.pen : CanvasTool.eraser;
      selectedStrokeIds.clear();
      selectedCards.clear();
    });
  }

  Future<void> _closeCanvas() async {
    if (allowPop) return;
    saveTimer?.cancel();
    try {
      await _saveNow();
    } catch (_) {
      return;
    }
    if (!mounted) return;
    setState(() => allowPop = true);
    Navigator.of(context).pop();
  }

  Future<void> _loadQuestion({bool preserveViewport = false}) async {
    saveTimer?.cancel();
    setState(() {
      loading = true;
      analysisVisible = false;
      selectedStrokeIds.clear();
      selectedCards.clear();
      cardKeys.clear();
      cardHeights.clear();
      questionOptionKeys = List.generate(
        questionContext.question.options.length,
        (index) => GlobalKey(debugLabel: 'canvas-question-option-$index'),
      );
      questionSubmitKey = GlobalKey(debugLabel: 'canvas-answer-submit');
      questionRetryKey = GlobalKey(debugLabel: 'canvas-answer-retry');
      pendingOptions = {
        for (final option in questionContext.state.selectedOptions)
          if (option.isNotEmpty) option.codeUnitAt(0) - 65,
      };
    });
    final hasSavedCanvas = widget.storage.hasHandwriting(
      questionContext.question.id,
    );
    final loadedTools =
        toolSettings ?? await widget.storage.loadWritingToolSettings();
    final loaded = await widget.storage.loadHandwriting(
      questionContext.question.id,
      fallbackTextNote: questionContext.textNote,
    );
    final textNoteChanged = loaded.textNote != questionContext.textNote;
    loaded.textNote = questionContext.textNote;
    if (!mounted) return;
    setState(() {
      toolSettings = loadedTools;
      document = loaded;
      analysisVisible = loaded.analysisVisible;
      inkRevision += 1;
      tool = CanvasTool.pen;
      fitAfterMeasure = !preserveViewport && loaded.viewOffset == Offset.zero;
      positionAnalysisAfterMeasure = !preserveViewport && !hasSavedCanvas;
      loading = false;
    });
    if (textNoteChanged) _scheduleSave();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      widget.onLoaded?.call();
      if (viewport.isEmpty) return;
      if (!preserveViewport &&
          loaded.viewOffset == Offset.zero &&
          !fitAfterMeasure) {
        _fitQuestion();
      }
    });
  }

  void _scheduleSave() {
    saveFailed = false;
    saveTimer?.cancel();
    saveTimer = Timer(const Duration(milliseconds: 550), _saveNow);
  }

  Future<void> _saveNow() async {
    final activeSave = saveInProgress;
    if (activeSave != null) {
      savePending = true;
      await activeSave;
      return;
    }
    final operation = _performSaveLoop();
    saveInProgress = operation;
    try {
      await operation;
    } finally {
      if (identical(saveInProgress, operation)) saveInProgress = null;
    }
  }

  Future<void> _performSaveLoop() async {
    try {
      do {
        savePending = false;
        final current = document;
        if (current == null) break;
        await Future.wait([
          widget.storage.saveHandwriting(current),
          widget.storage.saveWritingToolSettings(writingTools),
        ]);
      } while (savePending);
      if (mounted && saveFailed) setState(() => saveFailed = false);
    } catch (error, stackTrace) {
      if (mounted && !saveFailed) {
        setState(() => saveFailed = true);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('书写内容保存失败，请稍后重试')));
      }
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<void> _navigate(int offset) async {
    try {
      await _saveNow();
    } catch (_) {
      return;
    }
    final next = await widget.onNavigate(offset);
    if (next == null || !mounted) return;
    questionContext = next;
    await _loadQuestion();
  }

  Future<void> _openNavigator() async {
    try {
      await _saveNow();
    } catch (_) {
      return;
    }
    if (!mounted) return;
    final next = await widget.onOpenNavigator(context);
    if (next == null || !mounted) return;
    questionContext = next;
    await _loadQuestion();
  }

  void _toggleFavorite() {
    widget.onToggleFavorite(questionContext.question);
    setState(() {});
  }

  void _setMastery(Mastery mastery) {
    widget.onSetMastery(questionContext.question, mastery);
    setState(() {});
  }

  Offset _toWorld(Offset local) => (local - doc.viewOffset) / doc.viewScale;

  double _pressure(PointerEvent event) {
    final range = event.pressureMax - event.pressureMin;
    if (range <= .001) return 1;
    return ((event.pressure - event.pressureMin) / range).clamp(0.05, 1);
  }

  bool _isStylus(PointerEvent event) =>
      event.kind == PointerDeviceKind.stylus ||
      event.kind == PointerDeviceKind.invertedStylus;

  bool get _touchIsBlocked =>
      stylusActive || DateTime.now().isBefore(touchBlockedUntil);

  bool _shouldDraw(PointerEvent event) {
    if (event.kind == PointerDeviceKind.invertedStylus) return true;
    if (_isStylus(event)) {
      return tool == CanvasTool.pen || tool == CanvasTool.eraser;
    }
    return event.kind == PointerDeviceKind.touch &&
        doc.fingerDrawing &&
        (tool == CanvasTool.pen || tool == CanvasTool.eraser);
  }

  bool _eventUsesEraser(PointerEvent event) {
    if (event.kind == PointerDeviceKind.invertedStylus ||
        tool == CanvasTool.eraser) {
      pressureEraserActive = false;
      return true;
    }
    if (!_isStylus(event) ||
        tool != CanvasTool.pen ||
        !writingTools.pressureEraseEnabled) {
      pressureEraserActive = false;
      return false;
    }
    pressureEraserActive = pressureEraserActive ||
        _pressure(event) >= writingTools.pressureEraseThreshold;
    return pressureEraserActive;
  }

  InkStroke _newStroke(
    PointerEvent event, {
    required bool erase,
    List<InkPoint>? points,
  }) {
    final preset = writingTools.penPresets[writingTools.activePen];
    final point = _toWorld(event.localPosition);
    return InkStroke(
      id: _nextStrokeId(),
      points: points ?? [InkPoint(point.dx, point.dy, _pressure(event))],
      color: erase ? Colors.transparent.toARGB32() : preset.color,
      width: erase ? writingTools.eraserWidth : preset.width,
      pressureStrength:
          erase ? writingTools.eraserPressureStrength : preset.pressureStrength,
      erase: erase,
    );
  }

  String _nextStrokeId() =>
      '${DateTime.now().microsecondsSinceEpoch}-${strokeSerial++}';

  void _completeStrokePoint(InkStroke stroke) {
    if (stroke.points.length != 1) return;
    final point = stroke.points.single;
    stroke.points.add(InkPoint(point.x + .01, point.y + .01, point.pressure));
  }

  void _handleStylusButtons(PointerEvent event) {
    if (!_isStylus(event)) return;
    final primaryPressed = event.buttons & kPrimaryStylusButton != 0;
    if (primaryPressed && !primaryStylusButtonWasPressed) {
      _togglePenEraser();
    }
    primaryStylusButtonWasPressed = primaryPressed;

    final secondaryPressed = event.buttons & kSecondaryStylusButton != 0;
    if (secondaryPressed && !secondaryStylusButtonWasPressed) {
      if (secondaryStylusButtonTimer?.isActive ?? false) {
        secondaryStylusButtonTimer?.cancel();
        secondaryStylusButtonTimer = null;
        if (doc.redoHistory.isNotEmpty) _redo();
      } else {
        secondaryStylusButtonTimer = Timer(
          const Duration(milliseconds: 360),
          () {
            secondaryStylusButtonTimer = null;
            if (mounted && !loading && doc.undoHistory.isNotEmpty) _undo();
          },
        );
      }
    }
    secondaryStylusButtonWasPressed = secondaryPressed;
  }

  void _onPointerDown(PointerDownEvent event) {
    viewPanController.stop();
    _handleStylusButtons(event);
    if (_isStylus(event)) {
      stylusCursor = event.localPosition;
      stylusPressure = _pressure(event);
      stylusActive = true;
      touchBlockedUntil = DateTime.now().add(const Duration(milliseconds: 180));
      for (final pointer in activePointers.keys.toList()) {
        ignoredTouchPointers.add(pointer);
      }
      activePointers.clear();
      pointerOrigins.clear();
      pinchStartDistance = null;
      pinchAnchorWorld = null;
    } else if (_touchIsBlocked) {
      ignoredTouchPointers.add(event.pointer);
      return;
    }

    if (_shouldDraw(event)) {
      final erase = _eventUsesEraser(event);
      setState(() {
        drawingPointer = event.pointer;
        activeGestureStrokes.clear();
        activeStroke = _newStroke(event, erase: erase);
      });
      return;
    }

    if (event.kind != PointerDeviceKind.touch && !_isStylus(event)) return;
    activePointers[event.pointer] = event.localPosition;
    pointerOrigins[event.pointer] = event.localPosition;
    if (tool == CanvasTool.lasso && activePointers.length == 1) {
      final world = _toWorld(event.localPosition);
      if (_selectionBounds().inflate(18 / doc.viewScale).contains(world) &&
          (selectedStrokeIds.isNotEmpty || selectedCards.isNotEmpty)) {
        movingSelection = true;
        selectionMoveOrigin = world;
        selectionOriginalStrokes = [
          for (final stroke in doc.strokes)
            if (selectedStrokeIds.contains(stroke.id)) stroke,
        ];
        selectionOriginalCards = {
          for (final id in selectedCards) id: _card(id),
        };
      } else {
        setState(() {
          selectedStrokeIds.clear();
          selectedCards.clear();
          lassoPoints = [world];
        });
      }
      return;
    }
    if (activePointers.length == 2) _beginPinch();
  }

  void _onPointerMove(PointerMoveEvent event) {
    _handleStylusButtons(event);
    if (_isStylus(event)) {
      stylusCursor = event.localPosition;
      stylusPressure = _pressure(event);
    }
    if (ignoredTouchPointers.contains(event.pointer)) return;
    if (drawingPointer == event.pointer && activeStroke != null) {
      final point = _toWorld(event.localPosition);
      final previous = activeStroke!.points.last;
      final pressure = _pressure(event);
      final erase = _eventUsesEraser(event);
      if (erase != activeStroke!.erase) {
        _completeStrokePoint(activeStroke!);
        final previousPoint = activeStroke!.points.last;
        setState(() {
          activeGestureStrokes.add(activeStroke!);
          activeStroke = _newStroke(
            event,
            erase: erase,
            points: [previousPoint, InkPoint(point.dx, point.dy, pressure)],
          );
        });
        return;
      }
      if ((point - previous.offset).distance < .45 / doc.viewScale) return;
      setState(() {
        activeStroke!.points.add(InkPoint(point.dx, point.dy, pressure));
      });
      return;
    }
    if ((event.kind != PointerDeviceKind.touch && !_isStylus(event)) ||
        !activePointers.containsKey(event.pointer)) {
      return;
    }
    activePointers[event.pointer] = event.localPosition;

    if (tool == CanvasTool.lasso && activePointers.length == 1) {
      final world = _toWorld(event.localPosition);
      if (movingSelection && selectionMoveOrigin != null) {
        _moveSelection(world - selectionMoveOrigin!);
      } else {
        setState(() => lassoPoints.add(world));
      }
      return;
    }
    if (activePointers.length >= 2) {
      _updatePinch();
    } else {
      setState(() {
        doc.viewOffset += event.delta;
      });
      _scheduleSave();
    }
  }

  void _onPointerUp(PointerEvent event) {
    _handleStylusButtons(event);
    final wasIgnored = ignoredTouchPointers.remove(event.pointer);
    if (wasIgnored) return;
    if (drawingPointer == event.pointer && activeStroke != null) {
      final finished = activeStroke!;
      _completeStrokePoint(finished);
      final completed = [...activeGestureStrokes, finished];
      final operation = buildDestructiveEraseOperation(
        existingStrokes: doc.strokes,
        completedStrokes: completed,
        nextStrokeId: _nextStrokeId,
      );
      final changed =
          operation.added.isNotEmpty || operation.removed.isNotEmpty;
      setState(() {
        if (changed) {
          doc.apply(operation);
          inkRevision += 1;
        }
        drawingPointer = null;
        activeStroke = null;
        activeGestureStrokes.clear();
        pressureEraserActive = false;
      });
      if (changed) _scheduleSave();
    }

    if (_isStylus(event)) {
      stylusActive = false;
      touchBlockedUntil = DateTime.now().add(const Duration(milliseconds: 180));
    }
    if (event.kind != PointerDeviceKind.touch && !_isStylus(event)) return;
    final wasOnlyPointer = activePointers.length == 1;
    final origin = pointerOrigins.remove(event.pointer);
    final wasTap =
        origin != null && (event.localPosition - origin).distance < 10;
    activePointers.remove(event.pointer);
    if (tool == CanvasTool.lasso && wasOnlyPointer) {
      if (movingSelection) {
        _finishMovingSelection();
      } else if (lassoPoints.length > 2) {
        _finishLasso();
      } else if (wasTap) {
        if (!_maybeEditTextCard(event.localPosition)) {
          _returnToPen();
        }
      }
      movingSelection = false;
      selectionMoveOrigin = null;
      return;
    }
    if (wasOnlyPointer && wasTap && event is PointerUpEvent) {
      if (!_maybeAnswerQuestion(event.position)) {
        _maybeEditTextCard(event.localPosition);
      }
    }
    if (activePointers.length < 2) {
      pinchStartDistance = null;
      pinchAnchorWorld = null;
    }
  }

  bool _keyContains(GlobalKey key, Offset globalPosition) {
    final renderObject = key.currentContext?.findRenderObject();
    if (renderObject is! RenderBox || !renderObject.hasSize) return false;
    final bounds = MatrixUtils.transformRect(
      renderObject.getTransformTo(null),
      Offset.zero & renderObject.size,
    );
    return bounds.contains(globalPosition);
  }

  void _startRedo(Question question, {Set<int> options = const <int>{}}) {
    widget.onClearAnswer(question);
    setState(() {
      pendingOptions = options;
      analysisVisible = false;
      doc.analysisVisible = false;
    });
    _scheduleSave();
  }

  bool _maybeAnswerQuestion(Offset globalPosition) {
    final question = questionContext.question;
    final state = questionContext.state;
    if (_touchIsBlocked ||
        doc.fingerDrawing ||
        tool == CanvasTool.lasso ||
        tool == CanvasTool.hand ||
        question.options.isEmpty ||
        (question.type != 'single_choice' &&
            question.type != 'multiple_choice')) {
      return false;
    }
    if (state.lastCorrect != null) {
      if (_keyContains(questionRetryKey, globalPosition)) {
        _startRedo(question);
        return true;
      }
      final selected = {
        for (final option in state.selectedOptions)
          if (option.isNotEmpty) option.codeUnitAt(0) - 65,
      };
      for (var index = 0; index < questionOptionKeys.length; index++) {
        if (!_keyContains(questionOptionKeys[index], globalPosition)) continue;
        if (!selected.contains(index)) return true;
        selected.remove(index);
        _startRedo(question, options: selected);
        return true;
      }
      return false;
    }
    if (question.type == 'multiple_choice' &&
        _keyContains(questionSubmitKey, globalPosition)) {
      if (pendingOptions.isEmpty) return true;
      widget.onSubmitAnswer(question, pendingOptions);
      setState(() {});
      return true;
    }
    for (var index = 0; index < questionOptionKeys.length; index++) {
      if (!_keyContains(questionOptionKeys[index], globalPosition)) continue;
      if (question.type == 'multiple_choice') {
        setState(() {
          if (!pendingOptions.add(index)) pendingOptions.remove(index);
        });
      } else {
        widget.onSubmitAnswer(question, {index});
        setState(() {});
      }
      return true;
    }
    return false;
  }

  void _onPointerHover(PointerHoverEvent event) {
    if (!_isStylus(event)) return;
    _handleStylusButtons(event);
    setState(() {
      stylusCursor = event.localPosition;
      stylusPressure = 1;
    });
  }

  void _onPointerExit(PointerExitEvent event) {
    if (!_isStylus(event)) return;
    primaryStylusButtonWasPressed = false;
    secondaryStylusButtonWasPressed = false;
    setState(() => stylusCursor = null);
  }

  void _beginPinch() {
    final points = activePointers.values.take(2).toList();
    pinchStartDistance = (points[0] - points[1]).distance;
    pinchStartScale = doc.viewScale;
    final midpoint = (points[0] + points[1]) / 2;
    pinchAnchorWorld = _toWorld(midpoint);
  }

  void _updatePinch() {
    if (pinchStartDistance == null || pinchAnchorWorld == null) {
      _beginPinch();
      return;
    }
    final points = activePointers.values.take(2).toList();
    final distance = (points[0] - points[1]).distance;
    final midpoint = (points[0] + points[1]) / 2;
    final scale = (pinchStartScale! * distance / pinchStartDistance!)
        .clamp(.2, 4)
        .toDouble();
    setState(() {
      doc.viewScale = scale;
      doc.viewOffset = midpoint - pinchAnchorWorld! * scale;
    });
    _scheduleSave();
  }

  Rect _cardRect(String id) {
    final card = _card(id);
    final source = _cardSource(id);
    final height = cardHeights[id] ??
        switch (source) {
          'question' => _questionCardHeight(questionContext.question),
          'analysis' => _analysisCardHeight(questionContext.question),
          _ => _noteCardHeight(),
        };
    return Rect.fromLTWH(
      card.x,
      card.y,
      card.width * card.scaleX,
      height * card.scaleY,
    );
  }

  String _cardSource(String id) {
    if (id == 'question' || id == 'analysis' || id == 'note') return id;
    return doc.cardCopies.firstWhere((card) => card.id == id).source;
  }

  CanvasCardCopy? _cardCopy(String id) {
    for (final card in doc.cardCopies) {
      if (card.id == id) return card;
    }
    return null;
  }

  CanvasCardState _card(String id) {
    switch (id) {
      case 'question':
        return doc.questionCard;
      case 'analysis':
        return doc.analysisCard;
      case 'note':
        return doc.noteCard;
      default:
        return _cardCopy(id)!.state;
    }
  }

  void _setCard(String id, CanvasCardState value) {
    switch (id) {
      case 'question':
        doc.questionCard = value;
        break;
      case 'analysis':
        doc.analysisCard = value;
        break;
      case 'note':
        doc.noteCard = value;
        break;
      default:
        final index = doc.cardCopies.indexWhere((card) => card.id == id);
        if (index >= 0) {
          doc.cardCopies[index] = doc.cardCopies[index].copyWith(state: value);
        }
    }
  }

  List<String> get _visibleCardIds => [
        'question',
        if (analysisVisible) 'analysis',
        'note',
        for (final card in doc.cardCopies)
          if (card.source != 'analysis' || analysisVisible) card.id,
      ];

  GlobalKey _cardKey(String id) =>
      cardKeys.putIfAbsent(id, () => GlobalKey(debugLabel: 'canvas-card-$id'));

  void _measureCards() {
    if (!mounted || loading) return;
    var changed = false;
    for (final entry in cardKeys.entries) {
      final height = entry.value.currentContext?.size?.height;
      if (height == null || height <= 0) continue;
      if (((cardHeights[entry.key] ?? -1) - height).abs() > .5) {
        cardHeights[entry.key] = height;
        changed = true;
      }
    }
    final questionHeight = cardHeights['question'];
    if (positionAnalysisAfterMeasure && questionHeight != null) {
      final question = doc.questionCard;
      doc.analysisCard = doc.analysisCard.copyWith(
        x: question.x,
        y: question.y + questionHeight * question.scaleY + 40,
      );
      positionAnalysisAfterMeasure = false;
      changed = true;
      _scheduleSave();
    }
    if (!changed) return;
    if (fitAfterMeasure && cardHeights['question'] != null) {
      fitAfterMeasure = false;
      _fitQuestion();
      return;
    }
    setState(() {});
  }

  Rect _selectionBounds() {
    Rect? result;
    for (final stroke in doc.strokes) {
      if (!selectedStrokeIds.contains(stroke.id)) continue;
      result = result == null
          ? stroke.bounds
          : result.expandToInclude(stroke.bounds);
    }
    for (final card in selectedCards) {
      final bounds = _cardRect(card);
      result = result == null ? bounds : result.expandToInclude(bounds);
    }
    return result ?? Rect.zero;
  }

  void _finishLasso() {
    final path = Path()..addPolygon(lassoPoints, true);
    final bounds = path.getBounds();
    var foundSelection = false;
    setState(() {
      selectedStrokeIds
        ..clear()
        ..addAll(
          doc.strokes.where((stroke) {
            if (stroke.erase || !bounds.overlaps(stroke.bounds)) {
              return false;
            }
            return stroke.points.any(
              (point) => path.contains(point.offset),
            );
          }).map((stroke) => stroke.id),
        );
      selectedCards.clear();
      for (final id in _visibleCardIds) {
        if (bounds.overlaps(_cardRect(id))) selectedCards.add(id);
      }
      foundSelection = selectedStrokeIds.isNotEmpty || selectedCards.isNotEmpty;
      lassoPoints = [];
    });
    if (!foundSelection) _returnToPen();
  }

  void _returnToPen() {
    setState(() {
      tool = CanvasTool.pen;
      selectedStrokeIds.clear();
      selectedCards.clear();
      lassoPoints = [];
    });
  }

  void _moveSelection(Offset delta) {
    setState(() {
      for (final original in selectionOriginalStrokes) {
        final index = doc.strokes.indexWhere(
          (stroke) => stroke.id == original.id,
        );
        if (index >= 0) doc.strokes[index] = original.translated(delta);
      }
      for (final entry in selectionOriginalCards.entries) {
        _setCard(entry.key, entry.value.translated(delta));
      }
      if (selectionOriginalStrokes.isNotEmpty) inkRevision += 1;
    });
  }

  void _finishMovingSelection() {
    final moved = [
      for (final stroke in doc.strokes)
        if (selectedStrokeIds.contains(stroke.id)) stroke,
    ];
    final beforeCards = <CanvasCardCopy>[];
    final afterCards = <CanvasCardCopy>[];
    final beforeBaseCards = <String, CanvasCardState>{};
    final afterBaseCards = <String, CanvasCardState>{};
    for (final entry in selectionOriginalCards.entries) {
      final copy = _cardCopy(entry.key);
      if (copy == null) {
        beforeBaseCards[entry.key] = entry.value;
        afterBaseCards[entry.key] = _card(entry.key);
      } else {
        beforeCards.add(copy.copyWith(state: entry.value));
        afterCards.add(copy);
      }
    }
    if (selectionOriginalStrokes.isNotEmpty ||
        beforeCards.isNotEmpty ||
        beforeBaseCards.isNotEmpty) {
      doc.recordApplied(
        CanvasOperation(
          added: moved,
          removed: selectionOriginalStrokes,
          addedCards: afterCards,
          removedCards: beforeCards,
          beforeBaseCards: beforeBaseCards,
          afterBaseCards: afterBaseCards,
        ),
      );
    }
    selectionOriginalStrokes = [];
    selectionOriginalCards = {};
    _scheduleSave();
  }

  void _beginResizeSelection(_ResizeHandle handle) {
    final bounds = _selectionBounds();
    if (bounds.isEmpty) return;
    selectionResizeHandle = handle;
    selectionResizeBounds = bounds;
    selectionResizeDelta = Offset.zero;
    selectionOriginalStrokes = [
      for (final stroke in doc.strokes)
        if (selectedStrokeIds.contains(stroke.id)) stroke,
    ];
    selectionOriginalCards = {for (final id in selectedCards) id: _card(id)};
  }

  void _updateResizeSelection(Offset screenDelta) {
    final bounds = selectionResizeBounds;
    final handle = selectionResizeHandle;
    if (bounds == null || handle == null) return;
    selectionResizeDelta += screenDelta / doc.viewScale;
    final affectsLeft = handle == _ResizeHandle.topLeft ||
        handle == _ResizeHandle.centerLeft ||
        handle == _ResizeHandle.bottomLeft;
    final affectsRight = handle == _ResizeHandle.topRight ||
        handle == _ResizeHandle.centerRight ||
        handle == _ResizeHandle.bottomRight;
    final affectsTop = handle == _ResizeHandle.topLeft ||
        handle == _ResizeHandle.topCenter ||
        handle == _ResizeHandle.topRight;
    final affectsBottom = handle == _ResizeHandle.bottomLeft ||
        handle == _ResizeHandle.bottomCenter ||
        handle == _ResizeHandle.bottomRight;
    var horizontal = affectsLeft || affectsRight
        ? 1 +
            selectionResizeDelta.dx *
                (affectsRight ? 1 : -1) /
                math.max(1, bounds.width)
        : 1.0;
    var vertical = affectsTop || affectsBottom
        ? 1 +
            selectionResizeDelta.dy *
                (affectsBottom ? 1 : -1) /
                math.max(1, bounds.height)
        : 1.0;
    final isCorner =
        (affectsLeft || affectsRight) && (affectsTop || affectsBottom);
    if (isCorner) {
      final factor = ((horizontal - 1).abs() >= (vertical - 1).abs()
              ? horizontal
              : vertical)
          .clamp(.2, 5)
          .toDouble();
      horizontal = factor;
      vertical = factor;
    } else {
      horizontal = horizontal.clamp(.2, 5).toDouble();
      vertical = vertical.clamp(.2, 5).toDouble();
    }
    final anchor = switch (handle) {
      _ResizeHandle.topLeft => bounds.bottomRight,
      _ResizeHandle.topCenter => bounds.bottomCenter,
      _ResizeHandle.topRight => bounds.bottomLeft,
      _ResizeHandle.centerLeft => bounds.centerRight,
      _ResizeHandle.centerRight => bounds.centerLeft,
      _ResizeHandle.bottomLeft => bounds.topRight,
      _ResizeHandle.bottomCenter => bounds.topCenter,
      _ResizeHandle.bottomRight => bounds.topLeft,
    };
    setState(() {
      for (final original in selectionOriginalStrokes) {
        final index = doc.strokes.indexWhere(
          (stroke) => stroke.id == original.id,
        );
        if (index >= 0) {
          doc.strokes[index] = original.scaledXY(horizontal, vertical, anchor);
        }
      }
      for (final entry in selectionOriginalCards.entries) {
        final card = entry.value;
        final origin = Offset(card.x, card.y);
        final next = Offset(
          anchor.dx + (origin.dx - anchor.dx) * horizontal,
          anchor.dy + (origin.dy - anchor.dy) * vertical,
        );
        _setCard(
          entry.key,
          card.copyWith(
            x: next.dx,
            y: next.dy,
            scaleX: (card.scaleX * horizontal).clamp(.15, 8),
            scaleY: (card.scaleY * vertical).clamp(.15, 8),
          ),
        );
      }
      if (selectionOriginalStrokes.isNotEmpty) inkRevision += 1;
    });
  }

  void _finishResizeSelection() {
    final afterStrokes = [
      for (final stroke in doc.strokes)
        if (selectedStrokeIds.contains(stroke.id)) stroke,
    ];
    final beforeCards = <CanvasCardCopy>[];
    final afterCards = <CanvasCardCopy>[];
    final beforeBaseCards = <String, CanvasCardState>{};
    final afterBaseCards = <String, CanvasCardState>{};
    for (final entry in selectionOriginalCards.entries) {
      final copy = _cardCopy(entry.key);
      if (copy == null) {
        beforeBaseCards[entry.key] = entry.value;
        afterBaseCards[entry.key] = _card(entry.key);
      } else {
        beforeCards.add(copy.copyWith(state: entry.value));
        afterCards.add(copy);
      }
    }
    if (selectionOriginalStrokes.isNotEmpty ||
        beforeCards.isNotEmpty ||
        beforeBaseCards.isNotEmpty) {
      doc.recordApplied(
        CanvasOperation(
          added: afterStrokes,
          removed: selectionOriginalStrokes,
          addedCards: afterCards,
          removedCards: beforeCards,
          beforeBaseCards: beforeBaseCards,
          afterBaseCards: afterBaseCards,
        ),
      );
    }
    selectionOriginalStrokes = [];
    selectionOriginalCards = {};
    selectionResizeBounds = null;
    selectionResizeHandle = null;
    selectionResizeDelta = Offset.zero;
    _scheduleSave();
  }

  void _copySelection() {
    final bounds = _selectionBounds();
    if (bounds.isEmpty) return;
    canvasClipboard = _CanvasClipboard(
      bounds: bounds,
      strokes: [
        for (final stroke in doc.strokes)
          if (selectedStrokeIds.contains(stroke.id)) stroke,
      ],
      cards: [
        for (final id in selectedCards)
          _ClipboardCard(source: _cardSource(id), state: _card(id)),
      ],
    );
  }

  void _pasteClipboardAt(Offset target) {
    final clipboard = canvasClipboard;
    if (clipboard == null) return;
    final delta = target - clipboard.bounds.topLeft;
    final copiedStrokes = [
      for (final stroke in clipboard.strokes)
        stroke.translated(
          delta,
          newId: '${DateTime.now().microsecondsSinceEpoch}-${strokeSerial++}',
        ),
    ];
    final copiedCards = [
      for (final card in clipboard.cards)
        CanvasCardCopy(
          id: 'card-${DateTime.now().microsecondsSinceEpoch}-${cardSerial++}',
          source: card.source,
          state: card.state.translated(delta),
        ),
    ];
    setState(() {
      doc.apply(
        CanvasOperation(
          added: copiedStrokes,
          removed: [],
          addedCards: copiedCards,
        ),
      );
      selectedStrokeIds
        ..clear()
        ..addAll(copiedStrokes.map((stroke) => stroke.id));
      selectedCards
        ..clear()
        ..addAll(copiedCards.map((card) => card.id));
      if (copiedStrokes.isNotEmpty) inkRevision += 1;
    });
    _scheduleSave();
  }

  void _duplicateSelection() {
    final bounds = _selectionBounds();
    if (bounds.isEmpty) return;
    _copySelection();
    _pasteClipboardAt(bounds.topLeft + const Offset(36, 36));
  }

  void _deleteSelection() {
    final removed = [
      for (final stroke in doc.strokes)
        if (selectedStrokeIds.contains(stroke.id)) stroke,
    ];
    final removedCards = [
      for (final card in doc.cardCopies)
        if (selectedCards.contains(card.id)) card,
    ];
    setState(() {
      doc.apply(
        CanvasOperation(
          added: [],
          removed: removed,
          removedCards: removedCards,
        ),
      );
      selectedStrokeIds.clear();
      selectedCards.clear();
      if (removed.isNotEmpty) inkRevision += 1;
    });
    _scheduleSave();
  }

  void _undo() {
    setState(() {
      doc.undo();
      inkRevision += 1;
      selectedStrokeIds.clear();
      selectedCards.clear();
    });
    _scheduleSave();
  }

  void _redo() {
    setState(() {
      doc.redo();
      inkRevision += 1;
      selectedStrokeIds.clear();
      selectedCards.clear();
    });
    _scheduleSave();
  }

  void _fitQuestion() {
    if (viewport.isEmpty || loading) return;
    final card = doc.questionCard;
    final cardHeight = cardHeights['question'] ??
        _questionCardHeight(questionContext.question);
    final usableHeight = viewport.height - 120;
    final visualWidth = card.width * card.scaleX;
    final visualHeight = cardHeight * card.scaleY;
    final scale = math
        .min((viewport.width - 88) / visualWidth, usableHeight / visualHeight)
        .clamp(.28, 1.15);
    setState(() {
      doc.viewScale = scale;
      doc.viewOffset = Offset(
        (viewport.width - visualWidth * scale) / 2 - card.x * scale,
        28 - card.y * scale,
      );
    });
    _scheduleSave();
  }

  void _toggleAnalysis() {
    if (analysisVisible) {
      viewPanController.stop();
      setState(() {
        analysisVisible = false;
        doc.analysisVisible = false;
      });
      _scheduleSave();
      return;
    }
    setState(() {
      analysisVisible = true;
      doc.analysisVisible = true;
    });
    _scheduleSave();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _measureCards();
      _revealAnalysisIfOutsideViewport();
    });
  }

  void _revealAnalysisIfOutsideViewport() {
    if (!analysisVisible || viewport.isEmpty || loading) return;
    final analysis = _cardRect('analysis');
    final screenRect = Rect.fromLTRB(
      doc.viewOffset.dx + analysis.left * doc.viewScale,
      doc.viewOffset.dy + analysis.top * doc.viewScale,
      doc.viewOffset.dx + analysis.right * doc.viewScale,
      doc.viewOffset.dy + analysis.bottom * doc.viewScale,
    );
    final landscape = viewport.width > viewport.height;
    final visibleRect = Rect.fromLTRB(
      landscape ? 76 : 12,
      12,
      viewport.width - 12,
      viewport.height - (landscape ? 12 : 76),
    );
    if (visibleRect.contains(screenRect.topLeft) &&
        visibleRect.contains(screenRect.bottomRight)) {
      return;
    }

    const margin = 16.0;
    final fitScale = math.min(
      (visibleRect.width - margin * 2) / analysis.width,
      (visibleRect.height - margin * 2) / analysis.height,
    );
    final targetScale =
        math.min(doc.viewScale, fitScale).clamp(.2, 4).toDouble();
    final targetX = visibleRect.left +
        (visibleRect.width - analysis.width * targetScale) / 2 -
        analysis.left * targetScale;
    final targetY = visibleRect.top + margin - analysis.top * targetScale;
    viewPanStart = doc.viewOffset;
    viewPanEnd = Offset(targetX, targetY);
    viewScaleStart = doc.viewScale;
    viewScaleEnd = targetScale;
    viewPanController
      ..reset()
      ..forward();
  }

  Rect _canvasContentBounds({required bool includeTextNote}) {
    final visibleCards = _visibleCardIds
        .where((id) => includeTextNote || _cardSource(id) != 'note')
        .toList(growable: false);
    var bounds = _cardRect(visibleCards.first);
    for (final id in visibleCards.skip(1)) {
      bounds = bounds.expandToInclude(_cardRect(id));
    }
    for (final stroke in doc.strokes) {
      if (!stroke.erase && !stroke.bounds.isEmpty) {
        bounds = bounds.expandToInclude(stroke.bounds);
      }
    }
    return bounds.inflate(48);
  }

  Future<void> _showExportDialog() async {
    var pdf = false;
    var includeTextNote = true;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('导出当前画布'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: false, label: Text('PNG')),
                  ButtonSegment(value: true, label: Text('PDF')),
                ],
                selected: {pdf},
                onSelectionChanged: (values) =>
                    setDialogState(() => pdf = values.first),
              ),
              const SizedBox(height: 14),
              SwitchListTile(
                value: includeTextNote,
                contentPadding: EdgeInsets.zero,
                title: const Text('包含文字笔记'),
                subtitle: const Text('解析按照当前画布的显示状态导出'),
                onChanged: (value) =>
                    setDialogState(() => includeTextNote = value),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('导出'),
            ),
          ],
        ),
      ),
    );
    if (confirmed == true && mounted) {
      await _exportCanvas(pdf: pdf, includeTextNote: includeTextNote);
    }
  }

  Future<void> _exportCanvas({
    required bool pdf,
    required bool includeTextNote,
  }) async {
    if (exporting) return;
    setState(() => exporting = true);
    final boundaryKey = GlobalKey();
    final bounds = _canvasContentBounds(includeTextNote: includeTextNote);
    final largest = math.max(bounds.width, bounds.height);
    final exportScale = largest <= 3600 ? 1.0 : 3600 / largest;
    final surfaceSize = Size(
      math.max(1, bounds.width * exportScale),
      math.max(1, bounds.height * exportScale),
    );
    final exportOffset = -bounds.topLeft * exportScale;
    final overlay = Overlay.of(context);
    late final OverlayEntry entry;
    entry = OverlayEntry(
      builder: (context) => Stack(
        fit: StackFit.expand,
        children: [
          const ModalBarrier(dismissible: false, color: Color(0x4d0f172a)),
          Center(
            child: Opacity(
              opacity: .01,
              child: FittedBox(
                fit: BoxFit.contain,
                child: RepaintBoundary(
                  key: boundaryKey,
                  child: HandwritingExportSurface(
                    size: surfaceSize,
                    document: doc,
                    question: questionContext.question,
                    analysisVisible: analysisVisible,
                    includeTextNote: includeTextNote,
                    offset: exportOffset,
                    scale: exportScale,
                  ),
                ),
              ),
            ),
          ),
          const Center(
            child: Card(
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: 24, vertical: 18),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2.5),
                    ),
                    SizedBox(width: 14),
                    Text('正在生成画布文件…'),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
    overlay.insert(entry);
    try {
      await WidgetsBinding.instance.endOfFrame;
      await Future<void>.delayed(const Duration(milliseconds: 24));
      final boundary = boundaryKey.currentContext?.findRenderObject()
          as RenderRepaintBoundary?;
      if (boundary == null) throw StateError('画布尚未完成布局');
      final image = await boundary.toImage(pixelRatio: 1);
      final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();
      if (byteData == null) throw StateError('无法生成画布图像');
      entry.remove();
      final saved = await widget.storage.exportCanvasImage(
        byteData.buffer.asUint8List(),
        displayName: questionDisplayName(questionContext.question),
        pdf: pdf,
      );
      if (mounted && saved) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(pdf ? 'PDF 已导出' : '图片已导出')));
      }
    } catch (_) {
      if (entry.mounted) entry.remove();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('画布导出失败，请稍后重试')));
      }
    } finally {
      if (entry.mounted) entry.remove();
      if (mounted) setState(() => exporting = false);
    }
  }

  Future<void> _resetCurrentCanvas() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('重置当前书写画布？'),
        content: const Text(
          '将删除当前题目的笔迹、卡片布局与副本、画布位置、背景和撤销记录。'
          '收藏、掌握状态、当前答案和文字笔记不会改变。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认重置'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    saveTimer?.cancel();
    try {
      await _saveNow();
    } catch (_) {
      return;
    }
    await widget.storage.deleteHandwriting(questionContext.question.id);
    if (!mounted) return;
    setState(() {
      document = HandwritingDocument.empty(
        questionContext.question.id,
        textNote: questionContext.state.note,
      );
      analysisVisible = false;
      tool = CanvasTool.pen;
      selectedStrokeIds.clear();
      selectedCards.clear();
      inkRevision += 1;
      fitAfterMeasure = true;
      positionAnalysisAfterMeasure = true;
      cardHeights.clear();
    });
  }

  Future<void> _reloadCanvas() async {
    if (loading) return;
    saveTimer?.cancel();
    setState(() => loading = true);
    try {
      await _saveNow();
    } catch (_) {
      if (mounted) setState(() => loading = false);
      return;
    }
    if (!mounted) return;
    final restart = widget.onRestart;
    if (restart != null) {
      await restart(questionContext);
      return;
    }
    _clearTransientCanvasState();
    inkPictureCache.clear();
    await _loadQuestion(preserveViewport: true);
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('画布已重新载入，当前位置和书写内容完整保留')));
  }

  void _clearTransientCanvasState() {
    viewPanController.stop();
    activePointers.clear();
    pointerOrigins.clear();
    ignoredTouchPointers.clear();
    activeGestureStrokes.clear();
    selectedStrokeIds.clear();
    selectedCards.clear();
    lassoPoints.clear();
    selectionOriginalStrokes = [];
    selectionOriginalCards = {};
    drawingPointer = null;
    activeStroke = null;
    stylusActive = false;
    stylusCursor = null;
    pinchStartDistance = null;
    pinchStartScale = null;
    pinchAnchorWorld = null;
    movingSelection = false;
    selectionMoveOrigin = null;
    selectionResizeBounds = null;
    selectionResizeHandle = null;
    pressureEraserActive = false;
    primaryStylusButtonWasPressed = false;
    secondaryStylusButtonWasPressed = false;
  }

  bool _maybeEditTextCard(Offset local) {
    final world = _toWorld(local);
    for (final id in _visibleCardIds.reversed) {
      if (_cardSource(id) != 'note' || !_cardRect(id).contains(world)) {
        continue;
      }
      _editTextNote();
      return true;
    }
    return false;
  }

  Future<void> _editTextNote() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      barrierColor: Colors.black45,
      builder: (context) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            20,
            20,
            20 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                '文字笔记',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 12),
              TextFormField(
                initialValue: doc.textNote,
                autofocus: true,
                minLines: 5,
                maxLines: 12,
                onChanged: (value) {
                  if (!mounted || value == doc.textNote) return;
                  setState(() => doc.textNote = value);
                  widget.onTextNoteChanged(questionContext.question, value);
                  _scheduleSave();
                },
                decoration: const InputDecoration(
                  hintText: '记录思路、易错点……',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              FilledButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('完成'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showPenSettings(int index) async {
    var preset = writingTools.penPresets[index];
    const colors = [
      0xff111827,
      0xff2563eb,
      0xffdc2626,
      0xff16a34a,
      0xff9333ea,
      0xfff59e0b,
    ];
    void updatePreset(PenPreset value, StateSetter setSheetState) {
      setSheetState(() => preset = value);
      if (!mounted) return;
      setState(() {
        writingTools.penPresets[index] = value;
        writingTools.activePen = index;
        tool = CanvasTool.pen;
      });
      _scheduleSave();
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      barrierColor: Colors.black54,
      showDragHandle: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(22, 20, 22, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  '画笔 ${index + 1}',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 18),
                Wrap(
                  spacing: 14,
                  runSpacing: 12,
                  children: [
                    for (final color in colors)
                      InkWell(
                        borderRadius: BorderRadius.circular(24),
                        onTap: () => updatePreset(
                          preset.copyWith(color: color),
                          setSheetState,
                        ),
                        child: Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: Color(color),
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: preset.color == color
                                  ? _primary
                                  : Colors.transparent,
                              width: 4,
                            ),
                          ),
                          child: preset.color == color
                              ? const Icon(Icons.check, color: Colors.white)
                              : null,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 18),
                Text('粗细 ${preset.width.toStringAsFixed(1)}'),
                Slider(
                  min: 1,
                  max: 14,
                  value: preset.width,
                  onChanged: (value) => updatePreset(
                    preset.copyWith(width: value),
                    setSheetState,
                  ),
                ),
                Text('压感强度 ${(preset.pressureStrength * 100).round()}%'),
                Slider(
                  min: 0,
                  max: 1,
                  value: preset.pressureStrength,
                  onChanged: (value) => updatePreset(
                    preset.copyWith(pressureStrength: value),
                    setSheetState,
                  ),
                ),
                const Text(
                  '调整后立即生效，点击面板外即可关闭。',
                  style: TextStyle(color: _muted, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _showEraserSettings() async {
    var width = writingTools.eraserWidth;
    var pressure = writingTools.eraserPressureStrength;
    var pressureEraseEnabled = writingTools.pressureEraseEnabled;
    var pressureEraseThreshold = writingTools.pressureEraseThreshold;
    void updateEraser(StateSetter setSheetState, VoidCallback update) {
      setSheetState(update);
      if (!mounted) return;
      setState(() {
        writingTools.eraserWidth = width;
        writingTools.eraserPressureStrength = pressure;
        writingTools.pressureEraseEnabled = pressureEraseEnabled;
        writingTools.pressureEraseThreshold = pressureEraseThreshold;
        tool = CanvasTool.eraser;
      });
      _scheduleSave();
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      barrierColor: Colors.black54,
      showDragHandle: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) => SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(22, 20, 22, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  '像素橡皮',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 18),
                Text('大小 ${width.round()}'),
                Slider(
                  min: 8,
                  max: 240,
                  value: width,
                  onChanged: (value) =>
                      updateEraser(setSheetState, () => width = value),
                ),
                Text('大小压感 ${(pressure * 100).round()}%'),
                Slider(
                  min: 0,
                  max: 1,
                  value: pressure,
                  onChanged: (value) =>
                      updateEraser(setSheetState, () => pressure = value),
                ),
                const Text(
                  '数值越高，轻按和重按时的橡皮大小差异越明显。',
                  style: TextStyle(color: _muted, fontSize: 12),
                ),
                const Divider(height: 28),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('重压临时擦除'),
                  subtitle: const Text('用力下压时，本次落笔临时切换为橡皮，提笔后恢复画笔'),
                  value: pressureEraseEnabled,
                  onChanged: (value) => updateEraser(
                    setSheetState,
                    () => pressureEraseEnabled = value,
                  ),
                ),
                if (pressureEraseEnabled) ...[
                  Text('触发压力 ${(pressureEraseThreshold * 100).round()}%'),
                  Slider(
                    min: .55,
                    max: .95,
                    divisions: 40,
                    value: pressureEraseThreshold,
                    onChanged: (value) => updateEraser(
                      setSheetState,
                      () => pressureEraseThreshold = value,
                    ),
                  ),
                  const Text(
                    '达到阈值后会保持橡皮直到提笔，避免提笔位移产生多余笔迹。',
                    style: TextStyle(color: _muted, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 8),
                const Text(
                  '调整后立即生效，点击面板外即可关闭。',
                  style: TextStyle(color: _muted, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _selectPen(int index) {
    if (tool == CanvasTool.pen && writingTools.activePen == index) {
      _showPenSettings(index);
      return;
    }
    setState(() {
      writingTools.activePen = index;
      tool = CanvasTool.pen;
      selectedStrokeIds.clear();
      selectedCards.clear();
    });
    _scheduleSave();
  }

  void _selectEraser() {
    if (tool == CanvasTool.eraser) {
      _showEraserSettings();
      return;
    }
    setState(() {
      tool = CanvasTool.eraser;
      selectedStrokeIds.clear();
      selectedCards.clear();
    });
  }

  double _questionCardHeight(Question question) =>
      _estimatedQuestionCardHeight(question);

  double _analysisCardHeight(Question question) =>
      _estimatedAnalysisCardHeight(question);

  double _noteCardHeight() => _estimatedNoteCardHeight(doc.textNote);

  Rect _selectionScreenBounds() {
    final bounds = _selectionBounds();
    return Rect.fromLTRB(
      doc.viewOffset.dx + bounds.left * doc.viewScale,
      doc.viewOffset.dy + bounds.top * doc.viewScale,
      doc.viewOffset.dx + bounds.right * doc.viewScale,
      doc.viewOffset.dy + bounds.bottom * doc.viewScale,
    );
  }

  Offset _selectionActionsPosition(bool landscape) {
    final bounds = _selectionScreenBounds();
    const actionWidth = 52.0;
    const actionHeight = 104.0;
    const gap = 12.0;
    final minimumLeft = landscape ? 78.0 : 8.0;
    final maximumLeft = math.max(minimumLeft, viewport.width - actionWidth - 8);
    final right = bounds.right + gap;
    final leftCandidate = bounds.left - actionWidth - gap;
    final left = right <= maximumLeft
        ? right
        : leftCandidate >= minimumLeft
            ? leftCandidate
            : right.clamp(minimumLeft, maximumLeft).toDouble();
    final top = (bounds.center.dy - actionHeight / 2)
        .clamp(8, math.max(8, viewport.height - actionHeight - 8))
        .toDouble();
    return Offset(left, top);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: allowPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_closeCanvas());
      },
      child: Scaffold(
        backgroundColor: _canvas,
        appBar: AppBar(
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.white,
          titleSpacing: 0,
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${questionContext.displayPosition == null ? '#—' : '#${questionContext.displayPosition}'} · '
                '${questionContext.question.source.trim().isEmpty ? '题库题' : questionContext.question.source}',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                questionContext.categoryPath,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11, color: _muted),
              ),
            ],
          ),
          actions: [
            IconButton(
              key: const ValueKey('canvas-open-question-navigator'),
              tooltip: '选择题目',
              onPressed: loading ? null : _openNavigator,
              icon: const Icon(Icons.account_tree_outlined),
            ),
            IconButton(
              tooltip: '上一题',
              onPressed: questionContext.canGoBack ? () => _navigate(-1) : null,
              icon: const Icon(Icons.chevron_left_rounded),
            ),
            Center(
              child: Text(
                '${questionContext.index + 1}/${questionContext.total}',
                style: const TextStyle(
                  color: _text,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            IconButton(
              tooltip: '下一题',
              onPressed:
                  questionContext.canGoForward ? () => _navigate(1) : null,
              icon: const Icon(Icons.chevron_right_rounded),
            ),
            PopupMenuButton<String>(
              key: const ValueKey('canvas-question-state-menu'),
              tooltip: '题目标记',
              onSelected: (value) {
                final mastery = Mastery.values.firstWhere(
                  (item) => item.value == value,
                );
                _setMastery(mastery);
              },
              itemBuilder: (context) => [
                for (final mastery in Mastery.values.skip(1))
                  PopupMenuItem(
                    value: mastery.value,
                    child: ListTile(
                      leading: Icon(
                        questionContext.state.mastery == mastery
                            ? Icons.radio_button_checked_rounded
                            : Icons.radio_button_unchecked_rounded,
                        color: switch (mastery) {
                          Mastery.mastered => const Color(0xff16a34a),
                          Mastery.needsPractice => const Color(0xffd97706),
                          Mastery.notKnown => const Color(0xffdc2626),
                          Mastery.notStarted => _muted,
                        },
                      ),
                      title: Text(mastery.label),
                    ),
                  ),
                if (questionContext.state.mastery != Mastery.notStarted) ...[
                  const PopupMenuDivider(),
                  const PopupMenuItem(
                    value: 'not_started',
                    child: ListTile(
                      leading: Icon(Icons.remove_circle_outline_rounded),
                      title: Text('清除状态'),
                    ),
                  ),
                ],
              ],
              icon: const Icon(Icons.fact_check_outlined, color: _text),
            ),
            IconButton(
              key: const ValueKey('canvas-favorite-toggle'),
              tooltip: questionContext.state.favorite ? '取消收藏' : '收藏当前题',
              onPressed: loading ? null : _toggleFavorite,
              icon: Icon(
                questionContext.state.favorite
                    ? Icons.star_rounded
                    : Icons.star_border_rounded,
                color: questionContext.state.favorite
                    ? const Color(0xfff59e0b)
                    : _muted,
              ),
            ),
            IconButton(
              tooltip: analysisVisible ? '隐藏解析' : '查看解析',
              onPressed: loading ? null : _toggleAnalysis,
              icon: Icon(
                analysisVisible
                    ? Icons.visibility_off_outlined
                    : Icons.lightbulb_outline_rounded,
              ),
            ),
            IconButton(
              tooltip: '导出当前画布',
              onPressed:
                  loading || exporting ? null : () => _showExportDialog(),
              icon: exporting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.ios_share_rounded),
            ),
            IconButton(
              key: const ValueKey('canvas-reload'),
              tooltip: '重新载入画布',
              onPressed: loading ? null : () => unawaited(_reloadCanvas()),
              icon: const Icon(Icons.refresh_rounded),
            ),
            IconButton(
              key: const ValueKey('canvas-reset-current'),
              tooltip: '重置当前书写画布',
              onPressed:
                  loading ? null : () => unawaited(_resetCurrentCanvas()),
              icon: const Icon(
                Icons.delete_sweep_outlined,
                color: Color(0xffdc2626),
              ),
            ),
          ],
        ),
        body: loading
            ? const Center(child: CircularProgressIndicator())
            : LayoutBuilder(
                builder: (context, constraints) {
                  viewport = constraints.biggest;
                  final landscape =
                      constraints.maxWidth > constraints.maxHeight;
                  final hasSelection = tool == CanvasTool.lasso &&
                      (selectedStrokeIds.isNotEmpty ||
                          selectedCards.isNotEmpty);
                  final actionsPosition = hasSelection
                      ? _selectionActionsPosition(landscape)
                      : null;
                  return Stack(
                    children: [
                      Positioned.fill(child: _buildCanvas()),
                      if (landscape)
                        Positioned(
                          left: 12,
                          top: 12,
                          bottom: 12,
                          child: _buildToolbar(vertical: true),
                        )
                      else
                        Positioned(
                          left: 8,
                          right: 8,
                          bottom: 8,
                          child: _buildToolbar(vertical: false),
                        ),
                      if (hasSelection)
                        Positioned.fill(
                          child: _SelectionHandles(
                            bounds: _selectionScreenBounds(),
                            onStart: _beginResizeSelection,
                            onUpdate: _updateResizeSelection,
                            onEnd: _finishResizeSelection,
                          ),
                        ),
                      if (hasSelection)
                        Positioned(
                          left: actionsPosition!.dx,
                          top: actionsPosition.dy,
                          child: _SelectionActions(
                            onDuplicate: _duplicateSelection,
                            onDelete: _deleteSelection,
                          ),
                        ),
                    ],
                  );
                },
              ),
      ),
    );
  }

  Widget _buildCanvas() {
    WidgetsBinding.instance.addPostFrameCallback((_) => _measureCards());
    final liveStrokes = [
      ...activeGestureStrokes,
      if (activeStroke != null) activeStroke!,
    ];
    final liveErasing = liveStrokes.any((stroke) => stroke.erase);
    return ClipRect(
      child: MouseRegion(
        onExit: _onPointerExit,
        child: Listener(
          behavior: HitTestBehavior.opaque,
          onPointerDown: _onPointerDown,
          onPointerMove: _onPointerMove,
          onPointerHover: _onPointerHover,
          onPointerUp: _onPointerUp,
          onPointerCancel: _onPointerUp,
          child: Stack(
            fit: StackFit.expand,
            children: [
              CustomPaint(
                painter: _CanvasBackgroundPainter(
                  background: doc.background,
                  offset: doc.viewOffset,
                  scale: doc.viewScale,
                ),
              ),
              for (final id in _visibleCardIds)
                _WorldCard(
                  cardKey: _cardKey(id),
                  state: _card(id),
                  offset: doc.viewOffset,
                  scale: doc.viewScale,
                  selected: selectedCards.contains(id),
                  child: switch (_cardSource(id)) {
                    'question' => _QuestionCanvasCard(
                        question: questionContext.question,
                        optionKeys: questionOptionKeys,
                        submitKey: questionSubmitKey,
                        retryKey: questionRetryKey,
                        state: questionContext.state,
                        pendingOptions: pendingOptions,
                        correctOptions: questionContext.correctOptionIndexes,
                      ),
                    'analysis' => _AnalysisCanvasCard(
                        question: questionContext.question,
                      ),
                    _ => _TextNoteCanvasCard(text: doc.textNote),
                  },
                ),
              RepaintBoundary(
                child: CustomPaint(
                  key: const ValueKey('handwriting-ink-layer'),
                  painter: _InkPainter(
                    strokes: doc.strokes,
                    offset: doc.viewOffset,
                    scale: doc.viewScale,
                    revision: inkRevision,
                    live: liveErasing,
                    cache: inkPictureCache,
                    overlayStrokes: liveErasing ? liveStrokes : const [],
                  ),
                ),
              ),
              if (liveStrokes.isNotEmpty && !liveErasing)
                CustomPaint(
                  painter: _InkPainter(
                    strokes: liveStrokes,
                    offset: doc.viewOffset,
                    scale: doc.viewScale,
                    live: true,
                  ),
                ),
              CustomPaint(
                painter: _SelectionPainter(
                  lassoPoints: lassoPoints,
                  selectionBounds: _selectionBounds(),
                  hasSelection:
                      selectedStrokeIds.isNotEmpty || selectedCards.isNotEmpty,
                  offset: doc.viewOffset,
                  scale: doc.viewScale,
                ),
              ),
              if (stylusCursor != null &&
                  (tool == CanvasTool.eraser || pressureEraserActive))
                CustomPaint(
                  painter: _EraserCursorPainter(
                    center: stylusCursor!,
                    radius: writingTools.eraserWidth *
                        _pressureScale(
                          stylusPressure,
                          writingTools.eraserPressureStrength,
                        ) *
                        doc.viewScale /
                        2,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildToolbar({required bool vertical}) {
    final items = <Widget>[
      for (var index = 0; index < 3; index++)
        _ToolButton(
          tooltip: '画笔 ${index + 1}；再次点击打开设置',
          selected: tool == CanvasTool.pen && writingTools.activePen == index,
          onTap: () => _selectPen(index),
          child: Container(
            width: 18,
            height: 18,
            decoration: BoxDecoration(
              color: Color(writingTools.penPresets[index].color),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 1.5),
            ),
          ),
        ),
      _ToolButton(
        tooltip: '像素橡皮；再次点击打开设置',
        selected: tool == CanvasTool.eraser,
        icon: Icons.auto_fix_normal_rounded,
        onTap: _selectEraser,
      ),
      _ToolButton(
        tooltip: '移动画布',
        selected: tool == CanvasTool.hand,
        icon: Icons.pan_tool_alt_outlined,
        onTap: () => setState(() => tool = CanvasTool.hand),
      ),
      _ToolButton(
        tooltip: '套索',
        selected: tool == CanvasTool.lasso,
        icon: Icons.gesture_rounded,
        onTap: () => setState(() {
          tool = CanvasTool.lasso;
          selectedStrokeIds.clear();
          selectedCards.clear();
        }),
      ),
      _ToolButton(
        tooltip: '撤销',
        icon: Icons.undo_rounded,
        onTap: doc.undoHistory.isEmpty ? null : _undo,
      ),
      _ToolButton(
        tooltip: '重做',
        icon: Icons.redo_rounded,
        onTap: doc.redoHistory.isEmpty ? null : _redo,
      ),
      _ToolButton(
        tooltip: '回到题目',
        icon: Icons.center_focus_strong_rounded,
        onTap: _fitQuestion,
      ),
      PopupMenuButton<CanvasBackground>(
        tooltip: '画布背景',
        color: Colors.white,
        onSelected: (value) {
          setState(() => doc.background = value);
          _scheduleSave();
        },
        itemBuilder: (context) => const [
          PopupMenuItem(value: CanvasBackground.plain, child: Text('纯白')),
          PopupMenuItem(value: CanvasBackground.dots, child: Text('点阵')),
          PopupMenuItem(value: CanvasBackground.grid, child: Text('方格')),
        ],
        child: const SizedBox(
          width: 46,
          height: 46,
          child: Icon(Icons.grid_4x4_rounded, color: _text),
        ),
      ),
      _ToolButton(
        tooltip: doc.fingerDrawing ? '关闭手指书写' : '开启手指书写',
        selected: doc.fingerDrawing,
        icon: Icons.touch_app_outlined,
        onTap: () {
          setState(() => doc.fingerDrawing = !doc.fingerDrawing);
          _scheduleSave();
        },
      ),
    ];
    return Material(
      color: Colors.white,
      elevation: 8,
      shadowColor: Colors.black26,
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: vertical
          ? SingleChildScrollView(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(mainAxisSize: MainAxisSize.min, children: items),
            )
          : SizedBox(
              height: 58,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
                children: items,
              ),
            ),
    );
  }
}

class _ToolButton extends StatelessWidget {
  const _ToolButton({
    required this.tooltip,
    required this.onTap,
    this.selected = false,
    this.icon,
    this.child,
  });

  final String tooltip;
  final VoidCallback? onTap;
  final bool selected;
  final IconData? icon;
  final Widget? child;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: tooltip,
        child: Padding(
          padding: const EdgeInsets.all(2),
          child: Material(
            color: selected ? const Color(0xffdbeafe) : Colors.transparent,
            borderRadius: BorderRadius.circular(11),
            child: InkWell(
              onTap: onTap,
              borderRadius: BorderRadius.circular(11),
              child: SizedBox(
                width: 46,
                height: 46,
                child: Center(
                  child: child ??
                      Icon(
                        icon,
                        color: onTap == null
                            ? const Color(0xffcbd5e1)
                            : selected
                                ? _primary
                                : _text,
                      ),
                ),
              ),
            ),
          ),
        ),
      );
}

class _SelectionActions extends StatelessWidget {
  const _SelectionActions({required this.onDuplicate, required this.onDelete});

  final VoidCallback onDuplicate;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        elevation: 8,
        borderRadius: BorderRadius.circular(14),
        clipBehavior: Clip.antiAlias,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Semantics(
              label: '创建副本',
              button: true,
              child: IconButton(
                onPressed: onDuplicate,
                icon: const Icon(Icons.control_point_duplicate_rounded),
              ),
            ),
            Semantics(
              label: '删除',
              button: true,
              child: IconButton(
                onPressed: onDelete,
                icon: const Icon(Icons.delete_outline_rounded),
              ),
            ),
          ],
        ),
      );
}

enum _ResizeHandle {
  topLeft,
  topCenter,
  topRight,
  centerLeft,
  centerRight,
  bottomLeft,
  bottomCenter,
  bottomRight,
}

class _SelectionHandles extends StatelessWidget {
  const _SelectionHandles({
    required this.bounds,
    required this.onStart,
    required this.onUpdate,
    required this.onEnd,
  });

  final Rect bounds;
  final ValueChanged<_ResizeHandle> onStart;
  final ValueChanged<Offset> onUpdate;
  final VoidCallback onEnd;

  @override
  Widget build(BuildContext context) => Stack(
        clipBehavior: Clip.none,
        children: [
          _handle(_ResizeHandle.topLeft, bounds.topLeft),
          _handle(_ResizeHandle.topCenter, bounds.topCenter),
          _handle(_ResizeHandle.topRight, bounds.topRight),
          _handle(_ResizeHandle.centerLeft, bounds.centerLeft),
          _handle(_ResizeHandle.centerRight, bounds.centerRight),
          _handle(_ResizeHandle.bottomLeft, bounds.bottomLeft),
          _handle(_ResizeHandle.bottomCenter, bounds.bottomCenter),
          _handle(_ResizeHandle.bottomRight, bounds.bottomRight),
        ],
      );

  Widget _handle(_ResizeHandle handle, Offset center) => Positioned(
        left: center.dx - 18,
        top: center.dy - 18,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onPanStart: (_) => onStart(handle),
          onPanUpdate: (details) => onUpdate(details.delta),
          onPanEnd: (_) => onEnd(),
          onPanCancel: onEnd,
          child: SizedBox(
            width: 36,
            height: 36,
            child: Center(
              child: Container(
                width: 11,
                height: 11,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: _primary, width: 2),
                  boxShadow: const [
                    BoxShadow(color: Colors.black26, blurRadius: 3),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
}

class _WorldCard extends StatelessWidget {
  const _WorldCard({
    this.cardKey,
    required this.state,
    required this.offset,
    required this.scale,
    required this.selected,
    required this.child,
  });

  final GlobalKey? cardKey;
  final CanvasCardState state;
  final Offset offset;
  final double scale;
  final bool selected;
  final Widget child;

  @override
  Widget build(BuildContext context) => Positioned(
        left: offset.dx + state.x * scale,
        top: offset.dy + state.y * scale,
        child: IgnorePointer(
          child: Transform(
            transform: Matrix4.diagonal3Values(
              scale * state.scaleX,
              scale * state.scaleY,
              1,
            ),
            alignment: Alignment.topLeft,
            child: Container(
              key: cardKey,
              width: state.width,
              foregroundDecoration: BoxDecoration(
                borderRadius: BorderRadius.circular(18),
                color: selected ? const Color(0x082563eb) : null,
              ),
              child: child,
            ),
          ),
        ),
      );
}

class HandwritingExportSurface extends StatelessWidget {
  const HandwritingExportSurface({
    super.key,
    required this.size,
    required this.document,
    required this.question,
    required this.analysisVisible,
    required this.includeTextNote,
    required this.offset,
    required this.scale,
    this.cardKeys,
  });

  final Size size;
  final HandwritingDocument document;
  final Question question;
  final bool analysisVisible;
  final bool includeTextNote;
  final Offset offset;
  final double scale;
  final Map<String, GlobalKey>? cardKeys;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: size.width,
        height: size.height,
        child: ClipRect(
          child: Stack(
            fit: StackFit.expand,
            children: [
              CustomPaint(
                painter: _CanvasBackgroundPainter(
                  background: document.background,
                  offset: offset,
                  scale: scale,
                ),
              ),
              _WorldCard(
                cardKey: cardKeys?['question'],
                state: document.questionCard,
                offset: offset,
                scale: scale,
                selected: false,
                child: _QuestionCanvasCard(question: question),
              ),
              if (analysisVisible)
                _WorldCard(
                  cardKey: cardKeys?['analysis'],
                  state: document.analysisCard,
                  offset: offset,
                  scale: scale,
                  selected: false,
                  child: _AnalysisCanvasCard(question: question),
                ),
              if (includeTextNote)
                _WorldCard(
                  cardKey: cardKeys?['note'],
                  state: document.noteCard,
                  offset: offset,
                  scale: scale,
                  selected: false,
                  child: _TextNoteCanvasCard(text: document.textNote),
                ),
              for (final copy in document.cardCopies)
                if ((copy.source != 'analysis' || analysisVisible) &&
                    (copy.source != 'note' || includeTextNote))
                  _WorldCard(
                    cardKey: cardKeys?[copy.id],
                    state: copy.state,
                    offset: offset,
                    scale: scale,
                    selected: false,
                    child: switch (copy.source) {
                      'question' => _QuestionCanvasCard(question: question),
                      'analysis' => _AnalysisCanvasCard(question: question),
                      _ => _TextNoteCanvasCard(text: document.textNote),
                    },
                  ),
              CustomPaint(
                painter: _InkPainter(
                  strokes: document.strokes,
                  offset: offset,
                  scale: scale,
                ),
              ),
            ],
          ),
        ),
      );
}

class _QuestionCanvasCard extends StatelessWidget {
  const _QuestionCanvasCard({
    required this.question,
    this.optionKeys,
    this.submitKey,
    this.retryKey,
    this.state,
    this.pendingOptions = const {},
    this.correctOptions = const {},
  });

  final Question question;
  final List<GlobalKey>? optionKeys;
  final GlobalKey? submitKey;
  final GlobalKey? retryKey;
  final QuestionState? state;
  final Set<int> pendingOptions;
  final Set<int> correctOptions;

  @override
  Widget build(BuildContext context) {
    final submitted = state?.lastCorrect != null;
    final selected = submitted
        ? {
            for (final option in state!.selectedOptions)
              if (option.isNotEmpty) option.codeUnitAt(0) - 65,
          }
        : pendingOptions;
    return _CanvasCard(
      title: '题目',
      trailing: question.source,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MathContent(question.stem, selectable: false),
          for (var index = 0; index < question.options.length; index++)
            Container(
              key: optionKeys != null && index < optionKeys!.length
                  ? optionKeys![index]
                  : null,
              margin: const EdgeInsets.only(top: 12),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: submitted && correctOptions.contains(index)
                    ? const Color(0xfff0fdf4)
                    : submitted &&
                            selected.contains(index) &&
                            !correctOptions.contains(index)
                        ? const Color(0xfffef2f2)
                        : selected.contains(index)
                            ? const Color(0xffeff6ff)
                            : Colors.transparent,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: submitted && correctOptions.contains(index)
                      ? const Color(0xff86efac)
                      : submitted &&
                              selected.contains(index) &&
                              !correctOptions.contains(index)
                          ? const Color(0xfffca5a5)
                          : selected.contains(index)
                              ? const Color(0xff93c5fd)
                              : _border,
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 30,
                    height: 30,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: selected.contains(index)
                          ? _primary
                          : const Color(0xffeff6ff),
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      String.fromCharCode(65 + index),
                      style: TextStyle(
                        color:
                            selected.contains(index) ? Colors.white : _primary,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: MathContent(
                      question.options[index],
                      selectable: false,
                    ),
                  ),
                ],
              ),
            ),
          if (question.type == 'multiple_choice' &&
              !submitted &&
              optionKeys != null) ...[
            const SizedBox(height: 14),
            Align(
              alignment: Alignment.centerRight,
              child: Container(
                key: submitKey,
                padding: const EdgeInsets.symmetric(
                  horizontal: 18,
                  vertical: 10,
                ),
                decoration: BoxDecoration(
                  color: pendingOptions.isEmpty
                      ? const Color(0xffcbd5e1)
                      : _primary,
                  borderRadius: BorderRadius.circular(9),
                ),
                child: const Text(
                  '提交答案',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
          if (submitted) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    state!.lastCorrect! ? '回答正确，已标记为已掌握' : '回答错误，已标记为需练习',
                    style: TextStyle(
                      color: state!.lastCorrect!
                          ? const Color(0xff15803d)
                          : const Color(0xffdc2626),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (retryKey != null)
                  Container(
                    key: retryKey,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    child: const Text(
                      '开始重做',
                      style: TextStyle(
                        color: _primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _AnalysisCanvasCard extends StatelessWidget {
  const _AnalysisCanvasCard({required this.question});

  final Question question;

  @override
  Widget build(BuildContext context) => _CanvasCard(
        title: '答案与解析',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '参考答案',
              style: TextStyle(fontWeight: FontWeight.w800, color: _ink),
            ),
            const SizedBox(height: 8),
            MathContent(
              question.answer.isEmpty ? '暂无答案' : question.answer,
              selectable: false,
            ),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 18),
              child: Divider(),
            ),
            const Text(
              '解析',
              style: TextStyle(fontWeight: FontWeight.w800, color: _ink),
            ),
            const SizedBox(height: 8),
            MathContent(
              question.explanation.isEmpty ? '暂无解析' : question.explanation,
              selectable: false,
            ),
          ],
        ),
      );
}

class _TextNoteCanvasCard extends StatelessWidget {
  const _TextNoteCanvasCard({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => _CanvasCard(
        title: '文字笔记',
        trailing: '手指轻点编辑',
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 150),
          child: text.trim().isEmpty
              ? const Text(
                  '记录思路、易错点……',
                  style: TextStyle(height: 1.65, fontSize: 17, color: _muted),
                )
              : MathContent(
                  text,
                  key: const ValueKey('canvas-text-note-content'),
                  selectable: false,
                  baseStyle: const TextStyle(
                    height: 1.65,
                    fontSize: 17,
                    color: _text,
                  ),
                ),
        ),
      );
}

class _CanvasCard extends StatelessWidget {
  const _CanvasCard({
    required this.title,
    required this.child,
    this.trailing = '',
  });

  final String title;
  final String trailing;
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: _border),
          boxShadow: const [
            BoxShadow(
              color: Color(0x120f172a),
              blurRadius: 22,
              offset: Offset(0, 10),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 18, 20, 16),
              child: Row(
                children: [
                  Container(
                    width: 4,
                    height: 22,
                    decoration: BoxDecoration(
                      color: _primary,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        color: _ink,
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  if (trailing.trim().isNotEmpty)
                    Text(
                      trailing,
                      style: const TextStyle(color: _muted, fontSize: 12),
                    ),
                ],
              ),
            ),
            const Divider(height: 1),
            Padding(padding: const EdgeInsets.all(24), child: child),
          ],
        ),
      );
}

class _CanvasBackgroundPainter extends CustomPainter {
  const _CanvasBackgroundPainter({
    required this.background,
    required this.offset,
    required this.scale,
  });

  final CanvasBackground background;
  final Offset offset;
  final double scale;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawColor(Colors.white, BlendMode.src);
    if (background == CanvasBackground.plain) return;
    final spacing = 32 * scale;
    if (spacing < 8) return;
    final paint = Paint()
      ..color = const Color(0xffdbe3ef)
      ..strokeWidth = .8;
    final startX = offset.dx % spacing;
    final startY = offset.dy % spacing;
    if (background == CanvasBackground.grid) {
      for (double x = startX; x < size.width; x += spacing) {
        canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
      }
      for (double y = startY; y < size.height; y += spacing) {
        canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
      }
    } else {
      paint.color = const Color(0xffcbd5e1);
      for (double x = startX; x < size.width; x += spacing) {
        for (double y = startY; y < size.height; y += spacing) {
          canvas.drawCircle(Offset(x, y), 1.15, paint);
        }
      }
    }
  }

  @override
  bool shouldRepaint(_CanvasBackgroundPainter oldDelegate) =>
      oldDelegate.background != background ||
      oldDelegate.offset != offset ||
      oldDelegate.scale != scale;
}

class _InkPainter extends CustomPainter {
  const _InkPainter({
    required this.strokes,
    required this.offset,
    required this.scale,
    this.revision = 0,
    this.live = false,
    this.cache,
    this.overlayStrokes = const [],
  });

  final List<InkStroke> strokes;
  final Offset offset;
  final double scale;
  final int revision;
  final bool live;
  final _InkPictureCache? cache;
  final List<InkStroke> overlayStrokes;

  int get cacheBuildCount => cache?.buildCount ?? 0;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.translate(offset.dx, offset.dy);
    canvas.scale(scale);
    final picture = cache?.pictureFor(strokes, revision);
    if (picture != null) {
      if (overlayStrokes.isNotEmpty) {
        canvas.saveLayer(_inkBounds([...strokes, ...overlayStrokes]), Paint());
      }
      canvas.drawPicture(picture);
      if (overlayStrokes.isNotEmpty) {
        _paintInkStrokes(canvas, overlayStrokes);
        canvas.restore();
      }
      return;
    }
    canvas.saveLayer(_inkBounds(strokes), Paint());
    _paintInkStrokes(canvas, strokes);
    canvas.restore();
  }

  @override
  bool shouldRepaint(_InkPainter oldDelegate) =>
      live ||
      oldDelegate.live ||
      oldDelegate.revision != revision ||
      oldDelegate.offset != offset ||
      oldDelegate.scale != scale;
}

class _InkPictureCache {
  int revision = -1;
  int buildCount = 0;
  ui.Picture? picture;

  ui.Picture? pictureFor(List<InkStroke> strokes, int nextRevision) {
    if (revision == nextRevision && picture != null) return picture;
    picture?.dispose();
    revision = nextRevision;
    if (strokes.isEmpty) {
      picture = null;
      return null;
    }
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, _inkBounds(strokes));
    canvas.saveLayer(_inkBounds(strokes), Paint());
    _paintInkStrokes(canvas, strokes);
    canvas.restore();
    picture = recorder.endRecording();
    buildCount += 1;
    return picture;
  }

  void clear() {
    picture?.dispose();
    picture = null;
    revision = -1;
  }

  void dispose() => clear();
}

Rect _inkBounds(List<InkStroke> strokes) {
  Rect? bounds;
  var padding = 1.0;
  for (final stroke in strokes) {
    padding = math.max(padding, stroke.width * 2);
    for (final point in stroke.points) {
      final rect = Rect.fromCircle(center: point.offset, radius: padding);
      bounds = bounds == null ? rect : bounds.expandToInclude(rect);
    }
  }
  return bounds ?? const Rect.fromLTWH(0, 0, 1, 1);
}

void _paintInkStrokes(Canvas canvas, List<InkStroke> strokes) {
  for (final stroke in strokes) {
    if (stroke.points.length < 2) continue;
    final paint = Paint()
      ..color = Color(stroke.color)
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke
      ..blendMode = stroke.erase ? BlendMode.clear : BlendMode.srcOver;
    if (stroke.points.length == 2) {
      final start = stroke.points.first;
      final end = stroke.points.last;
      paint.strokeWidth = stroke.width *
          _pressureScale(
            (start.pressure + end.pressure) / 2,
            stroke.pressureStrength,
          );
      canvas.drawLine(start.offset, end.offset, paint);
      continue;
    }
    var segmentStart = stroke.points.first.offset;
    for (var index = 1; index < stroke.points.length - 1; index++) {
      final control = stroke.points[index];
      final next = stroke.points[index + 1];
      final segmentEnd = (control.offset + next.offset) / 2;
      paint.strokeWidth = stroke.width *
          _pressureScale(
            (stroke.points[index - 1].pressure +
                    control.pressure +
                    next.pressure) /
                3,
            stroke.pressureStrength,
          );
      final path = Path()
        ..moveTo(segmentStart.dx, segmentStart.dy)
        ..quadraticBezierTo(control.x, control.y, segmentEnd.dx, segmentEnd.dy);
      canvas.drawPath(path, paint);
      segmentStart = segmentEnd;
    }
    final last = stroke.points.last;
    final beforeLast = stroke.points[stroke.points.length - 2];
    paint.strokeWidth = stroke.width *
        _pressureScale(
          (beforeLast.pressure + last.pressure) / 2,
          stroke.pressureStrength,
        );
    final tail = Path()
      ..moveTo(segmentStart.dx, segmentStart.dy)
      ..quadraticBezierTo(last.x, last.y, last.x, last.y);
    canvas.drawPath(tail, paint);
  }
}

class _EraserCursorPainter extends CustomPainter {
  const _EraserCursorPainter({required this.center, required this.radius});

  final Offset center;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final fill = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;
    final border = Paint()
      ..color = const Color(0xff111827)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    canvas.drawCircle(center, math.max(4, radius), fill);
    canvas.drawCircle(center, math.max(4, radius), border);
  }

  @override
  bool shouldRepaint(_EraserCursorPainter oldDelegate) =>
      oldDelegate.center != center || oldDelegate.radius != radius;
}

class _SelectionPainter extends CustomPainter {
  const _SelectionPainter({
    required this.lassoPoints,
    required this.selectionBounds,
    required this.hasSelection,
    required this.offset,
    required this.scale,
  });

  final List<Offset> lassoPoints;
  final Rect selectionBounds;
  final bool hasSelection;
  final Offset offset;
  final double scale;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.translate(offset.dx, offset.dy);
    canvas.scale(scale);
    final paint = Paint()
      ..color = _primary
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2 / scale;
    if (lassoPoints.length > 1) {
      final path = Path()..moveTo(lassoPoints.first.dx, lassoPoints.first.dy);
      for (final point in lassoPoints.skip(1)) {
        path.lineTo(point.dx, point.dy);
      }
      canvas.drawPath(path, paint);
    }
    if (hasSelection && !selectionBounds.isEmpty) {
      paint
        ..color = const Color(0xff2563eb)
        ..strokeWidth = 2 / scale;
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          selectionBounds.inflate(8 / scale),
          Radius.circular(10 / scale),
        ),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_SelectionPainter oldDelegate) => true;
}
