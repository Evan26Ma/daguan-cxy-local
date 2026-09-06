import 'dart:math' as math;
import 'dart:ui';

import 'handwriting_models.dart';

CanvasOperation buildDestructiveEraseOperation({
  required Iterable<InkStroke> existingStrokes,
  required Iterable<InkStroke> completedStrokes,
  required String Function() nextStrokeId,
}) {
  final completed = completedStrokes.toList();
  final erasers = completed
      .where((stroke) => stroke.erase && stroke.points.isNotEmpty)
      .toList();
  final newInk = completed.where((stroke) => !stroke.erase).toList();
  if (erasers.isEmpty) {
    return CanvasOperation(added: newInk, removed: const []);
  }

  final added = <InkStroke>[];
  final removed = <InkStroke>[];
  for (final stroke in existingStrokes.where((stroke) => !stroke.erase)) {
    final fragments = _eraseInkStroke(stroke, erasers);
    if (fragments == null) continue;
    removed.add(stroke);
    added.addAll(_buildInkFragments(stroke, fragments, nextStrokeId));
  }
  for (final stroke in newInk) {
    final fragments = _eraseInkStroke(stroke, erasers);
    if (fragments == null) {
      added.add(stroke);
    } else {
      added.addAll(_buildInkFragments(stroke, fragments, nextStrokeId));
    }
  }
  return CanvasOperation(added: added, removed: removed);
}

bool migrateLegacyEraseDocument(HandwritingDocument document) {
  final hasLegacyEraser = document.strokes.any((stroke) => stroke.erase) ||
      document.undoHistory.any(_operationContainsEraser) ||
      document.redoHistory.any(_operationContainsEraser);
  if (!hasLegacyEraser) return false;

  final usedIds = document.strokes.map((stroke) => stroke.id).toSet();
  var fragmentSerial = 0;
  String nextFragmentId() {
    String id;
    do {
      id = 'legacy-erase-fragment-${fragmentSerial++}';
    } while (usedIds.contains(id));
    usedIds.add(id);
    return id;
  }

  var migrated = <InkStroke>[];
  for (final stroke in document.strokes) {
    if (!stroke.erase) {
      migrated.add(stroke);
      continue;
    }
    final next = <InkStroke>[];
    for (final candidate in migrated) {
      final fragments = _eraseInkStroke(candidate, [stroke]);
      if (fragments == null) {
        next.add(candidate);
      } else {
        next.addAll(
          _buildInkFragments(candidate, fragments, nextFragmentId),
        );
      }
    }
    migrated = next;
  }
  document.strokes
    ..clear()
    ..addAll(migrated);
  document.undoHistory.clear();
  document.redoHistory.clear();
  return true;
}

bool _operationContainsEraser(CanvasOperation operation) =>
    operation.added.any((stroke) => stroke.erase) ||
    operation.removed.any((stroke) => stroke.erase);

List<InkStroke> _buildInkFragments(
  InkStroke source,
  List<List<InkPoint>> fragments,
  String Function() nextStrokeId,
) =>
    [
      for (final points in fragments)
        InkStroke(
          id: nextStrokeId(),
          points: points,
          color: source.color,
          width: source.width,
          pressureStrength: source.pressureStrength,
        ),
    ];

List<List<InkPoint>>? _eraseInkStroke(
  InkStroke stroke,
  List<InkStroke> erasers,
) {
  if (stroke.points.length < 2) return null;
  final strokeBounds = _strokeEnvelope(stroke);
  final eraserBounds = {
    for (final eraser in erasers) eraser: _strokeEnvelope(eraser),
  };
  if (!eraserBounds.values.any(strokeBounds.overlaps)) return null;

  final erasedSegments = List<bool>.filled(stroke.points.length - 1, false);
  var changed = false;
  for (var index = 0; index < erasedSegments.length; index++) {
    final start = stroke.points[index];
    final end = stroke.points[index + 1];
    final sourceRadius = _segmentRadius(stroke, start, end);
    for (final entry in eraserBounds.entries) {
      final eraser = entry.key;
      if (!_segmentEnvelope(start, end, sourceRadius).overlaps(entry.value)) {
        continue;
      }
      for (var eraseIndex = 0;
          eraseIndex < eraser.points.length - 1;
          eraseIndex++) {
        final eraseStart = eraser.points[eraseIndex];
        final eraseEnd = eraser.points[eraseIndex + 1];
        final eraseRadius = _segmentRadius(eraser, eraseStart, eraseEnd);
        final combinedRadius = sourceRadius + eraseRadius;
        if (!_segmentEnvelope(start, end, combinedRadius).overlaps(
          _segmentEnvelope(eraseStart, eraseEnd, eraseRadius),
        )) {
          continue;
        }
        if (_segmentDistanceSquared(
              start.offset,
              end.offset,
              eraseStart.offset,
              eraseEnd.offset,
            ) <=
            combinedRadius * combinedRadius) {
          erasedSegments[index] = true;
          changed = true;
          break;
        }
      }
      if (erasedSegments[index]) break;
    }
  }
  if (!changed) return null;

  final fragments = <List<InkPoint>>[];
  List<InkPoint>? current;
  for (var index = 0; index < erasedSegments.length; index++) {
    if (erasedSegments[index]) {
      if (current != null) fragments.add(current);
      current = null;
      continue;
    }
    current ??= [stroke.points[index]];
    current.add(stroke.points[index + 1]);
  }
  if (current != null) fragments.add(current);
  return fragments;
}

