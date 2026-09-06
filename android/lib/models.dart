import 'dart:convert';

enum Mastery {
  notStarted('not_started', '未开始'),
  mastered('mastered', '已掌握'),
  needsPractice('needs_practice', '需练习'),
  notKnown('not_known', '完全不会');

  const Mastery(this.value, this.label);
  final String value;
  final String label;

  static Mastery parse(String? value) => values.firstWhere(
        (item) => item.value == value,
        orElse: () => Mastery.notStarted,
      );
}

class Question {
  Question.fromJson(Map<String, dynamic> json)
      : id = json['id'] as int,
        serial = json['serial'] as int? ?? 0,
        categoryIds = List<int>.from(json['categoryIds'] as List? ?? const []),
        stem = json['stem'] as String? ?? '',
        options = List<String>.from(json['options'] as List? ?? const []),
        answer = json['answer'] as String? ?? '',
        explanation = json['explanation'] as String? ?? '',
        source = json['source'] as String? ?? '',
        type = json['type'] as String? ?? 'subjective',
        core = json['core'] as bool? ?? false,
        assets = List<String>.from(json['assets'] as List? ?? const []);

  final int id;
  final int serial;
  final List<int> categoryIds;
  final String stem;
  final List<String> options;
  final String answer;
  final String explanation;
  final String source;
  final String type;
  final bool core;
  final List<String> assets;

  String get searchable =>
      '$id $serial $stem ${options.join(' ')} $source'.toLowerCase();
}

class Category {
  Category.fromJson(Map<String, dynamic> json)
      : id = json['id'] as int,
        parentId = json['parentId'] as int?,
        name = json['name'] as String,
        path = json['path'] as String,
        directCount = json['directCount'] as int? ?? 0,
        totalCount = json['totalCount'] as int? ?? 0;

  final int id;
  final int? parentId;
  final String name;
  final String path;
  final int directCount;
  final int totalCount;
}

class CollectionOrigin {
  const CollectionOrigin({
    required this.categoryId,
    required this.categoryPath,
    required this.position,
  });

  factory CollectionOrigin.fromJson(Map<String, dynamic> json) =>
      CollectionOrigin(
        categoryId: json['categoryId'] as int?,
        categoryPath: json['categoryPath'] as String? ?? '',
        position: (json['position'] as int? ?? 0).clamp(0, 1 << 31),
      );

  final int? categoryId;
  final String categoryPath;
  final int position;

  Map<String, dynamic> toJson() => {
        'categoryId': categoryId,
        'categoryPath': categoryPath,
        'position': position,
      };
}

class QuestionState {
  QuestionState({
    this.mastery = Mastery.notStarted,
    this.favorite = false,
    this.note = '',
    this.updatedAt,
    this.selectedOptions = const [],
    this.lastCorrect,
    this.wrongCount = 0,
    this.inWrongBook = false,
    this.lastAttemptAt,
    this.favoriteOrigin,
    this.reviewOrigin,
    this.practiceQueuedAt,
    this.reviewAddedAt,
  });

  factory QuestionState.fromJson(Map<String, dynamic> json) => QuestionState(
        mastery: Mastery.parse(json['mastery'] as String?),
        favorite: json['favorite'] as bool? ?? false,
        note: json['note'] as String? ?? '',
        updatedAt: json['updatedAt'] as String?,
        selectedOptions: List<String>.from(
          json['selectedOptions'] as List? ?? const [],
        ),
        lastCorrect: json['lastCorrect'] as bool?,
        wrongCount: json['wrongCount'] as int? ?? 0,
        inWrongBook: json['inWrongBook'] as bool? ?? false,
        lastAttemptAt: json['lastAttemptAt'] as String?,
        favoriteOrigin: json['favoriteOrigin'] is Map
            ? CollectionOrigin.fromJson(
                Map<String, dynamic>.from(json['favoriteOrigin'] as Map),
              )
            : null,
        reviewOrigin: json['reviewOrigin'] is Map
            ? CollectionOrigin.fromJson(
                Map<String, dynamic>.from(json['reviewOrigin'] as Map),
              )
            : null,
        practiceQueuedAt: json['practiceQueuedAt'] as String?,
        reviewAddedAt: json['reviewAddedAt'] as String?,
      );

  Mastery mastery;
  bool favorite;
  String note;
  String? updatedAt;
  List<String> selectedOptions;
  bool? lastCorrect;
  int wrongCount;
  bool inWrongBook;
  String? lastAttemptAt;
  CollectionOrigin? favoriteOrigin;
  CollectionOrigin? reviewOrigin;
  String? practiceQueuedAt;
  String? reviewAddedAt;

  Map<String, dynamic> toJson() => {
        'mastery': mastery.value,
        'favorite': favorite,
        'note': note,
        'updatedAt': updatedAt,
        'selectedOptions': selectedOptions,
        'lastCorrect': lastCorrect,
        'wrongCount': wrongCount,
        'inWrongBook': inWrongBook,
        'lastAttemptAt': lastAttemptAt,
        if (favoriteOrigin != null) 'favoriteOrigin': favoriteOrigin!.toJson(),
        if (reviewOrigin != null) 'reviewOrigin': reviewOrigin!.toJson(),
        if (practiceQueuedAt != null) 'practiceQueuedAt': practiceQueuedAt,
        if (reviewAddedAt != null) 'reviewAddedAt': reviewAddedAt,
      };
}

class StudyEvent {
  StudyEvent.fromJson(Map<String, dynamic> json)
      : id = json['id'].toString(),
        questionId = json['questionId'] as int,
        categoryId = json['categoryId'] as int?,
        action = json['action'] as String? ?? '',
        createdAt = json['createdAt'] as String? ?? '',
        categoryName = json['categoryName'] as String? ?? '',
        serial = json['serial'] as int? ?? 0;

  StudyEvent.now({
    required this.questionId,
    required this.categoryId,
    required this.action,
    required this.categoryName,
    required this.serial,
  })  : id = DateTime.now().microsecondsSinceEpoch.toString(),
        createdAt = DateTime.now().toIso8601String();

  final String id;
  final int questionId;
  final int? categoryId;
  final String action;
  final String createdAt;
  final String categoryName;
  final int serial;

  Map<String, dynamic> toJson() => {
        'id': id,
        'questionId': questionId,
        'categoryId': categoryId,
        'action': action,
        'createdAt': createdAt,
        'categoryName': categoryName,
        'serial': serial,
      };
}

Map<String, dynamic> decodeObject(String source) =>
    jsonDecode(source) as Map<String, dynamic>;
