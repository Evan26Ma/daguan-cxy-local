import 'dart:math' as math;

import 'package:flutter/material.dart';

enum CanvasBackground {
  plain('plain'),
  dots('dots'),
  grid('grid');

  const CanvasBackground(this.value);
  final String value;

  static CanvasBackground parse(String? value) => values.firstWhere(
        (item) => item.value == value,
        orElse: () => CanvasBackground.dots,
      );
}

class InkPoint {
  const InkPoint(this.x, this.y, this.pressure);

  factory InkPoint.fromJson(List<dynamic> json) => InkPoint(
        (json[0] as num).toDouble(),
        (json[1] as num).toDouble(),
        (json.length > 2 ? json[2] as num : 1).toDouble(),
      );

  final double x;
  final double y;
  final double pressure;

  Offset get offset => Offset(x, y);

  List<num> toJson() => [
        double.parse(x.toStringAsFixed(2)),
        double.parse(y.toStringAsFixed(2)),
        double.parse(pressure.toStringAsFixed(3)),
      ];
}

class InkStroke {
  InkStroke({
    required this.id,
    required this.points,
    required this.color,
    required this.width,
    required this.pressureStrength,
    this.erase = false,
  });

  factory InkStroke.fromJson(Map<String, dynamic> json) => InkStroke(
        id: json['id'] as String,
        points: (json['points'] as List? ?? const [])
            .map((point) => InkPoint.fromJson(point as List<dynamic>))
            .toList(),
        color: json['color'] as int? ?? Colors.black.toARGB32(),
        width: (json['width'] as num? ?? 3).toDouble(),
        pressureStrength: (json['pressureStrength'] as num? ?? .65).toDouble(),
        erase: json['erase'] as bool? ?? false,
      );

  final String id;
  final List<InkPoint> points;
  final int color;
  final double width;
  final double pressureStrength;
  final bool erase;

  Rect get bounds {
    if (points.isEmpty) return Rect.zero;
    var left = points.first.x;
    var top = points.first.y;
    var right = left;
    var bottom = top;
    for (final point in points.skip(1)) {
      left = math.min(left, point.x);
      top = math.min(top, point.y);
      right = math.max(right, point.x);
      bottom = math.max(bottom, point.y);
    }
    final padding = width / 2 + 2;
    return Rect.fromLTRB(left, top, right, bottom).inflate(padding);
  }

  InkStroke translated(Offset delta, {String? newId}) => InkStroke(
        id: newId ?? id,
        points: [
          for (final point in points)
            InkPoint(
              point.x + delta.dx,
              point.y + delta.dy,
              point.pressure,
            ),
        ],
        color: color,
        width: width,
        pressureStrength: pressureStrength,
        erase: erase,
      );

  InkStroke scaled(double factor, Offset center, {String? newId}) => InkStroke(
        id: newId ?? id,
        points: [
          for (final point in points)
            InkPoint(
              center.dx + (point.x - center.dx) * factor,
              center.dy + (point.y - center.dy) * factor,
              point.pressure,
            ),
        ],
        color: color,
        width: width * factor,
        pressureStrength: pressureStrength,
        erase: erase,
      );

  InkStroke scaledXY(
    double horizontal,
    double vertical,
    Offset center, {
    String? newId,
  }) =>
      InkStroke(
        id: newId ?? id,
        points: [
          for (final point in points)
            InkPoint(
              center.dx + (point.x - center.dx) * horizontal,
              center.dy + (point.y - center.dy) * vertical,
              point.pressure,
            ),
        ],
        color: color,
        width: width * math.sqrt(horizontal.abs() * vertical.abs()),
        pressureStrength: pressureStrength,
        erase: erase,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'points': points.map((point) => point.toJson()).toList(),
        'color': color,
        'width': width,
        'pressureStrength': pressureStrength,
        'erase': erase,
      };
}

class CanvasCardState {
  const CanvasCardState({
    required this.x,
    required this.y,
    required this.width,
    this.scaleX = 1,
    this.scaleY = 1,
  });

  factory CanvasCardState.fromJson(
    Map<String, dynamic>? json,
    CanvasCardState fallback,
  ) {
    if (json == null) return fallback;
    return CanvasCardState(
      x: (json['x'] as num? ?? fallback.x).toDouble(),
      y: (json['y'] as num? ?? fallback.y).toDouble(),
      width: (json['width'] as num? ?? fallback.width).toDouble(),
      scaleX: (json['scaleX'] as num? ?? fallback.scaleX).toDouble(),
      scaleY: (json['scaleY'] as num? ?? fallback.scaleY).toDouble(),
    );
  }

  final double x;
  final double y;
  final double width;
  final double scaleX;
  final double scaleY;