double _pressureScale(double pressure, double strength) =>
    lerpDouble(1, .28 + pressure * .92, strength)!;

double _segmentRadius(InkStroke stroke, InkPoint start, InkPoint end) {
  final pressure = (start.pressure + end.pressure) / 2;
  return stroke.width * _pressureScale(pressure, stroke.pressureStrength) / 2;
}

Rect _strokeEnvelope(InkStroke stroke) {
  if (stroke.points.isEmpty) return Rect.zero;
  var left = stroke.points.first.x;
  var top = stroke.points.first.y;
  var right = left;
  var bottom = top;
  var radius = 0.0;
  for (final point in stroke.points) {
    left = math.min(left, point.x);
    top = math.min(top, point.y);
    right = math.max(right, point.x);
    bottom = math.max(bottom, point.y);
    radius = math.max(
      radius,
      stroke.width *
          _pressureScale(point.pressure, stroke.pressureStrength) /
          2,
    );
  }
  return Rect.fromLTRB(left, top, right, bottom).inflate(radius);
}

Rect _segmentEnvelope(InkPoint start, InkPoint end, double radius) =>
    Rect.fromPoints(start.offset, end.offset).inflate(radius);

double _segmentDistanceSquared(Offset a, Offset b, Offset c, Offset d) {
  if (_segmentsIntersect(a, b, c, d)) return 0;
  return math.min(
    math.min(
      _pointSegmentDistanceSquared(a, c, d),
      _pointSegmentDistanceSquared(b, c, d),
    ),
    math.min(
      _pointSegmentDistanceSquared(c, a, b),
      _pointSegmentDistanceSquared(d, a, b),
    ),
  );
}

double _pointSegmentDistanceSquared(Offset point, Offset start, Offset end) {
  final segment = end - start;
  final lengthSquared = segment.dx * segment.dx + segment.dy * segment.dy;
  if (lengthSquared == 0) return (point - start).distanceSquared;
  final relative = point - start;
  final fraction =
      ((relative.dx * segment.dx + relative.dy * segment.dy) / lengthSquared)
          .clamp(0.0, 1.0);
  final closest = start + segment * fraction;
  return (point - closest).distanceSquared;
}

bool _segmentsIntersect(Offset a, Offset b, Offset c, Offset d) {
  final abC = _cross(a, b, c);
  final abD = _cross(a, b, d);
  final cdA = _cross(c, d, a);
  final cdB = _cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) {
    return true;
  }
  const epsilon = 1e-9;
  return (abC.abs() <= epsilon && _pointOnSegment(c, a, b)) ||
      (abD.abs() <= epsilon && _pointOnSegment(d, a, b)) ||
      (cdA.abs() <= epsilon && _pointOnSegment(a, c, d)) ||
      (cdB.abs() <= epsilon && _pointOnSegment(b, c, d));
}

double _cross(Offset a, Offset b, Offset point) =>
    (b.dx - a.dx) * (point.dy - a.dy) - (b.dy - a.dy) * (point.dx - a.dx);

bool _pointOnSegment(Offset point, Offset start, Offset end) =>
    point.dx >= math.min(start.dx, end.dx) &&
    point.dx <= math.max(start.dx, end.dx) &&
    point.dy >= math.min(start.dy, end.dy) &&
    point.dy <= math.max(start.dy, end.dy);
