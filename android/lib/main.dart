import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'batch_export.dart';
import 'batch_export_models.dart';
import 'handwriting_canvas.dart';
import 'math_content.dart';
import 'models.dart';
import 'storage.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DaguanApp());
}

abstract final class AppColors {
  static const primary = Color(0xff2563eb);
  static const primaryDark = Color(0xff1d4ed8);
  static const primarySoft = Color(0xffeff6ff);
  static const canvas = Color(0xfff8fafc);
  static const surface = Color(0xffffffff);
  static const surfaceMuted = Color(0xfff1f5f9);
  static const border = Color(0xffe2e8f0);
  static const borderLight = Color(0xfff1f5f9);
  static const ink = Color(0xff0f172a);
  static const text = Color(0xff334155);
  static const muted = Color(0xff64748b);
}

class SyncImportResult {
  const SyncImportResult({
    required this.updatedQuestions,
    required this.importedEvents,
    required this.ignoredQuestionIds,
  });

  final int updatedQuestions;
  final int importedEvents;
  final int ignoredQuestionIds;
}

class _SyncStateChange {
  const _SyncStateChange({
    required this.questionId,
    required this.hasMastery,
    required this.mastery,
    required this.hasFavorite,
    required this.favorite,
    this.updatedAt,
    this.practiceQueuedAt,
    this.reviewAddedAt,
    this.reviewOrigin,
  });

  final int questionId;
  final bool hasMastery;
  final Mastery mastery;
  final bool hasFavorite;
  final bool favorite;
  final String? updatedAt;
  final String? practiceQueuedAt;
  final String? reviewAddedAt;
  final CollectionOrigin? reviewOrigin;
}

class DaguanApp extends StatefulWidget {
  const DaguanApp({super.key});

  @override
  State<DaguanApp> createState() => _DaguanAppState();
}

class _DaguanAppState extends State<DaguanApp> {
  final controller = AppController();

  @override
  void initState() {
    super.initState();
    controller.load();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: '大观园数学题库',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: AppColors.primary,
          brightness: Brightness.light,
          surface: AppColors.surface,
        ),
        scaffoldBackgroundColor: AppColors.canvas,
        useMaterial3: true,
        fontFamily: 'sans',
        dividerColor: AppColors.border,
        cardTheme: CardThemeData(
          color: AppColors.surface,
          elevation: 0,
          shape: RoundedRectangleBorder(
            side: const BorderSide(color: AppColors.border),
            borderRadius: BorderRadius.circular(14),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: AppColors.canvas,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: AppColors.border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: AppColors.border),
          ),
        ),
      ),
      home: AnimatedBuilder(
        animation: controller,
        builder: (context, _) {
          if (controller.error != null) {
            return ErrorPage(message: controller.error!);
          }
          if (!controller.ready) return const LoadingPage();
          return AppShell(controller: controller);
        },
      ),
    );
  }
}

enum QuestionBook { favorite, recentPractice, review }

enum ReviewFilter { all, needsPractice, notKnown }

enum ReviewSort { ascending, descending }