  CanvasCardState copyWith({
    double? x,
    double? y,
    double? width,
    double? scaleX,
    double? scaleY,
  }) =>
      CanvasCardState(
        x: x ?? this.x,
        y: y ?? this.y,
        width: width ?? this.width,
        scaleX: scaleX ?? this.scaleX,
        scaleY: scaleY ?? this.scaleY,
      );

  CanvasCardState translated(Offset delta) =>
      copyWith(x: x + delta.dx, y: y + delta.dy);

  Map<String, dynamic> toJson() => {
        'x': x,
        'y': y,
        'width': width,
        'scaleX': scaleX,
        'scaleY': scaleY,
      };
}

class CanvasCardCopy {
  const CanvasCardCopy({
    required this.id,
    required this.source,
    required this.state,
  });

  factory CanvasCardCopy.fromJson(Map<String, dynamic> json) => CanvasCardCopy(
        id: json['id'] as String,
        source: json['source'] as String? ?? 'question',
        state: CanvasCardState.fromJson(
          json['state'] as Map<String, dynamic>?,
          const CanvasCardState(x: 80, y: 80, width: 720),
        ),
      );

  final String id;
  final String source;
  final CanvasCardState state;

  CanvasCardCopy copyWith({CanvasCardState? state}) => CanvasCardCopy(
        id: id,
        source: source,
        state: state ?? this.state,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'source': source,
        'state': state.toJson(),
      };
}

class PenPreset {
  const PenPreset({
    required this.color,
    required this.width,
    required this.pressureStrength,
  });

  factory PenPreset.fromJson(
    Map<String, dynamic>? json,
    PenPreset fallback,
  ) {
    if (json == null) return fallback;
    return PenPreset(
      color: json['color'] as int? ?? fallback.color,
      width: (json['width'] as num? ?? fallback.width).toDouble(),
      pressureStrength:
          (json['pressureStrength'] as num? ?? fallback.pressureStrength)
              .toDouble(),
    );
  }

  final int color;
  final double width;
  final double pressureStrength;

  PenPreset copyWith({
    int? color,
    double? width,
    double? pressureStrength,
  }) =>
      PenPreset(
        color: color ?? this.color,
        width: width ?? this.width,
        pressureStrength: pressureStrength ?? this.pressureStrength,
      );

  Map<String, dynamic> toJson() => {
        'color': color,
        'width': width,
        'pressureStrength': pressureStrength,
      };
}

class WritingToolSettings {
  WritingToolSettings({
    required this.penPresets,
    required this.activePen,
    required this.eraserWidth,
    required this.eraserPressureStrength,
    required this.pressureEraseEnabled,
    required this.pressureEraseThreshold,
  });

  factory WritingToolSettings.defaults() => WritingToolSettings(
        penPresets: [
          const PenPreset(
            color: 0xff111827,
            width: 3,
            pressureStrength: .7,
          ),
          const PenPreset(
            color: 0xff2563eb,
            width: 4,
            pressureStrength: .65,
          ),
          const PenPreset(
            color: 0xffdc2626,
            width: 5,
            pressureStrength: .55,
          ),
        ],
        activePen: 0,
        eraserWidth: 24,
        eraserPressureStrength: .45,
        pressureEraseEnabled: false,
        pressureEraseThreshold: .78,
      );

  factory WritingToolSettings.fromJson(Map<String, dynamic> json) {
    final fallback = WritingToolSettings.defaults();
    final rawPresets = json['penPresets'] as List? ?? const [];
    final presets = <PenPreset>[];
    for (var index = 0; index < 3; index++) {
      presets.add(
        PenPreset.fromJson(
          index < rawPresets.length
              ? rawPresets[index] as Map<String, dynamic>?
              : null,
          fallback.penPresets[index],
        ),
      );
    }
    return WritingToolSettings(
      penPresets: presets,
      activePen: (json['activePen'] as int? ?? 0).clamp(0, 2),
      eraserWidth: (json['eraserWidth'] as num? ?? 24).toDouble(),
      eraserPressureStrength:
          (json['eraserPressureStrength'] as num? ?? .45).toDouble(),
      pressureEraseEnabled: json['pressureEraseEnabled'] as bool? ?? false,
      pressureEraseThreshold: (json['pressureEraseThreshold'] as num? ?? .78)
          .toDouble()
          .clamp(.55, .98),
    );
  }

  final List<PenPreset> penPresets;
  int activePen;
  double eraserWidth;
  double eraserPressureStrength;
  bool pressureEraseEnabled;
  double pressureEraseThreshold;

  Map<String, dynamic> toJson() => {
        'format': 'daguan-writing-tools',
        'version': 1,
        'penPresets': penPresets.map((preset) => preset.toJson()).toList(),
        'activePen': activePen,
        'eraserWidth': eraserWidth,
        'eraserPressureStrength': eraserPressureStrength,
        'pressureEraseEnabled': pressureEraseEnabled,
        'pressureEraseThreshold': pressureEraseThreshold,
      };
}

class CanvasOperation {
  CanvasOperation({
    required this.added,
    required this.removed,
    this.addedCards = const [],
    this.removedCards = const [],
    this.beforeBaseCards = const {},
    this.afterBaseCards = const {},
  });

  factory CanvasOperation.fromJson(Map<String, dynamic> json) =>
      CanvasOperation(
        added: (json['added'] as List? ?? const [])
            .map((item) => InkStroke.fromJson(item as Map<String, dynamic>))
            .toList(),
        removed: (json['removed'] as List? ?? const [])
            .map((item) => InkStroke.fromJson(item as Map<String, dynamic>))
            .toList(),
        addedCards: (json['addedCards'] as List? ?? const [])
            .map(
                (item) => CanvasCardCopy.fromJson(item as Map<String, dynamic>))
            .toList(),
        removedCards: (json['removedCards'] as List? ?? const [])
            .map(
                (item) => CanvasCardCopy.fromJson(item as Map<String, dynamic>))
            .toList(),
        beforeBaseCards: _baseCardsFromJson(json['beforeBaseCards']),
        afterBaseCards: _baseCardsFromJson(json['afterBaseCards']),
      );

  final List<InkStroke> added;
  final List<InkStroke> removed;
  final List<CanvasCardCopy> addedCards;
  final List<CanvasCardCopy> removedCards;
  final Map<String, CanvasCardState> beforeBaseCards;
  final Map<String, CanvasCardState> afterBaseCards;

  static Map<String, CanvasCardState> _baseCardsFromJson(Object? value) {
    if (value is! Map) return const {};
    return {
      for (final entry in value.entries)
        entry.key.toString(): CanvasCardState.fromJson(
          Map<String, dynamic>.from(entry.value as Map),
          const CanvasCardState(x: 0, y: 0, width: 720),
        ),
    };
  }

  Map<String, dynamic> toJson() => {
        'added': added.map((stroke) => stroke.toJson()).toList(),
        'removed': removed.map((stroke) => stroke.toJson()).toList(),
        'addedCards': addedCards.map((card) => card.toJson()).toList(),
        'removedCards': removedCards.map((card) => card.toJson()).toList(),
        'beforeBaseCards': {
          for (final entry in beforeBaseCards.entries)
            entry.key: entry.value.toJson(),
        },
        'afterBaseCards': {
          for (final entry in afterBaseCards.entries)
            entry.key: entry.value.toJson(),
        },
      };
}

class HandwritingDocument {
  HandwritingDocument({
    required this.questionId,
    required this.strokes,
    required this.questionCard,
    required this.analysisCard,
    required this.noteCard,
    required this.cardCopies,
    required this.textNote,
    required this.analysisVisible,
    required this.background,
    required this.viewOffset,
    required this.viewScale,
    required this.fingerDrawing,
    required this.undoHistory,
    required this.redoHistory,
  });

  factory HandwritingDocument.empty(int questionId, {String textNote = ''}) =>
      HandwritingDocument(
        questionId: questionId,
        strokes: [],
        questionCard: const CanvasCardState(x: 80, y: 80, width: 720),
        analysisCard: const CanvasCardState(x: 80, y: 760, width: 720),
        noteCard: const CanvasCardState(x: 840, y: 80, width: 400),
        cardCopies: [],
        textNote: textNote,
        analysisVisible: false,
        background: CanvasBackground.dots,
        viewOffset: Offset.zero,
        viewScale: 1,
        fingerDrawing: false,
        undoHistory: [],
        redoHistory: [],
      );