class AppController extends ChangeNotifier {
  AppController({DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  static const progressVersion = 2;
  static const recentPracticeDuration = Duration(hours: 48);

  final storage = LocalStorage();
  final questions = <Question>[];
  final categories = <Category>[];
  final states = <int, QuestionState>{};
  final events = <StudyEvent>[];
  final categoryById = <int, Category>{};
  final childrenByParent = <int?, List<Category>>{};
  final questionsByCategory = <int, List<Question>>{};
  bool ready = false;
  String? error;
  int? selectedCategoryId;
  int? selectedQuestionId;
  String search = '';
  bool coreOnly = false;
  ReviewFilter reviewFilter = ReviewFilter.all;
  ReviewSort reviewSort = ReviewSort.ascending;
  int workspacePage = 0;
  bool canvasOpen = false;
  bool _resumeCanvasPending = false;
  Timer? _saveTimer;
  Timer? _practiceTimer;
  final DateTime Function() _clock;
  List<Question>? _navigationQuestions;
  String? _navigationTitle;
  QuestionBook? _navigationBook;

  Future<void> load() async {
    try {
      final raw = await Future.wait([
        rootBundle.loadString('assets/questions.json'),
        rootBundle.loadString('assets/categories.json'),
        storage.loadProgress(),
      ]);
      final questionData = decodeObject(raw[0] as String);
      questions.addAll(
        (questionData['items'] as List).map(
          (item) => Question.fromJson(item as Map<String, dynamic>),
        ),
      );
      categories.addAll(
        (decodeObject(raw[1] as String)['items'] as List).map(
          (item) => Category.fromJson(item as Map<String, dynamic>),
        ),
      );
      for (final category in categories) {
        categoryById[category.id] = category;
        childrenByParent.putIfAbsent(category.parentId, () => []).add(category);
      }
      for (final question in questions) {
        for (final categoryId in question.categoryIds) {
          questionsByCategory.putIfAbsent(categoryId, () => []).add(question);
        }
      }
      final progress = raw[2] as Map<String, dynamic>;
      final storedVersion = progress['version'] as int? ?? 1;
      var migratedLegacyPractice = false;
      final loadedAt = _clock();
      for (final entry
          in (progress['states'] as Map<String, dynamic>? ?? {}).entries) {
        final state = QuestionState.fromJson(
          entry.value as Map<String, dynamic>,
        );
        if (state.inWrongBook && state.mastery == Mastery.notStarted) {
          state.mastery = Mastery.needsPractice;
        }
        state.inWrongBook = false;
        if (storedVersion < progressVersion &&
            state.mastery == Mastery.needsPractice) {
          state
            ..mastery = Mastery.notStarted
            ..selectedOptions = []
            ..lastCorrect = null
            ..wrongCount = 0
            ..lastAttemptAt = null
            ..reviewOrigin = null
            ..practiceQueuedAt = null
            ..reviewAddedAt = null;
          migratedLegacyPractice = true;
        } else {
          _normalizePracticeDates(state, loadedAt);
        }
        states[int.parse(entry.key)] = state;
      }
      events.addAll(
        (progress['events'] as List? ?? const []).map(
          (item) => StudyEvent.fromJson(item as Map<String, dynamic>),
        ),
      );
      final lastStudy = progress['lastStudy'] as Map?;
      final lastQuestionId = lastStudy?['last_question_id'] as int?;
      selectedQuestionId =
          questions.any((question) => question.id == lastQuestionId)
              ? lastQuestionId
              : null;
      final lastCategoryId = lastStudy?['category_id'] as int?;
      selectedCategoryId =
          lastCategoryId == null || categoryById.containsKey(lastCategoryId)
              ? lastCategoryId
              : null;
      final storedWorkspacePage =
          (lastStudy?['workspace_page'] as int? ?? 0).clamp(0, 5);
      workspacePage =
          storedVersion < progressVersion && storedWorkspacePage >= 2
              ? (storedWorkspacePage + 1).clamp(0, 5)
              : storedWorkspacePage;
      if (migratedLegacyPractice && storedWorkspacePage == 2) {
        workspacePage = 0;
      }
      reviewFilter = ReviewFilter.values.firstWhere(
        (filter) => filter.name == lastStudy?['review_filter'],
        orElse: () => ReviewFilter.all,
      );
      reviewSort = ReviewSort.values.firstWhere(
        (sort) => sort.name == lastStudy?['review_sort'],
        orElse: () => ReviewSort.ascending,
      );
      canvasOpen = lastStudy?['canvas_open'] as bool? ?? false;
      if (workspacePage == 1) {
        _navigationBook = QuestionBook.favorite;
        _navigationTitle = '收藏题目';
        _navigationQuestions = List<Question>.unmodifiable(favoriteQuestions);
      } else if (workspacePage == 2) {
        _navigationBook = QuestionBook.recentPractice;
        _navigationTitle = '近期复习';
        _navigationQuestions = List<Question>.unmodifiable(
          recentPracticeQuestions,
        );
      } else if (workspacePage == 3) {
        _navigationBook = QuestionBook.review;
        _navigationTitle = '复习题目';
        _navigationQuestions = List<Question>.unmodifiable(
          filteredReviewQuestions,
        );
      }
      if (_navigationQuestions != null &&
          !_navigationQuestions!.any(
            (question) => question.id == selectedQuestionId,
          )) {
        selectedQuestionId = null;
      }
      _resumeCanvasPending = canvasOpen && selectedQuestionId != null;
      ready = true;
      _practiceTimer?.cancel();
      _practiceTimer = Timer.periodic(
        const Duration(minutes: 1),
        (_) => _handlePracticeTick(),
      );
      if (migratedLegacyPractice || storedVersion < progressVersion) {
        await storage.save(exportValue());
      }
    } catch (exception) {
      error = exception.toString();
    }
    notifyListeners();
  }

  QuestionState stateOf(int questionId) =>
      states.putIfAbsent(questionId, QuestionState.new);

  DateTime? _date(String? value) =>
      value == null ? null : DateTime.tryParse(value)?.toLocal();

  void _normalizePracticeDates(QuestionState state, DateTime now) {
    switch (state.mastery) {
      case Mastery.needsPractice:
        final queuedAt = _date(state.practiceQueuedAt);
        if (queuedAt == null) {
          state
            ..practiceQueuedAt = null
            ..reviewAddedAt ??= now.toIso8601String();
        } else {
          state.reviewAddedAt ??=
              queuedAt.add(recentPracticeDuration).toIso8601String();
        }
      case Mastery.notKnown:
        state
          ..practiceQueuedAt = null
          ..reviewAddedAt ??= now.toIso8601String();
      case Mastery.notStarted || Mastery.mastered:
        state
          ..practiceQueuedAt = null
          ..reviewAddedAt = null;
    }
  }

  bool isRecentPracticeState(QuestionState state, {DateTime? now}) {
    if (state.mastery != Mastery.needsPractice) return false;
    final queuedAt = _date(state.practiceQueuedAt);
    if (queuedAt == null) return false;
    return (now ?? _clock()).isBefore(queuedAt.add(recentPracticeDuration));
  }

  bool isReviewState(QuestionState state, {DateTime? now}) =>
      state.mastery == Mastery.notKnown ||
      (state.mastery == Mastery.needsPractice &&
          !isRecentPracticeState(state, now: now));

  Question? get selectedQuestion {
    final id = selectedQuestionId;
    if (id == null) return null;
    return questions.where((question) => question.id == id).firstOrNull;
  }

  List<Question> get visibleQuestions {
    Iterable<Question> result = questions;
    if (coreOnly) {
      result = result.where((question) => question.core);
    }
    if (selectedCategoryId != null) {
      final ids = _descendantIds(selectedCategoryId!);
      result = result.where(
        (question) => question.categoryIds.any(ids.contains),
      );
    }
    final query = search.trim().toLowerCase();
    if (query.isNotEmpty) {
      result = result.where((question) => question.searchable.contains(query));
    }
    return result.toList(growable: false);
  }

  List<Question> get favoriteQuestions => questions
      .where((question) => states[question.id]?.favorite ?? false)
      .toList(growable: false);

  List<Question> get recentPracticeQuestions {
    final now = _clock();
    final result = questions
        .where(
          (question) => isRecentPracticeState(
            states[question.id] ?? QuestionState(),
            now: now,
          ),
        )
        .toList(growable: false);
    result.sort(
      (left, right) => _date(
        stateOf(left.id).practiceQueuedAt,
      )!
          .compareTo(_date(stateOf(right.id).practiceQueuedAt)!),
    );
    return result;
  }

  int get recentPracticeCount => recentPracticeQuestions.length;

  String recentPracticeCountdown(Question question) {
    final queuedAt = _date(stateOf(question.id).practiceQueuedAt);
    if (queuedAt == null) return '即将移入复习本';
    final remaining = queuedAt.add(recentPracticeDuration).difference(_clock());
    if (remaining <= const Duration(hours: 1)) return '即将移入复习本';
    final days = remaining.inDays;
    final hours = remaining.inHours.remainder(24);
    if (days > 0 && hours > 0) return '$days 天 $hours 小时后移入复习本';
    if (days > 0) return '$days 天后移入复习本';
    return '${remaining.inHours} 小时后移入复习本';
  }

  List<Question> get reviewQuestions {
    final now = _clock();
    final result = questions
        .where(
          (question) =>
              isReviewState(states[question.id] ?? QuestionState(), now: now),
        )
        .toList(growable: false);
    result.sort((left, right) {
      final leftAt = _date(stateOf(left.id).reviewAddedAt) ??
          DateTime.fromMillisecondsSinceEpoch(0);
      final rightAt = _date(stateOf(right.id).reviewAddedAt) ??
          DateTime.fromMillisecondsSinceEpoch(0);
      final comparison = leftAt.compareTo(rightAt);
      return reviewSort == ReviewSort.ascending ? comparison : -comparison;
    });
    return result;
  }

  List<Question> get filteredReviewQuestions => reviewQuestions
      .where(
        (question) => switch (reviewFilter) {
          ReviewFilter.all => true,
          ReviewFilter.needsPractice =>
            stateOf(question.id).mastery == Mastery.needsPractice,
          ReviewFilter.notKnown =>
            stateOf(question.id).mastery == Mastery.notKnown,
        },
      )
      .toList(growable: false);

  int reviewCount(ReviewFilter filter) => reviewQuestions
      .where(
        (question) => switch (filter) {
          ReviewFilter.all => true,
          ReviewFilter.needsPractice =>
            stateOf(question.id).mastery == Mastery.needsPractice,
          ReviewFilter.notKnown =>
            stateOf(question.id).mastery == Mastery.notKnown,
        },
      )
      .length;

  List<Question> get currentQuestionSequence =>
      _navigationQuestions ?? visibleQuestions;

  List<Question>? get fixedNavigationQuestions => _navigationQuestions;

  String? get navigationTitle => _navigationTitle;

  QuestionBook? get navigationBook => _navigationBook;

  List<Category> get rootCategories => (childrenByParent[null] ?? const [])
      .where(
        (category) =>
            category.totalCount > 20 && !category.name.startsWith('归档分类'),
      )
      .toList(growable: false);

  int? rootCategoryIdOf(int? categoryId) {
    var current = categoryId == null ? null : categoryById[categoryId];
    if (current == null) return null;
    while (current?.parentId != null) {
      current = categoryById[current!.parentId];
    }
    return current?.id;
  }

  List<Category> childCategoriesOf(int? parentId) =>
      (childrenByParent[parentId] ?? const [])
          .where((category) => category.totalCount > 0)
          .toList(growable: false);

  List<Category> lineageOf(int? categoryId) {
    var current = categoryId == null ? null : categoryById[categoryId];
    final lineage = <Category>[];
    while (current != null) {
      lineage.add(current);
      current =
          current.parentId == null ? null : categoryById[current.parentId!];
    }
    return lineage.reversed.toList(growable: false);
  }

  List<Question> questionsForCategory(int categoryId) {
    final ids = _descendantIds(categoryId);
    return questions
        .where((question) => question.categoryIds.any(ids.contains))
        .toList(growable: false);
  }

  bool categoryContains(int ancestorId, int? categoryId) {
    var current = categoryId == null ? null : categoryById[categoryId];
    while (current != null) {
      if (current.id == ancestorId) return true;
      current =
          current.parentId == null ? null : categoryById[current.parentId!];
    }
    return false;
  }

  int? parentCategoryIdOf(int? categoryId) =>
      categoryId == null ? null : categoryById[categoryId]?.parentId;

  int? smallChapterIdOf(int? categoryId) {
    var current = categoryId == null ? null : categoryById[categoryId];
    if (current == null) return null;
    final lineage = <Category>[];
    while (current != null) {
      lineage.add(current);
      current =
          current.parentId == null ? null : categoryById[current.parentId!];
    }
    final ordered = lineage.reversed.toList(growable: false);
    return ordered.length >= 3 ? ordered[2].id : ordered.last.id;
  }

  List<Category> chapterChoicesFor(int? rootId) {
    if (rootId == null) return categories;
    final ids = _descendantIds(rootId);
    return categories
        .where(
          (category) =>
              category.id != rootId &&
              ids.contains(category.id) &&
              (category.directCount > 0 ||
                  (childrenByParent[category.id] ?? const []).isEmpty),
        )
        .toList(growable: false);
  }

  Set<int> _descendantIds(int id) {
    final result = <int>{id};
    final pending = <int>[id];
    while (pending.isNotEmpty) {
      final next = pending.removeLast();
      for (final child in childrenByParent[next] ?? const []) {
        if (result.add(child.id)) pending.add(child.id);
      }
    }
    return result;
  }

  void chooseCategory(int? id) {
    _navigationQuestions = null;
    _navigationTitle = null;
    _navigationBook = null;
    selectedCategoryId = id;
    selectedQuestionId = null;
    notifyListeners();
    _scheduleSave();
  }

  void chooseQuestion(int id, {bool keepNavigationContext = false}) {
    if (!keepNavigationContext) {
      _navigationQuestions = null;
      _navigationTitle = null;
      _navigationBook = null;
    }
    selectedQuestionId = id;
    notifyListeners();
    _scheduleSave();
  }

  void openQuestion(
    Question question, {
    List<Question>? navigationQuestions,
    String? navigationTitle,
    QuestionBook? navigationBook,
  }) {
    _navigationQuestions = navigationQuestions == null
        ? null
        : List<Question>.unmodifiable(navigationQuestions);
    _navigationTitle = navigationQuestions == null ? null : navigationTitle;
    _navigationBook = navigationQuestions == null ? null : navigationBook;
    selectedCategoryId = question.categoryIds.firstOrNull;
    selectedQuestionId = question.id;
    search = '';
    notifyListeners();
    _scheduleSave();
  }

  void openQuestionInCategory(Question question, int categoryId) {
    _navigationQuestions = null;
    _navigationTitle = null;
    _navigationBook = null;
    selectedCategoryId = categoryId;
    selectedQuestionId = question.id;
    search = '';
    notifyListeners();
    _scheduleSave();
  }

  void openLibraryQuestion(Question question) {
    _navigationQuestions = null;
    _navigationTitle = null;
    _navigationBook = null;
    selectedQuestionId = question.id;
    search = '';
    notifyListeners();
    _scheduleSave();
  }

  void openQuestionAtOrigin(Question question, CollectionOrigin origin) {
    _navigationQuestions = null;
    _navigationTitle = null;
    _navigationBook = null;
    selectedCategoryId = origin.categoryId;
    selectedQuestionId = question.id;
    search = '';
    notifyListeners();
    _scheduleSave();
  }

  int selectedQuestionIndex(List<Question> questions) =>
      questions.indexWhere((question) => question.id == selectedQuestionId);

  void selectAdjacent(int offset) {
    final questions = currentQuestionSequence;
    final index = selectedQuestionIndex(questions);
    if (index < 0 &&
        _navigationBook == QuestionBook.recentPractice &&
        questions.isNotEmpty) {
      chooseQuestion(
        offset < 0 ? questions.last.id : questions.first.id,
        keepNavigationContext: true,
      );
      return;
    }
    final next = index + offset;
    if (index < 0 || next < 0 || next >= questions.length) return;
    chooseQuestion(questions[next].id, keepNavigationContext: true);
  }

  void clearSelectedQuestion() {
    _navigationQuestions = null;
    _navigationTitle = null;
    _navigationBook = null;
    selectedQuestionId = null;
    notifyListeners();
    _scheduleSave();
  }

  void clearQuestionNavigationContext() {
    _navigationQuestions = null;
    _navigationTitle = null;
    _navigationBook = null;
  }

  CollectionOrigin? originFor(Question question, QuestionBook book) {
    final state = stateOf(question.id);
    return switch (book) {
      QuestionBook.favorite => state.favoriteOrigin,
      QuestionBook.recentPractice => state.reviewOrigin,
      QuestionBook.review => state.reviewOrigin,
    };
  }

  int? displayPosition(Question question) {
    final book = _navigationBook;
    if (book != null) return originFor(question, book)?.position;
    final index = selectedQuestionIndex(currentQuestionSequence);
    return index < 0 ? null : index + 1;
  }

  String displayPath(Question question) {
    final book = _navigationBook;
    if (book != null) {
      return originFor(question, book)?.categoryPath ?? '收录位置未知';
    }
    final categoryId = selectedCategoryId;
    if (categoryId == null) return '全部题目';
    return categoryById[categoryId]?.path ?? categoryPath(question);
  }

  CollectionOrigin? _currentCollectionOrigin(
    Question question, {
    CollectionOrigin? inheritedOrigin,
  }) {
    if (_navigationBook != null) return inheritedOrigin;
    if (_navigationQuestions != null) return inheritedOrigin;
    final index = selectedQuestionIndex(currentQuestionSequence);
    if (index < 0) return inheritedOrigin;
    final categoryId = selectedCategoryId;
    return CollectionOrigin(
      categoryId: categoryId,
      categoryPath: categoryId == null
          ? '全部题目'
          : categoryById[categoryId]?.path ?? categoryPath(question),
      position: index + 1,
    );
  }

  void setSearch(String value) {
    search = value;
    notifyListeners();
  }

  void setCoreOnly(bool value) {
    coreOnly = value;
    selectedQuestionId = null;
    notifyListeners();
  }

  void setReviewFilter(ReviewFilter value) {
    if (reviewFilter == value) return;
    reviewFilter = value;
    if (_navigationBook == QuestionBook.review) {
      _replaceReviewNavigation(preferredIndex: 0);
    }
    notifyListeners();
    _scheduleSave();
  }

  void setReviewSort(ReviewSort value) {
    if (reviewSort == value) return;
    reviewSort = value;
    if (_navigationBook == QuestionBook.review) {
      _replaceReviewNavigation(preferredIndex: 0);
    }
    notifyListeners();
    _scheduleSave();
  }

  void setWorkspacePage(int value) {
    workspacePage = value >= 0 && value <= 5 ? value : 0;
    _scheduleSave();
  }

  void setCanvasOpen(bool value) {
    canvasOpen = value;
    _scheduleSave();
  }

  bool takeResumeCanvasRequest() {
    if (!_resumeCanvasPending) return false;
    _resumeCanvasPending = false;
    return true;
  }

  Future<void> resetAllUserData() async {
    _saveTimer?.cancel();
    await storage.clearAllUserData();
    states.clear();
    events.clear();
    selectedCategoryId = null;
    selectedQuestionId = null;
    search = '';
    coreOnly = false;
    reviewFilter = ReviewFilter.all;
    reviewSort = ReviewSort.ascending;
    workspacePage = 0;
    canvasOpen = false;
    _resumeCanvasPending = false;
    _navigationQuestions = null;
    _navigationTitle = null;
    _navigationBook = null;
    notifyListeners();
  }

  void _replaceReviewNavigation({required int preferredIndex}) {
    final nextQuestions = filteredReviewQuestions;
    _navigationQuestions = List<Question>.unmodifiable(nextQuestions);
    if (nextQuestions.any((question) => question.id == selectedQuestionId)) {
      return;
    }
    selectedQuestionId = nextQuestions.isEmpty
        ? null
        : nextQuestions[preferredIndex.clamp(0, nextQuestions.length - 1)].id;
  }

  void _refreshActiveBookNavigation(Question question) {
    final book = _navigationBook;
    final current = _navigationQuestions;
    if (book == null || current == null) return;
    final previousIndex =
        current.indexWhere((item) => item.id == question.id).clamp(0, 1 << 31);
    final nextQuestions = switch (book) {
      QuestionBook.favorite => favoriteQuestions,
      QuestionBook.recentPractice => recentPracticeQuestions,
      QuestionBook.review => filteredReviewQuestions,
    };
    _navigationQuestions = List<Question>.unmodifiable(nextQuestions);
    if (nextQuestions.any((item) => item.id == selectedQuestionId)) return;
    selectedQuestionId = nextQuestions.isEmpty
        ? null
        : nextQuestions[previousIndex.clamp(0, nextQuestions.length - 1)].id;
  }

  void _handlePracticeTick() {
    if (_navigationBook == QuestionBook.recentPractice) {
      _navigationQuestions = List<Question>.unmodifiable(
        recentPracticeQuestions,
      );
    }
    notifyListeners();
  }

  void _clearReviewPlacement(QuestionState state) {
    state
      ..practiceQueuedAt = null
      ..reviewAddedAt = null
      ..reviewOrigin = null;
  }

  void _queueForPractice(Question question, QuestionState state, DateTime now) {
    final origin = _currentCollectionOrigin(
      question,
      inheritedOrigin: state.reviewOrigin ?? state.favoriteOrigin,
    );
    state
      ..mastery = Mastery.needsPractice
      ..practiceQueuedAt = now.toIso8601String()
      ..reviewAddedAt = now.add(recentPracticeDuration).toIso8601String()
      ..reviewOrigin = origin;
  }

  void setMastery(Question question, Mastery mastery) {
    final state = stateOf(question.id);
    if (mastery != Mastery.needsPractice && state.mastery == mastery) {
      return;
    }
    final now = _clock();
    switch (mastery) {
      case Mastery.needsPractice:
        _queueForPractice(question, state, now);
      case Mastery.notKnown:
        state
          ..mastery = Mastery.notKnown
          ..practiceQueuedAt = null
          ..reviewAddedAt = now.toIso8601String()
          ..reviewOrigin = _currentCollectionOrigin(
            question,
            inheritedOrigin: state.reviewOrigin ?? state.favoriteOrigin,
          );
      case Mastery.mastered:
        state.mastery = Mastery.mastered;
        _clearReviewPlacement(state);
      case Mastery.notStarted:
        state.mastery = Mastery.notStarted;
        _clearReviewPlacement(state);
    }
    state.inWrongBook = false;
    state.updatedAt = now.toIso8601String();
    events.insert(
      0,
      StudyEvent.now(
        questionId: question.id,
        categoryId: question.categoryIds.firstOrNull,
        action: '${mastery.value}_mark',
        categoryName: displayPath(question),
        serial: question.serial,
      ),
    );
    _refreshActiveBookNavigation(question);
    notifyListeners();
    _scheduleSave();
  }

  void clearMastery(Question question) =>
      setMastery(question, Mastery.notStarted);

  void toggleFavorite(Question question) {
    final state = stateOf(question.id);
    state.favorite = !state.favorite;
    state.favoriteOrigin = state.favorite
        ? _currentCollectionOrigin(
            question,
            inheritedOrigin: state.reviewOrigin,
          )
        : null;
    state.updatedAt = DateTime.now().toIso8601String();
    _refreshActiveBookNavigation(question);
    notifyListeners();
    _scheduleSave();
  }

  void setNote(Question question, String note) {
    final state = stateOf(question.id);
    state.note = note;
    state.updatedAt = DateTime.now().toIso8601String();
    notifyListeners();
    _scheduleSave();
  }

  Set<int> correctOptionIndexes(Question question) {
    final letters = RegExp(r'[A-Z]')
        .allMatches(question.answer.toUpperCase())
        .map((match) => match.group(0)!)
        .toSet();
    return {
      for (var index = 0; index < question.options.length; index++)
        if (letters.contains(String.fromCharCode(65 + index))) index,
    };
  }

  void submitAnswer(Question question, Set<int> selectedIndexes) {
    final selected = selectedIndexes.toList()..sort();
    final correct = correctOptionIndexes(question);
    final isCorrect = selected.length == correct.length &&
        selected.toSet().containsAll(correct);
    final state = stateOf(question.id);
    final nowValue = _clock();
    final now = nowValue.toIso8601String();
    state
      ..selectedOptions =
          selected.map((index) => String.fromCharCode(65 + index)).toList()
      ..lastCorrect = isCorrect
      ..lastAttemptAt = now
      ..updatedAt = now
      ..wrongCount = isCorrect ? 0 : 1;
    if (isCorrect) {
      state.mastery = Mastery.mastered;
      _clearReviewPlacement(state);
    } else {
      _queueForPractice(question, state, nowValue);
    }
    state.inWrongBook = false;
    events.insert(
      0,
      StudyEvent.now(
        questionId: question.id,
        categoryId: question.categoryIds.firstOrNull,
        action: isCorrect ? 'answer_correct' : 'answer_wrong',
        categoryName: displayPath(question),
        serial: question.serial,
      ),
    );
    _refreshActiveBookNavigation(question);
    notifyListeners();
    _scheduleSave();
  }

  void clearAnswer(Question question) {
    final state = stateOf(question.id);
    state
      ..selectedOptions = []
      ..lastCorrect = null
      ..wrongCount = 0
      ..lastAttemptAt = null
      ..updatedAt = DateTime.now().toIso8601String();
    notifyListeners();
    _scheduleSave();
  }

  String categoryPath(Question question) {
    if (question.categoryIds.isEmpty) return '未分类';
    return categoryById[question.categoryIds.first]?.path ?? '未分类';
  }

  Map<String, dynamic> exportValue({
    Map<int, QuestionState>? stateValues,
    List<StudyEvent>? eventValues,
  }) {
    final sourceStates = stateValues ?? states;
    final sourceEvents = eventValues ?? events;
    return {
      'format': 'daguan-android-progress',
      'version': progressVersion,
      'updatedAt': DateTime.now().toIso8601String(),
      'questionCount': questions.length,
      'states': {
        for (final entry in sourceStates.entries)
          if (entry.value.mastery != Mastery.notStarted ||
              entry.value.favorite ||
              entry.value.note.trim().isNotEmpty ||
              entry.value.selectedOptions.isNotEmpty ||
              entry.value.inWrongBook ||
              entry.value.wrongCount > 0)
            entry.key.toString(): entry.value.toJson(),
      },
      'events': sourceEvents.map((event) => event.toJson()).toList(),
      'lastStudy': selectedQuestion == null
          ? {
              'category_id': selectedCategoryId,
              'last_question_id': null,
              'workspace_page': workspacePage,
              'review_filter': reviewFilter.name,
              'review_sort': reviewSort.name,
              'canvas_open': false,
              'updated_at': DateTime.now().toIso8601String(),
            }
          : {
              'category_id': selectedCategoryId,
              'category_name': displayPath(selectedQuestion!),
              'last_question_id': selectedQuestionId,
              'workspace_page': workspacePage,
              'review_filter': reviewFilter.name,
              'review_sort': reviewSort.name,
              'canvas_open': canvasOpen,
              'updated_at': DateTime.now().toIso8601String(),
            },
    };
  }

  Future<SyncImportResult> importSyncJson(String source) async {
    final root = decodeObject(source);
    final changes = <int, _SyncStateChange>{};
    final incomingEvents = <StudyEvent>[];
    final sourceStates = root['question_states'];
    if (sourceStates is Map) {
      final rawStates = sourceStates['states'];
      if (rawStates is! List) {
        throw const FormatException('源站同步文件缺少 question_states.states');
      }
      for (final raw in rawStates) {
        if (raw is! Map) throw const FormatException('题目状态格式错误');
        final questionId = _requiredInt(raw['question_id'], 'question_id');
        final userState = raw['user_state'];
        if (userState is! Map) {
          throw FormatException('题目 $questionId 缺少 user_state');
        }
        final hasMastery = userState.containsKey('mastery');
        final hasFavorite = userState.containsKey('favorited_at') ||
            userState.containsKey('favorite');
        changes[questionId] = _SyncStateChange(
          questionId: questionId,
          hasMastery: hasMastery,
          mastery: hasMastery
              ? _requiredMastery(userState['mastery'], questionId)
              : Mastery.notStarted,
          hasFavorite: hasFavorite,
          favorite: userState.containsKey('favorite')
              ? _requiredBool(userState['favorite'], 'favorite')
              : userState['favorited_at'] != null,
          updatedAt: userState['updated_at'] as String?,
        );
      }
      final practiceEvents = root['practice_events'];
      if (practiceEvents is Map && practiceEvents.containsKey('items')) {
        _readSyncEvents(
          practiceEvents['items'],
          incomingEvents,
          sourceStyle: true,
        );
      }
    } else if (root['states'] is Map) {
      final rawStates = root['states'] as Map;
      for (final entry in rawStates.entries) {
        final questionId = int.tryParse(entry.key.toString());
        if (questionId == null || entry.value is! Map) {
          throw const FormatException('同步状态题目 ID 或内容格式错误');
        }
        final state = entry.value as Map;
        final hasMastery = state.containsKey('mastery');
        final hasFavorite = state.containsKey('favorite');
        changes[questionId] = _SyncStateChange(
          questionId: questionId,
          hasMastery: hasMastery,
          mastery: hasMastery
              ? _requiredMastery(state['mastery'], questionId)
              : Mastery.notStarted,
          hasFavorite: hasFavorite,
          favorite: hasFavorite
              ? _requiredBool(state['favorite'], 'favorite')
              : false,
          updatedAt: state['updatedAt'] as String?,
          practiceQueuedAt: state['practiceQueuedAt'] as String?,
          reviewAddedAt: state['reviewAddedAt'] as String?,
          reviewOrigin: state['reviewOrigin'] is Map
              ? CollectionOrigin.fromJson(
                  Map<String, dynamic>.from(state['reviewOrigin'] as Map),
                )
              : null,
        );
      }
      if (root.containsKey('events')) {
        _readSyncEvents(root['events'], incomingEvents, sourceStyle: false);
      }
    } else {
      throw const FormatException('未找到可导入的题目状态');
    }

    final knownQuestionIds = questions.map((question) => question.id).toSet();
    final unknownQuestionIds = <int>{};
    final nextStates = {
      for (final entry in states.entries)
        entry.key: QuestionState.fromJson(entry.value.toJson()),
    };
    final latestPracticeEvent = <int, StudyEvent>{};
    for (final event in incomingEvents) {
      if (event.action != 'answer_wrong' &&
          event.action != 'needs_practice_mark') {
        continue;
      }
      final createdAt = _date(event.createdAt);
      if (createdAt == null) continue;
      final previous = latestPracticeEvent[event.questionId];
      if (previous == null ||
          createdAt.isAfter(_date(previous.createdAt)!)) {
        latestPracticeEvent[event.questionId] = event;
      }
    }
    var updatedQuestions = 0;
    final importedAt = _clock();
    final now = importedAt.toIso8601String();
    for (final change in changes.values) {
      if (!knownQuestionIds.contains(change.questionId)) {
        unknownQuestionIds.add(change.questionId);
        continue;
      }
      final state = nextStates.putIfAbsent(
        change.questionId,
        QuestionState.new,
      );
      var changed = false;
      if (change.hasMastery) {
        final oldMastery = state.mastery;
        final oldQueuedAt = state.practiceQueuedAt;
        final oldReviewAddedAt = state.reviewAddedAt;
        state.mastery = change.mastery;
        switch (change.mastery) {
          case Mastery.needsPractice:
            final practiceEvent = latestPracticeEvent[change.questionId];
            final reliableQueuedAt = _date(change.practiceQueuedAt) ??
                _date(practiceEvent?.createdAt);
            state
              ..practiceQueuedAt = reliableQueuedAt?.toIso8601String()
              ..reviewAddedAt = reliableQueuedAt == null
                  ? change.reviewAddedAt ?? now
                  : reliableQueuedAt
                      .add(recentPracticeDuration)
                      .toIso8601String()
              ..reviewOrigin = change.reviewOrigin ??
                  (practiceEvent == null ||
                          practiceEvent.categoryName.trim().isEmpty
                      ? null
                      : CollectionOrigin(
                          categoryId: practiceEvent.categoryId,
                          categoryPath: practiceEvent.categoryName,
                          position: practiceEvent.serial,
                        ));
          case Mastery.notKnown:
            state
              ..practiceQueuedAt = null
              ..reviewAddedAt = change.reviewAddedAt ?? now
              ..reviewOrigin = change.reviewOrigin;
          case Mastery.notStarted || Mastery.mastered:
            _clearReviewPlacement(state);
        }
        changed = oldMastery != state.mastery ||
            oldQueuedAt != state.practiceQueuedAt ||
            oldReviewAddedAt != state.reviewAddedAt;
      }
      if (change.hasFavorite && state.favorite != change.favorite) {
        state.favorite = change.favorite;
        state.favoriteOrigin = null;
        changed = true;
      }
      if (changed) {
        state.updatedAt = change.updatedAt ?? now;
        updatedQuestions += 1;
      }
    }

    final nextEvents = <String, StudyEvent>{
      for (final event in events) event.id: event,
    };
    var importedEvents = 0;
    for (final event in incomingEvents) {
      if (!knownQuestionIds.contains(event.questionId)) {
        unknownQuestionIds.add(event.questionId);
        continue;
      }
      if (!nextEvents.containsKey(event.id)) importedEvents += 1;
      nextEvents[event.id] = event;
    }
    final mergedEvents = nextEvents.values.toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

    await storage.save(
      exportValue(stateValues: nextStates, eventValues: mergedEvents),
    );
    states
      ..clear()
      ..addAll(nextStates);
    events
      ..clear()
      ..addAll(mergedEvents);
    notifyListeners();
    return SyncImportResult(
      updatedQuestions: updatedQuestions,
      importedEvents: importedEvents,
      ignoredQuestionIds: unknownQuestionIds.length,
    );
  }

  void _readSyncEvents(
    Object? rawEvents,
    List<StudyEvent> destination, {
    required bool sourceStyle,
  }) {
    if (rawEvents is! List) throw const FormatException('学习记录格式错误');
    for (final raw in rawEvents) {
      if (raw is! Map) throw const FormatException('学习记录内容格式错误');
      final questionId = _requiredInt(
        raw[sourceStyle ? 'question_id' : 'questionId'],
        'questionId',
      );
      final id = raw['id'];
      if (id == null) throw const FormatException('学习记录缺少 id');
      destination.add(
        StudyEvent.fromJson({
          'id': id.toString(),
          'questionId': questionId,
          'categoryId': raw[sourceStyle ? 'category_id' : 'categoryId'] as int?,
          'action': raw['action'] as String? ?? '',
          'createdAt':
              raw[sourceStyle ? 'created_at' : 'createdAt'] as String? ?? '',
          'categoryName':
              raw[sourceStyle ? 'category_name' : 'categoryName'] as String? ??
                  '',
          'serial':
              raw[sourceStyle ? 'question_serial' : 'serial'] as int? ?? 0,
        }),
      );
    }
  }

  int _requiredInt(Object? value, String field) {
    if (value is int) return value;
    throw FormatException('$field 必须是整数');
  }

  bool _requiredBool(Object? value, String field) {
    if (value is bool) return value;
    throw FormatException('$field 必须是布尔值');
  }

  Mastery _requiredMastery(Object? value, int questionId) {
    if (value is! String ||
        !Mastery.values.any((mastery) => mastery.value == value)) {
      throw FormatException('题目 $questionId 的 mastery 无效');
    }
    return Mastery.values.firstWhere((mastery) => mastery.value == value);
  }

  Future<bool> export() async {
    await _saveNow();
    final value = exportValue();
    final states = value['states'] as Map<String, dynamic>;
    for (final state in states.values.cast<Map<String, dynamic>>()) {
      state.remove('note');
    }
    return storage.export(value);
  }

  void _scheduleSave() {
    if (!storage.isInitialized) return;
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 350), _saveNow);
  }

  @override
  void dispose() {
    _saveTimer?.cancel();
    _practiceTimer?.cancel();
    super.dispose();
  }

  Future<void> _saveNow() => storage.save(exportValue());

  Map<Mastery, int> get masteryCounts => {
        for (final mastery in Mastery.values)
          mastery: questions
              .where(
                (question) =>
                    (states[question.id]?.mastery ?? Mastery.notStarted) ==
                    mastery,
              )
              .length,
      };
}

class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.controller});
  final AppController controller;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  late int page;
  bool navigationCollapsed = false;
  bool questionListCollapsed = false;
  String collectionTitle = '';
  List<Question> collectionQuestions = const [];
  int? questionReturnPage;
  final scaffoldKey = GlobalKey<ScaffoldState>();

  @override
  void initState() {
    super.initState();
    page = widget.controller.workspacePage;
  }

  void _selectPage(int value) {
    questionReturnPage = null;
    if (widget.controller.selectedQuestionId != null) {
      widget.controller.clearSelectedQuestion();
    } else {
      widget.controller.clearQuestionNavigationContext();
    }
    widget.controller.setWorkspacePage(value);
    setState(() => page = value);
    scaffoldKey.currentState?.closeDrawer();
  }

  void _selectCategory(int? categoryId) {
    questionReturnPage = null;
    widget.controller.chooseCategory(categoryId);
    widget.controller.setWorkspacePage(0);
    if (page != 0) {
      setState(() => page = 0);
    }
  }

  void _openQuestion(Question question) {
    questionReturnPage = null;
    widget.controller.openLibraryQuestion(question);
    widget.controller.setWorkspacePage(0);
    setState(() => page = 0);
    scaffoldKey.currentState
      ?..closeDrawer()
      ..closeEndDrawer();
  }

  void _openOrigin(Question question, CollectionOrigin origin) {
    questionReturnPage = null;
    widget.controller.openQuestionAtOrigin(question, origin);
    widget.controller.setWorkspacePage(0);
    setState(() => page = 0);
    scaffoldKey.currentState
      ?..closeDrawer()
      ..closeEndDrawer();
  }

  void _openBookQuestion(
    Question question,
    List<Question> questions,
    int sourcePage,
  ) {
    questionReturnPage = sourcePage;
    widget.controller.openQuestion(
      question,
      navigationQuestions: questions,
      navigationTitle: sourcePage == 6 ? collectionTitle : null,
    );
    widget.controller.setWorkspacePage(0);
    setState(() => page = 0);
    scaffoldKey.currentState
      ?..closeDrawer()
      ..closeEndDrawer();
  }

  void _openCollection(String title, List<Question> questions) {
    setState(() {
      collectionTitle = title;
      collectionQuestions = questions;
      page = 6;
    });
  }

  void _handleAppBack() {
    final scaffold = scaffoldKey.currentState;
    if (scaffold?.isDrawerOpen ?? false) {
      scaffold!.closeDrawer();
      return;
    }
    if (scaffold?.isEndDrawerOpen ?? false) {
      scaffold!.closeEndDrawer();
      return;
    }
    if (page == 6) {
      setState(() => page = 5);
      return;
    }
    if (widget.controller.selectedQuestionId != null &&
        (page == 1 || page == 2 || page == 3)) {
      widget.controller.clearSelectedQuestion();
      return;
    }
    if (page != 0) {
      widget.controller.setWorkspacePage(0);
      setState(() => page = 0);
      return;
    }
    if (widget.controller.selectedQuestionId != null) {
      final returnPage = questionReturnPage;
      questionReturnPage = null;
      widget.controller.clearSelectedQuestion();
      if (returnPage != null) {
        setState(() => page = returnPage);
      }
      return;
    }
    final selectedCategoryId = widget.controller.selectedCategoryId;
    if (selectedCategoryId != null) {
      widget.controller.chooseCategory(
        widget.controller.parentCategoryIdOf(selectedCategoryId),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final desktop = constraints.maxWidth >= 980;
        final pages = [
          LibraryPage(
            controller: widget.controller,
            categoryInSidebar: desktop,
            showQuestionList: desktop ? !questionListCollapsed : true,
            onQuestionSelected: _openQuestion,
          ),
          FavoritesPage(
            controller: widget.controller,
            onOpenOrigin: _openOrigin,
          ),
          RecentPracticePage(
            controller: widget.controller,
            onOpenOrigin: _openOrigin,
          ),
          ReviewBookPage(
            controller: widget.controller,
            onOpenOrigin: _openOrigin,
          ),
          HistoryPage(
            controller: widget.controller,
            onOpenQuestion: _openQuestion,
          ),
          ExportPage(
            controller: widget.controller,
            onOpenCollection: _openCollection,
            onOpenFavorites: () => _selectPage(1),
            onOpenRecentPractice: () => _selectPage(2),
            onOpenHistory: () => _selectPage(4),
            onResetComplete: () => setState(() => page = 0),
          ),
          QuestionCollectionPage(
            controller: widget.controller,
            title: collectionTitle,
            questions: collectionQuestions,
            onOpenQuestion: (question) =>
                _openBookQuestion(question, collectionQuestions, 5),
          ),
        ];
        final canLeaveApp = page == 0 &&
            widget.controller.selectedQuestionId == null &&
            widget.controller.selectedCategoryId == null;
        return PopScope<Object?>(
          canPop: canLeaveApp,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) _handleAppBack();
          },
          child: Scaffold(
            key: scaffoldKey,
            drawer: desktop
                ? null
                : Drawer(
                    width: constraints.maxWidth.clamp(300.0, 340.0),
                    shape: const RoundedRectangleBorder(),
                    child: SafeArea(
                      child: WebStyleSidebar(
                        controller: widget.controller,
                        selectedPage: page,
                        onSelectPage: _selectPage,
                        onSelectCategory: _selectCategory,
                        compact: false,
                      ),
                    ),
                  ),
            endDrawer: desktop || page != 0
                ? null
                : Drawer(
                    width: constraints.maxWidth.clamp(300.0, 380.0),
                    shape: const RoundedRectangleBorder(),
                    child: SafeArea(
                      child: Padding(
                        padding: const EdgeInsets.all(10),
                        child: QuestionList(
                          controller: widget.controller,
                          showCategoryButton: true,
                          onQuestionSelected: _openQuestion,
                        ),
                      ),
                    ),
                  ),
            body: SafeArea(
              bottom: false,
              child: Row(
                children: [
                  if (desktop)
                    SizedBox(
                      width: navigationCollapsed ? 72 : 250,
                      child: WebStyleSidebar(
                        controller: widget.controller,
                        selectedPage: page,
                        onSelectPage: _selectPage,
                        onSelectCategory: _selectCategory,
                        compact: navigationCollapsed,
                      ),
                    ),
                  Expanded(
                    child: Column(
                      children: [
                        WebStyleHeader(
                          controller: widget.controller,
                          page: page,
                          customTitle: page == 6 ? collectionTitle : null,
                          desktop: desktop,
                          navigationCollapsed: navigationCollapsed,
                          questionListCollapsed: questionListCollapsed,
                          showQuestionListButton: page == 0,
                          onToggleNavigation: desktop
                              ? () => setState(
                                    () => navigationCollapsed =
                                        !navigationCollapsed,
                                  )
                              : () => scaffoldKey.currentState?.openDrawer(),
                          onToggleQuestionList: desktop
                              ? () => setState(
                                    () => questionListCollapsed =
                                        !questionListCollapsed,
                                  )
                              : () => scaffoldKey.currentState?.openEndDrawer(),
                          onOpenData: () => _selectPage(5),
                        ),
                        Expanded(
                          child: ColoredBox(
                            color: AppColors.canvas,
                            child: Padding(
                              padding: EdgeInsets.all(desktop ? 14 : 10),
                              child: pages[page],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class WebStyleSidebar extends StatelessWidget {
  const WebStyleSidebar({
    super.key,
    required this.controller,
    required this.selectedPage,
    required this.onSelectPage,
    required this.onSelectCategory,
    required this.compact,
  });

  final AppController controller;
  final int selectedPage;
  final ValueChanged<int> onSelectPage;
  final ValueChanged<int?> onSelectCategory;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(right: BorderSide(color: AppColors.borderLight)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            height: 64,
            padding: EdgeInsets.symmetric(horizontal: compact ? 18 : 16),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppColors.borderLight)),
            ),
            child: Row(
              children: [
                const DecoratedBox(
                  decoration: BoxDecoration(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.all(Radius.circular(10)),
                  ),
                  child: SizedBox(
                    width: 34,
                    height: 34,
                    child: Icon(
                      Icons.auto_stories_rounded,
                      size: 19,
                      color: Colors.white,
                    ),
                  ),
                ),
                if (!compact) ...[
                  const SizedBox(width: 11),
                  const Text(
                    '大观园',
                    style: TextStyle(
                      color: AppColors.ink,
                      fontSize: 21,
                      height: 1,
                      fontWeight: FontWeight.w800,
                      letterSpacing: .2,
                    ),
                  ),
                ],
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 14, 10, 8),
            child: Column(
              children: [
                _SidebarDestination(
                  icon: Icons.home_outlined,
                  selectedIcon: Icons.home_rounded,
                  label: '题库首页',
                  selected: selectedPage == 0,
                  onTap: () => onSelectPage(0),
                  compact: compact,
                ),
                _SidebarDestination(
                  icon: Icons.star_border_rounded,
                  selectedIcon: Icons.star_rounded,
                  label: '收藏本',
                  selected: selectedPage == 1,
                  onTap: () => onSelectPage(1),
                  compact: compact,
                ),
                _SidebarDestination(
                  icon: Icons.schedule_outlined,
                  selectedIcon: Icons.schedule_rounded,
                  label: '近期复习',
                  badge: controller.recentPracticeCount,
                  selected: selectedPage == 2,
                  onTap: () => onSelectPage(2),
                  compact: compact,
                ),
                _SidebarDestination(
                  icon: Icons.fact_check_outlined,
                  selectedIcon: Icons.fact_check_rounded,
                  label: '复习本',
                  selected: selectedPage == 3,
                  onTap: () => onSelectPage(3),
                  compact: compact,
                ),
                _SidebarDestination(
                  icon: Icons.history_rounded,
                  selectedIcon: Icons.history_rounded,
                  label: '学习记录',
                  selected: selectedPage == 4,
                  onTap: () => onSelectPage(4),
                  compact: compact,
                ),
                _SidebarDestination(
                  icon: Icons.save_alt_rounded,
                  selectedIcon: Icons.save_rounded,
                  label: '数据备份',
                  selected: selectedPage == 5,
                  onTap: () => onSelectPage(5),
                  compact: compact,
                ),
              ],
            ),
          ),
          if (!compact) ...[
            const Divider(height: 1, color: AppColors.borderLight),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 14, 8),
              child: Row(
                children: [
                  const Expanded(
                    child: Text(
                      '章节目录',
                      style: TextStyle(
                        color: AppColors.ink,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  if (controller.selectedCategoryId != null)
                    Text(
                      '${controller.visibleQuestions.length} 题',
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 11,
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: SegmentedButton<bool>(
                showSelectedIcon: false,
                style: ButtonStyle(
                  visualDensity: VisualDensity.compact,
                  side: WidgetStateProperty.all(
                    const BorderSide(color: AppColors.border),
                  ),
                ),
                segments: const [
                  ButtonSegment(value: false, label: Text('完整')),
                  ButtonSegment(value: true, label: Text('核心')),
                ],
                selected: {controller.coreOnly},
                onSelectionChanged: (value) =>
                    controller.setCoreOnly(value.first),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                children: [
                  _CategoryTreeTile(
                    label: '全部题目',
                    icon: Icons.all_inbox_outlined,
                    selected: controller.selectedCategoryId == null,
                    onTap: () {
                      onSelectCategory(null);
                      Scaffold.maybeOf(context)?.closeDrawer();
                    },
                  ),
                  for (final root in controller.rootCategories) ...[
                    _CategoryTreeTile(
                      label: root.name,
                      icon: Icons.menu_book_outlined,
                      selected: controller.selectedCategoryId == root.id,
                      active: controller.rootCategoryIdOf(
                            controller.selectedCategoryId,
                          ) ==
                          root.id,
                      expandable:
                          controller.childCategoriesOf(root.id).isNotEmpty,
                      expanded: controller.rootCategoryIdOf(
                            controller.selectedCategoryId,
                          ) ==
                          root.id,
                      onTap: () => onSelectCategory(
                        controller.rootCategoryIdOf(
                                  controller.selectedCategoryId,
                                ) ==
                                root.id
                            ? null
                            : root.id,
                      ),
                    ),
                    if (controller.rootCategoryIdOf(
                          controller.selectedCategoryId,
                        ) ==
                        root.id)
                      for (final major in controller.childCategoriesOf(
                        root.id,
                      )) ...[
                        _CategoryTreeTile(
                          label: major.name,
                          icon: Icons.folder_outlined,
                          level: 1,
                          selected: controller.selectedCategoryId == major.id,
                          active: controller.categoryContains(
                            major.id,
                            controller.selectedCategoryId,
                          ),
                          expandable:
                              controller.childCategoriesOf(major.id).isNotEmpty,
                          expanded: controller.categoryContains(
                            major.id,
                            controller.selectedCategoryId,
                          ),
                          onTap: () => onSelectCategory(
                            controller.categoryContains(
                              major.id,
                              controller.selectedCategoryId,
                            )
                                ? root.id
                                : major.id,
                          ),
                        ),
                        if (controller.categoryContains(
                          major.id,
                          controller.selectedCategoryId,
                        ))
                          for (final minor in controller.childCategoriesOf(
                            major.id,
                          ))
                            _CategoryTreeTile(
                              label: minor.name,
                              icon: Icons.circle,
                              level: 2,
                              selected:
                                  controller.selectedCategoryId == minor.id,
                              active: controller.categoryContains(
                                minor.id,
                                controller.selectedCategoryId,
                              ),
                              onTap: () {
                                onSelectCategory(minor.id);
                                Scaffold.maybeOf(context)?.closeDrawer();
                              },
                            ),
                      ],
                  ],
                ],
              ),
            ),
          ] else
            const Spacer(),
        ],
      ),
    );
  }
}

class _SidebarDestination extends StatelessWidget {
  const _SidebarDestination({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    required this.selected,
    required this.onTap,
    required this.compact,
    this.badge,
  });

  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final bool compact;
  final int? badge;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Tooltip(
        message: compact ? label : '',
        child: Material(
          color: selected ? AppColors.primarySoft : Colors.transparent,
          borderRadius: BorderRadius.circular(9),
          child: InkWell(
            borderRadius: BorderRadius.circular(9),
            onTap: onTap,
            child: Container(
              height: 43,
              padding: EdgeInsets.symmetric(horizontal: compact ? 13 : 12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(9),
                border: Border.all(
                  color: selected
                      ? AppColors.primary.withValues(alpha: .24)
                      : Colors.transparent,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    selected ? selectedIcon : icon,
                    size: 20,
                    color: selected ? AppColors.primary : AppColors.muted,
                  ),
                  if (!compact) ...[
                    const SizedBox(width: 11),
                    Text(
                      label,
                      style: TextStyle(
                        color:
                            selected ? AppColors.primaryDark : AppColors.text,
                        fontSize: 14,
                        fontWeight:
                            selected ? FontWeight.w700 : FontWeight.w600,
                      ),
                    ),
                    if (badge case final value?) ...[
                      const Spacer(),
                      _CountBadge(value: value),
                    ],
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class WebStyleHeader extends StatelessWidget {
  const WebStyleHeader({
    super.key,
    required this.controller,
    required this.page,
    required this.desktop,
    required this.navigationCollapsed,
    required this.questionListCollapsed,
    required this.showQuestionListButton,
    required this.onToggleNavigation,
    required this.onToggleQuestionList,
    required this.onOpenData,
    this.customTitle,
  });

  final AppController controller;
  final int page;
  final bool desktop;
  final bool navigationCollapsed;
  final bool questionListCollapsed;
  final bool showQuestionListButton;
  final VoidCallback onToggleNavigation;
  final VoidCallback onToggleQuestionList;
  final VoidCallback onOpenData;
  final String? customTitle;

  @override
  Widget build(BuildContext context) {
    const titles = ['题库', '收藏本', '近期复习', '复习本', '学习记录', '数据备份'];
    return Container(
      height: 64,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(bottom: BorderSide(color: AppColors.borderLight)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip:
                desktop ? (navigationCollapsed ? '展开主导航' : '收起主导航') : '打开主导航',
            onPressed: onToggleNavigation,
            icon: Icon(
              desktop && !navigationCollapsed
                  ? Icons.menu_open_rounded
                  : Icons.menu_rounded,
            ),
          ),
          if (showQuestionListButton)
            IconButton(
              tooltip:
                  desktop ? (questionListCollapsed ? '展开题单' : '收起题单') : '打开题单',
              onPressed: onToggleQuestionList,
              icon: Icon(
                desktop && !questionListCollapsed
                    ? Icons.view_sidebar_outlined
                    : Icons.format_list_numbered_rounded,
              ),
            ),
          const SizedBox(width: 4),
          Expanded(
            child: Text(
              customTitle ?? titles[page.clamp(0, titles.length - 1)],
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.ink,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 6),
          IconButton(
            tooltip: '导出学习数据',
            onPressed: onOpenData,
            icon: const Icon(Icons.file_download_outlined),
          ),
        ],
      ),
    );
  }
}

class _CategoryTreeTile extends StatelessWidget {
  const _CategoryTreeTile({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
    this.active = false,
    this.expandable = false,
    this.expanded = false,
    this.level = 0,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final bool active;
  final bool expandable;
  final bool expanded;
  final int level;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final emphasized = selected || active;
    return Padding(
      padding: const EdgeInsets.only(bottom: 3),
      child: Material(
        color: selected ? AppColors.primarySoft : Colors.transparent,
        borderRadius: BorderRadius.circular(9),
        child: InkWell(
          borderRadius: BorderRadius.circular(9),
          onTap: onTap,
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              11 + level * 14,
              level == 0 ? 10 : 8,
              8,
              level == 0 ? 10 : 8,
            ),
            child: Row(
              children: [
                Icon(
                  icon,
                  size: level == 2 ? 7 : 17,
                  color: emphasized ? AppColors.primary : AppColors.muted,
                ),
                SizedBox(width: level == 2 ? 12 : 9),
                Expanded(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color:
                          emphasized ? AppColors.primaryDark : AppColors.text,
                      fontSize: level == 0 ? 13 : 12.5,
                      fontWeight:
                          emphasized ? FontWeight.w700 : FontWeight.w600,
                    ),
                  ),
                ),
                if (expandable)
                  Icon(
                    expanded
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    size: 17,
                    color: emphasized ? AppColors.primary : AppColors.muted,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class LibraryPage extends StatelessWidget {
  const LibraryPage({
    super.key,
    required this.controller,
    this.categoryInSidebar = false,
    this.showQuestionList = true,
    this.onQuestionSelected,
  });
  final AppController controller;
  final bool categoryInSidebar;
  final bool showQuestionList;
  final ValueChanged<Question>? onQuestionSelected;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (categoryInSidebar) {
          if (!showQuestionList) {
            return QuestionDetail(controller: controller);
          }
          return Row(
            children: [
              SizedBox(
                width: constraints.maxWidth >= 1200 ? 245 : 220,
                child: QuestionList(
                  controller: controller,
                  showCategoryButton: true,
                  onQuestionSelected: onQuestionSelected,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(child: QuestionDetail(controller: controller)),
            ],
          );
        }
        return controller.selectedQuestion == null
            ? QuestionList(
                controller: controller,
                showCategoryButton: true,
                onQuestionSelected: onQuestionSelected,
              )
            : QuestionDetail(controller: controller);
      },
    );
  }
}

class _CountBadge extends StatelessWidget {
  const _CountBadge({required this.value});

  final int value;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 24),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        '$value',
        textAlign: TextAlign.center,
        style: const TextStyle(
          color: AppColors.muted,
          fontSize: 10,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class QuestionList extends StatelessWidget {
  const QuestionList({
    super.key,
    required this.controller,
    this.showCategoryButton = false,
    this.overrideQuestions,
    this.questionBook,
    this.title,
    this.onQuestionSelected,
  });
  final AppController controller;
  final bool showCategoryButton;
  final List<Question>? overrideQuestions;
  final QuestionBook? questionBook;
  final String? title;
  final ValueChanged<Question>? onQuestionSelected;

  @override
  Widget build(BuildContext context) {
    var questions = overrideQuestions ?? controller.visibleQuestions;
    if (overrideQuestions != null && controller.search.trim().isNotEmpty) {
      final query = controller.search.trim().toLowerCase();
      questions = questions
          .where((question) => question.searchable.contains(query))
          .toList(growable: false);
    }
    final selectedCategoryId = controller.selectedCategoryId;
    final category = selectedCategoryId == null
        ? '全部题目'
        : controller.categoryById[selectedCategoryId]?.name ?? '题目';
    final detailCategories =
        overrideQuestions == null && selectedCategoryId != null
            ? controller.childCategoriesOf(selectedCategoryId)
            : const <Category>[];
    final heading = title ?? category;
    final showQuestionCount =
        overrideQuestions != null || controller.selectedCategoryId != null;
    void openBatchExport() {
      final items = <BatchExportQuestion>[];
      for (var index = 0; index < questions.length; index++) {
        final question = questions[index];
        final origin = questionBook == null
            ? null
            : controller.originFor(question, questionBook!);
        var path = origin?.categoryPath;
        if (path == null || path.isEmpty) {
          if (questionBook != null) {
            path = '来源位置未知';
          } else {
            final selectedId = controller.selectedCategoryId;
            final matchingCategories = question.categoryIds
                .where(
                  (id) =>
                      selectedId == null ||
                      controller.categoryContains(selectedId, id),
                )
                .map((id) => controller.categoryById[id])
                .whereType<Category>()
                .toList(growable: false)
              ..sort(
                (left, right) => left.path.length.compareTo(right.path.length),
              );
            path = matchingCategories.lastOrNull?.path ??
                (selectedId == null
                    ? controller.categoryPath(question)
                    : controller.categoryById[selectedId]?.path) ??
                '未分类';
          }
        }
        items.add(
          BatchExportQuestion(
            question: question,
            categoryPath: path,
            position:
                origin?.position ?? (questionBook == null ? index + 1 : null),
            textNote: controller.stateOf(question.id).note,
          ),
        );
      }
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (context) => BatchExportPage(
            storage: controller.storage,
            title: heading,
            questions: items,
          ),
        ),
      );
    }

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0a0f172a),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: Column(
          children: [
            if (showCategoryButton)
              ListTile(
                contentPadding: const EdgeInsets.fromLTRB(14, 4, 10, 0),
                leading: const Icon(
                  Icons.account_tree_outlined,
                  color: AppColors.primary,
                ),
                title: Text(
                  heading,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                subtitle:
                    showQuestionCount ? Text('${questions.length} 道题') : null,
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      tooltip: '批量导出当前题单',
                      onPressed: questions.isEmpty ? null : openBatchExport,
                      icon: const Icon(Icons.file_download_outlined),
                    ),
                    const Icon(Icons.chevron_right),
                  ],
                ),
                onTap: overrideQuestions != null
                    ? null
                    : () => showModalBottomSheet<void>(
                          context: context,
                          useSafeArea: true,
                          isScrollControlled: true,
                          backgroundColor: AppColors.surface,
                          builder: (sheetContext) => FractionallySizedBox(
                            heightFactor: .9,
                            child: _ChapterPickerSheet(
                              controller: controller,
                              scopeCategoryId: controller.smallChapterIdOf(
                                controller.selectedCategoryId,
                              ),
                            ),
                          ),
                        ),
              ),
            if (showCategoryButton && detailCategories.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 4, 10, 6),
                child: PopupMenuButton<int>(
                  tooltip: '选择具体内容',
                  onSelected: controller.chooseCategory,
                  itemBuilder: (context) => [
                    for (final category in detailCategories)
                      PopupMenuItem<int>(
                        value: category.id,
                        child: Row(
                          children: [
                            const Icon(
                              Icons.subdirectory_arrow_right_rounded,
                              size: 17,
                              color: AppColors.primary,
                            ),
                            const SizedBox(width: 9),
                            Expanded(
                              child: Text(
                                category.name,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                  child: Container(
                    height: 38,
                    padding: const EdgeInsets.symmetric(horizontal: 11),
                    decoration: BoxDecoration(
                      color: AppColors.primarySoft,
                      borderRadius: BorderRadius.circular(9),
                      border: Border.all(color: const Color(0xffbfdbfe)),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.account_tree_outlined,
                          size: 17,
                          color: AppColors.primary,
                        ),
                        const SizedBox(width: 8),
                        const Expanded(
                          child: Text(
                            '选择具体内容',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 12.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        Text(
                          '${detailCategories.length} 项',
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 11,
                          ),
                        ),
                        const SizedBox(width: 2),
                        const Icon(
                          Icons.keyboard_arrow_down_rounded,
                          size: 18,
                          color: AppColors.primary,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            Padding(
              padding: EdgeInsets.fromLTRB(
                10,
                showCategoryButton ? 4 : 10,
                10,
                8,
              ),
              child: SearchBar(
                elevation: WidgetStateProperty.all(0),
                backgroundColor: WidgetStateProperty.all(AppColors.canvas),
                side: WidgetStateProperty.all(
                  const BorderSide(color: AppColors.border),
                ),
                shape: WidgetStateProperty.all(
                  RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(9),
                  ),
                ),
                constraints: const BoxConstraints(minHeight: 40),
                hintText: '搜索题号或年份',
                leading: const Icon(
                  Icons.search_rounded,
                  size: 18,
                  color: AppColors.muted,
                ),
                onChanged: controller.setSearch,
              ),
            ),
            if (!showCategoryButton)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 2, 12, 9),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        heading,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.ink,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    if (showQuestionCount) _CountBadge(value: questions.length),
                    const SizedBox(width: 3),
                    IconButton(
                      tooltip: '批量导出',
                      onPressed: questions.isEmpty ? null : openBatchExport,
                      icon: const Icon(Icons.file_download_outlined, size: 20),
                    ),
                  ],
                ),
              ),
            const Divider(height: 1, color: AppColors.borderLight),
            Expanded(
              child: questions.isEmpty
                  ? const _EmptyQuestionList()
                  : ListView.builder(
                      padding: const EdgeInsets.all(7),
                      itemExtent: 66,
                      itemCount: questions.length,
                      itemBuilder: (context, index) {
                        final question = questions[index];
                        final state = controller.stateOf(question.id);
                        final origin = questionBook == null
                            ? null
                            : controller.originFor(question, questionBook!);
                        final displayPosition =
                            questionBook == null ? index + 1 : origin?.position;
                        final selected =
                            controller.selectedQuestionId == question.id;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 5),
                          child: Material(
                            color: selected
                                ? AppColors.primarySoft
                                : AppColors.surface,
                            borderRadius: BorderRadius.circular(9),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(9),
                              onTap: () {
                                if (onQuestionSelected != null) {
                                  onQuestionSelected!(question);
                                } else {
                                  controller.chooseQuestion(question.id);
                                }
                              },
                              child: Container(
                                padding: const EdgeInsets.fromLTRB(10, 8, 8, 8),
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(9),
                                  border: Border.all(
                                    color: selected
                                        ? AppColors.primary.withValues(
                                            alpha: .3,
                                          )
                                        : AppColors.borderLight,
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    StatusDot(mastery: state.mastery),
                                    const SizedBox(width: 9),
                                    Expanded(
                                      child: Column(
                                        mainAxisAlignment:
                                            MainAxisAlignment.center,
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              _MetaBadge(
                                                text: displayPosition == null
                                                    ? '#—'
                                                    : '#$displayPosition',
                                              ),
                                              const SizedBox(width: 5),
                                              Expanded(
                                                child: Text(
                                                  _sourceLabel(question.source),
                                                  maxLines: 1,
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                  style: TextStyle(
                                                    color: selected
                                                        ? AppColors.primaryDark
                                                        : AppColors.text,
                                                    fontSize: 11.5,
                                                    fontWeight: FontWeight.w600,
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 5),
                                          Text(
                                            questionBook == null
                                                ? question.type ==
                                                        'multiple_choice'
                                                    ? '多选题'
                                                    : question.type ==
                                                            'single_choice'
                                                        ? '选择题'
                                                        : '解答题'
                                                : questionBook ==
                                                        QuestionBook
                                                            .recentPractice
                                                    ? '${controller.recentPracticeCountdown(question)} · '
                                                        '${origin?.categoryPath ?? '来源位置未知'}'
                                                    : origin == null
                                                        ? '${title ?? '题单'} ${index + 1}/${questions.length} · 收录位置未知'
                                                        : '${title ?? '题单'} ${index + 1}/${questions.length} · ${origin.categoryPath}',
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              color: AppColors.muted,
                                              fontSize: 10.5,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    if (state.favorite)
                                      const Padding(
                                        padding: EdgeInsets.only(left: 4),
                                        child: Icon(
                                          Icons.star_rounded,
                                          size: 16,
                                          color: Color(0xfff59e0b),
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChapterPickerSheet extends StatefulWidget {
  const _ChapterPickerSheet({
    required this.controller,
    required this.scopeCategoryId,
  });

  final AppController controller;
  final int? scopeCategoryId;

  @override
  State<_ChapterPickerSheet> createState() => _ChapterPickerSheetState();
}

class _ChapterPickerSheetState extends State<_ChapterPickerSheet> {
  String query = '';

  @override
  Widget build(BuildContext context) {
    final scope = widget.scopeCategoryId == null
        ? null
        : widget.controller.categoryById[widget.scopeCategoryId!];
    final baseChoices = scope == null
        ? widget.controller.rootCategories
        : widget.controller.chapterChoicesFor(scope.id);
    final choices = baseChoices
        .where(
          (category) =>
              query.isEmpty ||
              category.name.toLowerCase().contains(query.toLowerCase()) ||
              category.path.toLowerCase().contains(query.toLowerCase()),
        )
        .toList(growable: false);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 8, 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  scope == null ? '选择学科' : '${scope.name} · 选择具体章节',
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              IconButton(
                tooltip: '关闭',
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 2, 14, 8),
          child: TextField(
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search_rounded),
              hintText: scope == null ? '搜索学科名称' : '只搜索“${scope.name}”下的章节',
            ),
            onChanged: (value) => setState(() => query = value.trim()),
          ),
        ),
        if (scope != null)
          ListTile(
            leading: const Icon(
              Icons.folder_open_outlined,
              color: AppColors.primary,
            ),
            title: Text('全部${scope.name}'),
            subtitle: Text('${scope.totalCount} 道题'),
            onTap: () {
              widget.controller.chooseCategory(scope.id);
              Navigator.pop(context);
            },
          ),
        const Divider(height: 1),
        Expanded(
          child: ListView.separated(
            itemCount: choices.length,
            separatorBuilder: (_, __) => const Divider(
              height: 1,
              indent: 54,
              color: AppColors.borderLight,
            ),
            itemBuilder: (context, index) {
              final category = choices[index];
              return ListTile(
                leading: const Icon(
                  Icons.subdirectory_arrow_right_rounded,
                  color: AppColors.muted,
                ),
                title: Text(category.name),
                subtitle: Text(
                  scope == null
                      ? category.path
                      : category.path.replaceFirst('${scope.path} / ', ''),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: _CountBadge(
                  value: category.directCount > 0
                      ? category.directCount
                      : category.totalCount,
                ),
                selected: widget.controller.selectedCategoryId == category.id,
                onTap: () {
                  widget.controller.chooseCategory(category.id);
                  Navigator.pop(context);
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

class _CanvasNavigationSelection {
  const _CanvasNavigationSelection({required this.question, this.categoryId});

  final Question question;
  final int? categoryId;
}

class _CanvasQuestionPickerSheet extends StatefulWidget {
  const _CanvasQuestionPickerSheet({required this.controller});

  final AppController controller;

  @override
  State<_CanvasQuestionPickerSheet> createState() =>
      _CanvasQuestionPickerSheetState();
}

class _CanvasQuestionPickerSheetState
    extends State<_CanvasQuestionPickerSheet> {
  List<int> selectedPath = [];
  String query = '';

  bool get fixedSequence => widget.controller.fixedNavigationQuestions != null;

  @override
  void initState() {
    super.initState();
    if (fixedSequence) return;
    selectedPath = widget.controller
        .lineageOf(widget.controller.selectedCategoryId)
        .map((category) => category.id)
        .toList();
    selectedPath = _validPath(selectedPath);
    if (selectedPath.isEmpty && widget.controller.rootCategories.isNotEmpty) {
      selectedPath = [widget.controller.rootCategories.first.id];
    }
  }

  List<int> _validPath(List<int> path) {
    final result = <int>[];
    for (final id in path) {
      final choices = result.isEmpty
          ? widget.controller.rootCategories
          : widget.controller.childCategoriesOf(result.last);
      if (!choices.any((category) => category.id == id)) break;
      result.add(id);
    }
    return result;
  }

  void _selectRoot(int? value) {
    if (value == null) return;
    setState(() => selectedPath = [value]);
  }

  void _selectChild(int parentIndex, int? value) {
    if (value == null) return;
    final parentId = selectedPath[parentIndex];
    setState(() {
      selectedPath = selectedPath.take(parentIndex + 1).toList();
      if (value != parentId) selectedPath.add(value);
    });
  }

  String _levelLabel(int index) {
    return switch (index) {
      0 => '学科',
      1 => '大章节',
      2 => '小章节',
      3 => '具体内容',
      _ => '细分类 ${index - 3}',
    };
  }

  List<Widget> _categorySelectors() {
    if (widget.controller.rootCategories.isEmpty) return const [];
    final selectors = <Widget>[
      _categoryDropdown(
        label: _levelLabel(0),
        value: selectedPath.firstOrNull,
        choices: widget.controller.rootCategories,
        onChanged: _selectRoot,
      ),
    ];
    for (var parentIndex = 0;
        parentIndex < selectedPath.length;
        parentIndex++) {
      final parentId = selectedPath[parentIndex];
      final children = widget.controller.childCategoriesOf(parentId);
      if (children.isEmpty) break;
      selectors.add(const SizedBox(height: 8));
      selectors.add(
        _categoryDropdown(
          label: _levelLabel(parentIndex + 1),
          value: selectedPath.length > parentIndex + 1
              ? selectedPath[parentIndex + 1]
              : parentId,
          choices: children,
          allCategory: widget.controller.categoryById[parentId],
          onChanged: (value) => _selectChild(parentIndex, value),
        ),
      );
    }
    return selectors;
  }

  List<Question> get visibleQuestions {
    final base = fixedSequence
        ? widget.controller.fixedNavigationQuestions!
        : selectedPath.isEmpty
            ? const <Question>[]
            : widget.controller.questionsForCategory(selectedPath.last);
    final normalized = query.trim().toLowerCase();
    if (normalized.isEmpty) return base;
    return base
        .where((question) => question.searchable.contains(normalized))
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final questions = visibleQuestions;
    final title =
        fixedSequence ? widget.controller.navigationTitle ?? '当前题单' : '画布内题目导航';
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 8, 8),
          child: Row(
            children: [
              const Icon(Icons.account_tree_outlined, color: AppColors.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              IconButton(
                tooltip: '关闭',
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
        ),
        if (!fixedSequence)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 2, 14, 10),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(context).height * .42,
              ),
              child: SingleChildScrollView(
                child: Column(children: _categorySelectors()),
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 2, 14, 10),
          child: TextField(
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search_rounded),
              hintText: '搜索当前范围内的序号或来源',
            ),
            onChanged: (value) => setState(() => query = value),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  fixedSequence
                      ? '仅显示当前题单'
                      : selectedPath.isEmpty
                          ? '请选择分类'
                          : widget.controller.categoryById[selectedPath.last]
                                  ?.path ??
                              '',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.muted,
                    fontSize: 11.5,
                  ),
                ),
              ),
              _CountBadge(value: questions.length),
            ],
          ),
        ),
        const SizedBox(height: 8),
        const Divider(height: 1),
        Expanded(
          child: questions.isEmpty
              ? const _EmptyQuestionList()
              : ListView.separated(
                  itemCount: questions.length,
                  separatorBuilder: (_, __) => const Divider(
                    height: 1,
                    indent: 58,
                    color: AppColors.borderLight,
                  ),
                  itemBuilder: (context, index) {
                    final question = questions[index];
                    final navigationBook = widget.controller.navigationBook;
                    final displayPosition =
                        fixedSequence && navigationBook != null
                            ? widget.controller
                                .originFor(question, navigationBook)
                                ?.position
                            : index + 1;
                    final selected =
                        widget.controller.selectedQuestionId == question.id;
                    return ListTile(
                      selected: selected,
                      selectedTileColor: AppColors.primarySoft,
                      leading: StatusDot(
                        mastery: widget.controller.stateOf(question.id).mastery,
                      ),
                      title: Text(
                        '${displayPosition == null ? '#—' : '#$displayPosition'} · '
                        '${_sourceLabel(question.source)}',
                        key: ValueKey('canvas-question-choice-${question.id}'),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      trailing: const Icon(Icons.chevron_right_rounded),
                      onTap: () => Navigator.pop(
                        context,
                        _CanvasNavigationSelection(
                          question: question,
                          categoryId:
                              fixedSequence ? null : selectedPath.lastOrNull,
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _categoryDropdown({
    required String label,
    required int? value,
    required List<Category> choices,
    required ValueChanged<int?> onChanged,
    Category? allCategory,
  }) {
    return DropdownButtonFormField<int>(
      key: ValueKey('$label-$value-${choices.length}'),
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: const Icon(
          Icons.subdirectory_arrow_right_rounded,
          color: AppColors.primary,
        ),
      ),
      items: [
        if (allCategory != null)
          DropdownMenuItem(
            value: allCategory.id,
            child: Text(
              '全部（${allCategory.name}）',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        for (final category in choices)
          DropdownMenuItem(
            value: category.id,
            child: Text(
              category.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
      onChanged: choices.isEmpty ? null : onChanged,
    );
  }
}

String _sourceLabel(String source) {
  final normalized = source
      .replaceAll(RegExp(r'^[（(]\s*'), '')
      .replaceAll(RegExp(r'\s*[）)]$'), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return normalized.isEmpty ? '题库题' : normalized;
}

class _EmptyQuestionList extends StatelessWidget {
  const _EmptyQuestionList();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.search_off_rounded, size: 38, color: AppColors.muted),
          SizedBox(height: 10),
          Text('没有找到题目', style: TextStyle(color: AppColors.muted)),
        ],
      ),
    );
  }
}

class QuestionDetail extends StatefulWidget {
  const QuestionDetail({
    super.key,
    required this.controller,
    this.showBack = false,
    this.onOpenOrigin,
  });
  final AppController controller;
  final bool showBack;
  final void Function(Question, CollectionOrigin)? onOpenOrigin;

  @override
  State<QuestionDetail> createState() => _QuestionDetailState();
}

class _QuestionDetailState extends State<QuestionDetail> {
  int noteQuestionId = -1;
  Set<int> pendingOptions = {};
  final scrollController = ScrollController();
  final noteController = TextEditingController();
  bool notePreview = false;

  @override
  void dispose() {
    scrollController.dispose();
    noteController.dispose();
    super.dispose();
  }

  void _copy(String value, String label) {
    Clipboard.setData(ClipboardData(text: value));
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('$label已复制')));
  }

  void _moveQuestion(int offset) {
    widget.controller.selectAdjacent(offset);
    if (scrollController.hasClients) {
      scrollController.jumpTo(0);
    }
  }

  HandwritingQuestionContext? _handwritingContext() {
    final question = widget.controller.selectedQuestion;
    if (question == null) return null;
    final questions = widget.controller.currentQuestionSequence;
    return HandwritingQuestionContext(
      question: question,
      categoryPath: widget.controller.displayPath(question),
      textNote: widget.controller.stateOf(question.id).note,
      displayPosition: widget.controller.displayPosition(question),
      index: widget.controller.selectedQuestionIndex(questions),
      total: questions.length,
      canEnterSequence:
          widget.controller.navigationBook == QuestionBook.recentPractice &&
              widget.controller.selectedQuestionIndex(questions) < 0 &&
              questions.isNotEmpty,
      state: widget.controller.stateOf(question.id),
      correctOptionIndexes: widget.controller.correctOptionIndexes(question),
    );
  }

  Future<HandwritingQuestionContext?> _openCanvasNavigator(
    BuildContext canvasContext,
  ) async {
    final selection = await showModalBottomSheet<_CanvasNavigationSelection>(
      context: canvasContext,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      builder: (context) => FractionallySizedBox(
        heightFactor: .92,
        child: _CanvasQuestionPickerSheet(controller: widget.controller),
      ),
    );
    if (selection == null) return null;
    if (selection.categoryId case final categoryId?) {
      widget.controller.openQuestionInCategory(selection.question, categoryId);
    } else {
      widget.controller.openQuestion(
        selection.question,
        navigationQuestions: widget.controller.fixedNavigationQuestions,
        navigationTitle: widget.controller.navigationTitle,
        navigationBook: widget.controller.navigationBook,
      );
    }
    return _handwritingContext();
  }

  Future<void> _openHandwriting() async {
    final initial = _handwritingContext();
    if (initial == null) return;
    widget.controller.setCanvasOpen(true);
    try {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (context) => HandwritingCanvasSession(
            storage: widget.controller.storage,
            initialContext: initial,
            onNavigate: (offset) {
              widget.controller.selectAdjacent(offset);
              return _handwritingContext();
            },
            onOpenNavigator: _openCanvasNavigator,
            onTextNoteChanged: widget.controller.setNote,
            onToggleFavorite: widget.controller.toggleFavorite,
            onSetMastery: widget.controller.setMastery,
            onSubmitAnswer: widget.controller.submitAnswer,
            onClearAnswer: widget.controller.clearAnswer,
          ),
        ),
      );
    } finally {
      widget.controller.setCanvasOpen(false);
    }
    if (!mounted) return;
    final question = widget.controller.selectedQuestion;
    if (question != null) {
      noteController.text = widget.controller.stateOf(question.id).note;
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final question = widget.controller.selectedQuestion;
    if (question == null) {
      return Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  shape: BoxShape.circle,
                ),
                child: SizedBox(
                  width: 62,
                  height: 62,
                  child: Icon(
                    Icons.touch_app_outlined,
                    size: 30,
                    color: AppColors.primary,
                  ),
                ),
              ),
              SizedBox(height: 16),
              Text(
                '从左侧选择一道题',
                style: TextStyle(
                  color: AppColors.ink,
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
              SizedBox(height: 5),
              Text(
                '题目、答案和笔记会显示在这里',
                style: TextStyle(color: AppColors.muted, fontSize: 12),
              ),
            ],
          ),
        ),
      );
    }
    final state = widget.controller.stateOf(question.id);
    if (widget.controller.takeResumeCanvasRequest()) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_openHandwriting());
      });
    }
    final activeBook = widget.controller.navigationBook;
    final origin = activeBook == null
        ? null
        : widget.controller.originFor(question, activeBook);
    final displayPath = widget.controller.displayPath(question);
    final displayPosition = widget.controller.displayPosition(question);
    if (noteQuestionId != question.id) {
      noteQuestionId = question.id;
      noteController.text = state.note;
      notePreview = false;
      pendingOptions = state.selectedOptions
          .map((letter) => letter.codeUnitAt(0) - 65)
          .where((index) => index >= 0 && index < question.options.length)
          .toSet();
    }
    final questions = widget.controller.currentQuestionSequence;
    final questionIndex = widget.controller.selectedQuestionIndex(questions);
    final canGoBack = questionIndex > 0;
    final canGoForward = (activeBook == QuestionBook.recentPractice &&
            questionIndex < 0 &&
            questions.isNotEmpty) ||
        (questionIndex >= 0 && questionIndex < questions.length - 1);
    final interactiveChoice =
        question.type == 'single_choice' || question.type == 'multiple_choice';
    final correctOptions = widget.controller.correctOptionIndexes(question);
    final submitted = interactiveChoice && state.lastCorrect != null;
    final selectedOptions = submitted
        ? state.selectedOptions
            .map((letter) => letter.codeUnitAt(0) - 65)
            .toSet()
        : pendingOptions;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0a0f172a),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: CustomScrollView(
        controller: scrollController,
        slivers: [
          SliverToBoxAdapter(
            child: Container(
              constraints: const BoxConstraints(minHeight: 68),
              padding: const EdgeInsets.fromLTRB(12, 8, 10, 8),
              decoration: const BoxDecoration(
                color: AppColors.surface,
                border: Border(
                  bottom: BorderSide(color: AppColors.borderLight),
                ),
              ),
              child: Row(
                children: [
                  if (widget.showBack)
                    IconButton(
                      tooltip: '返回题目列表',
                      onPressed: widget.controller.clearSelectedQuestion,
                      icon: const Icon(Icons.arrow_back_rounded),
                    ),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Tooltip(
                          message: origin == null ? '' : '返回收录题单',
                          child: InkWell(
                            onTap: origin == null || widget.onOpenOrigin == null
                                ? null
                                : () => widget.onOpenOrigin!(question, origin),
                            borderRadius: BorderRadius.circular(5),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 2),
                              child: Text(
                                displayPath,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: origin == null
                                      ? AppColors.ink
                                      : AppColors.primary,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                  decoration: origin == null
                                      ? null
                                      : TextDecoration.underline,
                                  decorationColor: AppColors.primary,
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 5),
                        Row(
                          children: [
                            _MetaBadge(
                              text: displayPosition == null
                                  ? '#—'
                                  : '#$displayPosition',
                            ),
                            if (question.source.isNotEmpty) ...[
                              const SizedBox(width: 6),
                              Flexible(
                                child: _MetaBadge(
                                  text: _sourceLabel(question.source),
                                  muted: true,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    key: const ValueKey('open-handwriting-canvas'),
                    tooltip: '打开书写画布',
                    onPressed: _openHandwriting,
                    icon: const Icon(Icons.open_in_full_rounded),
                  ),
                  IconButton(
                    tooltip: '复制完整题目',
                    onPressed: () => _copy(
                      '题目\n${question.stem}\n\n'
                          '答案\n${question.answer}\n\n'
                          '解析\n${question.explanation}',
                      '题目全文',
                    ),
                    icon: const Icon(Icons.content_copy_rounded),
                  ),
                  IconButton(
                    tooltip: state.favorite ? '取消收藏' : '收藏',
                    onPressed: () => widget.controller.toggleFavorite(question),
                    icon: Icon(
                      state.favorite
                          ? Icons.star_rounded
                          : Icons.star_border_rounded,
                      color: state.favorite
                          ? const Color(0xfff59e0b)
                          : AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(24, 22, 24, 34),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                _QuestionNavigator(
                  index: questionIndex,
                  total: questions.length,
                  canGoBack: canGoBack,
                  canGoForward: canGoForward,
                  onBack: () => _moveQuestion(-1),
                  onForward: () => _moveQuestion(1),
                ),
                const SizedBox(height: 20),
                _SectionHeading(
                  title: '题目',
                  onCopy: () => _copy(question.stem, '题目'),
                ),
                const SizedBox(height: 14),
                MathContent(question.stem),
                for (var index = 0; index < question.options.length; index++)
                  _QuestionOption(
                    key: ValueKey('question-option-$index'),
                    label: String.fromCharCode(65 + index),
                    content: question.options[index],
                    scale: 1,
                    selected: selectedOptions.contains(index),
                    correct: submitted && correctOptions.contains(index),
                    wrong: submitted &&
                        selectedOptions.contains(index) &&
                        !correctOptions.contains(index),
                    onTap: !interactiveChoice
                        ? null
                        : () {
                            if (submitted) {
                              if (!selectedOptions.contains(index)) return;
                              final editingOptions = Set<int>.from(
                                selectedOptions,
                              )..remove(index);
                              widget.controller.clearAnswer(question);
                              setState(() => pendingOptions = editingOptions);
                              return;
                            }
                            if (question.type == 'multiple_choice') {
                              setState(() {
                                if (!pendingOptions.add(index)) {
                                  pendingOptions.remove(index);
                                }
                              });
                            } else {
                              widget.controller.submitAnswer(question, {index});
                            }
                          },
                  ),
                if (question.type == 'multiple_choice' && !submitted) ...[
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton.icon(
                      onPressed: pendingOptions.isEmpty
                          ? null
                          : () => widget.controller.submitAnswer(
                                question,
                                pendingOptions,
                              ),
                      icon: const Icon(Icons.check_rounded),
                      label: const Text('提交答案'),
                    ),
                  ),
                ],
                if (submitted) ...[
                  const SizedBox(height: 14),
                  _AnswerFeedback(
                    correct: state.lastCorrect!,
                    onRetry: () {
                      widget.controller.clearAnswer(question);
                      setState(() => pendingOptions = {});
                    },
                  ),
                ],
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.canvas,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final mastery in Mastery.values.skip(1))
                        ChoiceChip(
                          label: Text(mastery.label),
                          selected: state.mastery == mastery,
                          avatar: StatusDot(mastery: mastery),
                          onSelected: (_) =>
                              widget.controller.setMastery(question, mastery),
                        ),
                      if (state.mastery != Mastery.notStarted)
                        TextButton.icon(
                          onPressed: () =>
                              widget.controller.clearMastery(question),
                          icon: const Icon(Icons.remove_circle_outline_rounded),
                          label: const Text('清除状态'),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.border),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: ExpansionTile(
                    key: ValueKey('answer-${question.id}-${state.lastCorrect}'),
                    initiallyExpanded: submitted,
                    backgroundColor: AppColors.surface,
                    collapsedBackgroundColor: AppColors.surface,
                    shape: const Border(),
                    collapsedShape: const Border(),
                    title: const Text(
                      '查看答案与解析',
                      style: TextStyle(
                        color: AppColors.ink,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    leading: const Icon(
                      Icons.lightbulb_outline_rounded,
                      color: AppColors.primary,
                    ),
                    children: [
                      const Divider(height: 1),
                      Padding(
                        padding: const EdgeInsets.all(16),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _SectionHeading(
                                title: '参考答案',
                                onCopy: () => _copy(
                                  question.answer.isEmpty
                                      ? '暂无答案'
                                      : question.answer,
                                  '参考答案',
                                ),
                              ),
                              const SizedBox(height: 10),
                              MathContent(
                                question.answer.isEmpty
                                    ? '暂无答案'
                                    : question.answer,
                              ),
                              const SizedBox(height: 22),
                              _SectionHeading(
                                title: '解析',
                                onCopy: () => _copy(
                                  question.explanation.isEmpty
                                      ? '暂无解析'
                                      : question.explanation,
                                  '解析',
                                ),
                              ),
                              const SizedBox(height: 10),
                              MathContent(
                                question.explanation.isEmpty
                                    ? '暂无解析'
                                    : question.explanation,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.canvas,
                    border: Border.all(color: AppColors.border),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          const Expanded(
                            child: Text(
                              '文字笔记',
                              style: TextStyle(
                                color: AppColors.ink,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          SegmentedButton<bool>(
                            showSelectedIcon: false,
                            style: const ButtonStyle(
                              visualDensity: VisualDensity.compact,
                            ),
                            segments: const [
                              ButtonSegment(value: false, label: Text('编辑')),
                              ButtonSegment(value: true, label: Text('预览')),
                            ],
                            selected: {notePreview},
                            onSelectionChanged: (value) =>
                                setState(() => notePreview = value.first),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      if (notePreview)
                        ConstrainedBox(
                          constraints: const BoxConstraints(minHeight: 110),
                          child: state.note.trim().isEmpty
                              ? const Text(
                                  '还没有文字笔记',
                                  style: TextStyle(color: AppColors.muted),
                                )
                              : MathContent(
                                  state.note,
                                  key: const ValueKey('text-note-preview'),
                                ),
                        )
                      else
                        TextField(
                          key: const ValueKey('text-note-editor'),
                          controller: noteController,
                          minLines: 4,
                          maxLines: 10,
                          decoration: const InputDecoration(
                            hintText:
                                r'记录思路、易错点；公式可写成 $x^2$ 或 $$\int_0^1 x\,dx$$',
                            border: OutlineInputBorder(),
                          ),
                          onChanged: (value) =>
                              widget.controller.setNote(question, value),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                _QuestionNavigator(
                  index: questionIndex,
                  total: questions.length,
                  canGoBack: canGoBack,
                  canGoForward: canGoForward,
                  onBack: () => _moveQuestion(-1),
                  onForward: () => _moveQuestion(1),
                ),
              ]),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.title, this.onCopy});

  final String title;
  final VoidCallback? onCopy;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 4,
          height: 18,
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(99),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            title,
            style: const TextStyle(
              color: AppColors.ink,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        if (onCopy != null)
          IconButton(
            tooltip: '复制$title',
            visualDensity: VisualDensity.compact,
            onPressed: onCopy,
            icon: const Icon(Icons.copy_rounded, size: 17),
          ),
      ],
    );
  }
}

class _QuestionNavigator extends StatelessWidget {
  const _QuestionNavigator({
    required this.index,
    required this.total,
    required this.canGoBack,
    required this.canGoForward,
    required this.onBack,
    required this.onForward,
  });

  final int index;
  final int total;
  final bool canGoBack;
  final bool canGoForward;
  final VoidCallback onBack;
  final VoidCallback onForward;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.canvas,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Row(
        children: [
          OutlinedButton.icon(
            onPressed: canGoBack ? onBack : null,
            icon: const Icon(Icons.chevron_left_rounded),
            label: const Text('上一题'),
          ),
          Expanded(
            child: Text(
              index < 0 ? '— / $total' : '${index + 1} / $total',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.text,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          OutlinedButton.icon(
            onPressed: canGoForward ? onForward : null,
            iconAlignment: IconAlignment.end,
            icon: const Icon(Icons.chevron_right_rounded),
            label: const Text('下一题'),
          ),
        ],
      ),
    );
  }
}

class _AnswerFeedback extends StatelessWidget {
  const _AnswerFeedback({required this.correct, required this.onRetry});

  final bool correct;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final color = correct ? const Color(0xff16a34a) : const Color(0xffdc2626);
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: .22)),
      ),
      child: Row(
        children: [
          Icon(
            correct ? Icons.check_circle_rounded : Icons.cancel_rounded,
            color: color,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              correct ? '回答正确，已标记为已掌握' : '回答错误，已标记为需练习',
              style: TextStyle(color: color, fontWeight: FontWeight.w700),
            ),
          ),
          TextButton(onPressed: onRetry, child: const Text('开始重做')),
        ],
      ),
    );
  }
}

class _MetaBadge extends StatelessWidget {
  const _MetaBadge({required this.text, this.muted = false});

  final String text;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 230),
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: muted ? AppColors.surfaceMuted : AppColors.primarySoft,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: muted ? AppColors.muted : AppColors.primaryDark,
          fontSize: 10.5,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _QuestionOption extends StatelessWidget {
  const _QuestionOption({
    super.key,
    required this.label,
    required this.content,
    required this.scale,
    required this.selected,
    required this.correct,
    required this.wrong,
    this.onTap,
  });

  final String label;
  final String content;
  final double scale;
  final bool selected;
  final bool correct;
  final bool wrong;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color = correct
        ? const Color(0xff16a34a)
        : wrong
            ? const Color(0xffdc2626)
            : selected
                ? AppColors.primary
                : AppColors.border;
    final background = correct || wrong || selected
        ? color.withValues(alpha: .07)
        : AppColors.surface;
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Material(
        color: background,
        borderRadius: BorderRadius.circular(10),
        child: _ReliableTap(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.fromLTRB(12, 10, 14, 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: color),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 28,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: selected || correct || wrong
                        ? color
                        : AppColors.primarySoft,
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    label,
                    style: TextStyle(
                      color: selected || correct || wrong
                          ? Colors.white
                          : AppColors.primaryDark,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(child: MathContent(content, scale: scale)),
                if (correct)
                  const Icon(
                    Icons.check_circle_rounded,
                    color: Color(0xff16a34a),
                  )
                else if (wrong)
                  const Icon(Icons.cancel_rounded, color: Color(0xffdc2626)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ReliableTap extends StatefulWidget {
  const _ReliableTap({
    required this.child,
    required this.onTap,
    required this.borderRadius,
  });

  final Widget child;
  final VoidCallback? onTap;
  final BorderRadius borderRadius;

  @override
  State<_ReliableTap> createState() => _ReliableTapState();
}

class _ReliableTapState extends State<_ReliableTap> {
  final pointerStarts = <int, Offset>{};
  final cancelledPointers = <int>{};
  bool pressed = false;

  void _down(PointerDownEvent event) {
    if (widget.onTap == null) return;
    pointerStarts[event.pointer] = event.localPosition;
    if (pointerStarts.length > 1) {
      cancelledPointers.addAll(pointerStarts.keys);
    }
    if (!pressed) setState(() => pressed = true);
  }

  void _move(PointerMoveEvent event) {
    final start = pointerStarts[event.pointer];
    if (start == null) return;
    if ((event.localPosition - start).distance > 14) {
      cancelledPointers.add(event.pointer);
      if (pressed) setState(() => pressed = false);
    }
  }

  void _end(PointerEvent event) {
    final start = pointerStarts.remove(event.pointer);
    final shouldTap = start != null &&
        !cancelledPointers.remove(event.pointer) &&
        (event.localPosition - start).distance <= 14;
    if (pointerStarts.isEmpty && pressed) {
      setState(() => pressed = false);
    }
    if (shouldTap) widget.onTap?.call();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: widget.onTap != null,
      enabled: widget.onTap != null,
      onTap: widget.onTap,
      child: MouseRegion(
        cursor:
            widget.onTap == null ? MouseCursor.defer : SystemMouseCursors.click,
        child: Listener(
          behavior: HitTestBehavior.opaque,
          onPointerDown: _down,
          onPointerMove: _move,
          onPointerUp: _end,
          onPointerCancel: _end,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 80),
            decoration: BoxDecoration(
              color: pressed
                  ? AppColors.primary.withValues(alpha: .06)
                  : Colors.transparent,
              borderRadius: widget.borderRadius,
            ),
            child: widget.child,
          ),
        ),
      ),
    );
  }
}

class QuestionImageGallery extends StatelessWidget {
  const QuestionImageGallery({super.key, required this.assetReferences});

  final List<String> assetReferences;

  @override
  Widget build(BuildContext context) {
    if (assetReferences.isEmpty) return const SizedBox.shrink();
    return MathContent(
      assetReferences.map((reference) => '![]($reference)').join('\n\n'),
      selectable: false,
    );
  }
}

class FavoritesPage extends StatelessWidget {
  const FavoritesPage({
    super.key,
    required this.controller,
    required this.onOpenOrigin,
  });

  final AppController controller;
  final void Function(Question, CollectionOrigin) onOpenOrigin;

  @override
  Widget build(BuildContext context) {
    final favorites = controller.favoriteQuestions;
    return _QuestionBookWorkspace(
      controller: controller,
      questions: favorites,
      questionBook: QuestionBook.favorite,
      title: '收藏题目',
      emptyIcon: Icons.star_border_rounded,
      emptyTitle: '还没有收藏题目',
      emptyMessage: '在题目右上角点一下星标，之后可以在这里快速找到。',
      onOpenOrigin: onOpenOrigin,
    );
  }
}

class RecentPracticePage extends StatelessWidget {
  const RecentPracticePage({
    super.key,
    required this.controller,
    required this.onOpenOrigin,
  });

  final AppController controller;
  final void Function(Question, CollectionOrigin) onOpenOrigin;

  @override
  Widget build(BuildContext context) => _QuestionBookWorkspace(
        controller: controller,
        questions: controller.recentPracticeQuestions,
        questionBook: QuestionBook.recentPractice,
        title: '近期复习',
        emptyIcon: Icons.schedule_outlined,
        emptyTitle: '最近没有需要集中练习的题目',
        emptyMessage: '答错或标记为“需练习”的题目，会在这里保留 48 小时。',
        onOpenOrigin: onOpenOrigin,
      );
}

class ReviewBookPage extends StatelessWidget {
  const ReviewBookPage({
    super.key,
    required this.controller,
    required this.onOpenOrigin,
  });

  final AppController controller;
  final void Function(Question, CollectionOrigin) onOpenOrigin;

  @override
  Widget build(BuildContext context) {
    final questions = controller.filteredReviewQuestions;
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: SegmentedButton<ReviewFilter>(
                  showSelectedIcon: false,
                  segments: [
                    ButtonSegment(
                      value: ReviewFilter.all,
                      label: Text(
                        '全部 ${controller.reviewCount(ReviewFilter.all)}',
                      ),
                    ),
                    ButtonSegment(
                      value: ReviewFilter.needsPractice,
                      label: Text(
                        '需练习 ${controller.reviewCount(ReviewFilter.needsPractice)}',
                      ),
                    ),
                    ButtonSegment(
                      value: ReviewFilter.notKnown,
                      label: Text(
                        '完全不会 ${controller.reviewCount(ReviewFilter.notKnown)}',
                      ),
                    ),
                  ],
                  selected: {controller.reviewFilter},
                  onSelectionChanged: (value) =>
                      controller.setReviewFilter(value.first),
                ),
              ),
            ),
            const SizedBox(width: 8),
            SegmentedButton<ReviewSort>(
              showSelectedIcon: false,
              segments: const [
                ButtonSegment(
                  value: ReviewSort.ascending,
                  icon: Icon(Icons.arrow_upward_rounded, size: 17),
                  tooltip: '加入时间正序',
                ),
                ButtonSegment(
                  value: ReviewSort.descending,
                  icon: Icon(Icons.arrow_downward_rounded, size: 17),
                  tooltip: '加入时间倒序',
                ),
              ],
              selected: {controller.reviewSort},
              onSelectionChanged: (value) =>
                  controller.setReviewSort(value.first),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Expanded(
          child: _QuestionBookWorkspace(
            controller: controller,
            questions: questions,
            questionBook: QuestionBook.review,
            title: '复习题目',
            emptyIcon: Icons.fact_check_outlined,
            emptyTitle: '当前分类还没有题目',
            emptyMessage: '“完全不会”和超过 48 小时的“需练习”会集中在这里。',
            onOpenOrigin: onOpenOrigin,
          ),
        ),
      ],
    );
  }
}

class _QuestionBookWorkspace extends StatelessWidget {
  const _QuestionBookWorkspace({
    required this.controller,
    required this.questions,
    required this.questionBook,
    required this.title,
    required this.emptyIcon,
    required this.emptyTitle,
    required this.emptyMessage,
    required this.onOpenOrigin,
  });

  final AppController controller;
  final List<Question> questions;
  final QuestionBook questionBook;
  final String title;
  final IconData emptyIcon;
  final String emptyTitle;
  final String emptyMessage;
  final void Function(Question, CollectionOrigin) onOpenOrigin;

  @override
  Widget build(BuildContext context) {
    if (questions.isEmpty && controller.selectedQuestion == null) {
      return _PageEmptyState(
        icon: emptyIcon,
        title: emptyTitle,
        message: emptyMessage,
      );
    }
    void openQuestion(Question question) => controller.openQuestion(
          question,
          navigationQuestions: questions,
          navigationTitle: title,
          navigationBook: questionBook,
        );
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 700) {
          return Row(
            children: [
              SizedBox(
                width: constraints.maxWidth >= 1100 ? 310 : 270,
                child: QuestionList(
                  controller: controller,
                  overrideQuestions: questions,
                  questionBook: questionBook,
                  title: title,
                  onQuestionSelected: openQuestion,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: QuestionDetail(
                  controller: controller,
                  onOpenOrigin: onOpenOrigin,
                ),
              ),
            ],
          );
        }
        return controller.selectedQuestion == null
            ? QuestionList(
                controller: controller,
                overrideQuestions: questions,
                questionBook: questionBook,
                title: title,
                onQuestionSelected: openQuestion,
              )
            : QuestionDetail(
                controller: controller,
                showBack: true,
                onOpenOrigin: onOpenOrigin,
              );
      },
    );
  }
}

class QuestionCollectionPage extends StatelessWidget {
  const QuestionCollectionPage({
    super.key,
    required this.controller,
    required this.title,
    required this.questions,
    required this.onOpenQuestion,
  });

  final AppController controller;
  final String title;
  final List<Question> questions;
  final ValueChanged<Question> onOpenQuestion;

  @override
  Widget build(BuildContext context) {
    return QuestionList(
      controller: controller,
      overrideQuestions: questions,
      title: title,
      onQuestionSelected: onOpenQuestion,
    );
  }
}

class HistoryPage extends StatelessWidget {
  const HistoryPage({
    super.key,
    required this.controller,
    required this.onOpenQuestion,
  });

  final AppController controller;
  final ValueChanged<Question> onOpenQuestion;

  @override
  Widget build(BuildContext context) {
    if (controller.events.isEmpty) {
      return const _PageEmptyState(
        icon: Icons.history_rounded,
        title: '还没有学习记录',
        message: '给题目标记掌握程度后，变化会按时间保存在这里。',
      );
    }
    return Align(
      alignment: Alignment.topCenter,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 940),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: AppColors.ink.withValues(alpha: .035),
              blurRadius: 16,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            Container(
              height: 54,
              padding: const EdgeInsets.symmetric(horizontal: 18),
              decoration: const BoxDecoration(
                border: Border(
                  bottom: BorderSide(color: AppColors.borderLight),
                ),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.history_rounded,
                    size: 19,
                    color: AppColors.primary,
                  ),
                  const SizedBox(width: 9),
                  const Expanded(
                    child: Text(
                      '最近学习动态',
                      style: TextStyle(
                        color: AppColors.ink,
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  _CountBadge(value: controller.events.length),
                ],
              ),
            ),
            Expanded(
              child: ListView.separated(
                itemCount: controller.events.length,
                separatorBuilder: (_, __) => const Divider(
                  height: 1,
                  indent: 64,
                  color: AppColors.borderLight,
                ),
                itemBuilder: (context, index) {
                  final event = controller.events[index];
                  return InkWell(
                    onTap: () {
                      if (controller.questions.any(
                        (question) => question.id == event.questionId,
                      )) {
                        onOpenQuestion(
                          controller.questions.firstWhere(
                            (question) => question.id == event.questionId,
                          ),
                        );
                      } else {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('这是一条归档记录，对应题目已不在当前题库中'),
                          ),
                        );
                      }
                    },
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 13, 18, 13),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 34,
                            height: 34,
                            alignment: Alignment.center,
                            decoration: const BoxDecoration(
                              color: AppColors.primarySoft,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.check_rounded,
                              size: 18,
                              color: AppColors.primary,
                            ),
                          ),
                          const SizedBox(width: 13),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _eventLabel(event.action),
                                  style: const TextStyle(
                                    color: AppColors.ink,
                                    fontSize: 14,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  event.categoryName,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: AppColors.text,
                                    fontSize: 12,
                                    height: 1.35,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 10),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(
                                _shortTime(event.createdAt),
                                style: const TextStyle(
                                  color: AppColors.muted,
                                  fontSize: 11,
                                ),
                              ),
                              const SizedBox(height: 7),
                              _MetaBadge(
                                text: '题号 #${event.serial}',
                                muted: true,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ExportPage extends StatefulWidget {
  const ExportPage({
    super.key,
    required this.controller,
    required this.onOpenCollection,
    required this.onOpenFavorites,
    required this.onOpenRecentPractice,
    required this.onOpenHistory,
    required this.onResetComplete,
  });

  final AppController controller;
  final void Function(String title, List<Question> questions) onOpenCollection;
  final VoidCallback onOpenFavorites;
  final VoidCallback onOpenRecentPractice;
  final VoidCallback onOpenHistory;
  final VoidCallback onResetComplete;

  @override
  State<ExportPage> createState() => _ExportPageState();
}

class _ExportPageState extends State<ExportPage> {
  bool exporting = false;
  bool importing = false;
  bool resetting = false;

  Future<void> _importSyncJson() async {
    setState(() => importing = true);
    try {
      final source = await widget.controller.storage.pickImportJson();
      if (!mounted) return;
      if (source == null) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('已取消导入')));
        return;
      }
      final result = await widget.controller.importSyncJson(source);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '导入完成：更新 ${result.updatedQuestions} 道题，'
            '新增 ${result.importedEvents} 条记录，'
            '忽略 ${result.ignoredQuestionIds} 个未知题号',
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('导入失败：$error')));
      }
    } finally {
      if (mounted) setState(() => importing = false);
    }
  }

  Future<void> _resetAllData() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('清除所有数据和设置？'),
        content: const Text(
          '将清除收藏、复习与掌握状态、作答结果、文字笔记、全部书写画布、'
          '画笔与橡皮设置，以及上次工作位置。题库内容和应用本身不会删除。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xffdc2626),
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认清除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => resetting = true);
    try {
      await widget.controller.resetAllUserData();
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('所有数据和设置已清除')));
      widget.onResetComplete();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('清除失败：$error')));
      }
    } finally {
      if (mounted) setState(() => resetting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final counts = widget.controller.masteryCounts;
    final favoriteCount = widget.controller.questions
        .where(
          (question) =>
              widget.controller.states[question.id]?.favorite ?? false,
        )
        .length;
    final reviewQuestions = widget.controller.reviewQuestions;
    final recentPracticeQuestions = widget.controller.recentPracticeQuestions;
    return Align(
      alignment: Alignment.topCenter,
      child: SingleChildScrollView(
        child: Container(
          width: double.infinity,
          constraints: const BoxConstraints(maxWidth: 940),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
            boxShadow: [
              BoxShadow(
                color: AppColors.ink.withValues(alpha: .035),
                blurRadius: 16,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: AppColors.primarySoft,
                      borderRadius: BorderRadius.all(Radius.circular(10)),
                    ),
                    child: SizedBox(
                      width: 42,
                      height: 42,
                      child: Icon(
                        Icons.folder_copy_outlined,
                        color: AppColors.primary,
                      ),
                    ),
                  ),
                  SizedBox(width: 13),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '本地学习数据',
                          style: TextStyle(
                            color: AppColors.ink,
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        SizedBox(height: 3),
                        Text(
                          '题库与记录只保存在这台设备，无需登录，也不会联网。',
                          style: TextStyle(
                            color: AppColors.muted,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  StatCard(
                    label: '已掌握',
                    value: counts[Mastery.mastered] ?? 0,
                    color: Color(0xff16a34a),
                    icon: Icons.check_circle_outline_rounded,
                    onTap: () => widget.onOpenCollection(
                      '已掌握',
                      widget.controller.questions
                          .where(
                            (question) =>
                                (widget.controller.states[question.id]
                                        ?.mastery ??
                                    Mastery.notStarted) ==
                                Mastery.mastered,
                          )
                          .toList(growable: false),
                    ),
                  ),
                  StatCard(
                    label: '需练习',
                    value: counts[Mastery.needsPractice] ?? 0,
                    color: Color(0xffd97706),
                    icon: Icons.refresh_rounded,
                    onTap: () => widget.onOpenCollection(
                      '需练习',
                      widget.controller.questions
                          .where(
                            (question) =>
                                (widget.controller.states[question.id]
                                        ?.mastery ??
                                    Mastery.notStarted) ==
                                Mastery.needsPractice,
                          )
                          .toList(growable: false),
                    ),
                  ),
                  StatCard(
                    label: '完全不会',
                    value: counts[Mastery.notKnown] ?? 0,
                    color: Color(0xffdc2626),
                    icon: Icons.error_outline_rounded,
                    onTap: () => widget.onOpenCollection(
                      '完全不会',
                      widget.controller.questions
                          .where(
                            (question) =>
                                (widget.controller.states[question.id]
                                        ?.mastery ??
                                    Mastery.notStarted) ==
                                Mastery.notKnown,
                          )
                          .toList(growable: false),
                    ),
                  ),
                  StatCard(
                    label: '收藏',
                    value: favoriteCount,
                    color: Color(0xfff59e0b),
                    icon: Icons.star_border_rounded,
                    onTap: widget.onOpenFavorites,
                  ),
                  StatCard(
                    label: '近期复习',
                    value: recentPracticeQuestions.length,
                    color: Color(0xff0891b2),
                    icon: Icons.schedule_outlined,
                    onTap: widget.onOpenRecentPractice,
                  ),
                  StatCard(
                    label: '复习本',
                    value: reviewQuestions.length,
                    color: Color(0xff7c3aed),
                    icon: Icons.fact_check_outlined,
                    onTap: () =>
                        widget.onOpenCollection('复习本', reviewQuestions),
                  ),
                  StatCard(
                    label: '学习记录',
                    value: widget.controller.events.length,
                    color: AppColors.primary,
                    icon: Icons.history_rounded,
                    onTap: widget.onOpenHistory,
                  ),
                ],
              ),
              const SizedBox(height: 26),
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: AppColors.canvas,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.borderLight),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '备份完成情况',
                      style: TextStyle(
                        color: AppColors.ink,
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      '同步 JSON 包含掌握状态、收藏、作答结果、学习记录和最后阅读位置；'
                      '文字笔记与书写画布不会被导入覆盖。',
                      style: TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                        height: 1.5,
                      ),
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: Column(
                        children: [
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 14,
                                ),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(9),
                                ),
                              ),
                              onPressed: importing || exporting
                                  ? null
                                  : _importSyncJson,
                              icon: const Icon(Icons.file_upload_outlined),
                              label: Text(importing ? '正在导入…' : '导入源站同步 JSON'),
                            ),
                          ),
                          const SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              style: FilledButton.styleFrom(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 14,
                                ),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(9),
                                ),
                              ),
                              onPressed: exporting || importing
                                  ? null
                                  : () async {
                                      setState(() => exporting = true);
                                      try {
                                        final saved =
                                            await widget.controller.export();
                                        if (context.mounted) {
                                          ScaffoldMessenger.of(
                                            context,
                                          ).showSnackBar(
                                            SnackBar(
                                              content: Text(
                                                saved ? '进度文件已保存' : '已取消导出',
                                              ),
                                            ),
                                          );
                                        }
                                      } catch (error) {
                                        if (context.mounted) {
                                          ScaffoldMessenger.of(
                                            context,
                                          ).showSnackBar(
                                            SnackBar(
                                              content: Text('导出失败：$error'),
                                            ),
                                          );
                                        }
                                      } finally {
                                        if (mounted) {
                                          setState(() => exporting = false);
                                        }
                                      }
                                    },
                              icon: const Icon(Icons.file_download_outlined),
                              label: Text(exporting ? '正在导出…' : '导出完成情况（JSON）'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              const Divider(),
              const SizedBox(height: 12),
              const Text(
                '重置应用',
                style: TextStyle(
                  color: AppColors.ink,
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                '此操作不可撤销。题库仍会保留，但你的全部学习数据和设置都会回到空白状态。',
                style: TextStyle(
                  color: AppColors.muted,
                  fontSize: 12,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                key: const ValueKey('reset-all-user-data'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xffdc2626),
                  side: const BorderSide(color: Color(0xfffecaca)),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 13,
                  ),
                ),
                onPressed:
                    importing || exporting || resetting ? null : _resetAllData,
                icon: const Icon(Icons.delete_forever_outlined),
                label: Text(resetting ? '正在清除…' : '清除所有数据和设置'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class StatCard extends StatelessWidget {
  const StatCard({
    super.key,
    required this.label,
    required this.value,
    required this.color,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final int value;
  final Color color;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: 154,
        child: Material(
          color: AppColors.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: AppColors.border),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: .1),
                      borderRadius: BorderRadius.circular(9),
                    ),
                    child: Icon(icon, size: 18, color: color),
                  ),
                  const SizedBox(width: 11),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '$value',
                        style: const TextStyle(
                          color: AppColors.ink,
                          fontSize: 22,
                          height: 1,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        label,
                        style: const TextStyle(
                          color: AppColors.muted,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      );
}

class _PageEmptyState extends StatelessWidget {
  const _PageEmptyState({
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 360,
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 50,
              height: 50,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                color: AppColors.primarySoft,
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: AppColors.primary),
            ),
            const SizedBox(height: 14),
            Text(
              title,
              style: const TextStyle(
                color: AppColors.ink,
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.muted,
                fontSize: 12,
                height: 1.5,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class StatusDot extends StatelessWidget {
  const StatusDot({super.key, required this.mastery});
  final Mastery mastery;

  @override
  Widget build(BuildContext context) {
    final color = switch (mastery) {
      Mastery.mastered => Colors.green,
      Mastery.needsPractice => Colors.orange,
      Mastery.notKnown => Colors.red,
      Mastery.notStarted => Colors.grey,
    };
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

class LoadingPage extends StatelessWidget {
  const LoadingPage({super.key});

  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('正在载入题库…'),
            ],
          ),
        ),
      );
}

class ErrorPage extends StatelessWidget {
  const ErrorPage({super.key, required this.message});
  final String message;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: SelectableText('题库载入失败\n\n$message'),
          ),
        ),
      );
}

String _eventLabel(String action) {
  if (action == 'answer_correct') return '选择题回答正确';
  if (action == 'answer_wrong') return '选择题回答错误';
  if (action.contains('mastered')) return '标记为已掌握';
  if (action.contains('needs_practice')) return '标记为需练习';
  if (action.contains('not_known')) return '标记为完全不会';
  if (action.contains('not_started')) return '清除题目状态';
  return '更新题目状态';
}

String _shortTime(String value) {
  final time = DateTime.tryParse(value);
  if (time == null) return value;
  final local = time.toLocal();
  return '${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')} '
      '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

extension FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