  factory HandwritingDocument.fromJson(
    Map<String, dynamic> json, {
    required int questionId,
    String fallbackTextNote = '',
  }) {
    final fallback = HandwritingDocument.empty(
      questionId,
      textNote: fallbackTextNote,
    );
    final rawOffset = json['viewOffset'] as List? ?? const [];
    return HandwritingDocument(
      questionId: questionId,
      strokes: (json['strokes'] as List? ?? const [])
          .map((item) => InkStroke.fromJson(item as Map<String, dynamic>))
          .toList(),
      questionCard: CanvasCardState.fromJson(
        json['questionCard'] as Map<String, dynamic>?,
        fallback.questionCard,
      ),
      analysisCard: CanvasCardState.fromJson(
        json['analysisCard'] as Map<String, dynamic>?,
        fallback.analysisCard,
      ),
      noteCard: CanvasCardState.fromJson(
        json['noteCard'] as Map<String, dynamic>?,
        fallback.noteCard,
      ),
      cardCopies: (json['cardCopies'] as List? ?? const [])
          .map((item) => CanvasCardCopy.fromJson(item as Map<String, dynamic>))
          .toList(),
      textNote: json['textNote'] as String? ?? fallbackTextNote,
      analysisVisible: json['analysisVisible'] as bool? ?? false,
      background: CanvasBackground.parse(json['background'] as String?),
      viewOffset: rawOffset.length >= 2
          ? Offset(
              (rawOffset[0] as num).toDouble(),
              (rawOffset[1] as num).toDouble(),
            )
          : Offset.zero,
      viewScale: (json['viewScale'] as num? ?? 1).toDouble().clamp(.2, 4),
      fingerDrawing: json['fingerDrawing'] as bool? ?? false,
      undoHistory: (json['undoHistory'] as List? ?? const [])
          .map((item) => CanvasOperation.fromJson(item as Map<String, dynamic>))
          .toList(),
      redoHistory: (json['redoHistory'] as List? ?? const [])
          .map((item) => CanvasOperation.fromJson(item as Map<String, dynamic>))
          .toList(),
    );
  }

  final int questionId;
  final List<InkStroke> strokes;
  CanvasCardState questionCard;
  CanvasCardState analysisCard;
  CanvasCardState noteCard;
  final List<CanvasCardCopy> cardCopies;
  String textNote;
  bool analysisVisible;
  CanvasBackground background;
  Offset viewOffset;
  double viewScale;
  bool fingerDrawing;
  final List<CanvasOperation> undoHistory;
  final List<CanvasOperation> redoHistory;

  void apply(CanvasOperation operation, {bool record = true}) {
    final removedIds = operation.removed.map((stroke) => stroke.id).toSet();
    strokes.removeWhere((stroke) => removedIds.contains(stroke.id));
    strokes.addAll(operation.added);
    final removedCardIds =
        operation.removedCards.map((card) => card.id).toSet();
    cardCopies.removeWhere((card) => removedCardIds.contains(card.id));
    for (final card in operation.addedCards) {
      cardCopies.removeWhere((existing) => existing.id == card.id);
      cardCopies.add(card);
    }
    for (final entry in operation.afterBaseCards.entries) {
      _setBaseCard(entry.key, entry.value);
    }
    if (!record) return;
    undoHistory.add(operation);
    if (undoHistory.length > 50) undoHistory.removeAt(0);
    redoHistory.clear();
  }

  void recordApplied(CanvasOperation operation) {
    undoHistory.add(operation);
    if (undoHistory.length > 50) undoHistory.removeAt(0);
    redoHistory.clear();
  }

  bool undo() {
    if (undoHistory.isEmpty) return false;
    final operation = undoHistory.removeLast();
    final inverse = CanvasOperation(
      added: operation.removed,
      removed: operation.added,
      addedCards: operation.removedCards,
      removedCards: operation.addedCards,
      beforeBaseCards: operation.afterBaseCards,
      afterBaseCards: operation.beforeBaseCards,
    );
    apply(inverse, record: false);
    redoHistory.add(operation);
    return true;
  }

  void _setBaseCard(String id, CanvasCardState state) {
    switch (id) {
      case 'question':
        questionCard = state;
      case 'analysis':
        analysisCard = state;
      case 'note':
        noteCard = state;
    }
  }

  bool redo() {
    if (redoHistory.isEmpty) return false;
    final operation = redoHistory.removeLast();
    apply(operation, record: false);
    undoHistory.add(operation);
    return true;
  }

  Map<String, dynamic> toJson() => {
        'format': 'daguan-handwriting-canvas',
        'version': 1,
        'questionId': questionId,
        'updatedAt': DateTime.now().toIso8601String(),
        'strokes': strokes.map((stroke) => stroke.toJson()).toList(),
        'questionCard': questionCard.toJson(),
        'analysisCard': analysisCard.toJson(),
        'noteCard': noteCard.toJson(),
        'cardCopies': cardCopies.map((card) => card.toJson()).toList(),
        'textNote': textNote,
        'analysisVisible': analysisVisible,
        'background': background.value,
        'viewOffset': [viewOffset.dx, viewOffset.dy],
        'viewScale': viewScale,
        'fingerDrawing': fingerDrawing,
        'undoHistory':
            undoHistory.map((operation) => operation.toJson()).toList(),
        'redoHistory':
            redoHistory.map((operation) => operation.toJson()).toList(),
      };
}
